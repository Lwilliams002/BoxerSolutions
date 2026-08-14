import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { reportService } from '../services/reportService';

const router = Router();
router.use(authenticate, authorize('reports:read'));

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  technicianId: z.string().uuid().optional(),
});

function dateRange(query: Record<string, unknown>) {
  const parsed = querySchema.parse(query);
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400_000);
  return {
    from: parsed.from ?? thirtyDaysAgo.toISOString().slice(0, 10),
    to: parsed.to ?? today.toISOString().slice(0, 10),
    technicianId: parsed.technicianId,
  };
}

router.get('/revenue', asyncHandler(async (req, res) => ok(res, await reportService.revenue(dateRange(req.query)))));
router.get('/technician-performance', asyncHandler(async (req, res) => ok(res, await reportService.technicianPerformance(dateRange(req.query)))));
router.get('/appointments', asyncHandler(async (req, res) => ok(res, await reportService.appointments(dateRange(req.query)))));
router.get('/ar-aging', asyncHandler(async (_req, res) => ok(res, await reportService.arAging())));
router.get('/recurring', asyncHandler(async (req, res) => ok(res, await reportService.recurring(dateRange(req.query)))));
router.get('/customer-growth', asyncHandler(async (req, res) => ok(res, await reportService.customerGrowth(dateRange(req.query)))));
router.get('/outstanding', asyncHandler(async (_req, res) => ok(res, await reportService.outstanding())));
router.get('/service-revenue', asyncHandler(async (req, res) => ok(res, await reportService.serviceRevenue(dateRange(req.query)))));

export default router;
