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
import { northFieldsPaymentService } from '../services/northFieldsPaymentService';

const router = Router();

const payModeSchema = z.enum(['card', 'bank']);

function timingSafeEqualText(a: string, b: string) {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyNorthWebhookSignature(rawBody: string, headerValue: string | undefined): boolean {
  const secrets = [config.north.webhookSecret, config.north.legacyWebhookSecret].filter(Boolean);
  if (!secrets.length || !headerValue) return false;
  return secrets.some((secret) => verifyWithSecret(secret, rawBody, headerValue));
}

function verifyWithSecret(secret: string, rawBody: string, headerValue: string): boolean {
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

// Compatibility shims for app builds that still call the pre-Fields Embedded
// Checkout endpoints. Those flows no longer exist server-side; answering 410
// (rather than 404, or worse a 401 from the auth middleware below) tells the
// old client exactly what is wrong.
const REMOVED_EMBEDDED_ROUTES = [
  '/north/embedded/session',
  '/north/embedded/confirm',
  '/north/embedded/storage-session',
  '/north/embedded/storage-confirm',
];
for (const removed of REMOVED_EMBEDDED_ROUTES) {
  router.all(removed, () => {
    throw new ApiError(410, 'This app version is out of date. Please update the app to continue taking payments.');
  });
}

router.use(authenticate);

router.post(
  '/north/fields/session',
  authorize('invoices:read', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ invoiceId: z.string().uuid(), mode: payModeSchema }).parse(req.body);
    const scope = technicianScope(req, 'invoices:read');
    await assertInvoiceAccess(scope, body.invoiceId);
    ok(res, await northFieldsPaymentService.createPaySession(body), 'North checkout session created', 201);
  }),
);

router.post(
  '/north/fields/confirm',
  authorize('invoices:read', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      invoiceId: z.string().uuid(),
      mode: payModeSchema,
      sessionToken: z.string().min(10),
      achConsent: z.boolean().optional(),
    }).parse(req.body);
    const scope = technicianScope(req, 'invoices:read');
    await assertInvoiceAccess(scope, body.invoiceId);
    const result = await northFieldsPaymentService.confirmPay({
      ...body,
      actorUserId: req.user!.id,
      employeeId: req.user!.employeeId,
      consentMeta: { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null },
    });
    ok(res, result, result.duplicate ? 'Payment already recorded' : 'Payment recorded', 201);
  }),
);

router.post(
  '/north/fields/storage-session',
  authorize('payments:collect_info', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ customerId: z.string().uuid() }).parse(req.body);
    const scope = technicianScope(req, 'payments:collect');
    if (scope) await assertCustomerAccess(scope, body.customerId);
    ok(res, await northFieldsPaymentService.createStorageSession(body), 'North storage session created', 201);
  }),
);

router.post(
  '/north/fields/storage-confirm',
  authorize('payments:collect_info', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      customerId: z.string().uuid(),
      sessionToken: z.string().min(10),
      setDefault: z.boolean().optional(),
    }).parse(req.body);
    const scope = technicianScope(req, 'payments:collect');
    if (scope) await assertCustomerAccess(scope, body.customerId);
    const method = await northFieldsPaymentService.confirmStorage({ ...body, setDefault: body.setDefault ?? true, actorUserId: req.user!.id });
    ok(res, method, method.duplicate ? 'Payment method already on file' : 'Payment method stored on file', 201);
  }),
);

router.get(
  '/',
  authorize('payments:read', 'payments:collect', 'payments:collect_info'),  asyncHandler(async (req, res) => {
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
