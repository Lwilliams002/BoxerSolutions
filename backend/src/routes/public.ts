import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { submitPublicRequest } from '../services/publicRequestService';

/** Unauthenticated endpoints for the public (website form, new-customer request in the app). */
const router = Router();

const limiter = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false });

export const publicRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(200).or(z.literal('')).nullish(),
  address: z.string().trim().max(200).nullish(),
  pest: z.string().trim().max(60).nullish(),
  message: z.string().trim().max(1000).nullish(),
  /** Honeypot: humans never see it. */
  company: z.string().max(200).nullish(),
});

router.post('/service-requests', limiter, asyncHandler(async (req, res) => {
  const body = publicRequestSchema.parse(req.body ?? {});
  if (body.company) return ok(res, { received: true }, 'Thanks! We will be in touch shortly.');
  const result = await submitPublicRequest({ name: body.name, phone: body.phone, email: body.email || null, address: body.address || null, pest: body.pest || null, message: body.message || null, source: 'app' });
  return ok(res, { received: true, requestId: result.requestId }, 'Request received', 201);
}));

export default router;
