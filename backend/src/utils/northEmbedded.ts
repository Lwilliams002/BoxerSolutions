import { ApiError } from './errors';
import { northGatewayService } from '../services/northGatewayService';

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * Decodes (without verifying) the North embedded checkout session JWT to
 * access its claims (session id, requestId, amount). Signature verification is
 * unnecessary here: the token is only trusted after North's status endpoint —
 * queried server-to-server with our private key — reports it approved.
 */
export function decodeNorthSessionToken(token: string): { id?: string; requestId?: string; amount?: number } | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    const session = asRecord(payload.session);
    return {
      id: typeof payload.id === 'string' ? payload.id : (typeof session?.id === 'string' ? session.id : undefined),
      requestId: typeof payload.requestId === 'string' ? payload.requestId : (typeof session?.requestId === 'string' ? session.requestId : undefined),
      amount: typeof payload.amount === 'number' ? payload.amount : (typeof session?.amount === 'number' ? session.amount : undefined),
    };
  } catch {
    return null;
  }
}

export function parseNorthAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(2));
  if (typeof value === 'string') {
    const normalized = value.replace(/[$,]/g, '').trim();
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) return Number(parsed.toFixed(2));
  }
  return null;
}

export function pickNorthTransactionId(statusPayload: Record<string, unknown>, bodyPayload: Record<string, unknown> | null): string | null {
  const fromTop = [statusPayload.transactionId, statusPayload.transaction_id, statusPayload.referenceNumber]
    .find((v) => typeof v === 'string' && v.length > 3) as string | undefined;
  if (fromTop) return fromTop;
  if (!bodyPayload) return null;
  const fullResponse = asRecord(bodyPayload.fullResponse);
  const candidate = [
    // EPX (North processor) field names as observed in production
    bodyPayload.auth_guid,
    bodyPayload.tran_nbr,
    bodyPayload.auth_tran_ident,
    bodyPayload.transactionId,
    bodyPayload.transaction_id,
    bodyPayload.tranId,
    bodyPayload.referenceNumber,
    bodyPayload.authCode,
    fullResponse?.auth_guid,
    fullResponse?.transaction_id,
    fullResponse?.trans_id,
    fullResponse?.reference_number,
    fullResponse?.auth_code,
  ].find((v) => typeof v === 'string' && v.length > 1);
  return (candidate as string | undefined) ?? null;
}

export function pickNorthApprovedAmount(bodyPayload: Record<string, unknown> | null): number | null {
  if (!bodyPayload) return null;
  const fullResponse = asRecord(bodyPayload.fullResponse);
  return (
    // EPX (North processor) field names as observed in production
    parseNorthAmount(bodyPayload.auth_amount)
    ?? parseNorthAmount(bodyPayload.auth_amount_requested)
    ?? parseNorthAmount(bodyPayload.amount)
    ?? parseNorthAmount(bodyPayload.approvedAmount)
    ?? parseNorthAmount(bodyPayload.tranAmount)
    ?? parseNorthAmount(bodyPayload.total)
    ?? parseNorthAmount(fullResponse?.auth_amount)
    ?? parseNorthAmount(fullResponse?.amount)
    ?? parseNorthAmount(fullResponse?.approved_amount)
  );
}

export interface ApprovedNorthSession {
  transactionId: string;
  amount: number;
  sessionStatus: Record<string, unknown>;
}

/**
 * Waits for a North embedded checkout session to reach an approved state and
 * extracts the transaction id + approved amount.
 *
 * North's session status can stay "Open" for several seconds after the
 * checkout confirmation page fires onPaymentComplete, and querying the status
 * too early can race North's own finalization/receipt rendering. The official
 * sample waits 5s before verifying — do the same, then poll.
 */
