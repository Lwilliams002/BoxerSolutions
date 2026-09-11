import { Router } from 'express';
import { dispatchService } from '../services/dispatchService';
import { ApiError } from '../utils/errors';
import { rowsToCamel } from '../services/customerService';
import { pool } from '../config/db';
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

/**
 * What the office still has to place on the calendar: upcoming appointments
 * without a technician, and recurring plans due soon with no visit created
 * (usually because the customer has no service address yet).
 */
router.get(
  '/needs-scheduling',
  authorize('appointments:read', 'appointments:write'),
  asyncHandler(async (_req, res) => {
    const unassigned = await pool.query(
      `${'SELECT a.id, a.customer_id, a.scheduled_date, a.window_start, a.window_end, a.recurring_charge_id, c.first_name, c.last_name, c.company, sl.address_line1, sl.city'}
       FROM appointments a JOIN customers c ON c.id = a.customer_id JOIN service_locations sl ON sl.id = a.service_location_id
       WHERE a.deleted_at IS NULL AND a.status = 'scheduled' AND a.technician_id IS NULL
         AND a.scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14
       ORDER BY a.scheduled_date, a.window_start`,
    );
    const plans = await pool.query(
      `SELECT rc.id AS recurring_charge_id, rc.customer_id, rc.next_due_date, rc.frequency, rc.amount, c.first_name, c.last_name, c.company,
              (SELECT count(*)::int FROM service_locations sl WHERE sl.customer_id = c.id AND sl.deleted_at IS NULL) AS location_count
       FROM recurring_charges rc JOIN customers c ON c.id = rc.customer_id AND c.deleted_at IS NULL AND c.status <> 'inactive'
       WHERE rc.active = true AND rc.next_due_date IS NOT NULL AND rc.next_due_date <= CURRENT_DATE + 14
         AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.recurring_charge_id = rc.id AND a.deleted_at IS NULL AND a.status <> 'cancelled' AND a.scheduled_date >= CURRENT_DATE)
       ORDER BY rc.next_due_date`,
    );
    ok(res, {
      unassigned: rowsToCamel(unassigned.rows).map((r: any) => ({ ...r, kind: 'unassigned' })),
      duePlans: rowsToCamel(plans.rows).map((r: any) => ({ ...r, kind: 'due_plan', reason: r.locationCount ? 'No visit on the calendar yet' : 'Customer has no service address' })),
    });
  }),
);

/** Scheduled appointments with a technician that are not on any route yet, plus per-day counts. */
router.get(
  '/unrouted',
  authorize('appointments:read', 'routes:write'),
  asyncHandler(async (req, res) => {
    const from = String(req.query.from ?? '').slice(0, 10);
    const to = String(req.query.to ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw ApiError.badRequest('from and to (YYYY-MM-DD) are required');
    const { rows } = await pool.query(
      `SELECT a.id, a.customer_id, a.scheduled_date, a.window_start, a.technician_id,
              c.first_name, c.last_name, c.company, tu.first_name || ' ' || tu.last_name AS technician_name
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       LEFT JOIN employees te ON te.id = a.technician_id LEFT JOIN users tu ON tu.id = te.user_id
       WHERE a.deleted_at IS NULL AND a.status = 'scheduled' AND a.technician_id IS NOT NULL
         AND a.scheduled_date BETWEEN $1 AND $2
         AND NOT EXISTS (SELECT 1 FROM route_stops rs WHERE rs.appointment_id = a.id)
       ORDER BY a.scheduled_date, a.window_start`,
      [from, to],
    );
    const items = rowsToCamel(rows);
    const byDate: Record<string, number> = {};
    for (const r of items as Array<{ scheduledDate: string }>) byDate[String(r.scheduledDate).slice(0, 10)] = (byDate[String(r.scheduledDate).slice(0, 10)] ?? 0) + 1;
    ok(res, { items, byDate, total: items.length });
  }),
);

/** Give every unassigned visit in a date range to the best available technician. */
router.post(
  '/auto-assign',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body ?? {});
    const result = await dispatchService.autoAssign(body.from, body.to, req.user!.id);
    ok(res, result, result.assigned.length ? `${result.assigned.length} visit(s) assigned` : 'Nothing to assign');
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
  '/:id/notify-on-my-way',
  authorize('appointments:write', 'appointments:write_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'appointments:write');
    await assertAppointmentAccess(scope, req.params.id);
    ok(res, await appointmentService.notifyOnMyWay(req.params.id, req.user!.id), 'On my way notification sent');
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

const productsSchema = z.object({
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().min(0).max(10000),
    unit: z.string().trim().max(20).nullish(),
    applicationMethod: z.string().trim().max(60).nullish(),
    targetPests: z.string().trim().max(200).nullish(),
  })).max(50),
});

/** Record the products applied on a visit (replaces the previous list). */
router.post(
  '/:id/products',
  authorize('appointments:write', 'appointments:write_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'appointments:write');
    await assertAppointmentAccess(scope, req.params.id);
    const body = productsSchema.parse(req.body ?? {});
    ok(res, await appointmentService.setProducts(req.params.id, body.items, req.user!.id), 'Products saved');
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
