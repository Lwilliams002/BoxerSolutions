import { Request, Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { authService } from '../services/authService';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, parsePagination } from '../utils/http';
import { ApiError } from '../utils/errors';
import { fileService } from '../services/fileService';
import { recordAudit } from '../services/auditService';
import { notifications } from '../integrations/notifications';
import { logger } from '../utils/logger';

const router = Router();

function portalCustomer(req: Request) {
  const tokenHeader = req.header('x-customer-portal-token');
  if (!tokenHeader) throw ApiError.unauthorized('Missing customer portal token');
  return authService.getCustomerPortalSession(tokenHeader);
}

const requestUploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(3).max(100),
  fileSize: z.number().int().positive().optional(),
});

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const session = portalCustomer(req);
    const { rows } = await pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.company, c.email, c.phone, c.status, c.customer_type,
              c.balance, c.autopay_enabled,
              sl.id AS primary_location_id, sl.address_line1, sl.address_line2, sl.city, sl.state, sl.postal_code
       FROM customers c
       LEFT JOIN LATERAL (
         SELECT id, address_line1, address_line2, city, state, postal_code
         FROM service_locations
         WHERE customer_id = c.id AND deleted_at IS NULL
         ORDER BY is_primary DESC, created_at ASC
         LIMIT 1
       ) sl ON true
       WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [session.customerId],
    );
    if (!rows[0]) throw ApiError.notFound('Customer not found');
    ok(res, rows[0]);
  }),
);

router.get(
  '/appointments',
  asyncHandler(async (req, res) => {
    const session = portalCustomer(req);
    const { limit, offset, page, pageSize } = parsePagination(req.query as Record<string, unknown>, 10);
    const count = await pool.query(
      `SELECT count(*)::int AS total
       FROM appointments a
       WHERE a.customer_id = $1
         AND a.deleted_at IS NULL`,
      [session.customerId],
    );
    const { rows } = await pool.query(
      `SELECT a.id, a.scheduled_date, a.window_start::text, a.window_end::text, a.status, a.duration_minutes, a.notes,
              sl.address_line1, sl.city, sl.state,
              COALESCE(string_agg(DISTINCT s.name, ', ') FILTER (WHERE s.name IS NOT NULL), '') AS service_names
       FROM appointments a
       LEFT JOIN service_locations sl ON sl.id = a.service_location_id
       LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
       LEFT JOIN services s ON s.id = aps.service_id
       WHERE a.customer_id = $1
         AND a.deleted_at IS NULL
       GROUP BY a.id, sl.address_line1, sl.city, sl.state
       ORDER BY a.scheduled_date DESC, a.window_start DESC
       LIMIT $2 OFFSET $3`,
      [session.customerId, limit, offset],
    );
    ok(res, { items: rows, page, pageSize, total: count.rows[0].total });
  }),
);

router.get(
  '/invoices',
  asyncHandler(async (req, res) => {
    const session = portalCustomer(req);
    const { limit, offset, page, pageSize } = parsePagination(req.query as Record<string, unknown>, 10);
    const count = await pool.query(
      `SELECT count(*)::int AS total
       FROM invoices i
       WHERE i.customer_id = $1
         AND i.deleted_at IS NULL`,
      [session.customerId],
    );
    const { rows } = await pool.query(
      `SELECT i.id, i.invoice_number, i.status, i.invoice_date, i.due_date, i.total, i.amount_paid,
              (i.total - i.amount_paid) AS balance_due
       FROM invoices i
       WHERE i.customer_id = $1
         AND i.deleted_at IS NULL
       ORDER BY i.invoice_date DESC, i.created_at DESC
       LIMIT $2 OFFSET $3`,
      [session.customerId, limit, offset],
    );
    ok(res, { items: rows, page, pageSize, total: count.rows[0].total });
  }),
);

router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const session = portalCustomer(req);
    const { limit, offset, page, pageSize } = parsePagination(req.query as Record<string, unknown>, 10);
    const count = await pool.query(
      `SELECT count(*)::int AS total
       FROM payments p
       WHERE p.customer_id = $1`,
      [session.customerId],
    );
    const { rows } = await pool.query(
      `SELECT p.id, p.amount, p.status, p.receipt_number, p.processed_at, p.created_at,
              p.failure_reason, i.invoice_number
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.customer_id = $1
       ORDER BY COALESCE(p.processed_at, p.created_at) DESC
       LIMIT $2 OFFSET $3`,
      [session.customerId, limit, offset],
    );
    ok(res, { items: rows, page, pageSize, total: count.rows[0].total });
  }),
);

router.post(
  '/files/upload-request',
  asyncHandler(async (req, res) => {
    const session = portalCustomer(req);
    const body = requestUploadSchema.parse(req.body);
    const upload = await fileService.requestUpload(
      {
        fileType: 'customer_photo',
        fileName: body.fileName,
        mimeType: body.mimeType,
        fileSize: body.fileSize ?? null,
        customerId: session.customerId,
      },
      null,
    );
    ok(res, upload, 'Upload authorized', 201);
  }),
);

