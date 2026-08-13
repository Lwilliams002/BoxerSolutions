import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { pool, withTransaction } from '../config/db';
import { toCamel, rowsToCamel } from '../services/customerService';
import { ApiError } from '../utils/errors';
import { recordAudit } from '../services/auditService';
import { generateAppointmentsForSubscription } from '../jobs/recurring';

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  customerId: z.string().uuid(),
  serviceLocationId: z.string().uuid(),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'custom']),
  intervalDays: z.number().int().positive().nullish(),
  preferredTechnicianId: z.string().uuid().nullish(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  services: z.array(z.object({
    serviceId: z.string().uuid(),
    quantity: z.number().int().positive().default(1),
    priceOverride: z.number().nonnegative().nullish(),
  })).min(1),
  generateImmediately: z.boolean().default(true),
});

router.get(
  '/',
  authorize('appointments:read'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const where: string[] = ['sub.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (req.query.customerId) { params.push(req.query.customerId); where.push(`sub.customer_id = $${params.length}`); }
    if (req.query.status) { params.push(req.query.status); where.push(`sub.status = $${params.length}`); }
    const whereSql = where.join(' AND ');
    const count = await pool.query(`SELECT count(*)::int AS total FROM subscriptions sub WHERE ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT sub.*, c.first_name || ' ' || c.last_name AS customer_name,
              (SELECT json_agg(json_build_object('serviceId', ss.service_id, 'name', s.name, 'quantity', ss.quantity, 'priceOverride', ss.price_override))
               FROM subscription_services ss JOIN services s ON s.id = ss.service_id WHERE ss.subscription_id = sub.id) AS services
       FROM subscriptions sub JOIN customers c ON c.id = sub.customer_id
       WHERE ${whereSql} ORDER BY sub.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    ok(res, { items: rowsToCamel(rows), total: count.rows[0].total, page, pageSize });
  }),
);

router.post(
  '/',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    if (body.frequency === 'custom' && !body.intervalDays) {
      throw ApiError.badRequest('intervalDays is required for custom frequency');
    }
    const sub = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO subscriptions (customer_id, service_location_id, frequency, interval_days,
           preferred_technician_id, start_date, end_date, next_generation_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$6) RETURNING *`,
        [body.customerId, body.serviceLocationId, body.frequency, body.intervalDays ?? null,
         body.preferredTechnicianId ?? null, body.startDate, body.endDate ?? null],
      );
      for (const s of body.services) {
        await tx.query(
          `INSERT INTO subscription_services (subscription_id, service_id, quantity, price_override) VALUES ($1,$2,$3,$4)`,
          [rows[0].id, s.serviceId, s.quantity, s.priceOverride ?? null],
        );
      }
      await recordAudit({ userId: req.user!.id, action: 'subscription.created', entityType: 'subscription', entityId: rows[0].id, newValue: body }, tx);
      return rows[0];
    });

    let generated = 0;
    if (body.generateImmediately) {
      generated = await generateAppointmentsForSubscription(sub.id, req.user!.id, 90);
    }
    ok(res, { ...toCamel(sub) as object, generatedAppointments: generated }, 'Subscription created', 201);
  }),
);

router.post(
  '/:id/status',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ status: z.enum(['active', 'paused', 'cancelled']) }).parse(req.body);
    const { rows } = await pool.query(
      `UPDATE subscriptions SET status = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
      [body.status, req.params.id],
    );
    if (!rows[0]) throw ApiError.notFound('Subscription not found');
    ok(res, toCamel(rows[0]), 'Subscription updated');
  }),
);

router.post(
  '/:id/generate',
  authorize('appointments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ horizonDays: z.number().int().positive().max(365).default(90) }).parse(req.body ?? {});
    const generated = await generateAppointmentsForSubscription(req.params.id, req.user!.id, body.horizonDays);
    ok(res, { generatedAppointments: generated }, `${generated} appointment(s) generated`);
  }),
);

export default router;
