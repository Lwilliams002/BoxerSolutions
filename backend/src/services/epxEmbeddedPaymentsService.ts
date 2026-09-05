import { config } from '../config';
import { ApiError } from '../utils/errors';
import { northCertLog } from '../utils/northCertLog';
import {
  buildRefundBody, buildReversalBody, buildTokenSaleBody, buildVoidBody, parseEpxResponse,
  type EpxPaymentMethod, type EpxResult, type TokenSaleInput,
} from './epx/epxPayloads';

/**
 * North Embedded Checkout Payments API (EPX processor).
 *
 *   POST /api/payments/token/sale  — charge a stored BRIC (orig_auth_guid)
 *   PUT  /api/payments/refund      — return funds after settlement
 *   PUT  /api/payments/reversal    — release a card authorization / void pre-settlement
 *   PUT  /api/payments/void        — stop a sale/refund pre-settlement (cards and ACH)
 *
 * Bodies contain only spec fields (see services/epx/epxPayloads.ts). The
 * checkout's private API key authenticates; CheckoutId/ProfileId are sent as
 * headers. Every request/response is appended to the certification log.
 */

function credentials() {
  return {
    checkoutId: config.north.embeddedCheckoutId,
    profileId: config.north.embeddedProfileId,
    apiKey: config.north.embeddedPrivateApiKey,
  };
}

function assertConfigured() {
  const c = credentials();
  if (!c.checkoutId || !c.profileId || !c.apiKey) {
    throw new ApiError(424, 'North Embedded Checkout is not configured. Set NORTH_EMBEDDED_CHECKOUT_ID, NORTH_EMBEDDED_PROFILE_ID, and NORTH_EMBEDDED_PRIVATE_API_KEY.');
  }
}

async function request(label: string, method: 'POST' | 'PUT', path: string, body: Record<string, unknown>): Promise<EpxResult> {
  assertConfigured();
  const creds = credentials();
  const url = `${config.north.embeddedBaseUrl}${path}`;
  const headers = {
    Authorization: `Bearer ${creds.apiKey}`,
    'Content-Type': 'application/json',
    CheckoutId: creds.checkoutId,
    ProfileId: creds.profileId,
    'User-Agent': 'ServiceFinance Embedded Checkout',
  };
  const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
  const text = await res.text().catch(() => '');
  let data: Record<string, unknown> | null = null;
  try { data = text ? (JSON.parse(text) as Record<string, unknown>) : null; } catch { data = null; }
  northCertLog({
    api: 'Embedded Checkout Payments', label, method, url,
    requestHeaders: headers, requestBody: body,
    status: res.status, statusText: res.statusText, responseBody: data ?? text,
  });
  const parsed = parseEpxResponse(data);
  // A processor decline can arrive with a non-2xx status but still carries
  // auth_resp; report it as a decline rather than a transport failure.
  if (res.ok || parsed.responseCode) return parsed;
  const detail = parsed.responseText ?? (text.trim() || null);
  const requestId = res.headers.get('x-request-id');
  throw new ApiError(
    502,
    `EPX ${label} failed: HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}${requestId ? ` (North request id: ${requestId})` : ''}`,
    data ?? { status: res.status, body: text || null },
  );
}

export const epxEmbeddedPaymentsService = {
  isConfigured(): boolean {
    const c = credentials();
    return Boolean(c.checkoutId && c.profileId && c.apiKey);
  },

  /** TOKEN SALE — charge a stored BRIC. MIT charges carry aci_ext: 'RB'. */
  tokenSale(input: TokenSaleInput): Promise<EpxResult> {
    return request(input.mit ? 'TOKEN SALE (MIT)' : 'TOKEN SALE (CIT)', 'POST', '/api/payments/token/sale', buildTokenSaleBody(input));
  },

  /** REFUND — after settlement, full or partial. */
  refund(input: { authGuid: string; amount: number; paymentMethod: EpxPaymentMethod }): Promise<EpxResult> {
    return request('REFUND', 'PUT', '/api/payments/refund', buildRefundBody(input));
  },

  /** REVERSAL — card only, before settlement. */
  reversal(input: { authGuid: string }): Promise<EpxResult> {
    return request('REVERSAL', 'PUT', '/api/payments/reversal', buildReversalBody(input));
  },

  /** VOID — card or ACH, before settlement. */
  voidTransaction(input: { authGuid: string; paymentMethod: EpxPaymentMethod }): Promise<EpxResult> {
    return request('VOID', 'PUT', '/api/payments/void', buildVoidBody(input));
  },
};
