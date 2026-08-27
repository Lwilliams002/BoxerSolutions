import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error(
        {
          err: {
            name: err.name,
            message: err.message,
            statusCode: err.statusCode,
            details: err.details ?? null,
          },
          req: {
            method: _req.method,
            url: _req.originalUrl,
          },
        },
        'request failed with ApiError',
      );
    }
    return res.status(err.statusCode).json({ success: false, data: err.details ?? null, message: err.message });
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return res.status(400).json({ success: false, data: null, message });
  }
  logger.error(err, 'unhandled error');
  return res.status(500).json({ success: false, data: null, message: 'Internal server error' });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, data: null, message: 'Route not found' });
}
