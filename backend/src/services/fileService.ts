import crypto from 'crypto';
import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { storage } from '../integrations/storage';
import { toCamel, rowsToCamel } from './customerService';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function buildObjectKey(fileType: string, fileId: string, mime: string, refs: { customerId?: string | null; appointmentId?: string | null; invoiceId?: string | null }) {
  const ext = EXT_BY_MIME[mime] ?? 'bin';
  switch (fileType) {
    case 'customer_photo':
    case 'document':
      return `customers/${refs.customerId}/photos/${fileId}.${ext}`;
    case 'service_photo':
    case 'technician_photo':
      return `appointments/${refs.appointmentId}/photos/${fileId}.${ext}`;
    case 'signature':
      return `signatures/${refs.appointmentId}/${fileId}.${ext}`;
    case 'invoice_pdf':
      return `invoices/${refs.invoiceId}/${fileId}.${ext}`;
    default:
      return `attachments/${fileId}.${ext}`;
  }
}

export const fileService = {
  /**
   * Step 1 of upload flow (spec §4/§31): create the metadata record and hand
   * the client a short-lived presigned PUT URL. Storage credentials never
   * leave the backend.
   */
  async requestUpload(data: {
    fileType: string; fileName: string; mimeType: string; fileSize?: number | null;
    customerId?: string | null; appointmentId?: string | null; invoiceId?: string | null;
  }, userId: string) {
    if (!EXT_BY_MIME[data.mimeType]) throw ApiError.badRequest(`Unsupported mime type: ${data.mimeType}`);
    if (['customer_photo', 'document'].includes(data.fileType) && !data.customerId)
      throw ApiError.badRequest('customerId is required for this file type');
    if (['service_photo', 'technician_photo', 'signature'].includes(data.fileType) && !data.appointmentId)
      throw ApiError.badRequest('appointmentId is required for this file type');

    const fileId = crypto.randomUUID();
    const objectKey = buildObjectKey(data.fileType, fileId, data.mimeType, data);

    const { rows } = await pool.query(
      `INSERT INTO files (id, customer_id, appointment_id, invoice_id, file_type, file_name, mime_type, file_size,
         storage_bucket, storage_object_key, upload_status, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11) RETURNING *`,
      [fileId, data.customerId ?? null, data.appointmentId ?? null, data.invoiceId ?? null, data.fileType,
       data.fileName, data.mimeType, data.fileSize ?? null, storage.bucket, objectKey, userId],
    );

    const uploadUrl = await storage.getUploadUrl(objectKey, data.mimeType);
    return { file: toCamel(rows[0]), uploadUrl };
  },

  /** Step 2: client confirms the PUT succeeded; verify the object exists. */
  async confirmUpload(fileId: string) {
    const { rows } = await pool.query('SELECT * FROM files WHERE id = $1 AND deleted_at IS NULL', [fileId]);
    if (!rows[0]) throw ApiError.notFound('File not found');
    const exists = await storage.objectExists(rows[0].storage_object_key);
    if (!exists) throw ApiError.badRequest('Object not found in storage; upload may have failed');
    const upd = await pool.query(
      `UPDATE files SET upload_status = 'uploaded', updated_at = now() WHERE id = $1 RETURNING *`,
      [fileId],
    );
    return toCamel(upd.rows[0]);
  },

  /** Authorized download: short-lived signed GET URL (spec §4). */
  async getDownloadUrl(fileId: string) {
    const { rows } = await pool.query(
      `SELECT * FROM files WHERE id = $1 AND deleted_at IS NULL AND upload_status = 'uploaded'`,
      [fileId],
    );
    if (!rows[0]) throw ApiError.notFound('File not found');
    const url = await storage.getDownloadUrl(rows[0].storage_object_key);
    return { file: toCamel(rows[0]), downloadUrl: url };
  },

  async list(filters: { customerId?: string; appointmentId?: string; invoiceId?: string; fileType?: string }, limit: number, offset: number) {
    const where: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    if (filters.customerId) { params.push(filters.customerId); where.push(`customer_id = $${params.length}`); }
    if (filters.appointmentId) { params.push(filters.appointmentId); where.push(`appointment_id = $${params.length}`); }
    if (filters.invoiceId) { params.push(filters.invoiceId); where.push(`invoice_id = $${params.length}`); }
    if (filters.fileType) { params.push(filters.fileType); where.push(`file_type = $${params.length}`); }
    const whereSql = where.join(' AND ');
    const count = await pool.query(`SELECT count(*)::int AS total FROM files WHERE ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT * FROM files WHERE ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel(rows), total: count.rows[0].total };
  },

  async softDelete(fileId: string) {
    const { rowCount } = await pool.query('UPDATE files SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL', [fileId]);
    if (!rowCount) throw ApiError.notFound('File not found');
  },
};
