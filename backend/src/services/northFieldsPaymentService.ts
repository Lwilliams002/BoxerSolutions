// backend/src/services/northFieldsPaymentService.ts
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

export const northFieldsPaymentService = {
  async createPaySession(input: { invoiceId: string; mode: FieldsPayMode }): Promise<FieldsPaySession> {
    const invoice = await loadInvoice(input.invoiceId);
    const breakdown = breakdownFor(invoice);
    if (breakdown.amountDue <= 0) throw ApiError.badRequest('Invoice has no outstanding balance.');
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
    const invoice = await loadInvoice(input.invoiceId);
    if (input.mode === 'bank' && input.achConsent !== true) {
      throw ApiError.badRequest('Bank payments require acceptance of the ACH authorization terms.');
    }
    const expected: NorthMethodType = input.mode === 'bank' ? 'bank_account' : 'card';
    const result = await waitForNorthSession(input.sessionToken, expected);
    logger.info({ invoiceId: invoice.id, mode: input.mode, status: result.status, methodType: result.methodType }, 'north fields session approved');

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
      true,
      input.actorUserId,
    )) as { id: string; duplicate: boolean };
    const savedMethod = { id: method.id, methodType: result.methodType, brand: result.brand, last4: result.last4 };

    if (input.mode === 'card') {
      // STORAGE approved → charge the stored BRIC (customer-initiated, no aci_ext).
      try {
        const charged = await paymentService.chargeInvoice(invoice.id, method.id, null, input.actorUserId, input.employeeId, { source: 'manual', mit: false });
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
    return {
      status: 'approved',
      duplicate: recorded.duplicate,
      amount: result.amount,
      transactionId: result.authGuid,
      receipt: recorded.receipt,
      payment: recorded.payment,
      savedMethod,
    };
  },

  async createStorageSession(input: { customerId: string }) {
    const customer = await paymentService.loadCustomerBillingInfo(input.customerId);
    const { sessionToken } = await northGatewayService.createEmbeddedSession({
      amount: 0, transactionType: 'STORAGE', customerEmail: customer.email, additionalFields: additionalFieldsFor(customer),
    });
    return { sessionToken, scriptUrl: scriptUrl(), customerId: input.customerId };
  },

  async confirmStorage(input: { customerId: string; sessionToken: string; setDefault: boolean; actorUserId: string }) {
    const result = await waitForNorthSession(input.sessionToken, 'card');
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
  },
};
