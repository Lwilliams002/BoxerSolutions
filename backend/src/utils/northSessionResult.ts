/**
 * Pure extraction of a North Embedded Checkout session-status payload
 * (GET /api/sessions/status → { status, body }). Also tolerates the shapes
 * observed in the wild: data wrapper, body under transaction/fullResponse,
 * uppercase EPX keys. No I/O, no config.
 */
export type NorthMethodType = 'card' | 'bank_account';

export interface NorthSessionResult {
  status: string;
  approved: boolean;
  declined: boolean;
  terminal: boolean;
  authGuid: string | null;
  amount: number | null;
  responseCode: string | null;
  responseText: string | null;
  methodType: NorthMethodType;
  brand: string;
  last4: string | null;
  expirationMonth: number | null;
  expirationYear: number | null;
  body: Record<string, unknown> | null;
}

const CARD_TYPE_NAMES: Record<string, string> = {
  V: 'Visa', M: 'Mastercard', X: 'American Express', A: 'American Express', D: 'Discover',
};
const APPROVED = ['approved', 'completed', 'complete', 'success'];
const DECLINED = ['declined', 'failed', 'error'];
const ENDED = ['expired', 'cancelled', 'canceled'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function findField(value: unknown, names: string[], depth = 0): string | null {
  const record = asRecord(value);
  if (!record || depth > 4) return null;
  const lower = names.map((n) => n.toLowerCase());
  for (const [key, v] of Object.entries(record)) {
    if (lower.includes(key.toLowerCase()) && (typeof v === 'string' || typeof v === 'number') && String(v).trim().length > 0) {
      return String(v).trim();
    }
  }
  for (const v of Object.values(record)) {
    const found = findField(v, names, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseAmount(value: string | null): number | null {
  if (value == null) return null;
  const n = Number.parseFloat(value.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function parseExpiry(raw: string | null): { month: number | null; year: number | null } {
  if (!raw) return { month: null, year: null };
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 4) return { month: null, year: null };
  const a = Number(digits.slice(0, 2));
  const b = Number(digits.slice(2));
  // "MM/YY" when a separator is present; otherwise EPX's YYMM, falling back
  // to MMYY when the trailing pair cannot be a month.
  if (raw.includes('/')) return { month: a >= 1 && a <= 12 ? a : null, year: 2000 + b };
  if (b >= 1 && b <= 12) return { month: b, year: 2000 + a };
  if (a >= 1 && a <= 12) return { month: a, year: 2000 + b };
  return { month: null, year: null };
}

function detectMethodType(body: Record<string, unknown> | null, expected: NorthMethodType): NorthMethodType {
  if (!body) return expected;
  const explicit = findField(body, ['payment_method', 'formType', 'form_type']);
  if (explicit) {
    if (/^(ach|bank)/i.test(explicit)) return 'bank_account';
    if (/^(credit|debit|card)/i.test(explicit)) return 'card';
  }
  const tranType = findField(body, ['tran_type', 'tranType']);
  if (tranType && /^(ach|ck|ec)/i.test(tranType)) return 'bank_account';
  if (findField(body, ['routing_nbr', 'account_type', 'std_entry_class', 'auth_routing_nbr'])) return 'bank_account';
  if (findField(body, ['auth_card_type'])) return 'card';
  return expected;
}

export function extractNorthSessionResult(payload: unknown, expected: NorthMethodType = 'card'): NorthSessionResult {
  const root = asRecord(payload) ?? {};
  const statusData = asRecord(root.data) ?? root;
  const status = String(statusData.status ?? root.status ?? '').toLowerCase();
  const body = asRecord(statusData.body) ?? asRecord(root.body) ?? asRecord(statusData.transaction) ?? null;

  // EPX can report an "Approved" session status while the transaction itself
  // carries a non-approval auth_resp (only '00' is an approval), so the
  // response code has the final say on `approved`. Such a session is still
  // terminal — nothing more will happen to it.
  const responseCode = findField(body, ['auth_resp']);
  const approved = APPROVED.includes(status) && (responseCode == null || responseCode === '00');
  const declined = DECLINED.includes(status);
  const terminal = APPROVED.includes(status) || declined || ENDED.includes(status);

  const authGuid = findField(body, ['auth_guid', 'bric', 'token']);
  const methodType = detectMethodType(body, expected);
  const masked = findField(body, ['auth_masked_account_nbr', 'masked_pan', 'maskedAccountNumber', 'lastFour', 'last_four']);
  const last4 = masked ? masked.replace(/\D/g, '').slice(-4) || null : null;

  let brand = 'Card';
  let expirationMonth: number | null = null;
  let expirationYear: number | null = null;
  if (methodType === 'bank_account') {
    brand = 'Bank Account';
  } else {
    const code = findField(body, ['auth_card_type', 'card_type', 'cardType']);
    if (code) brand = CARD_TYPE_NAMES[code.toUpperCase()] ?? (code.length === 1 ? 'Card' : code);
    const exp = parseExpiry(findField(body, ['exp_date', 'auth_exp_date', 'expDate']));
    expirationMonth = exp.month;
    expirationYear = exp.year;
  }

  return {
    status,
    approved,
    declined,
    terminal,
    authGuid,
    amount: parseAmount(findField(body, ['auth_amount', 'amount', 'approvedAmount']) ?? (typeof statusData.amount === 'number' ? String(statusData.amount) : null)),
    responseCode,
    responseText: findField(body, ['auth_resp_text', 'message']),
    methodType,
    brand,
    last4,
    expirationMonth,
    expirationYear,
    body,
  };
}
