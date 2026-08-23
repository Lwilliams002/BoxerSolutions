import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope, assertCustomerAccess, assertInvoiceAccess } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { invoiceService } from '../services/invoiceService';
import { fileService } from '../services/fileService';
import { ApiError } from '../utils/errors';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  customerId: z.string().uuid(),
  serviceLocationId: z.string().uuid().nullish(),
  appointmentId: z.string().uuid().nullish(),
  technicianId: z.string().uuid().nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  taxRate: z.number().min(0).max(0.3).optional(),
  notes: z.string().nullish(),
  items: z.array(z.object({
    serviceId: z.string().uuid().nullish(),
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    discount: z.number().nonnegative().optional(),
    taxable: z.boolean().optional(),
  })).min(1),
});

router.get(
  '/',
  authorize('invoices:read', 'invoices:read_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'invoices:read');
    if (scope && req.query.customerId) await assertCustomerAccess(scope, req.query.customerId as string);
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const result = await invoiceService.list(
      {
        customerId: req.query.customerId as string | undefined,
        status: req.query.status as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        pastDue: req.query.pastDue === 'true',
        technicianId: scope,
      },
      limit,
      offset,
    );
    ok(res, { ...result, page, pageSize });
  }),
);

router.get(
  '/:id',
  authorize('invoices:read', 'invoices:read_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'invoices:read');
    await assertInvoiceAccess(scope, req.params.id);
    ok(res, await invoiceService.getById(req.params.id, scope));
  }),
);

router.get(
  '/:id/pdf',
  authorize('invoices:read', 'invoices:read_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'invoices:read');
    await assertInvoiceAccess(scope, req.params.id);
    const invoice = (await invoiceService.getById(req.params.id, scope)) as any;
    if (!invoice.pdfFileId) throw ApiError.notFound('PDF not generated yet');
    ok(res, await fileService.getDownloadUrl(invoice.pdfFileId));
  }),
);

router.post(
  '/',
  authorize('invoices:write', 'invoices:write_assigned'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    ok(res, await invoiceService.create(body, req.user!.id), 'Invoice created', 201);
  }),
);

router.post(
  '/:id/generate-pdf',
  authorize('invoices:write', 'invoices:write_assigned'),
  asyncHandler(async (req, res) => {
    ok(res, await invoiceService.generatePdf(req.params.id, req.user!.id), 'PDF generated');
  }),
);

router.post(
  '/:id/send',
  authorize('invoices:write'),
  asyncHandler(async (req, res) => {
    ok(res, await invoiceService.send(req.params.id, req.user!.id), 'Invoice sent');
  }),
);

router.post(
  '/:id/void',
  authorize('invoices:write'),
  asyncHandler(async (req, res) => {
    ok(res, await invoiceService.voidInvoice(req.params.id, req.user!.id), 'Invoice voided');
  }),
);

export default router;
