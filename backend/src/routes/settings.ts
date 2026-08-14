import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { withTransaction } from '../config/db';
import { getCompanySettings } from '../services/settingsService';
import { recordAudit } from '../services/auditService';

const router = Router();
router.use(authenticate);

const settingsSchema = z.object({
  companyName: z.string().min(1).max(200),
  phone: z.string().min(1).max(50),
  address: z.string().min(1).max(500),
  licenseNumber: z.string().min(1).max(100),
  defaultTaxRate: z.number().min(0).max(0.3),
  invoiceDueDays: z.number().int().min(0).max(365),
  appointmentReminderHours: z.number().int().min(0).max(720),
});

router.get(
  '/',
  authorize('settings:read', 'settings:write'),
  asyncHandler(async (_req, res) => {
    ok(res, await getCompanySettings());
  }),
);

router.put(
  '/',
  authorize('settings:write'),
  asyncHandler(async (req, res) => {
    const body = settingsSchema.parse(req.body);
    const saved = await withTransaction(async (tx) => {
      const previous = await getCompanySettings(tx);
      await tx.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ('company', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify({
          companyName: body.companyName,
          phone: body.phone,
          address: body.address,
          licenseNumber: body.licenseNumber,
          defaultTaxRate: body.defaultTaxRate,
        })],
      );
      await tx.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ('invoicing', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify({ invoiceDueDays: body.invoiceDueDays })],
      );
      await tx.query(
        `INSERT INTO settings (key, value, updated_at) VALUES ('appointments', $1::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify({ appointmentReminderHours: body.appointmentReminderHours })],
      );
      await recordAudit({ userId: req.user!.id, action: 'settings.updated', entityType: 'settings', previousValue: previous, newValue: body }, tx);
      return getCompanySettings(tx);
    });
    ok(res, saved, 'Settings updated');
  }),
);

export default router;

