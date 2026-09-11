// backend/src/services/northFieldsPaymentService.ts
import crypto from 'crypto';
import { config } from '../config';
import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { northGatewayService } from './northGatewayService';
import { paymentService } from './paymentService';
import { getCompanySettings } from './settingsService';
import { computeSurcharge } from '../utils/surcharge';
import { waitForNorthSession } from '../utils/northEmbedded';
import type { NorthMethodType } from '../utils/northSessionResult';
import { ACH_TERMS_TEXT, ACH_TERMS_VERSION } from '../content/achAuthorizationTerms';

/**
 * Embedded Checkout (Fields) flows, shared by the staff API and the public
 * agreement page. Every checkout is a single STORAGE session: the customer
 * picks card or bank inside North's own form (North supports STORAGE for
 * both; there is no way to learn the choice before submit), North hands back
 * a token, and the money — if any — moves in a server-side TOKEN SALE:
 *
 *   pay, card  : STORAGE → vault BRIC → token sale (credit, CIT)
 *   pay, bank  : STORAGE → needs ACH consent → vault → token sale (ach, CIT)
 *   store      : STORAGE → (bank: needs ACH consent) → vault
 *
 * Because nothing is debited inside the checkout, a bank result without
 * consent is simply reported back as `needs_ach_consent`; the client shows the
 * authorization and confirms the same session again with consent. Every
 * decision is made from North's session status endpoint, never the client.
 */
/** Accepted from older clients; the session type no longer depends on it. */
export type FieldsPayMode = 'card' | 'bank';
export type AchAccountType = 'checking' | 'savings';

export interface FieldsBreakdown { subtotal: number; tax: number; total: number; previouslyPaid: number; amountDue: number; cardSurchargePercent?: number; cardSurcharge?: number; amountDueWithCard?: number }

export interface FieldsAchTerms { version: string; text: string }

export interface FieldsPaySession {
  sessionToken: string;
  scriptUrl: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  breakdown: FieldsBreakdown;
  achTerms: FieldsAchTerms;
}

export interface FieldsStorageSession {
  sessionToken: string;
  scriptUrl: string;
  customerId: string;
  achTerms: FieldsAchTerms;
}

export interface FieldsSavedMethod { id: string; methodType: NorthMethodType; brand: string; last4: string | null }

export interface FieldsConfirmResult {
  status: 'approved';
  duplicate: boolean;
  amount: number | null;
  transactionId: string | null;
  receipt: unknown | null;
  payment: unknown | null;
  savedMethod: FieldsSavedMethod | null;
}

/** North stored a bank account; nothing has been debited or saved yet. */
export interface FieldsNeedsConsentResult {
  status: 'needs_ach_consent';
  methodType: 'bank_account';
  brand: string;
  last4: string | null;
  achTerms: FieldsAchTerms;
}

export interface FieldsStoredResult {
  status: 'stored';
  id: string;
  methodType: NorthMethodType;
  brand: string;
  last4: string | null;
  duplicate: boolean;
}

export interface ConsentMeta { ip: string | null; userAgent: string | null }

interface ConsentInput { achConsent?: boolean; achAccountType?: AchAccountType; consentMeta?: ConsentMeta }

interface InvoiceRow {
  id: string; invoice_number: string; customer_id: string; status: string;
  subtotal: string; tax_amount: string; discount_amount: string | null; total: string; amount_paid: string;
}

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));
const scriptUrl = () => `${config.north.embeddedBaseUrl}/checkout.js`;
const achTerms = (): FieldsAchTerms => ({ version: ACH_TERMS_VERSION, text: ACH_TERMS_TEXT });

async function loadInvoice(invoiceId: string): Promise<InvoiceRow> {
  const { rows } = await pool.query(
    `SELECT id, invoice_number, customer_id, status, subtotal, tax_amount, discount_amount, total, amount_paid
     FROM invoices WHERE id = $1 AND deleted_at IS NULL`,
    [invoiceId],
  );
  const invoice = rows[0] as InvoiceRow | undefined;
  if (!invoice) throw ApiError.notFound('Invoice not found');
  if (invoice.status === 'void') throw ApiError.badRequest('This invoice has been voided.');
  return invoice;
}

