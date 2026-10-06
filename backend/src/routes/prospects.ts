import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { prospectService, PROSPECT_STATUSES } from '../services/prospectService';

/** Door-knocking pins: any staff member can see them all; anyone who can create customers can knock. */
const router = Router();
router.use(authenticate);

const statusSchema = z.enum(PROSPECT_STATUSES);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fields = {
  addressLine1: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  state: z.string().trim().max(40).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  contactName: z.string().trim().max(120).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  callbackDate: dateSchema.nullish(),
};
const createSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), status: statusSchema, ...fields });
const updateSchema = z.object({ status: statusSchema, ...fields });

router.get('/', authorize('customers:read', 'customers:read_assigned'), asyncHandler(async (_req, res) => {
  ok(res, await prospectService.list());
}));

router.get('/callbacks', authorize('customers:read', 'customers:read_assigned'), asyncHandler(async (req, res) => {
  const days = Math.min(30, Math.max(0, Number(req.query.days ?? 0) || 0));
  ok(res, await prospectService.callbacksDue(days));
}));

router.get('/:id', authorize('customers:read', 'customers:read_assigned'), asyncHandler(async (req, res) => {
  ok(res, await prospectService.getById(req.params.id));
}));

router.post('/', authorize('customers:write'), asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body ?? {});
  ok(res, await prospectService.create(body, req.user!.id), 'Pin saved', 201);
}));

router.patch('/:id', authorize('customers:write'), asyncHandler(async (req, res) => {
  const body = updateSchema.parse(req.body ?? {});
  ok(res, await prospectService.update(req.params.id, body, req.user!.id), 'Pin updated');
}));

router.post('/:id/convert', authorize('customers:write'), asyncHandler(async (req, res) => {
  const body = z.object({ customerId: z.string().uuid() }).parse(req.body ?? {});
  ok(res, await prospectService.markConverted(req.params.id, body.customerId, req.user!.id), 'Pin converted to customer');
}));

router.delete('/:id', authorize('customers:write'), asyncHandler(async (req, res) => {
  await prospectService.remove(req.params.id, req.user!.id);
  ok(res, null, 'Pin removed');
}));

export default router;
