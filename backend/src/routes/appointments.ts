import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope, assertAppointmentAccess } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { appointmentService } from '../services/appointmentService';

const router = Router();
router.use(authenticate);

const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  customerId: z.string().uuid(),
  serviceLocationId: z.string().uuid(),
  technicianId: z.string().uuid().nullish(),
  scheduledDate: z.string().regex(dateRe),
  windowStart: z.string().regex(timeRe),
  windowEnd: z.string().regex(timeRe),
  serviceIds: z.array(z.object({ serviceId: z.string().uuid(), quantity: z.number().int().positive().optional() })).min(1),
  notes: z.string().nullish(),
  subscriptionId: z.string().uuid().nullish(),
  allowConflict: z.boolean().optional(),
});

const rescheduleSchema = z.object({
  scheduledDate: z.string().regex(dateRe),
  windowStart: z.string().regex(timeRe),
  windowEnd: z.string().regex(timeRe),
  technicianId: z.string().uuid().nullable().optional(),
  allowConflict: z.boolean().optional(),
});

const statusSchema = z.object({
  status: z.enum(['scheduled', 'en_route', 'arrived', 'in_progress', 'no_access']),
});

const completeSchema = z.object({
  note: z.string().nullish(),
  generateInvoice: z.boolean().optional(),
  taxRate: z.number().min(0).max(0.3).optional(),
});

router.get(
  '/',
  authorize('appointments:read', 'appointments:read_assigned'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const scope = technicianScope(req, 'appointments:read');
    const result = await appointmentService.list(
      {
        date: req.query.date as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        technicianId: scope ?? (req.query.technicianId as string | undefined),
        customerId: req.query.customerId as string | undefined,
        status: req.query.status as string | undefined,
      },
      limit,
      offset,
    );
    ok(res, { ...result, page, pageSize });
  }),
);

router.get(
  '/conflicts',
  authorize('appointments:write', 'appointments:read'),
  asyncHandler(async (req, res) => {
    const q = z.object({
      technicianId: z.string().uuid(),
      date: z.string().regex(dateRe),
      windowStart: z.string().regex(timeRe),
      windowEnd: z.string().regex(timeRe),
      excludeAppointmentId: z.string().uuid().optional(),
    }).parse(req.query);
    const conflicts = await appointmentService.detectConflict(q.technicianId, q.date, q.windowStart, q.windowEnd, q.excludeAppointmentId);
    ok(res, { hasConflict: conflicts.length > 0, conflicts });
  }),
);

router.get(
  '/:id',
  authorize('appointments:read', 'appointments:read_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'appointments:read');
    await assertAppointmentAccess(scope, req.params.id);
    ok(res, await appointmentService.getById(req.params.id));
  }),
);

router.post(
  '/',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    ok(res, await appointmentService.create(body, req.user!.id), 'Appointment created', 201);
  }),
);

router.post(
  '/:id/reschedule',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = rescheduleSchema.parse(req.body);
    ok(res, await appointmentService.reschedule(req.params.id, body, req.user!.id), 'Appointment rescheduled');
  }),
);

router.post(
  '/:id/status',
  authorize('appointments:write', 'appointments:write_assigned'),
  asyncHandler(async (req, res) => {
    const body = statusSchema.parse(req.body);
    const scope = technicianScope(req, 'appointments:write');
    await assertAppointmentAccess(scope, req.params.id);
    ok(res, await appointmentService.updateStatus(req.params.id, body.status, req.user!.id, req.user!.employeeId));
  }),
);

router.post(
  '/:id/complete',
  authorize('appointments:write', 'appointments:write_assigned'),
  asyncHandler(async (req, res) => {
    const body = completeSchema.parse(req.body);
    const scope = technicianScope(req, 'appointments:write');
    await assertAppointmentAccess(scope, req.params.id);
    const result = await appointmentService.complete(req.params.id, body, req.user!.id, req.user!.employeeId);
    ok(res, result, 'Appointment completed');
  }),
);

router.post(
  '/:id/cancel',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ reason: z.string().nullish() }).parse(req.body);
    ok(res, await appointmentService.cancel(req.params.id, body.reason ?? null, req.user!.id), 'Appointment cancelled');
  }),
);

export default router;
