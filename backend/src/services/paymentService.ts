import PDFDocument from 'pdfkit';
import crypto from 'crypto';
import { pool, withTransaction, Queryable } from '../config/db';
import { ApiError } from '../utils/errors';
import { recordAudit } from './auditService';
import { rowsToCamel, toCamel } from './customerService';
import { paymentProvider } from '../integrations/payments';
import { communicationService, safelyQueueCommunication } from './communicationService';
import { storage } from '../integrations/storage';
import { fileService } from './fileService';

const COMPANY = {
  name: 'Boxer Solutions Pest Control',
  address: '2500 Bee Cave Rd, Austin, TX 78746',
  phone: '(512) 555-0142',
  email: 'service@boxersolutionspestcontrol.com',
};

type ChargeSource = 'manual' | 'autopay';

function money(value: string | number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeLast4(value: unknown) {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits.slice(-4);
}

function invoiceStatusFor(total: number, paid: number, dueDate?: string | Date | null) {
  if (paid >= total - 0.001) return 'paid';
  if (paid > 0.001) return 'partially_paid';
  const due = dueDate ? new Date(dueDate) : null;
  const today = new Date(todayIso());
  return due && due < today ? 'past_due' : 'open';
}

async function generateReceiptPdf(db: Queryable, paymentId: string, userId: string) {
  const { rows } = await db.query(
    `SELECT p.*, i.invoice_number, i.total, i.amount_paid, c.first_name, c.last_name, c.company,
            pm.brand, pm.last4
     FROM payments p
     JOIN customers c ON c.id = p.customer_id
     LEFT JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
     WHERE p.id = $1`,
    [paymentId],
  );
  const payment = rows[0];
  if (!payment) throw ApiError.notFound('Payment not found');

  const buffer: Buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const customerName = payment.company || `${payment.first_name} ${payment.last_name}`;
    doc.fontSize(22).fillColor('#2DC4A2').text(COMPANY.name);
    doc.fontSize(9).fillColor('#444').text(COMPANY.address).text(`${COMPANY.phone}  ·  ${COMPANY.email}`);
    doc.moveDown(1.5);
    doc.fontSize(18).fillColor('#0D0D0D').text(`RECEIPT ${payment.receipt_number}`);
    doc.moveDown(1);
    doc.fontSize(11).fillColor('#0D0D0D')
      .text(`Customer: ${customerName}`)
      .text(`Invoice: ${payment.invoice_number ?? 'Account payment'}`)
      .text(`Date: ${new Date(payment.processed_at ?? payment.created_at).toLocaleString('en-US')}`)
      .text(`Payment Method: ${payment.brand ?? 'Payment method'}${payment.last4 ? ` ****${payment.last4}` : ''}`)
      .text(`Transaction: ${payment.provider_transaction_id ?? ''}`);
    doc.moveDown(1.5);
    doc.fontSize(16).fillColor('#0D0D0D').text(`Amount Paid: ${money(payment.amount)}`);
    if (payment.invoice_number) {
      doc.fontSize(11).fillColor('#444')
        .text(`Invoice Total: ${money(payment.total)}`)
        .text(`Invoice Amount Paid: ${money(payment.amount_paid)}`);
    }
    doc.fontSize(8).fillColor('#888').text('Thank you for choosing Boxer Solutions Pest Control.', 50, 720, { width: 512, align: 'center' });
    doc.end();
  });

  const fileId = crypto.randomUUID();
  const objectKey = `receipts/${paymentId}/${payment.receipt_number}.pdf`;
  await storage.putObject(objectKey, buffer, 'application/pdf');
  const fileRes = await db.query(
    `INSERT INTO files (id, customer_id, invoice_id, payment_id, file_type, file_name, mime_type, file_size,
       storage_bucket, storage_object_key, upload_status, uploaded_by)
     VALUES ($1,$2,$3,$4,'receipt_pdf',$5,'application/pdf',$6,$7,$8,'uploaded',$9)
     ON CONFLICT (storage_object_key) DO UPDATE SET file_size = EXCLUDED.file_size, updated_at = now()
     RETURNING *`,
    [fileId, payment.customer_id, payment.invoice_id ?? null, paymentId, `${payment.receipt_number}.pdf`, buffer.length, storage.bucket, objectKey, userId],
  );
  await db.query('UPDATE payments SET receipt_file_id = $1, updated_at = now() WHERE id = $2', [fileRes.rows[0].id, paymentId]);
  return { fileId: fileRes.rows[0].id, objectKey, size: buffer.length };
}

