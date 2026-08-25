import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope, assertCustomerAccess } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { communicationService } from '../services/communicationService';
import { ApiError } from '../utils/errors';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize('customers:read', 'customers:read_assigned'),
  asyncHandler(async (req, res) => {
    const query = z.object({
      customerId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
    }).parse(req.query);
    const scope = technicianScope(req, 'customers:read');
    if (scope && !query.customerId) throw ApiError.badRequest('customerId is required for assigned communications');
    if (query.customerId) await assertCustomerAccess(scope, query.customerId);
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const result = await communicationService.list({ customerId: query.customerId }, limit, offset);
    ok(res, { ...result, page, pageSize });
  }),
);

router.post(
  '/agreement-review-request',
  authorize('customers:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      customerId: z.string().uuid(),
      reviewUrl: z.string().url().nullish(),
    }).parse(req.body);
    ok(
      res,
      await communicationService.sendAgreementReviewRequest(body.customerId, req.user!.id, body.reviewUrl ?? null),
      'Agreement review request sent',
      201,
    );
  }),
);

export default router;
