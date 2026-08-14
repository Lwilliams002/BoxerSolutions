import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { pool } from '../config/db';
import { rowsToCamel } from '../services/customerService';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize('users:write'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const count = await pool.query('SELECT count(*)::int AS total FROM audit_logs');
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at,
              u.first_name || ' ' || u.last_name AS user_name, u.email AS user_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    ok(res, { items: rowsToCamel(rows), page, pageSize, total: count.rows[0].total });
  }),
);

export default router;

