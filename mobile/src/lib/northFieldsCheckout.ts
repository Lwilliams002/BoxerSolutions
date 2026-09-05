import { ApiRequestError } from './api';

export type FieldsPayMode = 'card' | 'bank';
export type FieldsFlow = 'pay' | 'store';

export interface FieldsBreakdown { subtotal: number; tax: number; total: number; previouslyPaid: number; amountDue: number }

export interface FieldsPaySession {
  sessionToken: string;
  scriptUrl: string;
  mode: FieldsPayMode;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  breakdown: FieldsBreakdown;
  achTerms: { version: string; text: string } | null;
}

export interface FieldsStorageSession { sessionToken: string; scriptUrl: string; customerId: string }

export interface FieldsStoredMethod { id: string; methodType: 'card' | 'bank_account'; brand: string; last4: string | null; duplicate: boolean }

export interface FieldsConfirmResult {
  status: 'approved';
  duplicate: boolean;
  amount: number | null;
  transactionId: string | null;
  receipt: { receiptNumber?: string } | null;
  savedMethod: { id: string; methodType: 'card' | 'bank_account'; brand: string; last4: string | null } | null;
}

export interface FieldsSubmitResult { type: 'success' | 'failure'; status?: number; data?: Record<string, unknown> }

export type FieldsWebViewMessage =
  | { type: 'fields-ready' }
  | { type: 'fields-result'; result: FieldsSubmitResult }
  | { type: 'fields-error'; message: string };

declare global {
  interface Window {
    checkout?: {
      mount?: (sessionToken: string, containerId: string) => Promise<void> | void;
      submit?: () => Promise<FieldsSubmitResult>;
      onPaymentComplete?: (callback: (payload: unknown) => void) => (() => void) | void;
    };
  }
}

// ---- Web (DOM) helpers ------------------------------------------------------

let scriptPromise: Promise<void> | null = null;
let loadedScriptUrl = '';

