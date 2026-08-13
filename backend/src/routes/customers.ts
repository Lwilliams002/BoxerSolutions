import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope, assertCustomerAccess } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { customerService } from '../services/customerService';
import { createCustomerSchema, updateCustomerSchema } from '../validators/customers';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize('customers:read', 'customers:read_assigned'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePagination(req.query);
    const scope = technicianScope(req, 'customers:read');
    const result = await customerService.list(
      {
        search: req.query.search as string | undefined,
        status: req.query.status as string | undefined,
        pastDue: req.query.pastDue === 'true',
        autopay: req.query.autopay === 'true',
        scheduledToday: req.query.scheduledToday === 'true',
        upcoming: req.query.upcoming === 'true',
        noAppointment: req.query.noAppointment === 'true',
        technicianId: scope ?? (req.query.technicianId as string | undefined),
        sort: req.query.sort as string | undefined,
      },
      page,
      pageSize,
      offset,
    );
    ok(res, result);
  }),
);

router.get(
  '/:id',
  authorize('customers:read', 'customers:read_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'customers:read');
    await assertCustomerAccess(scope, req.params.id);
    ok(res, await customerService.getById(req.params.id));
  }),
);

router.get(
  '/:id/service-history',
  authorize('customers:read', 'customers:read_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'customers:read');
    await assertCustomerAccess(scope, req.params.id);
    ok(res, await customerService.serviceHistory(req.params.id));
  }),
);

router.post(
  '/',
  authorize('customers:write'),
  asyncHandler(async (req, res) => {
    const body = createCustomerSchema.parse(req.body);
    ok(res, await customerService.create(body, req.user!.id), 'Customer created', 201);
  }),
);

router.patch(
  '/:id',
  authorize('customers:write'),
  asyncHandler(async (req, res) => {
    const body = updateCustomerSchema.parse(req.body);
    ok(res, await customerService.update(req.params.id, body, req.user!.id), 'Customer updated');
  }),
);

router.delete(
  '/:id',
  authorize('customers:delete'),
  asyncHandler(async (req, res) => {
    await customerService.softDelete(req.params.id, req.user!.id);
    ok(res, null, 'Customer deleted');
  }),
);

export default router;
