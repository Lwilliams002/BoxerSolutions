import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { invoiceService } from './invoiceService';
import { paymentService } from './paymentService';
import { logger } from '../utils/logger';

function mapRow(row: any) {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.company || `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
    description: row.description,
    amount: Number(row.amount),
    active: row.active,
    lastChargedInvoiceId: row.last_charged_invoice_id,
    lastChargedAt: row.last_charged_at,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export const recurringChargeService = {
  /**
   * Create or update the customer's recurring "Regular" charge from a signed
   * agreement. Signing a newer agreement replaces the previous amount.
   */
  async upsertFromAgreement(
    customerId: string,
    amount: number,
    sourceAgreementFileId: string | null,
  ) {
    const normalized = Number(amount.toFixed(2));
    if (!Number.isFinite(normalized) || normalized <= 0) return null;
    const { rows } = await pool.query(
      `INSERT INTO recurring_charges (customer_id, description, amount, source_agreement_file_id, active)
       VALUES ($1, 'Regular recurring service', $2, $3, true)
       ON CONFLICT (customer_id) WHERE active
       DO UPDATE SET
         amount = EXCLUDED.amount,
         source_agreement_file_id = EXCLUDED.source_agreement_file_id,
         updated_at = now()
       RETURNING *`,
      [customerId, normalized, sourceAgreementFileId],
    );
    return rows[0] ?? null;
  },

  async list(filters: { customerId?: string }) {
    const params: unknown[] = [];
    let where = 'rc.active = true AND c.deleted_at IS NULL';
    if (filters.customerId) {
      params.push(filters.customerId);
      where += ` AND rc.customer_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT rc.*, c.first_name, c.last_name, c.company
       FROM recurring_charges rc
       JOIN customers c ON c.id = rc.customer_id
       WHERE ${where}
       ORDER BY rc.updated_at DESC`,
      params,
    );
    return { items: rows.map(mapRow), total: rows.length };
  },

  /**
   * Create an invoice for the recurring amount and immediately attempt to
   * charge it on the customer's saved payment method.
   */
  async chargeNow(id: string, userId: string, paymentMethodId?: string | null) {
    const { rows } = await pool.query(
      `SELECT * FROM recurring_charges WHERE id = $1 AND active = true`,
      [id],
    );
    const charge = rows[0];
    if (!charge) throw ApiError.notFound('Recurring charge not found.');
    const amount = Number(Number(charge.amount).toFixed(2));
    if (amount <= 0) throw ApiError.badRequest('Recurring charge amount must be greater than zero.');

    const invoice = (await invoiceService.create(
      {
        customerId: charge.customer_id,
        dueDate: new Date().toISOString().slice(0, 10),
        taxRate: 0,
        notes: 'Recurring service charge',
        items: [
          {
            description: charge.description || 'Regular recurring service',
            quantity: 1,
            unitPrice: amount,
            taxable: false,
          },
        ],
      },
      userId,
    )) as { id?: unknown };
    const invoiceId = String(invoice?.id ?? '');
    if (!invoiceId) throw ApiError.badRequest('Recurring invoice could not be created.');

    let methodId = paymentMethodId ?? null;
    if (!methodId) {
      const methods = (await paymentService.listMethods(charge.customer_id)) as Array<{
        id: string;
        isDefault?: boolean;
      }>;
      const method = methods.find((m) => m.isDefault) ?? methods[0];
      methodId = method?.id ?? null;
    }

    if (!methodId) {
      return {
        charged: false,
        invoiceId,
        amount,
        reason: 'No saved payment method on file. Open the invoice to collect payment.',
      };
    }

    try {
      const result = await paymentService.chargeInvoice(invoiceId, methodId, null, userId, null);
      await pool.query(
        `UPDATE recurring_charges
         SET last_charged_invoice_id = $2, last_charged_at = now(), updated_at = now()
         WHERE id = $1`,
        [id, invoiceId],
      );
      return { charged: true, invoiceId, amount, receipt: result.receipt };
    } catch (error) {
      logger.warn({ err: error, recurringChargeId: id, invoiceId }, 'recurring charge payment failed');
      return {
        charged: false,
        invoiceId,
        amount,
        reason: error instanceof Error ? error.message : 'Recurring charge failed.',
      };
    }
  },
};

