import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { rowsToCamel, toCamel } from '../services/customerService';

/** Product / chemical catalog used on the stop screen and printed on service notifications. */
const router = Router();
router.use(authenticate);

export const APPLICATION_METHODS = ['Crack & Crevice', 'Perimeter', 'Bait Stations', 'Broadcast', 'Spot Treatment', 'Fogging', 'Dusting', 'Granular'] as const;

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(20).default('oz'),
  epaRegistrationNo: z.string().trim().max(40).nullish(),
  defaultQuantity: z.number().min(0).max(10000).default(1),
  active: z.boolean().optional(),
});

router.get('/', asyncHandler(async (req, res) => {
  const all = req.query.all === '1' || req.query.all === 'true';
  const { rows } = await pool.query(`SELECT * FROM products ${all ? '' : 'WHERE active = true'} ORDER BY active DESC, name`);
  ok(res, { items: rowsToCamel(rows), applicationMethods: APPLICATION_METHODS });
}));

router.post('/', authorize('settings:write', 'services:write'), asyncHandler(async (req, res) => {
  const body = productSchema.parse(req.body ?? {});
  const { rows } = await pool.query(
    `INSERT INTO products (name, unit, epa_registration_no, default_quantity, active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [body.name, body.unit, body.epaRegistrationNo ?? null, body.defaultQuantity, body.active ?? true],
  ).catch((err) => { if (String(err?.code) === '23505') throw ApiError.badRequest('A product with that name already exists.'); throw err; });
  ok(res, toCamel(rows[0]), 'Product added', 201);
}));

router.patch('/:id', authorize('settings:write', 'services:write'), asyncHandler(async (req, res) => {
  const body = productSchema.partial().parse(req.body ?? {});
  const map: Record<string, string> = { name: 'name', unit: 'unit', epaRegistrationNo: 'epa_registration_no', defaultQuantity: 'default_quantity', active: 'active' };
  const sets: string[] = []; const params: unknown[] = [];
  for (const [k, col] of Object.entries(map)) if (k in body) { params.push((body as Record<string, unknown>)[k]); sets.push(`${col} = $${params.length}`); }
  if (!sets.length) throw ApiError.badRequest('No fields to update');
  params.push(req.params.id);
  const { rows } = await pool.query(`UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`, params);
  if (!rows[0]) throw ApiError.notFound('Product not found');
  ok(res, toCamel(rows[0]), 'Product updated');
}));

export default router;
