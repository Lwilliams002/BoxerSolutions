import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { pool } from '../config/db';
import { rowsToCamel } from '../services/customerService';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const count = await pool.query('SELECT count(*)::int AS total FROM notifications WHERE user_id = $1 OR user_id IS NULL', [req.user!.id]);
    const { rows } = await pool.query(
      `SELECT * FROM notifications WHERE user_id = $1 OR user_id IS NULL
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, limit, offset],
    );
    ok(res, { items: rowsToCamel(rows), total: count.rows[0].total, page, pageSize });
  }),
);

router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    await pool.query(
      `UPDATE notifications SET status = 'read', read_at = now() WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)`,
      [req.params.id, req.user!.id],
    );
    ok(res, null, 'Marked read');
  }),
);

export default router;