function breakdownFor(invoice: InvoiceRow, surchargePercent = 0): FieldsBreakdown {
  const total = money(invoice.total);
  const previouslyPaid = money(invoice.amount_paid);
  const amountDue = money(Math.max(0, total - previouslyPaid));
  const cardSurcharge = computeSurcharge(amountDue, surchargePercent);
  return {
    subtotal: money(Number(invoice.subtotal) - Number(invoice.discount_amount ?? 0)),
    tax: money(invoice.tax_amount),
    total,
    previouslyPaid,
    amountDue,
    cardSurchargePercent: surchargePercent,
    cardSurcharge,
    amountDueWithCard: money(amountDue + cardSurcharge),
  };
}

function additionalFieldsFor(customer: Awaited<ReturnType<typeof paymentService.loadCustomerBillingInfo>>, invoiceNumber?: string) {
  const fields: Record<string, string> = { industry_type: 'E' };
  if (customer.firstName) fields.first_name = customer.firstName;
  if (customer.lastName) fields.last_name = customer.lastName;
  if (customer.address) fields.address = customer.address;
  if (customer.city) fields.city = customer.city;
  if (customer.state) fields.state = customer.state;
  if (customer.zipCode) fields.zip_code = customer.zipCode;
  if (invoiceNumber) { fields.invoice_nbr = invoiceNumber; fields.order_nbr = invoiceNumber; }
  return fields;
}

// Session-token dedupe covers the single-process deployment only; a
// multi-process deployment needs a database lock instead of an in-memory map.
const inFlight = new Map<string, Promise<unknown>>();

async function dedupeBySession<T>(sessionToken: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(sessionToken) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run().finally(() => { inFlight.delete(sessionToken); });
  inFlight.set(sessionToken, promise);
  return promise;
}

// ---- Checkout session ledger (north_checkout_sessions) ----------------------
// Every session we hand out is recorded (hashed — the raw token is never
// stored) with its terminal confirm outcome, so payments can be reconciled
// against North's records.

type ConfirmOutcome = 'approved' | 'duplicate' | 'declined' | 'rejected' | 'pending_consent';

const hashSessionToken = (sessionToken: string) => crypto.createHash('sha256').update(sessionToken).digest('hex');

async function recordCheckoutSession(input: { sessionToken: string; invoiceId: string | null; customerId: string; mode: 'pay' | 'store' }) {
  await pool.query(
    `INSERT INTO north_checkout_sessions (session_token_hash, invoice_id, customer_id, mode, transaction_type, amount)
     VALUES ($1,$2,$3,$4,'STORAGE',0)
     ON CONFLICT (session_token_hash) DO NOTHING`,
    [hashSessionToken(input.sessionToken), input.invoiceId, input.customerId, input.mode],
  );
}

async function markCheckoutSession(sessionToken: string, outcome: ConfirmOutcome) {
  // Only true terminal outcomes close the row; a rejected confirm or a bank
  // result still waiting for ACH consent keeps it open for the retry.
  const close = outcome === 'approved' || outcome === 'duplicate' || outcome === 'declined';
  try {
    await pool.query(
      close
        ? `UPDATE north_checkout_sessions SET confirmed_at = now(), confirm_outcome = $2 WHERE session_token_hash = $1 AND confirmed_at IS NULL`
        : `UPDATE north_checkout_sessions SET confirm_outcome = $2 WHERE session_token_hash = $1 AND confirmed_at IS NULL`,
      [hashSessionToken(sessionToken), outcome],
    );
  } catch (error) {
    // Never let bookkeeping mask the confirm result the caller is waiting on.
    logger.warn({ err: error, outcome }, 'failed to mark north checkout session');
  }
}

function outcomeForError(error: unknown): ConfirmOutcome {
  return error instanceof ApiError && error.statusCode === 402 ? 'declined' : 'rejected';
}

