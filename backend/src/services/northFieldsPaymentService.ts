// backend/src/services/northFieldsPaymentService.ts
import crypto from 'crypto';
import { config } from '../config';
import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { northGatewayService } from './northGatewayService';
import { paymentService } from './paymentService';
import { waitForNorthSession } from '../utils/northEmbedded';
import type { NorthMethodType } from '../utils/northSessionResult';
import { ACH_TERMS_TEXT, ACH_TERMS_VERSION } from '../content/achAuthorizationTerms';

/**
 * The three Embedded Checkout (Fields) flows, shared by the staff API and the
 * public agreement page:
 *   card payment  = STORAGE session → vault BRIC → server-side TOKEN SALE (CIT)
 *   bank payment  = ACH SALE session → record payment → vault auth_guid as bank account
 *   store only    = STORAGE session → vault
 * The client only tells us which session to create and when to verify; every
 * decision is made from North's session status endpoint.
 */
export type FieldsPayMode = 'card' | 'bank';

export interface FieldsBreakdown { subtotal: number; tax: number; total: number; previouslyPaid: number; amountDue: number }

export interface FieldsPaySession {
  sessionToken: string;
  scriptUrl: string;
  mode: FieldsPayMode;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  breakdown: FieldsBreakdown;
  achTerms: { version: string; text: string } | null;
}

export interface FieldsConfirmResult {
  status: 'approved';
  duplicate: boolean;
  amount: number | null;
  transactionId: string | null;
  receipt: unknown | null;
  payment: unknown | null;
  savedMethod: { id: string; methodType: NorthMethodType; brand: string; last4: string | null } | null;
}

export interface ConsentMeta { ip: string | null; userAgent: string | null }

interface InvoiceRow {
  id: string; invoice_number: string; customer_id: string; status: string;
  subtotal: string; tax_amount: string; discount_amount: string | null; total: string; amount_paid: string;
}

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));
const scriptUrl = () => `${config.north.embeddedBaseUrl}/checkout.js`;

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

