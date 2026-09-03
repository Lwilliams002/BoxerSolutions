import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope, assertCustomerAccess } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { recurringChargeService } from '../services/recurringChargeService';

const router = Router();
router.use(authenticate);

const chargeSchema = z.object({
  paymentMethodId: z.string().uuid().nullish(),
});

const upsertSchema = z.object({
  customerId: z.string().uuid(),
  amount: z.number().positive(),
  sourceAgreementFileId: z.string().uuid().nullish(),
});

router.post(
  '/',
  authorize('invoices:write', 'invoices:write_assigned'),
  asyncHandler(async (req, res) => {
    const body = upsertSchema.parse(req.body ?? {});
    const scope = technicianScope(req, 'invoices:write');
    if (scope) await assertCustomerAccess(scope, body.customerId);
    const row = await recurringChargeService.upsertFromAgreement(
      body.customerId,
      body.amount,
      body.sourceAgreementFileId ?? null,
    );
    ok(res, row ? { id: row.id, amount: Number(row.amount) } : null, 'Recurring charge saved');
  }),
);

router.get(
  '/',
  authorize('invoices:read', 'invoices:read_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'invoices:read');
    if (scope && req.query.customerId) await assertCustomerAccess(scope, req.query.customerId as string);
    ok(res, await recurringChargeService.list({ customerId: req.query.customerId as string | undefined }));
  }),
);

router.post(
  '/:id/charge',
  authorize('invoices:write', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = chargeSchema.parse(req.body ?? {});
    const result = await recurringChargeService.chargeNow(req.params.id, req.user!.id, body.paymentMethodId ?? null);
    ok(res, result, result.charged ? 'Recurring charge collected' : 'Recurring invoice created');
  }),
);

export default router;


