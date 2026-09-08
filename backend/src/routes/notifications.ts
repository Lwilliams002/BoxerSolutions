import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { pool } from '../config/db';
import { rowsToCamel } from '../services/customerService';
import { z } from 'zod';
import { isExpoPushToken } from '../integrations/notifications/expoPush';
import { ApiError } from '../utils/errors';
import { notifications } from '../integrations/notifications';

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

const pushTokenSchema = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(['ios', 'android']).optional(),
  deviceName: z.string().max(120).nullish(),
});

/** Register (or refresh) this device's Expo push token for the signed-in user. */
router.post(
  '/push-token',
  asyncHandler(async (req, res) => {
    const body = pushTokenSchema.parse(req.body ?? {});
    if (!isExpoPushToken(body.token)) throw ApiError.badRequest('Not an Expo push token.');
    await pool.query(
      `INSERT INTO push_tokens (user_id, token, platform, device_name, last_seen_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform,
         device_name = EXCLUDED.device_name, last_seen_at = now()`,
      [req.user!.id, body.token, body.platform ?? 'unknown', body.deviceName ?? null],
    );
    ok(res, null, 'Push token registered');
  }),
);

/** Send the signed-in user a test push so a new build can be verified. */
router.post(
  '/test',
  asyncHandler(async (req, res) => {
    const devices = await pool.query('SELECT count(*)::int AS total FROM push_tokens WHERE user_id = $1', [req.user!.id]);
    await notifications.send({
      userId: req.user!.id,
      channel: 'push',
      type: 'test',
      title: 'Push notifications are working',
      body: 'Boxer Solutions can now alert you when a customer service is due.',
      data: {},
    });
    ok(res, { devices: devices.rows[0].total }, devices.rows[0].total ? 'Test notification sent' : 'No device registered for push yet');
  }),
);

/** Forget this device's token (sign-out). */
router.delete(
  '/push-token',
  asyncHandler(async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (token) await pool.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [token, req.user!.id]);
    ok(res, null, 'Push token removed');
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
