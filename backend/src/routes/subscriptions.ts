import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { subscriptionService } from '../services/subscriptionService';
import { generateAllRecurringAppointments, generateAppointmentsForSubscription } from '../jobs/recurring';
import { pool } from '../config/db';

const router = Router();
router.use(authenticate);

const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const serviceSchema = z.object({
  serviceId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  priceOverride: z.number().nonnegative().nullish(),
});
const createSchema = z.object({
  customerId: z.string().uuid(),
  serviceLocationId: z.string().uuid(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'custom']),
  intervalDays: z.number().int().positive().nullish(),
  preferredTechnicianId: z.string().uuid().nullish(),
  preferredTime: z.string().regex(timeRe).nullish(),
  startDate: z.string().regex(dateRe),
  endDate: z.string().regex(dateRe).nullish(),
  nextServiceDate: z.string().regex(dateRe).nullish(),
  generateAheadDays: z.number().int().positive().max(365).default(30),
  services: z.array(serviceSchema).min(1),
  generateImmediately: z.boolean().default(true),
});
const updateSchema = createSchema.omit({ customerId: true, generateImmediately: true }).partial().extend({
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
});

router.get(
  '/',
  authorize('appointments:read'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const result = await subscriptionService.list(
      { customerId: req.query.customerId as string | undefined, status: req.query.status as string | undefined },
      limit,
      offset,
    );
    ok(res, { ...result, page, pageSize });
  }),
);

router.post(
  '/jobs/generate',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const sys = await pool.query(
      `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id WHERE r.code = 'OWNER' LIMIT 1`,
    );
    const userId = sys.rows[0]?.id ?? req.user!.id;
    ok(res, await generateAllRecurringAppointments(userId), 'Recurring generation complete');
  }),
);

router.get(
  '/:id',
  authorize('appointments:read'),
  asyncHandler(async (req, res) => ok(res, await subscriptionService.getById(req.params.id))),
);

router.post(
  '/',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const subscription = await subscriptionService.create(body, req.user!.id);
    let generation = null;
    if (body.generateImmediately) generation = await generateAppointmentsForSubscription((subscription as any).id, req.user!.id, body.generateAheadDays);
    ok(res, generation ? await subscriptionService.getById((subscription as any).id) : subscription, 'Subscription created', 201);
  }),
);

router.patch(
  '/:id',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    ok(res, await subscriptionService.update(req.params.id, body, req.user!.id), 'Subscription updated');
  }),
);

router.post(
  '/:id/status',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ status: z.enum(['active', 'paused', 'cancelled']) }).parse(req.body);
    ok(res, await subscriptionService.setStatus(req.params.id, body.status, req.user!.id), 'Subscription updated');
  }),
);

router.post(
  '/:id/skip-next',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => ok(res, await subscriptionService.skipNext(req.params.id, req.user!.id), 'Next visit skipped')),
);

router.post(
  '/:id/generate',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ horizonDays: z.number().int().positive().max(365).optional() }).parse(req.body ?? {});
    const generation = await generateAppointmentsForSubscription(req.params.id, req.user!.id, body.horizonDays);
    ok(res, { ...generation, subscription: await subscriptionService.getById(req.params.id) }, 'Subscription generation complete');
  }),
);

router.delete(
  '/:id',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    await subscriptionService.softDelete(req.params.id, req.user!.id);
    ok(res, null, 'Subscription deleted');
  }),
);

export default router;