export function ensureCheckoutScript(scriptUrl: string): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  if (typeof window.checkout?.mount === 'function' && loadedScriptUrl === scriptUrl) return Promise.resolve();
  if (scriptPromise && loadedScriptUrl === scriptUrl) return scriptPromise;
  loadedScriptUrl = scriptUrl;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const fail = (message: string) => {
      scriptPromise = null;
      loadedScriptUrl = '';
      reject(new Error(message));
    };
    const finish = () => (typeof window.checkout?.mount === 'function' ? resolve() : fail('North checkout API did not load correctly.'));
    const existing = Array.from(document.scripts).find((s) => s.src === scriptUrl);
    if (existing) {
      if (typeof window.checkout?.mount === 'function') return resolve();
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => fail('Unable to load North checkout script.'), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.onload = finish;
    script.onerror = () => fail('Unable to load North checkout script.');
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function mountFields(sessionToken: string, containerId: string): Promise<void> {
  if (typeof window.checkout?.mount !== 'function') throw new Error('North checkout API is not ready.');
  const host = document.getElementById(containerId);
  if (host) host.innerHTML = '';
  await window.checkout.mount(sessionToken, containerId);
}

export async function submitFields(): Promise<FieldsSubmitResult> {
  if (typeof window.checkout?.submit !== 'function') throw new Error('North checkout API is not ready.');
  const result = await window.checkout.submit();
  if (!result || (result.type !== 'success' && result.type !== 'failure')) {
    throw new Error('North returned an unexpected response from the payment fields.');
  }
  return result;
}

export function describeFieldsFailure(result: FieldsSubmitResult): string {
  const data = result.data ?? {};
  const text = [data.auth_resp_text, data.message, data.error].find((v) => typeof v === 'string' && v.length > 0) as string | undefined;
  return text ?? 'The payment was not approved. Please check the details and try again.';
}

// ---- Native (WebView) helpers ----------------------------------------------

/**
 * Standalone page for react-native-webview. It mounts the Fields inputs and
 * exposes window.__sfSubmit(), which React Native invokes via
 * injectJavaScript when the user taps our Pay / Save button. Results are
 * posted back as FieldsWebViewMessage JSON strings.
 */
export function buildFieldsWebViewHtml(sessionToken: string, scriptUrl: string): string {
  const safeToken = JSON.stringify(sessionToken);
  const safeScriptUrl = JSON.stringify(scriptUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      #fields-root { width: 100%; min-height: 260px; padding: 8px; box-sizing: border-box; }
      #fields-root iframe { width: 100% !important; border: 0; display: block; }
      #status { color: #5f6b68; font-size: 14px; text-align: center; margin: 16px 0 8px; }
      #error { color: #c0352b; font-size: 14px; text-align: center; margin: 16px 0; display: none; }
    </style>
  </head>
  <body>
    <div id="status">Loading secure payment form…</div>
    <div id="error"></div>
    <div id="fields-root"></div>
    <script>
      (function () {
        var sessionToken = ${safeToken};
        var scriptUrl = ${safeScriptUrl};
        var statusEl = document.getElementById('status');
        var errorEl = document.getElementById('error');
        var busy = false;
        function send(message) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
        function showError(message) {
          if (statusEl) statusEl.style.display = 'none';
          if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = message; }
          send({ type: 'fields-error', message: message });
        }
        window.__sfSubmit = function () {
          if (busy) return;
          if (!window.checkout || typeof window.checkout.submit !== 'function') { showError('The payment form is not ready.'); return; }
          busy = true;
          Promise.resolve(window.checkout.submit())
            .then(function (result) { busy = false; send({ type: 'fields-result', result: result || { type: 'failure', data: {} } }); })
            .catch(function (err) { busy = false; showError(err && err.message === 'Submit timeout' ? 'The payment is taking longer than expected. Please try again.' : (err && err.message) || 'The payment could not be submitted.'); });
        };
        var script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.onload = function () {
          if (!window.checkout || typeof window.checkout.mount !== 'function') { showError('North checkout API did not load correctly.'); return; }
          Promise.resolve(window.checkout.mount(sessionToken, 'fields-root'))
            .then(function () { if (statusEl) statusEl.style.display = 'none'; send({ type: 'fields-ready' }); })
            .catch(function (err) { showError(err && err.message ? err.message : 'Unable to open the payment form.'); });
        };
        script.onerror = function () { showError('Unable to load North checkout script.'); };
        document.head.appendChild(script);
      })();
    </script>
  </body>
</html>`;
}

export function parseFieldsWebViewMessage(raw: string): FieldsWebViewMessage | null {
  try {
    const data = JSON.parse(raw) as { type?: string; result?: FieldsSubmitResult; message?: string };
    if (data.type === 'fields-ready') return { type: 'fields-ready' };
    if (data.type === 'fields-result' && data.result) return { type: 'fields-result', result: data.result };
    if (data.type === 'fields-error') return { type: 'fields-error', message: data.message ?? 'Unable to open the payment form.' };
    return null;
  } catch {
    return null;
  }
}

// ---- Shared -------------------------------------------------------------------

export const NORTH_SANDBOX_TEST_CARDS: readonly { brand: string; number: string; result: string }[] = __DEV__
  ? [
      { brand: 'Visa', number: '4111 1111 1111 1111', result: 'Successful transaction' },
      { brand: 'Amex', number: '3700 000000 00002', result: 'Successful transaction' },
    ]
  : [];

export const NORTH_SANDBOX_TEST_DETAILS: readonly string[] = __DEV__
  ? ['Draft Mode uses North Sandbox automatically.', 'Expiration: any future date, e.g. 12/30', 'CVV: any 3 digits, or 4 digits for Amex', 'ZIP: any 5 digits, e.g. 12345']
  : [];

export function formatEmbeddedCheckoutError(error: unknown) {
  if (!(error instanceof ApiRequestError)) {
    return error instanceof Error && error.message ? error.message : 'Unable to start checkout.';
  }
  const base = error.message || 'Unable to start checkout.';
  const data = (error.data && typeof error.data === 'object') ? (error.data as Record<string, unknown>) : null;
  const upstream = (data?.upstream && typeof data.upstream === 'object') ? (data.upstream as Record<string, unknown>) : null;
  const config = (data?.config && typeof data.config === 'object') ? (data.config as Record<string, unknown>) : null;
  const request = (data?.request && typeof data.request === 'object') ? (data.request as Record<string, unknown>) : null;
  const requestId = typeof upstream?.requestId === 'string' ? upstream.requestId : null;
  const statusText = typeof upstream?.statusText === 'string' ? upstream.statusText : null;
  const status = typeof upstream?.status === 'number' ? upstream.status : null;
  const diagnostics: string[] = [];

  if (requestId) diagnostics.push(`North request id: ${requestId}`);
  if (status || statusText) diagnostics.push(`North upstream: ${status ?? 'unknown'}${statusText ? ` ${statusText}` : ''}`.trim());

  const keyLength = typeof config?.embeddedPrivateApiKeyLength === 'number' ? config.embeddedPrivateApiKeyLength : null;
  const checkoutLooksUuid = typeof config?.embeddedCheckoutIdLooksUuid === 'boolean' ? config.embeddedCheckoutIdLooksUuid : null;
  const profileLooksUuid = typeof config?.embeddedProfileIdLooksUuid === 'boolean' ? config.embeddedProfileIdLooksUuid : null;
  const keyLooksHex = typeof config?.embeddedPrivateApiKeyLooksHex === 'boolean' ? config.embeddedPrivateApiKeyLooksHex : null;
  if (keyLength != null || checkoutLooksUuid != null || profileLooksUuid != null || keyLooksHex != null) {
    diagnostics.push(
      [
        checkoutLooksUuid != null ? `checkoutId uuid=${checkoutLooksUuid ? 'yes' : 'no'}` : null,
        profileLooksUuid != null ? `profileId uuid=${profileLooksUuid ? 'yes' : 'no'}` : null,
        keyLooksHex != null ? `apiKey hex=${keyLooksHex ? 'yes' : 'no'}` : null,
        keyLength != null ? `apiKey length=${keyLength}` : null,
      ].filter(Boolean).join(' · '),
    );
  }

  const productCount = typeof request?.productCount === 'number' ? request.productCount : null;
  const hasOrderId = typeof request?.hasOrderId === 'boolean' ? request.hasOrderId : null;
  const hasEmail = typeof request?.hasEmail === 'boolean' ? request.hasEmail : null;
  if (productCount != null || hasOrderId != null || hasEmail != null) {
    diagnostics.push(
      [
        productCount != null ? `products=${productCount}` : null,
        hasOrderId != null ? `orderId=${hasOrderId ? 'yes' : 'no'}` : null,
        hasEmail != null ? `email=${hasEmail ? 'yes' : 'no'}` : null,
      ].filter(Boolean).join(' · '),
    );
  }

  if (!diagnostics.length) return base;
  return `${base}\n\n${diagnostics.join('\n')}`;
}
