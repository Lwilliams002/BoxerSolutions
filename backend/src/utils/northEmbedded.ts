import { ApiError } from './errors';
import { northGatewayService } from '../services/northGatewayService';
import { extractNorthSessionResult, type NorthMethodType, type NorthSessionResult } from './northSessionResult';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const ENDED_STATUSES = ['expired', 'cancelled', 'canceled'];

/**
 * Fields' checkout.submit() resolves before the client calls us, so North's
 * status endpoint is usually final on the first poll; keep polling briefly
 * because the "Approved" write can lag the client callback by a few seconds.
 *
 * A status call that errors is never fatal on its own: for a bank (ACH) session
 * the money has already moved by the time we are called, so a transient gateway
 * hiccup must not abort the wait. We remember the error, keep polling, and only
 * surface it if the deadline passes without any usable status.
 */
export async function waitForNorthSession(
  sessionToken: string,
  expected: NorthMethodType,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<NorthSessionResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let result: NorthSessionResult | null = null;
  let lastError: unknown = null;

  for (;;) {
    try {
      result = extractNorthSessionResult(await northGatewayService.getEmbeddedSessionStatus(sessionToken), expected);
      if (result.terminal) break;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    await sleep(intervalMs);
  }

  if (!result || (!result.terminal && lastError)) {
    const detail = lastError instanceof Error && lastError.message ? `: ${lastError.message}` : '';
    throw new ApiError(502, `Could not read the payment status from North${detail}. The payment may still have gone through — check before retrying.`);
  }
  if (result.declined) {
    const reason = result.responseText ? ` (${result.responseText})` : '';
    throw new ApiError(402, `The payment was declined by the processor${reason}. Please try a different payment method.`);
  }
  if (!result.approved) {
    if (ENDED_STATUSES.includes(result.status)) {
      throw new ApiError(409, 'The checkout session has expired or was cancelled. Please start again.');
    }
    if (result.terminal) {
      // Terminal but neither approved nor declined: North reported a final
      // status with a non-approval response code (auth_resp !== '00').
      const reason = result.responseText ? ` (${result.responseText})` : '';
      throw new ApiError(402, `The payment was not approved by the processor${reason}. Please try a different payment method.`);
    }
    throw new ApiError(409, `The payment has not completed (North session status: ${result.status || 'unknown'}). Please try again.`);
  }
  if (!result.authGuid) {
    throw new ApiError(502, 'North approved the session but did not return a payment token (auth_guid).');
  }
  return result;
}
