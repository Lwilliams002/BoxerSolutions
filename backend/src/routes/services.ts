import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { rowsToCamel, toCamel } from '../services/customerService';

const router = Router();
router.use(authenticate);

const serviceSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().nullish(),
  categoryId: z.string().uuid().nullish(),
  serviceType: z.enum(['labor', 'product', 'material', 'fee']).default('labor'),
  price: z.number().nonnegative(),
  cost: z.number().nonnegative().default(0),
  durationMinutes: z.number().int().positive().default(30),
  taxable: z.boolean().default(true),
  isRecurring: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

router.get(
  '/categories',
  authorize('services:read', 'appointments:read_assigned'),
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM service_categories ORDER BY name');
    ok(res, rowsToCamel(rows));
  }),
);

router.post(
  '/categories',
  authorize('services:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ name: z.string().min(1) }).parse(req.body);
    const { rows } = await pool.query(
      'INSERT INTO service_categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET updated_at = now() RETURNING *',
      [body.name],
    );
    ok(res, toCamel(rows[0]), 'Category created', 201);
  }),
);

router.get(
  '/',
  authorize('services:read', 'appointments:read_assigned'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset, limit } = parsePagination(req.query, 100);
    const params: unknown[] = [];
    const where: string[] = ['s.deleted_at IS NULL'];
    if (req.query.active === 'true') where.push('s.is_active = true');
    if (req.query.search) {
      params.push(`%${String(req.query.search).toLowerCase()}%`);
      where.push(`lower(s.name) LIKE $${params.length}`);
    }
    const whereSql = where.join(' AND ');
    const count = await pool.query(`SELECT count(*)::int AS total FROM services s WHERE ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT s.*, sc.name AS category_name FROM services s
       LEFT JOIN service_categories sc ON sc.id = s.category_id
       WHERE ${whereSql} ORDER BY s.name LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    ok(res, { items: rowsToCamel(rows), page, pageSize, total: count.rows[0].total });
  }),
);

router.post(
  '/',
  authorize('services:write'),
  asyncHandler(async (req, res) => {
    const b = serviceSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO services (name, description, category_id, service_type, price, cost, duration_minutes, taxable, is_recurring, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [b.name, b.description ?? null, b.categoryId ?? null, b.serviceType, b.price, b.cost, b.durationMinutes, b.taxable, b.isRecurring, b.isActive],
    );
    ok(res, toCamel(rows[0]), 'Service created', 201);
  }),
);

router.patch(
  '/:id',
  authorize('services:write'),
  asyncHandler(async (req, res) => {
    const b = serviceSchema.partial().parse(req.body);
    const map: Record<string, string> = {
      name: 'name', description: 'description', categoryId: 'category_id', serviceType: 'service_type',
      price: 'price', cost: 'cost', durationMinutes: 'duration_minutes', taxable: 'taxable',
      isRecurring: 'is_recurring', isActive: 'is_active',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in b) {
        params.push((b as Record<string, unknown>)[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) throw ApiError.badRequest('No fields to update');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE services SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
      params,
    );
    if (!rows[0]) throw ApiError.notFound('Service not found');
    ok(res, toCamel(rows[0]), 'Service updated');
  }),
);

export default router;
