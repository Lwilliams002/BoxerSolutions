import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope, assertCustomerAccess } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { recurringChargeService } from '../services/recurringChargeService';
import { SERVICE_FREQUENCIES } from '../utils/serviceSchedule';

const router = Router();
router.use(authenticate);

const chargeSchema = z.object({
  paymentMethodId: z.string().uuid().nullish(),
});

const upsertSchema = z.object({
  customerId: z.string().uuid(),
  amount: z.number().positive(),
  sourceAgreementFileId: z.string().uuid().nullish(),
  frequency: z.enum(SERVICE_FREQUENCIES as [string, ...string[]]).nullish(),
  /** Initial service date (YYYY-MM-DD); defaults to today. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  isUpdate: z.boolean().optional(),
  /** Agreement term in months (12–72). */
  termMonths: z.number().int().min(1).max(120).nullish(),
  /** 30-day egg-cycle follow-up (default true). False: the cadence starts one interval after the initial. */
  eggCycle: z.boolean().nullish(),
});

router.post(
  '/',
  authorize('invoices:write', 'invoices:write_assigned'),
  asyncHandler(async (req, res) => {
    const body = upsertSchema.parse(req.body ?? {});
    const scope = technicianScope(req, 'invoices:write');
    if (scope) await assertCustomerAccess(scope, body.customerId);
    const row = await recurringChargeService.upsertFromAgreement(
      body.customerId,
      body.amount,
      body.sourceAgreementFileId ?? null,
      {
        frequency: (body.frequency ?? null) as import('../utils/serviceSchedule').ServiceFrequency | null,
        startDate: body.startDate ?? null,
        isUpdate: body.isUpdate ?? false,
        createdBy: req.user!.id,
        termMonths: body.termMonths ?? null,
        eggCycle: body.eggCycle ?? true,
      },
    );
    ok(res, row ? { id: row.id, amount: Number(row.amount), frequency: row.frequency, nextDueDate: row.next_due_date } : null, 'Recurring charge saved');
  }),
);

router.get(
  '/',
  authorize('invoices:read', 'invoices:read_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'invoices:read');
    if (scope && req.query.customerId) await assertCustomerAccess(scope, req.query.customerId as string);
    ok(res, await recurringChargeService.list({ customerId: req.query.customerId as string | undefined }));
  }),
);

router.post(
  '/:id/visit-schedule',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      windowStart: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
      technicianId: z.string().uuid().nullable().optional(),
      durationMinutes: z.number().int().min(15).max(480).optional(),
    }).parse(req.body ?? {});
    ok(res, await recurringChargeService.setVisitSchedule(req.params.id, body, req.user!.id), 'Visit schedule updated');
  }),
);

router.get(
  '/:id/visits',
  authorize('invoices:read', 'invoices:read_assigned', 'appointments:read', 'appointments:read_assigned'),
  asyncHandler(async (req, res) => {
    ok(res, await recurringChargeService.listVisits(req.params.id));
  }),
);

router.post(
  '/:id/rebuild-schedule',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const result = await recurringChargeService.rebuildSchedule(req.params.id, req.user!.id);
    ok(res, result, `${result.created} visit(s) scheduled`);
  }),
);

router.post(
  '/:id/charge',
  authorize('invoices:write', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = chargeSchema.parse(req.body ?? {});
    const result = await recurringChargeService.chargeNow(req.params.id, req.user!.id, body.paymentMethodId ?? null);
    ok(res, result, result.charged ? 'Recurring charge collected' : 'Recurring invoice created');
  }),
);

export default router;