router.post(
  '/files/:id/confirm',
  asyncHandler(async (req, res) => {
    const session = portalCustomer(req);
    const file = (await fileService.confirmUpload(req.params.id)) as any;
    if (file.customerId !== session.customerId) throw ApiError.forbidden('File does not belong to this customer');
    await pool.query(
      `INSERT INTO photos (file_id, customer_id, caption, taken_at)
       SELECT $1, $2, null, now()
       WHERE NOT EXISTS (SELECT 1 FROM photos WHERE file_id = $1)`,
      [file.id, session.customerId],
    );
    ok(res, file, 'Upload confirmed');
  }),
);

router.get(
  '/files/:id/download',
  asyncHandler(async (req, res) => {
    const session = portalCustomer(req);
    const download = await fileService.getDownloadUrl(req.params.id);
    if (!download.file || download.file.customerId !== session.customerId) {
      throw ApiError.forbidden('File does not belong to this customer');
    }
    ok(res, download);
  }),
);

const createRequestSchema = z.object({
  description: z.string().min(10).max(4000),
  photoFileIds: z.array(z.string().uuid()).max(8).optional(),
});

router.post(
  '/service-requests',
  asyncHandler(async (req, res) => {
    const session = portalCustomer(req);
    const body = createRequestSchema.parse(req.body);
    const created = await pool.query(
      `INSERT INTO service_requests (customer_id, description)
       VALUES ($1, $2)
       RETURNING *`,
      [session.customerId, body.description.trim()],
    );
    const requestId = created.rows[0].id as string;
    for (const fileId of body.photoFileIds ?? []) {
      const file = await pool.query(
        `SELECT id, customer_id, upload_status, deleted_at
         FROM files
         WHERE id = $1`,
        [fileId],
      );
      if (!file.rows[0]) continue;
      if (file.rows[0].deleted_at) continue;
      if (file.rows[0].upload_status !== 'uploaded') continue;
      if (file.rows[0].customer_id !== session.customerId) continue;
      await pool.query(
        `INSERT INTO service_request_files (service_request_id, file_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [requestId, fileId],
      );
    }

    await recordAudit({
      userId: null,
      action: 'service_request.created',
      entityType: 'service_request',
      entityId: requestId,
      newValue: { customerId: session.customerId },
    });

    // Notify owners/admins that a new request is waiting for review.
    try {
      const customer = await pool.query(
        `SELECT first_name, last_name, company FROM customers WHERE id = $1`,
        [session.customerId],
      );
      const name = customer.rows[0]?.company
        ?? `${customer.rows[0]?.first_name ?? ''} ${customer.rows[0]?.last_name ?? ''}`.trim();
      const owners = await pool.query(
        `SELECT DISTINCT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE r.code = 'OWNER' AND u.deleted_at IS NULL AND u.is_active = true`,
      );
      for (const owner of owners.rows) {
        await notifications.send({
          userId: owner.id,
          customerId: session.customerId,
          channel: 'push',
          type: 'service_request_submitted',
          title: 'New service request',
          body: `${name || 'A customer'} submitted a service request: ${body.description.trim().slice(0, 120)}`,
          data: { serviceRequestId: requestId, customerId: session.customerId },
        });
      }
    } catch (err) {
      logger.error({ err, requestId }, 'failed to notify owners of new service request');
    }

    ok(res, created.rows[0], 'Service request submitted', 201);
  }),
);

router.get(
  '/service-requests',
  asyncHandler(async (req, res) => {
    const session = portalCustomer(req);
    const { limit, offset, page, pageSize } = parsePagination(req.query as Record<string, unknown>, 20);
    const count = await pool.query(
      `SELECT count(*)::int AS total
       FROM service_requests
       WHERE customer_id = $1`,
      [session.customerId],
    );
    const { rows } = await pool.query(
      `SELECT sr.id, sr.description, sr.status, sr.quoted_price, sr.owner_notes, sr.requested_at, sr.reviewed_at,
              sr.assigned_technician_id, u.first_name AS technician_first_name, u.last_name AS technician_last_name,
              a.scheduled_date, a.window_start, a.window_end,
              COALESCE(
                json_agg(
                  DISTINCT jsonb_build_object(
                    'fileId', f.id,
                    'fileName', f.file_name,
                    'mimeType', f.mime_type
                  )
                ) FILTER (WHERE f.id IS NOT NULL),
                '[]'::json
              ) AS files
       FROM service_requests sr
       LEFT JOIN appointments a ON a.id = sr.appointment_id
       LEFT JOIN employees e ON e.id = sr.assigned_technician_id
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN service_request_files srf ON srf.service_request_id = sr.id
       LEFT JOIN files f ON f.id = srf.file_id AND f.deleted_at IS NULL
       WHERE sr.customer_id = $1
       GROUP BY sr.id, a.scheduled_date, a.window_start, a.window_end, u.first_name, u.last_name
       ORDER BY sr.requested_at DESC
       LIMIT $2 OFFSET $3`,
      [session.customerId, limit, offset],
    );
    ok(res, { items: rows, page, pageSize, total: count.rows[0].total });
  }),
);

export default router;
