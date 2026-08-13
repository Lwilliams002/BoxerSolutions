import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { paymentService } from '../services/paymentService';
import { ApiError } from '../utils/errors';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize('payments:read', 'payments:collect'),
  asyncHandler(async (req, res) => {
    const customerId = req.query.customerId as string | undefined;
    if (!customerId) throw ApiError.badRequest('customerId query parameter is required');
    ok(res, await paymentService.listMethods(customerId));
  }),
);

router.post(
  '/',
  authorize('payments:write', 'payments:collect'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      customerId: z.string().uuid(),
      token: z.string().min(4), // client-side token from the payment provider SDK; never raw card data
      setDefault: z.boolean().default(true),
    }).parse(req.body);
    ok(res, await paymentService.addMethod(body.customerId, body.token, body.setDefault, req.user!.id), 'Payment method added', 201);
  }),
);

router.post(
  '/:id/set-default',
  authorize('payments:write', 'payments:collect'),
  asyncHandler(async (req, res) => {
    ok(res, await paymentService.setDefaultMethod(req.params.id, req.user!.id), 'Default payment method updated');
  }),
);

router.delete(
  '/:id',
  authorize('payments:write'),
  asyncHandler(async (req, res) => {
    await paymentService.removeMethod(req.params.id, req.user!.id);
    ok(res, null, 'Payment method removed');
  }),
);

export default router;
