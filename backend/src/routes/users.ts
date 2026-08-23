import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { pool, withTransaction } from '../config/db';
import { toCamel, rowsToCamel } from '../services/customerService';
import { ApiError } from '../utils/errors';
import { recordAudit } from '../services/auditService';

const router = Router();
router.use(authenticate);

const ROLE_CODES = ['OWNER', 'TRUSTED_TECHNICIAN', 'TECHNICIAN'] as const;
const TECH_ROLE_CODES = ['TRUSTED_TECHNICIAN', 'TECHNICIAN'] as const;

router.get(
  '/',
  authorize('users:read'),
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.is_active,
              e.id AS employee_id, e.job_title, e.color,
              coalesce(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.deleted_at IS NULL
       GROUP BY u.id, e.id ORDER BY u.last_name, u.first_name`,
    );
    ok(res, rowsToCamel(rows));
  }),
);

/** Technicians list for scheduling/routes (lighter permission). */
router.get(
  '/technicians',
  authorize('users:read', 'appointments:read', 'routes:read', 'appointments:read_assigned'),
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT e.id AS employee_id, u.id AS user_id, u.first_name, u.last_name, e.job_title, e.color,
              e.work_start_time, e.work_end_time, e.home_base_lat, e.home_base_lng
       FROM employees e
       JOIN users u ON u.id = e.user_id
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id AND r.code = ANY($1::text[])
       WHERE e.deleted_at IS NULL AND e.is_active AND u.is_active
       ORDER BY u.last_name`,
      [TECH_ROLE_CODES],
    );
    ok(res, rowsToCamel(rows));
  }),
);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().nullish(),
  roleCodes: z.array(z.enum(ROLE_CODES)).min(1),
  employee: z
    .object({
      jobTitle: z.string().nullish(),
      hireDate: z.string().nullish(),
      homeBaseLat: z.number().nullish(),
      homeBaseLng: z.number().nullish(),
      workStartTime: z.string().default('08:00'),
      workEndTime: z.string().default('17:00'),
      color: z.string().nullish(),
    })
    .nullish(),
});

router.post(
  '/',
  authorize('users:write'),
  asyncHandler(async (req, res) => {
    const body = createUserSchema.parse(req.body);
    const result = await withTransaction(async (tx) => {
      const hash = await bcrypt.hash(body.password, 12);
      const userRes = await tx.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, phone)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, email, first_name, last_name`,
        [body.email.toLowerCase(), hash, body.firstName, body.lastName, body.phone ?? null],
      );
      const user = userRes.rows[0];
      for (const code of body.roleCodes) {
        await tx.query(
          `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`,
          [user.id, code],
        );
      }
      if (body.employee || body.roleCodes.includes('TRUSTED_TECHNICIAN') || body.roleCodes.includes('TECHNICIAN')) {
        const e = body.employee ?? {};
        await tx.query(
          `INSERT INTO employees (user_id, job_title, hire_date, home_base_lat, home_base_lng, work_start_time, work_end_time, color)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [user.id, (e as any).jobTitle ?? null, (e as any).hireDate ?? null, (e as any).homeBaseLat ?? null,
           (e as any).homeBaseLng ?? null, (e as any).workStartTime ?? '08:00', (e as any).workEndTime ?? '17:00', (e as any).color ?? null],
        );
      }
      await recordAudit({ userId: req.user!.id, action: 'user.created', entityType: 'user', entityId: user.id, newValue: { email: body.email, roles: body.roleCodes } }, tx);
      return toCamel(user);
    });
    ok(res, result, 'User created', 201);
  }),
);

router.patch(
  '/:id',
  authorize('users:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      firstName: z.string().min(1).optional(),
      lastName: z.string().min(1).optional(),
      phone: z.string().nullish().optional(),
      isActive: z.boolean().optional(),
      roleCodes: z.array(z.enum(ROLE_CODES)).min(1).optional(),
    }).parse(req.body);
    if (!Object.keys(body).length) throw ApiError.badRequest('No fields to update');
    const result = await withTransaction(async (tx) => {
      const previous = await tx.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.is_active,
                COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE u.id = $1 AND u.deleted_at IS NULL
         GROUP BY u.id`,
        [req.params.id],
      );
      if (!previous.rows[0]) throw ApiError.notFound('User not found');

      const map: Record<string, string> = { firstName: 'first_name', lastName: 'last_name', phone: 'phone', isActive: 'is_active' };
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [k, col] of Object.entries(map)) {
        if (k in body) { params.push((body as any)[k]); sets.push(`${col} = $${params.length}`); }
      }
      let user = previous.rows[0];
      if (sets.length) {
        params.push(req.params.id);
        const updated = await tx.query(
          `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} AND deleted_at IS NULL
           RETURNING id, email, first_name, last_name, phone, is_active`,
          params,
        );
        user = updated.rows[0];
        if ('isActive' in body) {
          await tx.query('UPDATE employees SET is_active = $1, updated_at = now() WHERE user_id = $2 AND deleted_at IS NULL', [body.isActive, req.params.id]);
        }
      }
      if (body.roleCodes) {
        await tx.query('DELETE FROM user_roles WHERE user_id = $1', [req.params.id]);
        for (const code of body.roleCodes) {
          await tx.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2`, [req.params.id, code]);
        }
        if (body.roleCodes.includes('TRUSTED_TECHNICIAN') || body.roleCodes.includes('TECHNICIAN')) {
          await tx.query(
            `INSERT INTO employees (user_id, job_title) VALUES ($1, 'Service Technician')
             ON CONFLICT (user_id) DO UPDATE SET is_active = true, deleted_at = NULL, updated_at = now()`,
            [req.params.id],
          );
        }
        await recordAudit({
          userId: req.user!.id,
          action: 'user.roles_updated',
          entityType: 'user',
          entityId: req.params.id,
          previousValue: { roles: previous.rows[0].roles },
          newValue: { roles: body.roleCodes },
        }, tx);
      }
      await recordAudit({ userId: req.user!.id, action: 'user.updated', entityType: 'user', entityId: req.params.id, previousValue: previous.rows[0], newValue: body }, tx);
      const roles = body.roleCodes ?? previous.rows[0].roles;
      return toCamel({ ...user, roles });
    });
    ok(res, result, 'User updated');
  }),
);

export default router;
