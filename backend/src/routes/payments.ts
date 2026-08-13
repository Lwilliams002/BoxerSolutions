import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { paymentService } from '../services/paymentService';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize('payments:read', 'payments:collect'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const result = await paymentService.list(
      {
        customerId: req.query.customerId as string | undefined,
        invoiceId: req.query.invoiceId as string | undefined,
        status: req.query.status as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      },
      limit,
      offset,
    );
    ok(res, { ...result, page, pageSize });
  }),
);

router.post(
  '/charge',
  authorize('payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      invoiceId: z.string().uuid(),
      paymentMethodId: z.string().uuid().nullish(),
      amount: z.number().positive().nullish(),
    }).parse(req.body);
    const result = await paymentService.chargeInvoice(
      body.invoiceId,
      body.paymentMethodId ?? null,
      body.amount ?? null,
      req.user!.id,
      req.user!.employeeId,
    );
    ok(res, result, 'Payment collected', 201);
  }),
);

router.get(
  '/autopay/:customerId',
  authorize('payments:read', 'payments:collect'),
  asyncHandler(async (req, res) => {
    ok(res, await paymentService.getAutopay(req.params.customerId));
  }),
);

router.post(
  '/autopay/:customerId',
  authorize('payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      enabled: z.boolean(),
      paymentMethodId: z.string().uuid().nullish(),
    }).parse(req.body);
    ok(res, await paymentService.setAutopay(req.params.customerId, body.enabled, body.paymentMethodId ?? null, req.user!.id), 'AutoPay updated');
  }),
);

export default router;
