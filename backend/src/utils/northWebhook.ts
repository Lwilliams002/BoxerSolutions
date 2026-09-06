import crypto from 'crypto';

/**
 * Pure helpers for North Embedded Checkout webhooks. No config, no I/O.
 *
 * North posts two webhooks to `{webhookURL}/transaction` and
 * `{webhookURL}/signup`:
 *  - transaction: signed with the checkout's private API key as
 *    `X-YourApp-Signature-256: v1=<hex>` over `<X-YourApp-Timestamp>.<raw body>`
 *  - signup: signed with the `sec_…` signing secret as
 *    `X-Webhook-Signature: t=<ts>,v1=<hex>` over `<ts>.<raw body>`
 * Older deliveries used a bare hex HMAC over the raw body. All three shapes
 * are accepted; every candidate key is tried.
 */

export interface NorthWebhookVerifyInput {
  rawBody: string;
  /** Lower-cased header names → values. */
  headers: Record<string, string | undefined>;
  /** Candidate HMAC keys (private API key, sec_ secret, legacy secret). */
  keys: string[];
}

function timingSafeEqualHex(expected: string, actual: string): boolean {
  const a = Buffer.from(expected.toLowerCase(), 'utf8');
  const b = Buffer.from(actual.trim().toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hmacHex(key: string, message: string): string {
  return crypto.createHmac('sha256', key).update(message).digest('hex');
}

interface ParsedSignature { v1: string; timestamp: string | null }

function parseSignatureHeader(value: string, timestampHeader: string | undefined): ParsedSignature | null {
  const signed = value.trim();
  if (!signed) return null;
  if (signed.includes('t=') && signed.includes('v1=')) {
    const parts = signed.split(',').map((p) => p.trim());
    const t = parts.find((p) => p.startsWith('t='))?.slice(2);
    const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
    return t && v1 ? { v1, timestamp: t } : null;
  }
  if (signed.startsWith('v1=')) return { v1: signed.slice(3), timestamp: timestampHeader?.trim() || null };
  return { v1: signed, timestamp: timestampHeader?.trim() || null };
}

export function verifyNorthWebhookSignature({ rawBody, headers, keys }: NorthWebhookVerifyInput): boolean {
  const candidates = ['x-yourapp-signature-256', 'x-webhook-signature', 'x-signature', 'north-signature']
    .map((name) => headers[name])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const usableKeys = keys.filter((k) => typeof k === 'string' && k.length > 0);
  if (!candidates.length || !usableKeys.length) return false;
  const timestamp = headers['x-yourapp-timestamp'] ?? headers['x-webhook-timestamp'];
  for (const header of candidates) {
    const parsed = parseSignatureHeader(header, timestamp);
    if (!parsed) continue;
    for (const key of usableKeys) {
      if (parsed.timestamp && timingSafeEqualHex(hmacHex(key, `${parsed.timestamp}.${rawBody}`), parsed.v1)) return true;
      if (timingSafeEqualHex(hmacHex(key, rawBody), parsed.v1)) return true;
    }
  }
  return false;
}

export interface NorthWebhookCardUpdate {
  authGuid: string;
  expirationMonth: number | null;
  expirationYear: number | null;
  last4: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : typeof value === 'number' ? String(value) : null;
}

/**
 * Parses a 4-digit expiry. EPX uses YYMM ("2904" = April 2029); the webhook's
 * fullRequest echoes what the form sent ("1228" = December 2028). A pair that
 * cannot be a month must be the year, which disambiguates every future date.
 */
export function parseWebhookExpiry(raw: string | null): { month: number | null; year: number | null } {
  if (!raw) return { month: null, year: null };
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 4) return { month: null, year: null };
  const a = Number(digits.slice(0, 2));
  const b = Number(digits.slice(2));
  if (raw.includes('/')) return { month: a >= 1 && a <= 12 ? a : null, year: 2000 + b };
  if (b >= 1 && b <= 12) return { month: b, year: 2000 + a };
  if (a >= 1 && a <= 12) return { month: a, year: 2000 + b };
  return { month: null, year: null };
}

/** Pulls the token + card display details out of a transaction webhook body. */
export function extractNorthWebhookCardUpdate(body: unknown): NorthWebhookCardUpdate | null {
  const root = asRecord(body);
  if (!root) return null;
  const transaction = asRecord(root.transaction) ?? root;
  const fullResponse = asRecord(transaction.fullResponse);
  const fullRequest = asRecord(transaction.fullRequest);
  const authGuid = str(transaction.authGuid) ?? str(transaction.auth_guid) ?? str(fullResponse?.auth_guid) ?? str(fullResponse?.AUTH_GUID);
  if (!authGuid) return null;
  const exp = parseWebhookExpiry(str(fullRequest?.EXP_DATE) ?? str(fullRequest?.exp_date) ?? str(transaction.expDate) ?? str(transaction.exp_date));
  const masked = str(transaction.lastFour) ?? str(transaction.maskedAccountNumber) ?? str(fullResponse?.auth_masked_account_nbr) ?? str(fullRequest?.ACCOUNT_NBR);
  const last4 = masked ? masked.replace(/\D/g, '').slice(-4) || null : null;
  return { authGuid, expirationMonth: exp.month, expirationYear: exp.year, last4 };
}
