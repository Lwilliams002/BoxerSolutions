import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceName: z.string().max(120).optional(),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const passwordResetRequestSchema = z.object({ email: z.string().email() });

export const passwordResetSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8).max(128),
});
