/**
 * Pure request builders / response parser for the North Embedded Checkout
 * Payments API (https://developer.north.com/.../api-spec/production/Payments).
 * No config, no I/O — unit tested in test/epxPayloads.test.ts.
 */
export type EpxPaymentMethod = 'credit' | 'ach';

export interface EpxCustomer {
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

export interface TokenSaleInput {
  authGuid: string;
  amount: number;
  paymentMethod: EpxPaymentMethod;
  /** Merchant-initiated (AutoPay / recurring). Adds aci_ext: 'RB'. */
  mit: boolean;
  customer?: EpxCustomer;
  invoiceNumber?: string | null;
  orderNumber?: string | null;
  tranNbr?: string;
  batchId?: string;
}

export interface EpxResult {
  approved: boolean;
  authGuid: string | null;
  authCode: string | null;
  responseCode: string | null;
  responseText: string | null;
  amount: number | null;
  raw: Record<string, unknown>;
}

const DISALLOWED = /[^a-zA-Z0-9 \/.\-@_*,#&+']/g;

export function sanitizeEpxText(value: unknown, max: number): string | undefined {
  if (value == null) return undefined;
  const cleaned = String(value).replace(DISALLOWED, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return cleaned.length ? cleaned : undefined;
}

export function epxBatchId(now: Date = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

/** Unique per millisecond, at most 10 digits (tran_nbr limit). */
export function epxTranNbr(nowMs: number = Date.now()): string {
  return String(nowMs % 10_000_000_000);
}

function withoutUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function customerFields(customer?: EpxCustomer): Record<string, unknown> {
  const zip = customer?.zipCode ? String(customer.zipCode).trim() : '';
  return withoutUndefined({
    first_name: sanitizeEpxText(customer?.firstName, 25),
    last_name: sanitizeEpxText(customer?.lastName, 25),
    address: sanitizeEpxText(customer?.address, 30),
    city: sanitizeEpxText(customer?.city, 25),
    state: customer?.state ? String(customer.state).trim().slice(0, 3).toUpperCase() || undefined : undefined,
    zip_code: zip.length >= 5 && zip.length <= 10 ? zip : undefined,
  });
}

function referenceFields(tranNbr?: string, batchId?: string) {
  return { tran_nbr: tranNbr ?? epxTranNbr(), batch_id: batchId ?? epxBatchId() };
}

export function buildTokenSaleBody(input: TokenSaleInput): Record<string, unknown> {
  const amount = Number(input.amount.toFixed(2));
  if (!Number.isFinite(amount) || amount < 0.01) throw new Error('Token sale amount must be at least 0.01');
  const body: Record<string, unknown> = {
    payment_method: input.paymentMethod,
    amount,
    orig_auth_guid: input.authGuid,
    industry_type: 'E',
    ...referenceFields(input.tranNbr, input.batchId),
    ...customerFields(input.customer),
  };
  const invoice = sanitizeEpxText(input.invoiceNumber, 25);
  if (invoice) body.invoice_nbr = invoice;
  const order = sanitizeEpxText(input.orderNumber, 25);
  if (order) body.order_nbr = order;
  if (input.mit) body.aci_ext = 'RB';
  if (input.paymentMethod === 'ach') {
    const recv = sanitizeEpxText([input.customer?.firstName, input.customer?.lastName].filter(Boolean).join(' '), 22);
    if (recv) body.recv_name = recv;
  }
  return body;
}

export function buildRefundBody(input: { authGuid: string; amount: number; paymentMethod: EpxPaymentMethod; tranNbr?: string; batchId?: string }): Record<string, unknown> {
  const amount = Number(input.amount.toFixed(2));
  if (!Number.isFinite(amount) || amount < 0.01) throw new Error('Refund amount must be at least 0.01');
  return { payment_method: input.paymentMethod, amount, orig_auth_guid: input.authGuid, ...referenceFields(input.tranNbr, input.batchId) };
}

export function buildReversalBody(input: { authGuid: string; tranNbr?: string; batchId?: string }): Record<string, unknown> {
  return { payment_method: 'credit', orig_auth_guid: input.authGuid, ...referenceFields(input.tranNbr, input.batchId) };
}

export function buildVoidBody(input: { authGuid: string; paymentMethod: EpxPaymentMethod; tranNbr?: string; batchId?: string }): Record<string, unknown> {
  return { payment_method: input.paymentMethod, orig_auth_guid: input.authGuid, ...referenceFields(input.tranNbr, input.batchId) };
}

/** Case-insensitive search for the first of `names`, up to 4 levels deep. */
function findField(value: unknown, names: string[], depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  const record = value as Record<string, unknown>;
  const lowerNames = names.map((n) => n.toLowerCase());
  for (const [key, v] of Object.entries(record)) {
    if (lowerNames.includes(key.toLowerCase()) && (typeof v === 'string' || typeof v === 'number') && String(v).length > 0) {
      return String(v);
    }
  }
  for (const v of Object.values(record)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const found = findField(v, names, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function parseAmount(value: string | null): number | null {
  if (value == null) return null;
  const n = Number.parseFloat(value.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

export function parseEpxResponse(raw: unknown): EpxResult {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const responseCode = findField(record, ['auth_resp']);
  return {
    approved: responseCode === '00',
    authGuid: findField(record, ['auth_guid']),
    authCode: findField(record, ['auth_code']),
    responseCode,
    responseText: findField(record, ['auth_resp_text', 'message', 'error']),
    amount: parseAmount(findField(record, ['auth_amount'])),
    raw: record,
  };
}
