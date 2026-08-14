import { pool, withTransaction } from '../config/db';
import { ApiError } from '../utils/errors';
import { recordAudit } from './auditService';
import { rowsToCamel, toCamel } from './customerService';
import { paymentProvider } from '../integrations/payments';
import { communicationService, safelyQueueCommunication } from './communicationService';

export const paymentService = {
  // ---- Payment methods (tokenized only; no PAN/CVV ever touches this system) ----

  async listMethods(customerId: string) {
    const { rows } = await pool.query(
      `SELECT id, customer_id, payment_provider, method_type, brand, last4, expiration_month, expiration_year, is_default, created_at
       FROM payment_methods WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, created_at DESC`,
      [customerId],
    );
    return rowsToCamel(rows);
  },

  async addMethod(customerId: string, token: string, setDefault: boolean, userId: string) {
    let tokenized;
    try {
      tokenized = await paymentProvider.attachPaymentMethod(token);
    } catch (err) {
      throw ApiError.badRequest((err as Error).message);
    }
    return withTransaction(async (tx) => {
      if (setDefault) {
        await tx.query('UPDATE payment_methods SET is_default = false, updated_at = now() WHERE customer_id = $1', [customerId]);
      }
      const { rows } = await tx.query(
        `INSERT INTO payment_methods (customer_id, payment_provider, provider_payment_method_id, brand, last4, expiration_month, expiration_year, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, customer_id, payment_provider, brand, last4, expiration_month, expiration_year, is_default`,
        [customerId, paymentProvider.name, tokenized.providerPaymentMethodId, tokenized.brand,
         tokenized.last4, tokenized.expirationMonth, tokenized.expirationYear, setDefault],
      );
      await recordAudit({ userId, action: 'payment_method.added', entityType: 'payment_method', entityId: rows[0].id, newValue: { brand: tokenized.brand, last4: tokenized.last4 } }, tx);
      return toCamel(rows[0]);
    });
  },

  async setDefaultMethod(methodId: string, userId: string) {
    return withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT customer_id FROM payment_methods WHERE id = $1 AND deleted_at IS NULL', [methodId]);
      if (!rows[0]) throw ApiError.notFound('Payment method not found');
      await tx.query('UPDATE payment_methods SET is_default = false, updated_at = now() WHERE customer_id = $1', [rows[0].customer_id]);
      await tx.query('UPDATE payment_methods SET is_default = true, updated_at = now() WHERE id = $1', [methodId]);
      await recordAudit({ userId, action: 'payment_method.set_default', entityType: 'payment_method', entityId: methodId }, tx);
      return { id: methodId, isDefault: true };
    });
  },

  async removeMethod(methodId: string, userId: string) {
    const { rowCount } = await pool.query(
      'UPDATE payment_methods SET deleted_at = now(), is_default = false, updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [methodId],
    );
    if (!rowCount) throw ApiError.notFound('Payment method not found');
    await recordAudit({ userId, action: 'payment_method.removed', entityType: 'payment_method', entityId: methodId });
  },

  // ---- Charging ----

  /**
   * Charge an invoice: run the provider charge, then atomically record the
   * payment, update invoice status/amounts, customer balance, and receipt.
   * Failed charges are recorded and surfaced with a useful error (spec §28).
   */
  async chargeInvoice(invoiceId: string, paymentMethodId: string | null, amount: number | null, userId: string, employeeId: string | null) {
    const invRes = await pool.query(
      `SELECT i.*, c.id AS cust_id FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [invoiceId],
    );
    const invoice = invRes.rows[0];
    if (!invoice) throw ApiError.notFound('Invoice not found');
    if (['paid', 'void'].includes(invoice.status)) throw ApiError.badRequest(`Invoice is already ${invoice.status}`);

    const balanceDue = Number(invoice.total) - Number(invoice.amount_paid);
    const chargeAmount = amount ?? balanceDue;
    if (chargeAmount <= 0 || chargeAmount > balanceDue + 0.001) {
      throw ApiError.badRequest(`Charge amount must be between $0.01 and $${balanceDue.toFixed(2)}`);
    }

    // Resolve payment method (explicit, or the customer's default).
    let methodRow;
    if (paymentMethodId) {
      const r = await pool.query(
        'SELECT * FROM payment_methods WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL',
        [paymentMethodId, invoice.customer_id],
      );
      methodRow = r.rows[0];
    } else {
      const r = await pool.query(
        'SELECT * FROM payment_methods WHERE customer_id = $1 AND is_default = true AND deleted_at IS NULL',
        [invoice.customer_id],
      );
      methodRow = r.rows[0];
    }
    if (!methodRow) throw ApiError.badRequest('No payment method available for this customer');

    const result = await paymentProvider.charge(
      methodRow.provider_payment_method_id,
      Math.round(chargeAmount * 100),
      'usd',
      `Invoice ${invoice.invoice_number}`,
    );

    if (!result.success) {
      await pool.query(
        `INSERT INTO payments (customer_id, invoice_id, payment_method_id, amount, status, payment_provider, failure_reason, collected_by, processed_at)
         VALUES ($1,$2,$3,$4,'failed',$5,$6,$7,now())`,
        [invoice.customer_id, invoiceId, methodRow.id, chargeAmount, paymentProvider.name, result.failureReason, employeeId],
      );
      await recordAudit({ userId, action: 'payment.failed', entityType: 'invoice', entityId: invoiceId, newValue: { amount: chargeAmount, reason: result.failureReason } });
      safelyQueueCommunication(() => communicationService.sendInvoiceTemplate(invoiceId, 'payment_failed', null, {
        amount: chargeAmount,
        reason: result.failureReason,
      }));
      throw new ApiError(402, `Payment failed: ${result.failureReason}`, { retryable: true });
    }

    const resultData = await withTransaction(async (tx) => {
      const receiptRes = await tx.query("SELECT 'RCPT-' || nextval('receipt_number_seq') AS num");
      const receiptNumber = receiptRes.rows[0].num;

      const payRes = await tx.query(
        `INSERT INTO payments (customer_id, invoice_id, payment_method_id, amount, status, payment_provider,
           provider_transaction_id, collected_by, receipt_number, processed_at)
         VALUES ($1,$2,$3,$4,'succeeded',$5,$6,$7,$8,now()) RETURNING *`,
        [invoice.customer_id, invoiceId, methodRow.id, chargeAmount, paymentProvider.name,
         result.transactionId, employeeId, receiptNumber],
      );

      const newPaid = Number(invoice.amount_paid) + chargeAmount;
      const fullyPaid = newPaid >= Number(invoice.total) - 0.001;
      await tx.query(
        `UPDATE invoices SET amount_paid = $1, status = $2, paid_at = CASE WHEN $3 THEN now() ELSE paid_at END, updated_at = now()
         WHERE id = $4`,
        [newPaid, fullyPaid ? 'paid' : 'partially_paid', fullyPaid, invoiceId],
      );
      await tx.query('UPDATE customers SET balance = balance - $1, updated_at = now() WHERE id = $2', [chargeAmount, invoice.customer_id]);
      await tx.query('UPDATE autopay_settings SET failure_count = 0, updated_at = now() WHERE customer_id = $1', [invoice.customer_id]);

      await recordAudit({
        userId, action: 'payment.succeeded', entityType: 'payment', entityId: payRes.rows[0].id,
        newValue: { invoiceId, amount: chargeAmount, transactionId: result.transactionId, receiptNumber },
      }, tx);

      return {
        payment: toCamel(payRes.rows[0]),
        receipt: {
          receiptNumber,
          amount: chargeAmount,
          transactionId: result.transactionId,
          invoiceNumber: invoice.invoice_number,
          brand: methodRow.brand,
          last4: methodRow.last4,
          paidInFull: fullyPaid,
        },
      };
    });
    safelyQueueCommunication(() => communicationService.sendInvoiceTemplate(invoiceId, 'payment_received', null, { amount: chargeAmount }));
    return resultData;
  },

  async list(filters: { customerId?: string; invoiceId?: string; status?: string; from?: string; to?: string }, limit: number, offset: number) {
    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    if (filters.customerId) { params.push(filters.customerId); where.push(`p.customer_id = $${params.length}`); }
    if (filters.invoiceId) { params.push(filters.invoiceId); where.push(`p.invoice_id = $${params.length}`); }
    if (filters.status) { params.push(filters.status); where.push(`p.status = $${params.length}`); }
    if (filters.from) { params.push(filters.from); where.push(`p.created_at >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); where.push(`p.created_at <= $${params.length}::date + 1`); }
    const whereSql = where.join(' AND ');
    const count = await pool.query(`SELECT count(*)::int AS total FROM payments p WHERE ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT p.*, i.invoice_number, c.first_name || ' ' || c.last_name AS customer_name,
              pm.brand, pm.last4
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       JOIN customers c ON c.id = p.customer_id
       LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
       WHERE ${whereSql} ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel(rows), total: count.rows[0].total };
  },

  // ---- AutoPay ----

  async getAutopay(customerId: string) {
    const { rows } = await pool.query('SELECT * FROM autopay_settings WHERE customer_id = $1', [customerId]);
    return rows[0] ? toCamel(rows[0]) : { customerId, enabled: false, paymentMethodId: null, nextPaymentDate: null, failureCount: 0 };
  },

  async setAutopay(customerId: string, enabled: boolean, paymentMethodId: string | null, userId: string) {
    if (enabled && !paymentMethodId) throw ApiError.badRequest('A payment method is required to enable AutoPay');
    return withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO autopay_settings (customer_id, enabled, payment_method_id, updated_at)
         VALUES ($1,$2,$3,now())
         ON CONFLICT (customer_id) DO UPDATE SET enabled = $2, payment_method_id = $3, updated_at = now()`,
        [customerId, enabled, paymentMethodId],
      );
      await tx.query('UPDATE customers SET autopay_enabled = $1, updated_at = now() WHERE id = $2', [enabled, customerId]);
      await recordAudit({ userId, action: enabled ? 'autopay.enabled' : 'autopay.disabled', entityType: 'customer', entityId: customerId }, tx);
      return { customerId, enabled, paymentMethodId };
    });
  },
};
