import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { config } from '../config';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope, assertInvoiceAccess, assertCustomerAccess } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { paymentService } from '../services/paymentService';
import { processAutopay } from '../jobs/billing';
import { pool } from '../config/db';
import { northGatewayService } from '../services/northGatewayService';
import { ApiError } from '../utils/errors';
import { notifications } from '../integrations/notifications';
import { logger } from '../utils/logger';

const router = Router();

function timingSafeEqualText(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyNorthWebhookSignature(rawBody: string, headerValue: string | undefined): boolean {
  const secret = config.north.webhookSecret;
  if (!secret || !headerValue) return false;
  const signed = headerValue.trim();
  // "t=<timestamp>,v1=<hex>" format
  if (signed.includes('t=') && signed.includes('v1=')) {
    const parts = signed
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const t = parts.find((p) => p.startsWith('t='))?.slice(2);
    const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
    if (!t || !v1) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    return timingSafeEqualText(expected, v1);
  }
  // Raw hex signature format
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqualText(expected, signed);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseNorthAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(2));
  if (typeof value === 'string') {
    const normalized = value.replace(/[$,]/g, '').trim();
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) return Number(parsed.toFixed(2));
  }
  return null;
}

function pickNorthTransactionId(statusPayload: Record<string, unknown>, bodyPayload: Record<string, unknown> | null): string | null {
  const fromTop = [statusPayload.transactionId, statusPayload.transaction_id, statusPayload.referenceNumber]
    .find((v) => typeof v === 'string' && v.length > 3) as string | undefined;
  if (fromTop) return fromTop;
  if (!bodyPayload) return null;
  const fullResponse = asRecord(bodyPayload.fullResponse);
  const candidate = [
    bodyPayload.transactionId,
    bodyPayload.transaction_id,
    bodyPayload.tranId,
    bodyPayload.referenceNumber,
    bodyPayload.authCode,
    fullResponse?.transaction_id,
    fullResponse?.trans_id,
    fullResponse?.reference_number,
    fullResponse?.auth_code,
  ].find((v) => typeof v === 'string' && v.length > 1);
  return (candidate as string | undefined) ?? null;
}

function pickNorthApprovedAmount(bodyPayload: Record<string, unknown> | null): number | null {
  if (!bodyPayload) return null;
  const fullResponse = asRecord(bodyPayload.fullResponse);
  return (
    parseNorthAmount(bodyPayload.amount)
    ?? parseNorthAmount(bodyPayload.approvedAmount)
    ?? parseNorthAmount(bodyPayload.tranAmount)
    ?? parseNorthAmount(bodyPayload.total)
    ?? parseNorthAmount(fullResponse?.amount)
    ?? parseNorthAmount(fullResponse?.approved_amount)
  );
}

router.get(
  '/north/logo',
  asyncHandler(async (_req, res) => {
    const filePath = path.resolve(__dirname, '../../../mobile/assets/logo-mark.png');
    const data = await fs.readFile(filePath);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).type('image/png').send(data);
  }),
);

router.post(
  '/north/webhook',
  asyncHandler(async (req, res) => {
    const rawBody = String((req as any).rawBody ?? '');
    const signatureHeader = (req.header('x-webhook-signature')
      || req.header('x-yourapp-signature-256')
      || req.header('x-signature')
      || req.header('north-signature')
      || undefined);
    const validSignature = verifyNorthWebhookSignature(rawBody, signatureHeader);
    if (!validSignature) {
      throw ApiError.unauthorized('Invalid North webhook signature');
    }
    logger.info(
      {
        eventType: (req.body as { eventType?: string } | undefined)?.eventType ?? null,
        hasBody: !!req.body,
        signatureVerified: true,
      },
      'north webhook received',
    );
    ok(res, { received: true }, 'Webhook received');
  }),
);

router.get(
  '/north/webhook',
  asyncHandler(async (_req, res) => {
    ok(res, { status: 'ok' }, 'Webhook endpoint active');
  }),
);

router.use(authenticate);