async function withSessionLedger<T extends { status: string; duplicate?: boolean }>(sessionToken: string, run: () => Promise<T>): Promise<T> {
  return dedupeBySession(sessionToken, async () => {
    let outcome: ConfirmOutcome = 'rejected';
    try {
      const result = await run();
      outcome = result.status === 'needs_ach_consent' ? 'pending_consent' : result.duplicate ? 'duplicate' : 'approved';
      return result;
    } catch (error) {
      outcome = outcomeForError(error);
      throw error;
    } finally {
      await markCheckoutSession(sessionToken, outcome);
    }
  });
}

/** True when the customer already has a default method that must not be displaced. */
async function customerHasDefaultMethod(customerId: string): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT id FROM payment_methods WHERE customer_id = $1 AND is_default AND deleted_at IS NULL LIMIT 1',
    [customerId],
  );
  return rows.length > 0;
}

async function recordAchAuthorization(input: {
  customerId: string; invoiceId: string | null; paymentId: string | null; paymentMethodId: string; amount: number; consentMeta?: ConsentMeta;
}) {
  await pool.query(
    `INSERT INTO ach_authorizations (customer_id, invoice_id, payment_id, payment_method_id, amount, terms_version, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [input.customerId, input.invoiceId, input.paymentId, input.paymentMethodId, input.amount, ACH_TERMS_VERSION, input.consentMeta?.ip ?? null, input.consentMeta?.userAgent ?? null],
  );
}

/** Verifies the STORAGE session and vaults the token; bank accounts require consent first. */
async function verifyAndVault(input: {
  sessionToken: string; customerId: string; setDefault: boolean; actorUserId: string; logContext: Record<string, unknown>;
} & ConsentInput): Promise<
  | { kind: 'needs_consent'; result: FieldsNeedsConsentResult }
  | { kind: 'vaulted'; method: { id: string; duplicate: boolean }; methodType: NorthMethodType; brand: string; last4: string | null }
> {
  const result = await waitForNorthSession(input.sessionToken, 'card');
  logger.info({ ...input.logContext, status: result.status, methodType: result.methodType }, 'north fields session approved');
  if (result.methodType === 'bank_account' && input.achConsent !== true) {
    return {
      kind: 'needs_consent',
      result: { status: 'needs_ach_consent', methodType: 'bank_account', brand: result.brand, last4: result.last4, achTerms: achTerms() },
    };
  }
  const method = (await paymentService.addVaultedMethod(
    input.customerId,
    {
      providerPaymentMethodId: result.authGuid!,
      provider: 'north',
      methodType: result.methodType,
      bankAccountType: result.methodType === 'bank_account' ? (input.achAccountType ?? 'checking') : null,
      brand: result.brand,
      last4: result.last4,
      expirationMonth: result.expirationMonth,
      expirationYear: result.expirationYear,
    },
    input.setDefault,
    input.actorUserId,
  )) as { id: string; duplicate: boolean };
  return { kind: 'vaulted', method, methodType: result.methodType, brand: result.brand, last4: result.last4 };
}

async function runConfirmPay(input: {
  invoiceId: string; sessionToken: string; actorUserId: string; employeeId: string | null;
} & ConsentInput): Promise<FieldsConfirmResult | FieldsNeedsConsentResult> {
  const invoice = await loadInvoice(input.invoiceId);
  if (invoice.status === 'paid') {
    return { status: 'approved', duplicate: true, amount: null, transactionId: null, receipt: null, payment: null, savedMethod: null };
  }
  // A method vaulted here has only cleared the STORAGE session — the money
  // moves in the token sale below. Never let it become (or displace) the
  // AutoPay default before that succeeds; promote it afterwards, and only
  // when the customer had no default of their own.
  const hadDefaultMethod = await customerHasDefaultMethod(invoice.customer_id);
  const vaulted = await verifyAndVault({ ...input, customerId: invoice.customer_id, setDefault: false, logContext: { invoiceId: invoice.id } });
  if (vaulted.kind === 'needs_consent') return vaulted.result;

  const { method } = vaulted;
  const savedMethod: FieldsSavedMethod = { id: method.id, methodType: vaulted.methodType, brand: vaulted.brand, last4: vaulted.last4 };
  try {
    // Customer-initiated token sale (no aci_ext); ach vs credit and the
    // account type come from the vaulted method itself.
    const charged = await paymentService.chargeInvoice(invoice.id, method.id, null, input.actorUserId, input.employeeId, { source: 'manual', mit: false });
    if (vaulted.methodType === 'bank_account') {
      await recordAchAuthorization({
        customerId: invoice.customer_id, invoiceId: invoice.id, paymentId: (charged.payment as { id: string }).id,
        paymentMethodId: method.id, amount: charged.receipt.amount, consentMeta: input.consentMeta,
      });
    }
    if (!hadDefaultMethod) {
      try { await paymentService.setDefaultMethod(method.id, input.actorUserId); } catch (error) {
        logger.warn({ err: error, methodId: method.id }, 'failed to set the newly vaulted method as default');
      }
    }
    return { status: 'approved', duplicate: false, amount: charged.receipt.amount, transactionId: charged.receipt.transactionId, receipt: charged.receipt, payment: charged.payment, savedMethod };
  } catch (error) {
    if (error instanceof ApiError && /already paid/i.test(error.message)) {
      return { status: 'approved', duplicate: true, amount: null, transactionId: null, receipt: null, payment: null, savedMethod };
    }
    throw error;
  }
}

async function runConfirmStorage(input: {
  customerId: string; sessionToken: string; setDefault: boolean; actorUserId: string;
} & ConsentInput): Promise<FieldsStoredResult | FieldsNeedsConsentResult> {
  const vaulted = await verifyAndVault({ ...input, logContext: { customerId: input.customerId, flow: 'store' } });
  if (vaulted.kind === 'needs_consent') return vaulted.result;
  if (vaulted.methodType === 'bank_account' && !vaulted.method.duplicate) {
    await recordAchAuthorization({
      customerId: input.customerId, invoiceId: null, paymentId: null, paymentMethodId: vaulted.method.id, amount: 0, consentMeta: input.consentMeta,
    });
  }
  return { status: 'stored', id: vaulted.method.id, methodType: vaulted.methodType, brand: vaulted.brand, last4: vaulted.last4, duplicate: vaulted.method.duplicate };
}

export const northFieldsPaymentService = {
  async createPaySession(input: { invoiceId: string }): Promise<FieldsPaySession> {
    const invoice = await loadInvoice(input.invoiceId);
    const breakdown = breakdownFor(invoice, (await getCompanySettings()).cardSurchargePercent);
    if (breakdown.amountDue <= 0) throw ApiError.badRequest('Invoice has no outstanding balance.');
    const customer = await paymentService.loadCustomerBillingInfo(invoice.customer_id);
    const { sessionToken } = await northGatewayService.createEmbeddedSession({
      amount: 0,
      transactionType: 'STORAGE',
      customerEmail: customer.email,
      additionalFields: additionalFieldsFor(customer, invoice.invoice_number),
    });
    await recordCheckoutSession({ sessionToken, invoiceId: invoice.id, customerId: invoice.customer_id, mode: 'pay' });
    return {
      sessionToken,
      scriptUrl: scriptUrl(),
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      amount: breakdown.amountDue,
      breakdown,
      achTerms: achTerms(),
    };
  },

  confirmPay(input: { invoiceId: string; sessionToken: string; actorUserId: string; employeeId: string | null } & ConsentInput) {
    return withSessionLedger(input.sessionToken, () => runConfirmPay(input));
  },

  async createStorageSession(input: { customerId: string }): Promise<FieldsStorageSession> {
    const customer = await paymentService.loadCustomerBillingInfo(input.customerId);
    const { sessionToken } = await northGatewayService.createEmbeddedSession({
      amount: 0, transactionType: 'STORAGE', customerEmail: customer.email, additionalFields: additionalFieldsFor(customer),
    });
    await recordCheckoutSession({ sessionToken, invoiceId: null, customerId: input.customerId, mode: 'store' });
    return { sessionToken, scriptUrl: scriptUrl(), customerId: input.customerId, achTerms: achTerms() };
  },

  confirmStorage(input: { customerId: string; sessionToken: string; setDefault: boolean; actorUserId: string } & ConsentInput) {
    return withSessionLedger(input.sessionToken, () => runConfirmStorage(input));
  },
};
