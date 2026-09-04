import crypto from 'crypto';
import { config } from '../config';
import { ApiError } from '../utils/errors';
import { northCertLog } from '../utils/northCertLog';

/**
 * EPX / North Embedded Checkout Payments API.
 *
 * Per EPX Integration guidance the Server Post API is NOT required — the
 * Embedded Checkout API covers everything:
 *
 *   POST /api/payments/token/sale   — charge a stored BRIC token
 *   PUT  /api/payments/reversal     — void an unsettled transaction
 *   PUT  /api/payments/refund       — refund a settled transaction
 *
 * Merchant-Initiated (MIT) token sales (AutoPay / recurring billing) must
 * include the `aci_ext` field (e.g. "RB" for Recurring Billing). It is
 * omitted for Customer-Initiated (CIT) transactions.
 *
 * Auth reuses the Embedded Checkout private API key (Bearer). BRICs are
 * produced by an Embedded Checkout STORAGE (Fields) session, so the Fields
 * checkout credentials are used when configured. No raw card data ever
 * touches this service.
 *
 * Every raw request/response is appended to the North certification log
 * (logs/north-cert.log).
 */

export interface EpxPaymentResult {
  approved: boolean;
  authGuid: string | null;
  authCode: string | null;
  responseCode: string | null;
  responseText: string | null;
  raw: Record<string, unknown>;
}

export interface TokenSaleOptions {
  /** Merchant-Initiated Transaction (AutoPay / recurring). Adds aci_ext. */
  mit?: boolean;
  /** ACI extension value for MIT transactions. Defaults to RB (Recurring Billing). */
  aciExt?: string;
  tranNbr?: string;
  invoiceNbr?: string;
  orderNbr?: string;
}

interface Credentials {
  checkoutId: string;
  profileId: string;
  apiKey: string;
}

function credentials(): Credentials {
  // BRIC tokens originate from the Fields (STORAGE) checkout when configured.
  if (config.north.embeddedFieldsCheckoutId) {
    return {
      checkoutId: config.north.embeddedFieldsCheckoutId,
      profileId: config.north.embeddedFieldsProfileId || config.north.embeddedProfileId,
      apiKey: config.north.embeddedFieldsPrivateApiKey || config.north.embeddedPrivateApiKey,
    };
  }
  return {
    checkoutId: config.north.embeddedCheckoutId,
    profileId: config.north.embeddedProfileId,
    apiKey: config.north.embeddedPrivateApiKey,
  };
}

function assertConfigured() {
  const creds = credentials();
  if (!creds.checkoutId || !creds.profileId || !creds.apiKey) {
    throw new ApiError(
      424,
      'North Embedded Checkout is not configured. Set NORTH_EMBEDDED_CHECKOUT_ID, NORTH_EMBEDDED_PROFILE_ID, and NORTH_EMBEDDED_PRIVATE_API_KEY.',
    );
  }
}

function firstString(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number') return String(value);
  }
  const nested = raw.data;
  if (nested && typeof nested === 'object') {
    return firstString(nested as Record<string, unknown>, keys);
  }
  return null;
}

function parseResult(raw: Record<string, unknown>): EpxPaymentResult {
  const responseCode = firstString(raw, ['AUTH_RESP', 'authResp', 'responseCode', 'response_code', 'code']);
  const responseText = firstString(raw, ['AUTH_RESP_TEXT', 'authRespText', 'responseText', 'response_text', 'text', 'message']);
  const authGuid = firstString(raw, ['AUTH_GUID', 'authGuid', 'guid', 'transactionId', 'transaction_id', 'BRIC', 'bric']);
  const authCode = firstString(raw, ['AUTH_CODE', 'authCode', 'auth_code']);
  const flagApproved = raw.approved === true || raw.success === true || raw.successful === true
    || (typeof raw.status === 'string' && ['approved', 'success'].includes(raw.status.toLowerCase()));
  return {
    approved: responseCode === '00' || (responseCode == null && flagApproved),
    authGuid,
    authCode,
    responseCode,
    responseText,
    raw,
  };
}

async function request(
  label: string,
  method: 'POST' | 'PUT',
  path: string,
  body: Record<string, unknown>,
): Promise<EpxPaymentResult> {
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
  const payload = { checkoutId: creds.checkoutId, profileId: creds.profileId, ...body };
  const res = await fetch(url, { method, headers, body: JSON.stringify(payload) });
  const text = await res.text().catch(() => '');
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    data = null;
  }
  northCertLog({
    api: 'Embedded Checkout Payments',
    label,
    method,
    url,
    requestHeaders: headers,
    requestBody: payload,
    status: res.status,
    statusText: res.statusText,
    responseBody: data ?? text,
  });
  if (!res.ok) {
    const detail = data ? firstString(data, ['message', 'error', 'detail', 'AUTH_RESP_TEXT', 'text']) : text.trim() || null;
    const requestId = res.headers.get('x-request-id');
    throw new ApiError(
      502,
      `EPX ${label} failed: HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}${requestId ? ` (North request id: ${requestId})` : ''}`,
    );
  }
  return parseResult(data ?? {});
}

export const epxEmbeddedPaymentsService = {
  isConfigured(): boolean {
    const creds = credentials();
    return Boolean(creds.checkoutId && creds.profileId && creds.apiKey);
  },

  /**
   * TOKEN SALE — charge a stored BRIC via POST /api/payments/token/sale.
   * MIT transactions (AutoPay / recurring billing) include aci_ext (RB);
   * CIT transactions omit it per EPX guidance.
   */
  async tokenSale(bric: string, amount: number, options: TokenSaleOptions = {}): Promise<EpxPaymentResult> {
    const tranNbr = options.tranNbr ?? String(crypto.randomInt(1, 2_147_483_647));
    return request('TOKEN SALE (BRIC)', 'POST', '/api/payments/token/sale', {
      amount: Number(amount.toFixed(2)),
      token: bric,
      tranNbr,
      ...(options.mit ? { aci_ext: options.aciExt ?? 'RB' } : {}),
      ...(options.invoiceNbr ? { invoiceNbr: options.invoiceNbr } : {}),
      ...(options.orderNbr ? { orderId: options.orderNbr } : {}),
    });
  },

  /** REVERSAL (void) — full amount, before settlement. PUT /api/payments/reversal. */
  async reversal(transactionGuid: string): Promise<EpxPaymentResult> {
    return request('REVERSAL (VOID)', 'PUT', '/api/payments/reversal', {
      transaction: transactionGuid,
    });
  },

  /** REFUND — full or partial, after settlement. PUT /api/payments/refund. */
  async refund(transactionGuid: string, amount: number): Promise<EpxPaymentResult> {
    return request('REFUND', 'PUT', '/api/payments/refund', {
      transaction: transactionGuid,
      amount: Number(amount.toFixed(2)),
    });
  },
};

