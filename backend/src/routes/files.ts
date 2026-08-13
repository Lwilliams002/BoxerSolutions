import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope, assertAppointmentAccess, assertCustomerAccess } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { fileService } from '../services/fileService';
import { pool } from '../config/db';
import { toCamel, rowsToCamel } from '../services/customerService';
import { ApiError } from '../utils/errors';

const router = Router();
router.use(authenticate);

const uploadRequestSchema = z.object({
  fileType: z.enum(['customer_photo', 'service_photo', 'technician_photo', 'document', 'signature', 'attachment']),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(100),
  fileSize: z.number().int().positive().nullish(),
  customerId: z.string().uuid().nullish(),
  appointmentId: z.string().uuid().nullish(),
  caption: z.string().nullish(),
});

router.post(
  '/upload-request',
  authorize('files:write', 'appointments:write_assigned'),
  asyncHandler(async (req, res) => {
    const body = uploadRequestSchema.parse(req.body);
    const scope = technicianScope(req, 'files:write');
    if (body.appointmentId) await assertAppointmentAccess(scope, body.appointmentId);
    else if (body.customerId) await assertCustomerAccess(scope, body.customerId);
    ok(res, await fileService.requestUpload(body, req.user!.id), 'Upload authorized', 201);
  }),
);

router.post(
  '/:id/confirm',
  authorize('files:write', 'appointments:write_assigned'),
  asyncHandler(async (req, res) => {
    const file = (await fileService.confirmUpload(req.params.id)) as any;

    // If it's a photo, ensure a photos row exists for the gallery views.
    if (['service_photo', 'customer_photo', 'technician_photo'].includes(file.fileType)) {
      await pool.query(
        `INSERT INTO photos (file_id, customer_id, appointment_id, taken_by, taken_at)
         SELECT $1, $2, $3, $4, now()
         WHERE NOT EXISTS (SELECT 1 FROM photos WHERE file_id = $1)`,
        [file.id, file.customerId ?? null, file.appointmentId ?? null, req.user!.employeeId],
      );
    }
    ok(res, file, 'Upload confirmed');
  }),
);

router.get(
  '/:id/download',
  authorize('files:read', 'appointments:read_assigned'),
  asyncHandler(async (req, res) => {
    ok(res, await fileService.getDownloadUrl(req.params.id));
  }),
);

router.get(
  '/',
  authorize('files:read', 'appointments:read_assigned'),
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset, limit } = parsePagination(req.query, 50);
    const result = await fileService.list(
      {
        customerId: req.query.customerId as string | undefined,
        appointmentId: req.query.appointmentId as string | undefined,
        invoiceId: req.query.invoiceId as string | undefined,
        fileType: req.query.fileType as string | undefined,
      },
      limit,
      offset,
    );
    ok(res, { ...result, page, pageSize });
  }),
);

router.delete(
  '/:id',
  authorize('files:write'),
  asyncHandler(async (req, res) => {
    await fileService.softDelete(req.params.id);
    ok(res, null, 'File deleted');
  }),
);

// ---- Signatures: metadata records tied to uploaded signature files ----

const signatureSchema = z.object({
  appointmentId: z.string().uuid(),
  fileId: z.string().uuid(),
  signerName: z.string().max(200).nullish(),
});

router.post(
  '/signatures',
  authorize('files:write', 'appointments:write_assigned'),
  asyncHandler(async (req, res) => {
    const body = signatureSchema.parse(req.body);
    const scope = technicianScope(req, 'files:write');
    await assertAppointmentAccess(scope, body.appointmentId);
    const appt = await pool.query('SELECT customer_id FROM appointments WHERE id = $1', [body.appointmentId]);
    if (!appt.rows[0]) throw ApiError.notFound('Appointment not found');
    const { rows } = await pool.query(
      `INSERT INTO signatures (appointment_id, customer_id, technician_id, file_id, signer_name)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.appointmentId, appt.rows[0].customer_id, req.user!.employeeId, body.fileId, body.signerName ?? null],
    );
    ok(res, toCamel(rows[0]), 'Signature recorded', 201);
  }),
);

router.get(
  '/signatures/by-appointment/:appointmentId',
  authorize('files:read', 'appointments:read_assigned'),
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM signatures WHERE appointment_id = $1 ORDER BY signed_at DESC',
      [req.params.appointmentId],
    );
    ok(res, rowsToCamel(rows));
  }),
);

export default router;
