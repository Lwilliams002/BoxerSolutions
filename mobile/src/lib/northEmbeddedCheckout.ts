import { ApiRequestError } from './api';

export interface SessionResponse {
  sessionToken: string;
  checkoutId: string;
  scriptUrl: string;
  amount: number;
  invoiceId: string;
}

export interface ConfirmResponse {
  status: 'approved';
  transactionId: string;
  amount: number;
  duplicate: boolean;
  payment?: {
    id: string;
  };
}

export type CheckoutMessage =
  | { type: 'checkout-loaded' }
  | { type: 'payment-complete'; payload?: { status?: string; transactionId?: string; amount?: number; [key: string]: unknown } }
  | { type: 'checkout-error'; message?: string };

export const NORTH_SANDBOX_TEST_CARDS = [
  { brand: 'Visa', number: '4111 1111 1111 1111', result: 'Successful transaction' },
  { brand: 'Amex', number: '3700 000000 00002', result: 'Successful transaction' },
] as const;

export const NORTH_SANDBOX_TEST_DETAILS = [
  'Draft Mode uses North Sandbox automatically.',
  'Expiration: any future date, e.g. 12/30',
  'CVV: any 3 digits, or 4 digits for Amex',
  'ZIP: any 5 digits, e.g. 12345',
] as const;

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