router.post(
  '/north/embedded/session',
  authorize('invoices:read', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ invoiceId: z.string().uuid() }).parse(req.body);
    const scope = technicianScope(req, 'invoices:read');
    await assertInvoiceAccess(scope, body.invoiceId);
    const invoiceRes = await pool.query(
      `SELECT i.id, i.invoice_number, i.total, i.amount_paid, c.email AS customer_email
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1
         AND i.deleted_at IS NULL`,
      [body.invoiceId],
    );
    if (!invoiceRes.rows[0]) throw ApiError.notFound('Invoice not found');
    const invoice = invoiceRes.rows[0] as {
      invoice_number: string;
      total: string;
      amount_paid: string;
      customer_email: string | null;
    };
    const itemRows = await pool.query(
      `SELECT description, quantity, unit_price
       FROM invoice_items
       WHERE invoice_id = $1
       ORDER BY created_at ASC`,
      [body.invoiceId],
    );
    const amount = Math.max(0, Number(invoice.total) - Number(invoice.amount_paid));
    if (amount <= 0) throw ApiError.badRequest('Invoice has no outstanding balance.');
    const itemizedProducts = itemRows.rows.map((row) => ({
      name: row.description,
      quantity: Number(row.quantity),
      price: Number(row.unit_price),
    }));
    const itemizedTotal = Number(
      itemizedProducts.reduce((sum, p) => sum + p.price * p.quantity, 0).toFixed(2),
    );
    // North rejects sessions whose products total does not equal the amount, so
    // fall back to a single balance line when the invoice is partially paid,
    // discounted, or taxed.
    const products = itemizedProducts.length && itemizedTotal === Number(amount.toFixed(2))
      ? itemizedProducts
      : [{ name: `Invoice ${invoice.invoice_number} balance`, quantity: 1, price: Number(amount.toFixed(2)) }];
    const sessionToken = await northGatewayService.createEmbeddedSession({
      amount,
      orderId: invoice.invoice_number,
      customerEmail: invoice.customer_email,
      products,
    });
    ok(res, {
      sessionToken,
      checkoutId: config.north.embeddedCheckoutId,
      scriptUrl: `${config.north.embeddedBaseUrl}/checkout.js`,
      amount,
      invoiceId: body.invoiceId,
    }, 'North embedded session created', 201);
  }),
);

router.post(
  '/north/embedded/confirm',
  authorize('invoices:read', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      invoiceId: z.string().uuid(),
      sessionToken: z.string().min(10),
    }).parse(req.body);
    const scope = technicianScope(req, 'invoices:read');
    await assertInvoiceAccess(scope, body.invoiceId);

    const sessionStatus = await northGatewayService.getEmbeddedSessionStatus(body.sessionToken);
    const statusData = asRecord(sessionStatus.data) ?? sessionStatus;
    const status = String(statusData.status ?? '').toLowerCase();
    if (status !== 'approved') {
      throw new ApiError(409, `North checkout session is ${status || 'not approved'}.`);
    }
    const responseBody = asRecord(statusData.body) ?? asRecord(sessionStatus.body);
    const approvedAmount = pickNorthApprovedAmount(responseBody);
    const transactionId = pickNorthTransactionId(statusData, responseBody);
    if (!transactionId) {
      throw new ApiError(502, 'North approval response did not include a transaction identifier.');
    }
    if (approvedAmount == null || approvedAmount <= 0) {
      throw new ApiError(502, 'North approval response did not include a valid amount.');
    }
    const recorded = await paymentService.recordExternalInvoicePayment(
      body.invoiceId,
      approvedAmount,
      'north_embedded',
      transactionId,
      req.user!.id,
      req.user!.employeeId,
    );
    ok(res, {
      status: 'approved',
      transactionId,
      amount: approvedAmount,
      payment: recorded.payment,
      duplicate: recorded.duplicate,
    }, recorded.duplicate ? 'North payment already recorded' : 'North payment recorded', 201);
  }),
);

router.get(
  '/',
  authorize('payments:read', 'payments:collect', 'payments:collect_info'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'customers:read');
    const customerId = req.query.customerId as string | undefined;
    const invoiceId = req.query.invoiceId as string | undefined;
    if (scope && !customerId && !invoiceId) {
      throw ApiError.forbidden('Technician payment history requires a customer or invoice filter');
    }
    if (scope && customerId) {
      await assertCustomerAccess(scope, customerId);
    }
    if (scope && invoiceId) {
      const inv = await pool.query('SELECT id FROM invoices WHERE id = $1', [invoiceId]);
      if (!inv.rows[0]) throw ApiError.notFound('Invoice not found');
      await assertInvoiceAccess(scope, invoiceId);
    }
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const result = await paymentService.list(
      {
        customerId,
        invoiceId,
        status: req.query.status as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      },
      limit,
      offset,
    );
    ok(res, { ...result, page, pageSize });
  }),
);

router.post(
  '/charge',
  authorize('payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      invoiceId: z.string().uuid(),
      paymentMethodId: z.string().uuid().nullish(),
      amount: z.number().positive().nullish(),
    }).parse(req.body);
    const result = await paymentService.chargeInvoice(
      body.invoiceId,
      body.paymentMethodId ?? null,
      body.amount ?? null,
      req.user!.id,
      req.user!.employeeId,
    );
    ok(res, result, 'Payment collected', 201);
  }),
);

