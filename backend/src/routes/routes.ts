import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { routeService } from '../services/routeService';
import { ApiError } from '../utils/errors';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  authorize('routes:read', 'routes:read_assigned'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const scope = technicianScope(req, 'routes:read');
    const result = await routeService.list(
      {
        date: req.query.date as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        technicianId: scope ?? (req.query.technicianId as string | undefined),
      },
      limit,
      offset,
    );
    ok(res, { ...result, page, pageSize });
  }),
);

router.get(
  '/:id',
  authorize('routes:read', 'routes:read_assigned'),
  asyncHandler(async (req, res) => {
    const route = (await routeService.getById(req.params.id)) as any;
    const scope = technicianScope(req, 'routes:read');
    if (scope && route.technicianId !== scope) throw ApiError.forbidden('This route belongs to another technician');
    ok(res, route);
  }),
);

router.post(
  '/',
  authorize('routes:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      routeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      technicianId: z.string().uuid(),
    }).parse(req.body);
    ok(res, await routeService.createOrGet(body.routeDate, body.technicianId, req.user!.id), 'Route ready', 201);
  }),
);

router.post(
  '/:id/stops',
  authorize('routes:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ appointmentId: z.string().uuid() }).parse(req.body);
    ok(res, await routeService.addStop(req.params.id, body.appointmentId, req.user!.id), 'Stop added', 201);
  }),
);

router.delete(
  '/:id/stops/:stopId',
  authorize('routes:write'),
  asyncHandler(async (req, res) => {
    await routeService.removeStop(req.params.id, req.params.stopId, req.user!.id);
    ok(res, null, 'Stop removed');
  }),
);

router.post(
  '/:id/reorder',
  authorize('routes:write', 'routes:read_assigned'),
  asyncHandler(async (req, res) => {
    const body = z.object({ orderedStopIds: z.array(z.string().uuid()).min(1) }).parse(req.body);
    ok(res, await routeService.reorderStops(req.params.id, body.orderedStopIds, req.user!.id), 'Route reordered');
  }),
);

router.post(
  '/:id/optimize',
  authorize('routes:write', 'routes:read_assigned'),
  asyncHandler(async (req, res) => {
    ok(res, await routeService.optimize(req.params.id, req.user!.id), 'Route optimized');
  }),
);

export default router;
