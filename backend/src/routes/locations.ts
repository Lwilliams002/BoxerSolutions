import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { rowsToCamel, toCamel } from '../services/customerService';
import { createLocationSchema, updateLocationSchema } from '../validators/customers';
import { deriveStage } from '../utils/customerStage';
import { queueGeocode } from '../services/geocodingService';
import { technicianScope } from '../middleware/scope';

const router = Router();
router.use(authenticate);

router.get(
  '/map',
  authorize('customers:read', 'customers:read_assigned'),
  asyncHandler(async (req, res) => {
    // Every staff member sees every pin. Technicians may only open the
    // customers they are assigned to (or have appointments with).
    const scope = technicianScope(req, 'customers:read');
    const params: unknown[] = [];
    let canOpenSql = 'true';
    if (scope) {
      params.push(scope);
      canOpenSql = `(c.assigned_technician_id = $${params.length}
        OR EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.id AND a.technician_id = $${params.length} AND a.deleted_at IS NULL))`;
    }
    const { rows } = await pool.query(
      `SELECT sl.id, sl.customer_id, sl.label, sl.address_line1, sl.city, sl.state, sl.postal_code,
              sl.latitude, sl.longitude,
              c.first_name, c.last_name, c.company, c.status, c.assigned_technician_id, c.created_at,
              (cu.first_name || ' ' || cu.last_name) AS deal_owner_name,
              (tu.first_name || ' ' || tu.last_name) AS technician_name,
              EXISTS (
                SELECT 1 FROM notes n WHERE n.customer_id = c.id AND n.deleted_at IS NULL
                  AND n.body LIKE 'SERVICE AGREEMENT%' AND n.body LIKE '%Status: SIGNED%'
              ) OR EXISTS (
                SELECT 1 FROM files f WHERE f.customer_id = c.id AND f.deleted_at IS NULL AND f.file_name LIKE 'service-agreement-signed-%'
              ) OR EXISTS (
                SELECT 1 FROM recurring_charges rc WHERE rc.customer_id = c.id AND rc.active
              ) AS has_signed_agreement,
              EXISTS (
                SELECT 1 FROM appointments a WHERE a.customer_id = c.id AND a.status = 'completed' AND a.deleted_at IS NULL
              ) AS has_completed_service,
              ${canOpenSql} AS can_open
       FROM service_locations sl
       JOIN customers c ON c.id = sl.customer_id
       LEFT JOIN users cu ON cu.id = c.created_by
       LEFT JOIN employees te ON te.id = c.assigned_technician_id
       LEFT JOIN users tu ON tu.id = te.user_id
       WHERE sl.deleted_at IS NULL AND c.deleted_at IS NULL AND sl.latitude IS NOT NULL AND sl.longitude IS NOT NULL
       ORDER BY c.last_name, c.first_name`,
      params,
    );
    ok(res, rows.map((r) => ({
      ...toCamel(r),
      stage: deriveStage({ hasSignedAgreement: !!r.has_signed_agreement, hasCompletedService: !!r.has_completed_service }),
      inactive: r.status === 'inactive',
    })));
  }),
);

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
    if (body.latitude == null || body.longitude == null) queueGeocode(rows[0].id);
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
    const addressChanged = ['addressLine1', 'city', 'state', 'postalCode'].some((k) => k in body);
    if (addressChanged && !('latitude' in body)) {
      // Address edited without coordinates: re-geocode so the pin moves with it.
      await pool.query('UPDATE service_locations SET latitude = NULL, longitude = NULL WHERE id = $1', [req.params.id]);
      queueGeocode(req.params.id);
    }
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
