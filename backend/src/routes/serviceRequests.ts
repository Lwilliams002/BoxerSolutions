import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { recordAudit } from '../services/auditService';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize('users:write', 'appointments:write'),
  asyncHandler(async (req, res) => {
    const { limit, offset, page, pageSize } = parsePagination(req.query as Record<string, unknown>, 25);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const params: unknown[] = [];
    const where = ['1=1'];
    if (status) {
      params.push(status);
      where.push(`sr.status = $${params.length}`);
    }

    const count = await pool.query(
      `SELECT count(*)::int AS total
       FROM service_requests sr
       WHERE ${where.join(' AND ')}`,
      params,
    );

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT sr.id, sr.customer_id, sr.description, sr.status, sr.assigned_technician_id, sr.quoted_price, sr.owner_notes,
              sr.requested_at, sr.reviewed_at, sr.created_at, sr.updated_at,
              c.first_name || ' ' || c.last_name AS customer_name,
              c.email AS customer_email, c.phone AS customer_phone,
              e.id AS technician_id, u.first_name AS technician_first_name, u.last_name AS technician_last_name,
              COALESCE(
                json_agg(
                  DISTINCT jsonb_build_object(
                    'fileId', f.id,
                    'fileName', f.file_name,
                    'mimeType', f.mime_type,
                    'fileType', f.file_type
                  )
                ) FILTER (WHERE f.id IS NOT NULL),
                '[]'::json
              ) AS files
       FROM service_requests sr
       JOIN customers c ON c.id = sr.customer_id
       LEFT JOIN employees e ON e.id = sr.assigned_technician_id
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN service_request_files srf ON srf.service_request_id = sr.id
       LEFT JOIN files f ON f.id = srf.file_id AND f.deleted_at IS NULL
       WHERE ${where.join(' AND ')}
       GROUP BY sr.id, c.first_name, c.last_name, c.email, c.phone, e.id, u.first_name, u.last_name
       ORDER BY sr.requested_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    ok(res, { items: rows, page, pageSize, total: count.rows[0].total });
  }),
);

const updateSchema = z.object({
  status: z.enum(['submitted', 'reviewed', 'scheduled', 'declined']).optional(),
  assignedTechnicianId: z.string().uuid().nullable().optional(),
  quotedPrice: z.number().min(0).nullable().optional(),
  ownerNotes: z.string().max(2000).nullable().optional(),
});

router.patch(
  '/:id',
  authorize('users:write', 'appointments:write'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    if (!Object.keys(body).length) throw ApiError.badRequest('No fields to update');

    const existing = await pool.query('SELECT * FROM service_requests WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) throw ApiError.notFound('Service request not found');

    const sets: string[] = [];
    const params: unknown[] = [];
    if ('status' in body) {
      params.push(body.status);
      sets.push(`status = $${params.length}`);
    }
    if ('assignedTechnicianId' in body) {
      params.push(body.assignedTechnicianId ?? null);
      sets.push(`assigned_technician_id = $${params.length}`);
    }
    if ('quotedPrice' in body) {
      params.push(body.quotedPrice ?? null);
      sets.push(`quoted_price = $${params.length}`);
    }
    if ('ownerNotes' in body) {
      params.push(body.ownerNotes ?? null);
      sets.push(`owner_notes = $${params.length}`);
    }
    if ('status' in body || 'assignedTechnicianId' in body || 'quotedPrice' in body) {
      sets.push('reviewed_at = now()');
    }
    sets.push('updated_at = now()');
    params.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE service_requests
       SET ${sets.join(', ')}
       WHERE id = $${params.length}
       RETURNING *`,
      params,
    );

    await recordAudit({
      userId: req.user!.id,
      action: 'service_request.updated',
      entityType: 'service_request',
      entityId: req.params.id,
      previousValue: existing.rows[0],
      newValue: body,
    });

    ok(res, rows[0], 'Service request updated');
  }),
);

export default router;
