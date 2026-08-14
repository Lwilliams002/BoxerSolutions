import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { pool } from '../config/db';
import { rowsToCamel, toCamel } from '../services/customerService';
import { ApiError } from '../utils/errors';
import { recordAudit } from '../services/auditService';

const pointSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const upsertTerritorySchema = z.object({
  name: z.string().min(1).max(120),
  technicianId: z.string().uuid(),
  points: z.array(pointSchema).min(3).max(200),
});

const router = Router();
router.use(authenticate);

router.get(
  '/mine',
  authorize('customers:read', 'customers:read_assigned', 'appointments:read_assigned', 'routes:read_assigned'),
  asyncHandler(async (req, res) => {
    const employeeId = req.user?.employeeId ?? null;
    const isAdmin = req.user?.permissions.includes('*') || req.user?.permissions.includes('users:read') || req.user?.permissions.includes('users:write');
    const params: unknown[] = [];
    const where = ['t.deleted_at IS NULL'];
    if (!isAdmin) {
      if (!employeeId) throw ApiError.forbidden('No employee profile linked to this account');
      params.push(employeeId);
      where.push(`t.technician_id = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.technician_id, t.polygon, t.created_at, e.color AS technician_color,
              u.first_name AS technician_first_name, u.last_name AS technician_last_name
       FROM technician_territories t
       JOIN employees e ON e.id = t.technician_id
       JOIN users u ON u.id = e.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.last_name, u.first_name, t.name`,
      params,
    );
    ok(res, rowsToCamel(rows));
  }),
);

router.post(
  '/',
  authorize('users:write'),
  asyncHandler(async (req, res) => {
    const body = upsertTerritorySchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO technician_territories (name, technician_id, polygon, created_by)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [body.name, body.technicianId, JSON.stringify(body.points), req.user!.id],
    );
    await recordAudit({
      userId: req.user!.id,
      action: 'territory.created',
      entityType: 'territory',
      entityId: rows[0].id,
      newValue: { name: body.name, technicianId: body.technicianId, points: body.points.length },
    });
    ok(res, toCamel(rows[0]), 'Territory created', 201);
  }),
);

router.patch(
  '/:id',
  authorize('users:write'),
  asyncHandler(async (req, res) => {
    const body = upsertTerritorySchema.parse(req.body);
    const { rows } = await pool.query(
      `UPDATE technician_territories
       SET name = $1, technician_id = $2, polygon = $3, updated_at = now()
       WHERE id = $4 AND deleted_at IS NULL
       RETURNING *`,
      [body.name, body.technicianId, JSON.stringify(body.points), req.params.id],
    );
    if (!rows[0]) throw ApiError.notFound('Territory not found');
    await recordAudit({
      userId: req.user!.id,
      action: 'territory.updated',
      entityType: 'territory',
      entityId: req.params.id,
      newValue: { name: body.name, technicianId: body.technicianId, points: body.points.length },
    });
    ok(res, toCamel(rows[0]), 'Territory updated');
  }),
);

router.delete(
  '/:id',
  authorize('users:write'),
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      'UPDATE technician_territories SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!rowCount) throw ApiError.notFound('Territory not found');
    await recordAudit({
      userId: req.user!.id,
      action: 'territory.deleted',
      entityType: 'territory',
      entityId: req.params.id,
    });
    ok(res, null, 'Territory deleted');
  }),
);

export default router;
