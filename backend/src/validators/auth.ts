import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceName: z.string().max(120).optional(),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const passwordResetRequestSchema = z.object({ email: z.string().email() });

export const passwordResetSchema = z.object({
  email: z.string().email(),
  token: z.string().min(10),
  newPassword: z.string().min(8).max(128),
});

export const customerPortalRequestCodeSchema = z.object({
  email: z.string().email(),
});

export const customerPortalVerifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export const customerPortalTestLoginSchema = z.object({
  email: z.string().email().optional(),
});
