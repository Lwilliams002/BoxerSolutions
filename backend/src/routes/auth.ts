import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authService } from '../services/authService';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { authenticate } from '../middleware/auth';
import {
  loginSchema,
  refreshSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
} from '../validators/auth';
import { config } from '../config';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.env === 'production' ? 20 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body.email, body.password, body.deviceName);
    ok(res, result);
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    ok(res, await authService.refresh(body.refreshToken));
  }),
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = refreshSchema.parse(req.body);
    await authService.logout(body.refreshToken);
    ok(res, null, 'Logged out');
  }),
);

router.post(
  '/password-reset/request',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = passwordResetRequestSchema.parse(req.body);
    const token = await authService.requestPasswordReset(body.email);
    // Token returned directly only outside production (no email service in dev).
    ok(res, config.env === 'production' ? null : { resetToken: token }, 'If the account exists, a reset link was sent');
  }),
);

router.post(
  '/password-reset/confirm',
  asyncHandler(async (req, res) => {
    const body = passwordResetSchema.parse(req.body);
    await authService.resetPassword(body.token, body.newPassword);
    ok(res, null, 'Password updated');
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    ok(res, await authService.me(req.user!.id));
  }),
);

router.get(
  '/sessions',
  authenticate,
  asyncHandler(async (req, res) => {
    ok(res, await authService.listSessions(req.user!.id));
  }),
);

router.post(
  '/sessions/revoke-all',
  authenticate,
  asyncHandler(async (req, res) => {
    await authService.revokeAllSessions(req.user!.id);
    ok(res, null, 'All sessions revoked');
  }),
);

export default router;
