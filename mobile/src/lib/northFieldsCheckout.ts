import { ApiRequestError } from './api';

export type FieldsFlow = 'pay' | 'store';
export type AchAccountType = 'checking' | 'savings';
export interface FieldsAchTerms { version: string; text: string }

export interface FieldsBreakdown { subtotal: number; tax: number; total: number; previouslyPaid: number; amountDue: number; cardSurchargePercent?: number; cardSurcharge?: number; amountDueWithCard?: number }

export interface FieldsPaySession {
  sessionToken: string;
  scriptUrl: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  breakdown: FieldsBreakdown;
  achTerms: FieldsAchTerms;
}

export interface FieldsStorageSession { sessionToken: string; scriptUrl: string; customerId: string; achTerms: FieldsAchTerms }

export interface FieldsStoredMethod { status: 'stored'; id: string; methodType: 'card' | 'bank_account'; brand: string; last4: string | null; duplicate: boolean }

/** North stored a bank account; nothing is debited or saved until the customer authorizes it. */
export interface FieldsNeedsConsent { status: 'needs_ach_consent'; methodType: 'bank_account'; brand: string; last4: string | null; achTerms: FieldsAchTerms }

export type FieldsConfirmResponse = FieldsConfirmResult | FieldsNeedsConsent;
export type FieldsStoreResponse = FieldsStoredMethod | FieldsNeedsConsent;

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
  | { type: 'host-ready' }
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
 * The native app loads the host page served by our API
 * (`GET /payments/north/fields-host`) so North's production domain policy
 * sees our registered domain as the iframe's parent. The page carries no
 * token: once it posts `host-ready`, React Native injects the mount call
 * below, and later `window.__sfSubmit()` when the user taps Pay / Save.
 */
export function fieldsHostPageUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/payments/north/fields-host`;
}

/** JavaScript to inject into the host page to mount the fields for a session. */
export function fieldsMountInjection(sessionToken: string): string {
  // Escape "<" so a value can never terminate a script element if echoed.
  const literal = JSON.stringify(sessionToken).replace(/</g, '\\u003c');
  return `window.__sfMount && window.__sfMount(${literal}); true;`;
}

export const FIELDS_SUBMIT_INJECTION = 'window.__sfSubmit && window.__sfSubmit(); true;';

export function parseFieldsWebViewMessage(raw: string): FieldsWebViewMessage | null {
  try {
    const data = JSON.parse(raw) as { type?: string; result?: FieldsSubmitResult; message?: string };
    if (data.type === 'host-ready') return { type: 'host-ready' };
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
