import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope, assertCustomerAccess, assertAppointmentAccess } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { pool } from '../config/db';
import { toCamel, rowsToCamel } from '../services/customerService';
import { ApiError } from '../utils/errors';

const router = Router();
router.use(authenticate);

const createNoteSchema = z.object({
  customerId: z.string().uuid().nullish(),
  appointmentId: z.string().uuid().nullish(),
  body: z.string().min(1),
  isInternal: z.boolean().default(false),
}).refine((d) => d.customerId || d.appointmentId, { message: 'customerId or appointmentId is required' });

router.get(
  '/',
  authorize('notes:read', 'appointments:read_assigned'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const where: string[] = ['n.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (req.query.customerId) { params.push(req.query.customerId); where.push(`n.customer_id = $${params.length}`); }
    if (req.query.appointmentId) { params.push(req.query.appointmentId); where.push(`n.appointment_id = $${params.length}`); }
    const whereSql = where.join(' AND ');
    const count = await pool.query(`SELECT count(*)::int AS total FROM notes n WHERE ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT n.*, u.first_name || ' ' || u.last_name AS author_name FROM notes n
       JOIN users u ON u.id = n.author_id
       WHERE ${whereSql} ORDER BY n.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    ok(res, { items: rowsToCamel(rows), total: count.rows[0].total, page, pageSize });
  }),
);

router.post(
  '/',
  authorize('notes:write', 'appointments:write_assigned'),
  asyncHandler(async (req, res) => {
    const body = createNoteSchema.parse(req.body);
    const scope = technicianScope(req, 'notes:write');
    if (body.appointmentId) await assertAppointmentAccess(scope, body.appointmentId);
    else if (body.customerId) await assertCustomerAccess(scope, body.customerId);

    let customerId = body.customerId ?? null;
    if (!customerId && body.appointmentId) {
      const appt = await pool.query('SELECT customer_id FROM appointments WHERE id = $1', [body.appointmentId]);
      customerId = appt.rows[0]?.customer_id ?? null;
    }
    const { rows } = await pool.query(
      `INSERT INTO notes (customer_id, appointment_id, author_id, body, is_internal)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [customerId, body.appointmentId ?? null, req.user!.id, body.body, body.isInternal],
    );
    ok(res, toCamel(rows[0]), 'Note created', 201);
  }),
);

router.delete(
  '/:id',
  authorize('notes:write'),
  asyncHandler(async (req, res) => {
    const { rowCount } = await pool.query(
      'UPDATE notes SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [req.params.id],
    );
    if (!rowCount) throw ApiError.notFound('Note not found');
    ok(res, null, 'Note deleted');
  }),
);

export default router;