router.post(
  '/request-charge',
  authorize('invoices:read', 'invoices:read_assigned'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      invoiceId: z.string().uuid(),
      message: z.string().max(500).optional(),
    }).parse(req.body);
    const scope = technicianScope(req, 'invoices:read');
    await assertInvoiceAccess(scope, body.invoiceId);
    const invoice = await pool.query(
      `SELECT i.id, i.invoice_number, i.total, i.amount_paid, c.id AS customer_id,
              c.first_name AS customer_first_name, c.last_name AS customer_last_name, c.company AS customer_company
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1`,
      [body.invoiceId],
    );
    const row = invoice.rows[0];
    if (!row) throw ApiError.notFound('Invoice not found');
    const owner = await pool.query(
      `SELECT u.id
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'OWNER'
       LIMIT 1`,
    );
    const ownerId = owner.rows[0]?.id as string | undefined;
    if (!ownerId) throw new ApiError(424, 'Owner account not available');
    const balanceDue = Math.max(0, Number(row.total) - Number(row.amount_paid));
    await notifications.send({
      userId: ownerId,
      customerId: row.customer_id,
      channel: 'push',
      type: 'payment_request',
      title: 'Payment approval requested',
      body: `${row.customer_company ?? `${row.customer_first_name} ${row.customer_last_name}`} invoice ${row.invoice_number} needs approval for $${balanceDue.toFixed(2)}.`,
      data: {
        invoiceId: row.id,
        amount: balanceDue,
        requestedBy: req.user!.id,
        requestedByEmployeeId: req.user!.employeeId,
        message: body.message ?? null,
      },
    });
    ok(res, { requested: true }, 'Payment approval requested', 201);
  }),
);

router.post(
  '/jobs/autopay',
  authorize('payments:write'),
  asyncHandler(async (req, res) => {
    const sys = await pool.query(
      `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id WHERE r.code = 'OWNER' LIMIT 1`,
    );
    ok(res, await processAutopay(sys.rows[0]?.id ?? req.user!.id), 'AutoPay processing complete');
  }),
);

router.post(
  '/north/invoice-link',
  authorize('invoices:read', 'payments:collect'),
  asyncHandler(async (req, res) => {
    const body = z.object({ invoiceId: z.string().uuid() }).parse(req.body);
    const invoice = await pool.query(
      `SELECT i.id, i.invoice_number, i.due_date, i.total, i.amount_paid, i.tax_rate,
              c.first_name AS customer_first_name, c.last_name AS customer_last_name,
              c.email AS customer_email, c.phone AS customer_phone, c.company AS customer_company
       FROM invoices i
       JOIN customers c ON c.id = i.customer_id
       WHERE i.id = $1 AND i.deleted_at IS NULL`,
      [body.invoiceId],
    );
    if (!invoice.rows[0]) throw ApiError.notFound('Invoice not found');
    const row = invoice.rows[0] as {
      invoice_number: string;
      due_date: string | Date;
      total: string;
      amount_paid: string;
      tax_rate: string | number | null;
      customer_first_name: string;
      customer_last_name: string;
      customer_email: string | null;
      customer_phone: string | null;
      customer_company: string | null;
    };
    const balanceDue = Math.max(0, Number(row.total) - Number(row.amount_paid));
    const url = await northGatewayService.createInvoiceLink({
      customerFirstName: row.customer_first_name,
      customerLastName: row.customer_last_name,
      customerEmail: row.customer_email,
      customerPhone: row.customer_phone,
      invoiceNumber: row.invoice_number,
      dueDate: new Date(row.due_date).toISOString().slice(0, 10),
      amount: balanceDue || Number(row.total),
      taxRate: row.tax_rate == null ? null : Number(row.tax_rate),
      description: row.customer_company ? `${row.customer_company} invoice` : `Invoice ${row.invoice_number}`,
    });
    ok(res, { url }, 'North payment link created', 201);
  }),
);

router.get(
  '/:id/receipt',
  authorize('payments:read', 'payments:collect', 'payments:collect_info'),
  asyncHandler(async (req, res) => {
    ok(res, await paymentService.getReceipt(req.params.id));
  }),
);

router.post(
  '/:id/refund',
  authorize('payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ amount: z.number().positive().nullish() }).parse(req.body ?? {});
    ok(res, await paymentService.refundPayment(req.params.id, body.amount ?? null, req.user!.id, req.user!.employeeId), 'Payment refunded', 201);
  }),
);

router.get(
  '/autopay/:customerId',
  authorize('payments:read', 'payments:collect'),
  asyncHandler(async (req, res) => {
    ok(res, await paymentService.getAutopay(req.params.customerId));
  }),
);

router.post(
  '/autopay/:customerId',
  authorize('payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      enabled: z.boolean(),
      paymentMethodId: z.string().uuid().nullish(),
    }).parse(req.body);
    ok(res, await paymentService.setAutopay(req.params.customerId, body.enabled, body.paymentMethodId ?? null, req.user!.id), 'AutoPay updated');
  }),
);

export default router;
