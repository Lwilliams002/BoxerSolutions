import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { pool } from '../config/db';
import { logger } from '../utils/logger';

/**
 * Offline-sync idempotency: if a client sends an Idempotency-Key header on a
 * mutating request, replay the stored response instead of re-executing —
 * prevents duplicate records when the mobile app retries queued mutations.
 */
export async function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['idempotency-key'];
  if (!key || typeof key !== 'string' || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  try {
    const { rows } = await pool.query(
      'SELECT response_status, response_body FROM sync_queue WHERE idempotency_key = $1',
      [key],
    );
    if (rows.length > 0 && rows[0].response_status != null) {
      return res.status(rows[0].response_status).json(rows[0].response_body);
    }
  } catch (err) {
    logger.warn(err, 'idempotency lookup failed');
  }

  const requestHash = crypto
    .createHash('sha256')
    .update(`${req.method}:${req.originalUrl}:${JSON.stringify(req.body ?? {})}`)
    .digest('hex');

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    pool
      .query(
        `INSERT INTO sync_queue (idempotency_key, user_id, endpoint, request_hash, response_status, response_body)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [key, req.user?.id ?? null, `${req.method} ${req.originalUrl}`, requestHash, res.statusCode, JSON.stringify(body)],
      )
      .catch((err: unknown) => logger.warn(err, 'idempotency store failed'));
    return originalJson(body);
  };
  next();
}
