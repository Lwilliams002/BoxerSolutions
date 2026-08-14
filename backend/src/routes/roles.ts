import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { pool } from '../config/db';
import { rowsToCamel } from '../services/customerService';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize('users:read', 'users:write'),
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.code, r.name, r.description,
              COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       GROUP BY r.id
       ORDER BY r.name`,
    );
    ok(res, rowsToCamel(rows));
  }),
);

export default router;

