import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { rowsToCamel, toCamel } from '../services/customerService';
import { createLocationSchema, updateLocationSchema } from '../validators/customers';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize('customers:read', 'customers:read_assigned'),
  asyncHandler(async (req, res) => {
    const customerId = req.query.customerId as string | undefined;
    if (!customerId) throw ApiError.badRequest('customerId query parameter is required');
    const { rows } = await pool.query(
      'SELECT * FROM service_locations WHERE customer_id = $1 AND deleted_at IS NULL ORDER BY is_primary DESC, created_at',
      [customerId],
    );
    ok(res, rowsToCamel(rows));
  }),
);

router.post(
  '/',
  authorize('customers:write'),
  asyncHandler(async (req, res) => {
    const body = createLocationSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO service_locations (customer_id, label, address_line1, address_line2, city, state, postal_code, latitude, longitude, access_notes, is_primary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [body.customerId, body.label, body.addressLine1, body.addressLine2 ?? null, body.city, body.state,
       body.postalCode, body.latitude ?? null, body.longitude ?? null, body.accessNotes ?? null, body.isPrimary],
    );
    ok(res, toCamel(rows[0]), 'Location created', 201);
  }),
);

router.patch(
  '/:id',
  authorize('customers:write'),
  asyncHandler(async (req, res) => {
    const body = updateLocationSchema.parse(req.body);
    const map: Record<string, string> = {
      label: 'label', addressLine1: 'address_line1', addressLine2: 'address_line2', city: 'city',
      state: 'state', postalCode: 'postal_code', latitude: 'latitude', longitude: 'longitude',
      accessNotes: 'access_notes', isPrimary: 'is_primary',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in body) {
        params.push((body as Record<string, unknown>)[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (!sets.length) throw ApiError.badRequest('No fields to update');
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE service_locations SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
      params,
    );
    if (!rows[0]) throw ApiError.notFound('Location not found');
    ok(res, toCamel(rows[0]), 'Location updated');
  }),
);

router.delete(
  '/:id',
  authorize('customers:write'),
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      'UPDATE service_locations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!rowCount) throw ApiError.notFound('Location not found');
    ok(res, null, 'Location deleted');
  }),
);

const geocodeSchema = z.object({ latitude: z.number(), longitude: z.number() });
router.post(
  '/:id/coordinates',
  authorize('customers:write', 'appointments:write_assigned'),
  asyncHandler(async (req, res) => {
    const body = geocodeSchema.parse(req.body);
    const { rows } = await pool.query(
      'UPDATE service_locations SET latitude = $1, longitude = $2, updated_at = now() WHERE id = $3 RETURNING *',
      [body.latitude, body.longitude, req.params.id],
    );
    if (!rows[0]) throw ApiError.notFound('Location not found');
    ok(res, toCamel(rows[0]));
  }),
);

export default router;