export const paymentService = {
  // ---- Payment methods (tokenized only; no PAN/CVV ever touches this system) ----

  async listMethods(customerId: string) {
    const { rows } = await pool.query(
      `SELECT id, customer_id, payment_provider, method_type, brand,
              right(coalesce(last4::text, ''), 4) AS last4,
              expiration_month, expiration_year, is_default, created_at
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
         normalizeLast4(tokenized.last4), tokenized.expirationMonth, tokenized.expirationYear, setDefault],
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

  async chargeInvoice(
    invoiceId: string,
    paymentMethodId: string | null,
    amount: number | null,
    userId: string,
    employeeId: string | null,
    options: { source?: ChargeSource; sendFailureCommunication?: boolean; autopayAttemptDate?: string } = {},
  ) {
    const source = options.source ?? 'manual';
    const attemptDate = options.autopayAttemptDate ?? (source === 'autopay' ? todayIso() : null);
    const invRes = await pool.query(
      `SELECT i.*, c.id AS cust_id FROM invoices i JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [invoiceId],
    );
    const invoice = invRes.rows[0];
    if (!invoice) throw ApiError.notFound('Invoice not found');
    if (['paid', 'void'].includes(invoice.status)) throw ApiError.badRequest(`Invoice is already ${invoice.status}`);

    if (source === 'autopay' && attemptDate) {
      const attempted = await pool.query(
        `SELECT 1 FROM payments WHERE invoice_id = $1 AND payment_source = 'autopay' AND autopay_attempt_date = $2`,
        [invoiceId, attemptDate],
      );
      if (attempted.rows[0]) throw ApiError.conflict('AutoPay already attempted for this invoice today');
    }

    const balanceDue = Number(invoice.total) - Number(invoice.amount_paid);
    const chargeAmount = amount ?? balanceDue;
    if (chargeAmount <= 0 || chargeAmount > balanceDue + 0.001) {
      throw ApiError.badRequest(`Charge amount must be between $0.01 and $${balanceDue.toFixed(2)}`);
    }

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
        `INSERT INTO payments (customer_id, invoice_id, payment_method_id, amount, status, payment_provider, failure_reason,
           collected_by, processed_at, payment_source, autopay_attempt_date)
         VALUES ($1,$2,$3,$4,'failed',$5,$6,$7,now(),$8,$9)`,
        [invoice.customer_id, invoiceId, methodRow.id, chargeAmount, paymentProvider.name, result.failureReason, employeeId, source, attemptDate],
      );
      await recordAudit({ userId, action: 'payment.failed', entityType: 'invoice', entityId: invoiceId, newValue: { amount: chargeAmount, reason: result.failureReason, source } });
      if (options.sendFailureCommunication !== false) {
        safelyQueueCommunication(() => communicationService.sendInvoiceTemplate(invoiceId, 'payment_failed', null, {
          amount: chargeAmount,
          reason: result.failureReason,
        }));
      }
      throw new ApiError(402, `Payment failed: ${result.failureReason}`, { retryable: true });
    }

    const resultData = await withTransaction(async (tx) => {
      const receiptRes = await tx.query("SELECT 'RCPT-' || nextval('receipt_number_seq') AS num");
      const receiptNumber = receiptRes.rows[0].num;

      const payRes = await tx.query(
        `INSERT INTO payments (customer_id, invoice_id, payment_method_id, amount, status, payment_provider,
           provider_transaction_id, collected_by, receipt_number, processed_at, payment_source, autopay_attempt_date)
         VALUES ($1,$2,$3,$4,'succeeded',$5,$6,$7,$8,now(),$9,$10) RETURNING *`,
        [invoice.customer_id, invoiceId, methodRow.id, chargeAmount, paymentProvider.name,
         result.transactionId, employeeId, receiptNumber, source, attemptDate],
      );

      const newPaid = Number(invoice.amount_paid) + chargeAmount;
      const fullyPaid = newPaid >= Number(invoice.total) - 0.001;
      await tx.query(
        `UPDATE invoices SET amount_paid = $1, status = $2, paid_at = CASE WHEN $3 THEN now() ELSE paid_at END,
           autopay_retry_count = 0, next_autopay_retry_date = NULL, last_autopay_attempt_date = COALESCE($5, last_autopay_attempt_date), updated_at = now()
         WHERE id = $4`,
        [newPaid, fullyPaid ? 'paid' : 'partially_paid', fullyPaid, invoiceId, attemptDate],
      );
      await tx.query('UPDATE customers SET balance = balance - $1, updated_at = now() WHERE id = $2', [chargeAmount, invoice.customer_id]);
      await tx.query('UPDATE autopay_settings SET failure_count = 0, last_failure_at = NULL, updated_at = now() WHERE customer_id = $1', [invoice.customer_id]);

      const receiptFile = await generateReceiptPdf(tx, payRes.rows[0].id, userId);
      const finalPayment = await tx.query('SELECT * FROM payments WHERE id = $1', [payRes.rows[0].id]);

      await recordAudit({
        userId, action: 'payment.succeeded', entityType: 'payment', entityId: payRes.rows[0].id,
        newValue: { invoiceId, amount: chargeAmount, transactionId: result.transactionId, receiptNumber, source },
      }, tx);

      return {
        payment: toCamel(finalPayment.rows[0]),
        receipt: {
          receiptNumber,
          amount: chargeAmount,
          transactionId: result.transactionId,
          invoiceNumber: invoice.invoice_number,
          brand: methodRow.brand,
          last4: methodRow.last4,
          paidInFull: fullyPaid,
          fileId: receiptFile.fileId,
        },
      };
    });
    safelyQueueCommunication(() => communicationService.sendInvoiceTemplate(invoiceId, 'payment_received', null, { amount: chargeAmount }));
    return resultData;
  },

  async recordExternalInvoicePayment(
    invoiceId: string,
    amount: number,
    providerName: string,
    providerTransactionId: string,
    userId: string,
    employeeId: string | null,
  ) {
    const invRes = await pool.query(
      `SELECT i.*, c.id AS cust_id
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1
         AND i.deleted_at IS NULL`,
      [invoiceId],
    );
    const invoice = invRes.rows[0];
    if (!invoice) throw ApiError.notFound('Invoice not found');
    if (['paid', 'void'].includes(invoice.status)) throw ApiError.badRequest(`Invoice is already ${invoice.status}`);

    const chargeAmount = Number(amount.toFixed(2));
    const balanceDue = Number(invoice.total) - Number(invoice.amount_paid);
    if (!Number.isFinite(chargeAmount) || chargeAmount <= 0 || chargeAmount > balanceDue + 0.001) {
      throw ApiError.badRequest(`Payment amount must be between $0.01 and $${balanceDue.toFixed(2)}`);
    }

    const duplicate = await pool.query(
      `SELECT id
       FROM payments
       WHERE invoice_id = $1
         AND payment_provider = $2
         AND provider_transaction_id = $3
       LIMIT 1`,
      [invoiceId, providerName, providerTransactionId],
    );
    if (duplicate.rows[0]) {
      const existing = await pool.query('SELECT * FROM payments WHERE id = $1', [duplicate.rows[0].id]);
      return {
        payment: toCamel(existing.rows[0]),
        receipt: null,
        duplicate: true,
      };
    }

    const resultData = await withTransaction(async (tx) => {
      const receiptRes = await tx.query("SELECT 'RCPT-' || nextval('receipt_number_seq') AS num");
      const receiptNumber = receiptRes.rows[0].num;
      const payRes = await tx.query(
        `INSERT INTO payments (
           customer_id, invoice_id, payment_method_id, amount, status, payment_provider,
           provider_transaction_id, collected_by, receipt_number, processed_at, payment_source
         )
         VALUES ($1,$2,NULL,$3,'succeeded',$4,$5,$6,$7,now(),'manual')
         RETURNING *`,
        [invoice.customer_id, invoiceId, chargeAmount, providerName, providerTransactionId, employeeId, receiptNumber],
      );

      const newPaid = Number(invoice.amount_paid) + chargeAmount;
      const fullyPaid = newPaid >= Number(invoice.total) - 0.001;
      await tx.query(
        `UPDATE invoices
         SET amount_paid = $1,
             status = $2,
             paid_at = CASE WHEN $3 THEN now() ELSE paid_at END,
             updated_at = now()
         WHERE id = $4`,
        [newPaid, fullyPaid ? 'paid' : 'partially_paid', fullyPaid, invoiceId],
      );
      await tx.query(
        'UPDATE customers SET balance = balance - $1, updated_at = now() WHERE id = $2',
        [chargeAmount, invoice.customer_id],
      );
      await tx.query(
        'UPDATE autopay_settings SET failure_count = 0, last_failure_at = NULL, updated_at = now() WHERE customer_id = $1',
        [invoice.customer_id],
      );

      const receiptFile = await generateReceiptPdf(tx, payRes.rows[0].id, userId);
      const finalPayment = await tx.query('SELECT * FROM payments WHERE id = $1', [payRes.rows[0].id]);
      await recordAudit({
        userId,
        action: 'payment.external_recorded',
        entityType: 'payment',
        entityId: payRes.rows[0].id,
        newValue: { invoiceId, amount: chargeAmount, providerName, providerTransactionId, receiptNumber },
      }, tx);

      return {
        payment: toCamel(finalPayment.rows[0]),
        receipt: {
          receiptNumber,
          amount: chargeAmount,
          transactionId: providerTransactionId,
          invoiceNumber: invoice.invoice_number,
          brand: null,
          last4: null,
          paidInFull: fullyPaid,
          fileId: receiptFile.fileId,
        },
        duplicate: false,
      };
    });
    safelyQueueCommunication(() => communicationService.sendInvoiceTemplate(invoiceId, 'payment_received', null, { amount: chargeAmount }));
    return resultData;
  },

  async refundPayment(paymentId: string, amount: number | null, userId: string, employeeId: string | null) {
    const paymentRes = await pool.query(
      `SELECT p.*, i.total AS invoice_total, i.amount_paid, i.status AS invoice_status, i.due_date
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.id = $1`,
      [paymentId],
    );
    const payment = paymentRes.rows[0];
    if (!payment) throw ApiError.notFound('Payment not found');
    if (payment.status !== 'succeeded' || Number(payment.amount) <= 0 || !payment.provider_transaction_id) {
      throw ApiError.badRequest('Only successful charge payments can be refunded');
    }
    const remaining = Number(payment.amount) - Number(payment.refunded_amount ?? 0);
    const refundAmount = amount ?? remaining;
    if (refundAmount <= 0 || refundAmount > remaining + 0.001) {
      throw ApiError.badRequest(`Refund amount must be between $0.01 and $${remaining.toFixed(2)}`);
    }

    const result = await paymentProvider.refund(payment.provider_transaction_id, Math.round(refundAmount * 100));
    if (!result.success) throw new ApiError(402, `Refund failed: ${result.failureReason}`);

    const data = await withTransaction(async (tx) => {
      const locked = await tx.query(
        `SELECT p.*, i.total AS invoice_total, i.amount_paid, i.due_date
         FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE p.id = $1 FOR UPDATE OF p`,
        [paymentId],
      );
      const current = locked.rows[0];
      const currentRemaining = Number(current.amount) - Number(current.refunded_amount ?? 0);
      if (refundAmount > currentRemaining + 0.001) throw ApiError.badRequest('Refund exceeds remaining refundable amount');

      const refundRow = await tx.query(
        `INSERT INTO payments (customer_id, invoice_id, payment_method_id, amount, status, payment_provider,
           provider_transaction_id, provider_refund_id, collected_by, processed_at, parent_payment_id, payment_source)
         VALUES ($1,$2,$3,$4,'succeeded',$5,$6,$6,$7,now(),$8,'refund') RETURNING *`,
        [current.customer_id, current.invoice_id, current.payment_method_id, -refundAmount, current.payment_provider,
         result.transactionId, employeeId, current.id],
      );
      const newRefunded = Number(current.refunded_amount ?? 0) + refundAmount;
      await tx.query(
        `UPDATE payments SET refunded_amount = $1, status = CASE WHEN $1 >= amount - 0.001 THEN 'refunded' ELSE status END,
           updated_at = now() WHERE id = $2`,
        [newRefunded, current.id],
      );

      if (current.invoice_id) {
        const newPaid = Math.max(0, Number(current.amount_paid) - refundAmount);
        const newStatus = invoiceStatusFor(Number(current.invoice_total), newPaid, current.due_date);
        await tx.query(
          `UPDATE invoices SET amount_paid = $1, status = $2, paid_at = CASE WHEN $2 = 'paid' THEN paid_at ELSE NULL END, updated_at = now()
           WHERE id = $3`,
          [newPaid, newStatus, current.invoice_id],
        );
        await tx.query('UPDATE customers SET balance = balance + $1, updated_at = now() WHERE id = $2', [refundAmount, current.customer_id]);
      }
      await recordAudit({ userId, action: 'payment.refunded', entityType: 'payment', entityId: current.id, newValue: { amount: refundAmount, refundId: result.transactionId } }, tx);
      return { refund: toCamel(refundRow.rows[0]), amount: refundAmount, invoiceId: current.invoice_id };
    });
    if (data.invoiceId) {
      safelyQueueCommunication(() => communicationService.sendInvoiceTemplate(data.invoiceId, 'payment_refunded', null, { amount: data.amount }));
    }
    return data;
  },

  async getReceipt(paymentId: string) {
    const { rows } = await pool.query('SELECT receipt_file_id FROM payments WHERE id = $1', [paymentId]);
    if (!rows[0]) throw ApiError.notFound('Payment not found');
    if (!rows[0].receipt_file_id) throw ApiError.notFound('Receipt not found');
    return fileService.getDownloadUrl(rows[0].receipt_file_id);
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
      `SELECT p.*, (p.amount - p.refunded_amount) AS remaining_refundable_amount,
              i.invoice_number, c.first_name || ' ' || c.last_name AS customer_name,
              pm.brand, right(coalesce(pm.last4::text, ''), 4) AS last4
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
    if (enabled && paymentMethodId) {
      const method = await pool.query('SELECT 1 FROM payment_methods WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL', [paymentMethodId, customerId]);
      if (!method.rows[0]) throw ApiError.badRequest('Payment method is not available for this customer');
    }
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
