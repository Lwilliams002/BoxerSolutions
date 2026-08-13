import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { ApiError } from '../utils/errors';

export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  employeeId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Missing access token'));
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwt.secret) as jwt.JwtPayload;
    if (payload.type !== 'access') throw new Error('wrong token type');
    req.user = {
      id: payload.sub as string,
      email: payload.email,
      roles: payload.roles ?? [],
      permissions: payload.permissions ?? [],
      employeeId: payload.employeeId ?? null,
    };
    next();
  } catch {
    next(ApiError.unauthorized('Invalid or expired access token'));
  }
}

export function authorize(...requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(ApiError.unauthorized());
    if (user.permissions.includes('*')) return next();
    const okPerm = requiredPermissions.some((p) => user.permissions.includes(p));
    if (!okPerm) return next(ApiError.forbidden('Insufficient permissions'));
    next();
  };
}