export async function waitForApprovedNorthSession(sessionToken: string): Promise<ApprovedNorthSession> {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const deadline = Date.now() + 30_000;
  let sessionStatus = await northGatewayService.getEmbeddedSessionStatus(sessionToken);
  let statusData = asRecord(sessionStatus.data) ?? sessionStatus;
  let status = String(statusData.status ?? '').toLowerCase();
  while (status !== 'approved' && !['declined', 'failed', 'error', 'expired', 'cancelled', 'canceled'].includes(status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    sessionStatus = await northGatewayService.getEmbeddedSessionStatus(sessionToken);
    statusData = asRecord(sessionStatus.data) ?? sessionStatus;
    status = String(statusData.status ?? '').toLowerCase();
  }
  if (status !== 'approved') {
    throw new ApiError(409, `North checkout session is ${status || 'not approved'}.`);
  }

  const responseBody = asRecord(statusData.body) ?? asRecord(sessionStatus.body);
  const sessionClaims = decodeNorthSessionToken(sessionToken);
  const approvedAmount = pickNorthApprovedAmount(responseBody)
    ?? parseNorthAmount(statusData.amount)
    ?? parseNorthAmount(sessionClaims?.amount);
  const transactionId = pickNorthTransactionId(statusData, responseBody)
    // Fall back to North's own unique session/request identifiers — stable
    // per checkout session, which keeps duplicate detection intact.
    ?? (typeof sessionClaims?.requestId === 'string' && sessionClaims.requestId.length > 3 ? `north_req_${sessionClaims.requestId}` : null)
    ?? (typeof sessionClaims?.id === 'string' && sessionClaims.id.length > 3 ? `north_session_${sessionClaims.id}` : null);
  if (!transactionId) {
    throw new ApiError(502, 'North approval response did not include a transaction identifier.');
  }
  if (approvedAmount == null || approvedAmount <= 0) {
    throw new ApiError(502, 'North approval response did not include a valid amount.');
  }
  return { transactionId, amount: approvedAmount, sessionStatus };
}

export interface NorthStorageResult {
  bric: string;
  brand: string;
  last4: string | null;
  expirationMonth: number | null;
  expirationYear: number | null;
  sessionStatus: Record<string, unknown>;
}

function pickString(...candidates: unknown[]): string | null {
  const found = candidates.find((v) => typeof v === 'string' && v.trim().length > 0);
  return (found as string | undefined)?.trim() ?? null;
}

/**
 * Waits for an Embedded Checkout STORAGE session to complete and extracts the
 * BRIC (stored payment token) plus display metadata. The BRIC is returned by
 * EPX as AUTH_GUID on storage transactions.
 */
export async function waitForNorthStorageResult(sessionToken: string): Promise<NorthStorageResult> {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const deadline = Date.now() + 30_000;
  let sessionStatus = await northGatewayService.getEmbeddedSessionStatus(sessionToken, 'storage');
  let statusData = asRecord(sessionStatus.data) ?? sessionStatus;
  let status = String(statusData.status ?? '').toLowerCase();
  while (!['approved', 'completed', 'complete', 'success'].includes(status)
    && !['declined', 'failed', 'error', 'expired', 'cancelled', 'canceled'].includes(status)
    && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    sessionStatus = await northGatewayService.getEmbeddedSessionStatus(sessionToken, 'storage');
    statusData = asRecord(sessionStatus.data) ?? sessionStatus;
    status = String(statusData.status ?? '').toLowerCase();
  }
  if (!['approved', 'completed', 'complete', 'success'].includes(status)) {
    throw new ApiError(409, `North storage session is ${status || 'not complete'}.`);
  }

  const body = asRecord(statusData.body) ?? asRecord(sessionStatus.body);
  const fullResponse = body ? asRecord(body.fullResponse) : null;
  const bric = pickString(
    body?.bric, body?.BRIC, body?.token,
    body?.auth_guid, body?.AUTH_GUID,
    fullResponse?.BRIC, fullResponse?.bric, fullResponse?.AUTH_GUID, fullResponse?.auth_guid,
    statusData.bric, statusData.token,
  );
  if (!bric) {
    throw new ApiError(502, 'North storage response did not include a BRIC token.');
  }

  const brand = pickString(
    body?.card_type, body?.cardType, body?.auth_card_type, body?.card_brand,
    fullResponse?.AUTH_CARD_TYPE, fullResponse?.card_type,
  ) ?? 'Card';
  const masked = pickString(
    body?.masked_pan, body?.maskedPan, body?.account_number, body?.last_four, body?.lastFour,
    fullResponse?.AUTH_MASKED_ACCOUNT_NBR, fullResponse?.masked_pan,
  );
  const last4 = masked ? masked.replace(/\D/g, '').slice(-4) || null : null;

  // Expiry may arrive as YYMM (EPX) or MM/YY.
  let expirationMonth: number | null = null;
  let expirationYear: number | null = null;
  const expRaw = pickString(body?.exp_date, body?.expDate, fullResponse?.AUTH_EXP_DATE, fullResponse?.exp_date);
  if (expRaw) {
    const digits = expRaw.replace(/\D/g, '');
    if (digits.length === 4) {
      const a = Number(digits.slice(0, 2));
      const b = Number(digits.slice(2));
      if (a >= 1 && a <= 12) {
        expirationMonth = a;
        expirationYear = 2000 + b;
      } else {
        expirationYear = 2000 + a;
        expirationMonth = b >= 1 && b <= 12 ? b : null;
      }
    }
  }
  return { bric, brand, last4, expirationMonth, expirationYear, sessionStatus };
}

