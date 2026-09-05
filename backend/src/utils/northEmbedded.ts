import { ApiError } from './errors';
import { northGatewayService } from '../services/northGatewayService';
import { extractNorthSessionResult, type NorthMethodType, type NorthSessionResult } from './northSessionResult';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fields' checkout.submit() resolves before the client calls us, so North's
 * status endpoint is usually final on the first poll; keep polling briefly
 * because the "Approved" write can lag the client callback by a few seconds.
 */
export async function waitForNorthSession(
  sessionToken: string,
  expected: NorthMethodType,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<NorthSessionResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let result = extractNorthSessionResult(await northGatewayService.getEmbeddedSessionStatus(sessionToken), expected);
  while (!result.terminal && Date.now() < deadline) {
    await sleep(intervalMs);
    result = extractNorthSessionResult(await northGatewayService.getEmbeddedSessionStatus(sessionToken), expected);
  }
  if (result.declined) {
    const reason = result.responseText ? ` (${result.responseText})` : '';
    throw new ApiError(402, `The payment was declined by the processor${reason}. Please try a different payment method.`);
  }
  if (!result.approved) {
    if (['expired', 'cancelled', 'canceled'].includes(result.status)) {
      throw new ApiError(409, 'The checkout session has expired or was cancelled. Please start again.');
    }
    throw new ApiError(409, `The payment has not completed (North session status: ${result.status || 'unknown'}). Please try again.`);
  }
  if (!result.authGuid) {
    throw new ApiError(502, 'North approved the session but did not return a payment token (auth_guid).');
  }
  return result;
}