function breakdownFor(invoice: InvoiceRow): FieldsBreakdown {
  const total = money(invoice.total);
  const previouslyPaid = money(invoice.amount_paid);
  return {
    subtotal: money(Number(invoice.subtotal) - Number(invoice.discount_amount ?? 0)),
    tax: money(invoice.tax_amount),
    total,
    previouslyPaid,
    amountDue: money(Math.max(0, total - previouslyPaid)),
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
// Bank (ACH) money moves inside checkout.submit(), before we are ever called,
// so an unconfirmed bank row means a debit may already be in flight for that
// invoice. We record every session we hand out (hashed — the raw token is never
// stored) and mark it on every terminal confirm outcome.

type ConfirmOutcome = 'approved' | 'duplicate' | 'declined' | 'rejected';

const hashSessionToken = (sessionToken: string) => crypto.createHash('sha256').update(sessionToken).digest('hex');

/** Seconds a brand-new unconfirmed bank session stays "harmless" (see the guard below). */
const BANK_SESSION_GRACE_SECONDS = 60;
/** How far back an unconfirmed bank session is treated as possibly-in-flight money. */
const BANK_SESSION_LOOKBACK_MINUTES = 35;

async function recordCheckoutSession(input: {
  sessionToken: string; invoiceId: string | null; customerId: string;
  mode: 'card' | 'bank' | 'store'; transactionType: string; amount: number | null;
}) {
  await pool.query(
    `INSERT INTO north_checkout_sessions (session_token_hash, invoice_id, customer_id, mode, transaction_type, amount)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (session_token_hash) DO NOTHING`,
    [hashSessionToken(input.sessionToken), input.invoiceId, input.customerId, input.mode, input.transactionType, input.amount],
  );
}

async function markCheckoutSessionConfirmed(sessionToken: string, outcome: ConfirmOutcome) {
  // 'rejected' means the confirm threw for a reason other than a processor
  // decline (North status unreadable, a not-yet-completed 409, a DB error,
  // etc.) — we could not verify whether the ACH debit that already happened
  // inside checkout.submit() actually landed. Leave confirmed_at NULL so the
  // row still reads as "pending" to assertNoPendingBankSession: a second bank
  // session for the same invoice keeps getting refused with 409 until either
  // the 35-minute lookback window lapses or a retry successfully verifies the
  // original session. Only true terminal outcomes ('approved', 'duplicate',
  // 'declined') close the row.
  const close = outcome !== 'rejected';
  try {
    await pool.query(
      close
        ? `UPDATE north_checkout_sessions SET confirmed_at = now(), confirm_outcome = $2
           WHERE session_token_hash = $1 AND confirmed_at IS NULL`
        : `UPDATE north_checkout_sessions SET confirm_outcome = $2
           WHERE session_token_hash = $1 AND confirmed_at IS NULL`,
      [hashSessionToken(sessionToken), outcome],
    );
  } catch (error) {
    // Never let bookkeeping mask the confirm result the caller is waiting on.
    logger.warn({ err: error, outcome }, 'failed to mark north checkout session confirmed');
  }
}

function outcomeForError(error: unknown): ConfirmOutcome {
  return error instanceof ApiError && error.statusCode === 402 ? 'declined' : 'rejected';
}

/**
 * Refuse a second bank session while an earlier one for the same invoice is
 * still unconfirmed. Trade-off: we deliberately do not keep the raw session
 * token, so we cannot poll North for the earlier session's status here — we
 * only know that money may have moved. Rather than risk a second debit we ask
 * the customer to retry verification, which uses the original session token
 * held by the client. The 60-second grace window covers the common harmless
 * case (the customer just opened the page, switched tabs or toggled card/bank
 * before entering anything), and the 35-minute lookback bounds the block so a
 * genuinely abandoned page cannot lock the invoice out forever.
 */
async function assertNoPendingBankSession(invoiceId: string) {
  const { rows } = await pool.query(
    `SELECT id FROM north_checkout_sessions
     WHERE invoice_id = $1 AND mode = 'bank' AND confirmed_at IS NULL
       AND created_at > now() - ($2::int * interval '1 minute')
       AND created_at < now() - ($3::int * interval '1 second')
     LIMIT 1`,
    [invoiceId, BANK_SESSION_LOOKBACK_MINUTES, BANK_SESSION_GRACE_SECONDS],
  );
  if (rows.length) {
    throw new ApiError(409, 'A bank payment for this invoice was already submitted and is awaiting verification. Please retry verification instead of paying again.');
  }
}

/** True when the customer already has a default method that must not be displaced. */
async function customerHasDefaultMethod(customerId: string): Promise<boolean> {
  const { rows } = await pool.query(
    'SELECT id FROM payment_methods WHERE customer_id = $1 AND is_default AND deleted_at IS NULL LIMIT 1',
    [customerId],
  );
  return rows.length > 0;
}

const UNCONSENTED_BANK_RESULT_MESSAGE = 'Bank accounts must be added through Pay by Bank so your ACH authorization can be recorded.';

/** confirmPay body; kept separate so dedupeBySession can wrap it in try/finally. */
async function runConfirmPay(input: {
  invoiceId: string; mode: FieldsPayMode; sessionToken: string;
  actorUserId: string; employeeId: string | null;
  achConsent?: boolean; consentMeta?: ConsentMeta;
}): Promise<FieldsConfirmResult> {
  const invoice = await loadInvoice(input.invoiceId);
  if (invoice.status === 'paid') {
    return { status: 'approved', duplicate: true, amount: null, transactionId: null, receipt: null, payment: null, savedMethod: null };
  }
  if (input.mode === 'bank' && input.achConsent !== true) {
    throw ApiError.badRequest('Bank payments require acceptance of the ACH authorization terms.');
  }
  const expected: NorthMethodType = input.mode === 'bank' ? 'bank_account' : 'card';
  const result = await waitForNorthSession(input.sessionToken, expected);
  if (input.mode === 'card' && result.methodType === 'bank_account') {
    throw ApiError.badRequest(UNCONSENTED_BANK_RESULT_MESSAGE);
  }
  logger.info({ invoiceId: invoice.id, mode: input.mode, status: result.status, methodType: result.methodType }, 'north fields session approved');

  // A card that is vaulted here has only cleared the STORAGE session — the
  // money moves in the token sale below. Never let it become (or displace)
  // the AutoPay default before that succeeds; promote it afterwards, and
  // only when the customer had no default of their own.
  const hadDefaultMethod = await customerHasDefaultMethod(invoice.customer_id);

  // Whatever the customer picked inside the fields, the BRIC goes on file.
  const method = (await paymentService.addVaultedMethod(
    invoice.customer_id,
    {
      providerPaymentMethodId: result.authGuid!,
      provider: 'north',
      methodType: result.methodType,
      brand: result.brand,
      last4: result.last4,
      expirationMonth: result.expirationMonth,
      expirationYear: result.expirationYear,
    },
    false,
    input.actorUserId,
  )) as { id: string; duplicate: boolean };
  const savedMethod = { id: method.id, methodType: result.methodType, brand: result.brand, last4: result.last4 };
  const promoteDefault = async () => {
    if (hadDefaultMethod) return;
    try {
      await paymentService.setDefaultMethod(method.id, input.actorUserId);
    } catch (error) {
      logger.warn({ err: error, methodId: method.id }, 'failed to set the newly vaulted method as default');
    }
  };

  if (input.mode === 'card') {
    // STORAGE approved → charge the stored BRIC (customer-initiated, no aci_ext).
    try {
      const charged = await paymentService.chargeInvoice(invoice.id, method.id, null, input.actorUserId, input.employeeId, { source: 'manual', mit: false });
      await promoteDefault();
      return { status: 'approved', duplicate: false, amount: charged.receipt.amount, transactionId: charged.receipt.transactionId, receipt: charged.receipt, payment: charged.payment, savedMethod };
    } catch (error) {
      if (error instanceof ApiError && /already paid/i.test(error.message)) {
        return { status: 'approved', duplicate: true, amount: null, transactionId: null, receipt: null, payment: null, savedMethod };
      }
      throw error;
    }
  }

  // Bank: the SALE already moved the money inside the checkout.
  if (result.amount == null || result.amount <= 0) {
    throw ApiError.badGateway('North approved the ACH sale but did not report an amount.');
  }
  try {
    const recorded = await paymentService.recordExternalInvoicePayment(
      invoice.id, result.amount, 'north', result.authGuid!, input.actorUserId, input.employeeId,
      { paymentMethodId: method.id, brand: result.brand, last4: result.last4 },
    );
    if (!recorded.duplicate && result.methodType === 'bank_account') {
      await pool.query(
        `INSERT INTO ach_authorizations (customer_id, invoice_id, payment_id, payment_method_id, amount, terms_version, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoice.customer_id, invoice.id, (recorded.payment as { id: string }).id, method.id, result.amount, ACH_TERMS_VERSION, input.consentMeta?.ip ?? null, input.consentMeta?.userAgent ?? null],
      );
    }
    await promoteDefault();
    return {
      status: 'approved',
      duplicate: recorded.duplicate,
      amount: result.amount,
      transactionId: result.authGuid,
      receipt: recorded.receipt,
      payment: recorded.payment,
      savedMethod,
    };
  } catch (error) {
    if (error instanceof ApiError && /already paid/i.test(error.message)) {
      return { status: 'approved', duplicate: true, amount: null, transactionId: null, receipt: null, payment: null, savedMethod };
    }
    throw error;
  }
}

/** confirmStorage body; kept separate so dedupeBySession can wrap it in try/finally. */
async function runConfirmStorage(input: { customerId: string; sessionToken: string; setDefault: boolean; actorUserId: string }) {
  const result = await waitForNorthSession(input.sessionToken, 'card');
  if (result.methodType === 'bank_account') {
    throw ApiError.badRequest(UNCONSENTED_BANK_RESULT_MESSAGE);
  }
  const method = (await paymentService.addVaultedMethod(
    input.customerId,
    {
      providerPaymentMethodId: result.authGuid!,
      provider: 'north',
      methodType: result.methodType,
      brand: result.brand,
      last4: result.last4,
      expirationMonth: result.expirationMonth,
      expirationYear: result.expirationYear,
    },
    input.setDefault,
    input.actorUserId,
  )) as { id: string; duplicate: boolean };
  return { id: method.id, methodType: result.methodType, brand: result.brand, last4: result.last4, duplicate: method.duplicate };
}

export const northFieldsPaymentService = {
  async createPaySession(input: { invoiceId: string; mode: FieldsPayMode }): Promise<FieldsPaySession> {
    const invoice = await loadInvoice(input.invoiceId);
    const breakdown = breakdownFor(invoice);
    if (breakdown.amountDue <= 0) throw ApiError.badRequest('Invoice has no outstanding balance.');
    if (input.mode === 'bank') await assertNoPendingBankSession(invoice.id);
    const customer = await paymentService.loadCustomerBillingInfo(invoice.customer_id);
    const additionalFields = additionalFieldsFor(customer, invoice.invoice_number);
    const { sessionToken } = input.mode === 'card'
      ? await northGatewayService.createEmbeddedSession({ amount: 0, transactionType: 'STORAGE', customerEmail: customer.email, additionalFields })
      : await northGatewayService.createEmbeddedSession({
          amount: breakdown.amountDue,
          transactionType: 'SALE',
          orderId: invoice.invoice_number,
          customerEmail: customer.email,
          products: [{ name: `Invoice ${invoice.invoice_number} balance`, quantity: 1, price: breakdown.amountDue }],
          additionalFields,
        });
    await recordCheckoutSession({
      sessionToken,
      invoiceId: invoice.id,
      customerId: invoice.customer_id,
      mode: input.mode,
      transactionType: input.mode === 'card' ? 'STORAGE' : 'SALE',
      amount: input.mode === 'card' ? 0 : breakdown.amountDue,
    });
    return {
      sessionToken,
      scriptUrl: scriptUrl(),
      mode: input.mode,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      amount: breakdown.amountDue,
      breakdown,
      achTerms: input.mode === 'bank' ? { version: ACH_TERMS_VERSION, text: ACH_TERMS_TEXT } : null,
    };
  },

  async confirmPay(input: {
    invoiceId: string; mode: FieldsPayMode; sessionToken: string;
    actorUserId: string; employeeId: string | null;
    achConsent?: boolean; consentMeta?: ConsentMeta;
  }): Promise<FieldsConfirmResult> {
    return dedupeBySession(input.sessionToken, async () => {
      let outcome: ConfirmOutcome = 'rejected';
      try {
        const result = await runConfirmPay(input);
        outcome = result.duplicate ? 'duplicate' : 'approved';
        return result;
      } catch (error) {
        outcome = outcomeForError(error);
        throw error;
      } finally {
        await markCheckoutSessionConfirmed(input.sessionToken, outcome);
      }
    });
  },

  async createStorageSession(input: { customerId: string }) {
    const customer = await paymentService.loadCustomerBillingInfo(input.customerId);
    const { sessionToken } = await northGatewayService.createEmbeddedSession({
      amount: 0, transactionType: 'STORAGE', customerEmail: customer.email, additionalFields: additionalFieldsFor(customer),
    });
    await recordCheckoutSession({
      sessionToken, invoiceId: null, customerId: input.customerId, mode: 'store', transactionType: 'STORAGE', amount: 0,
    });
    return { sessionToken, scriptUrl: scriptUrl(), customerId: input.customerId };
  },

  async confirmStorage(input: { customerId: string; sessionToken: string; setDefault: boolean; actorUserId: string }) {
    return dedupeBySession(input.sessionToken, async () => {
      let outcome: ConfirmOutcome = 'rejected';
      try {
        const stored = await runConfirmStorage(input);
        outcome = stored.duplicate ? 'duplicate' : 'approved';
        return stored;
      } catch (error) {
        outcome = outcomeForError(error);
        throw error;
      } finally {
        await markCheckoutSessionConfirmed(input.sessionToken, outcome);
      }
    });
  },
};
