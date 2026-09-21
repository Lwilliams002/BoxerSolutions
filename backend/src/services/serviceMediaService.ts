import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { storage } from '../integrations/storage';

/** Labels a technician can put on a capture; 'proof' is the default "we were here" shot. */
export const MEDIA_LABELS = ['before', 'after', 'proof'] as const;
export type MediaLabel = (typeof MEDIA_LABELS)[number];

/** Viewing links live a little longer than upload links so a gallery can be browsed. */
const VIEW_URL_TTL_SECONDS = 15 * 60;

export interface ServiceMediaItem {
  id: string;
  fileId: string;
  appointmentId: string | null;
  customerId: string | null;
  kind: 'image' | 'video';
  mimeType: string;
  fileName: string;
  fileSize: number | null;
  label: MediaLabel | null;
  caption: string | null;
  hiddenFromCustomer: boolean;
  takenAt: string | null;
  technicianName: string | null;
  scheduledDate: string | null;
  appointmentStatus: string | null;
  url: string;
}

export function mediaKind(mimeType: string): 'image' | 'video' {
  return mimeType.startsWith('video/') ? 'video' : 'image';
}

interface ListFilters {
  customerId?: string | null;
  appointmentId?: string | null;
  /** Customer-facing: only completed visits, nothing hidden. */
  customerFacing?: boolean;
}

async function listRows(filters: ListFilters, limit = 200) {
  const where: string[] = [
    "f.file_type = 'service_photo'",
    "f.upload_status = 'uploaded'",
    'f.deleted_at IS NULL',
  ];
  const params: unknown[] = [];
  if (filters.customerId) { params.push(filters.customerId); where.push(`f.customer_id = $${params.length}`); }
  if (filters.appointmentId) { params.push(filters.appointmentId); where.push(`f.appointment_id = $${params.length}`); }
  if (filters.customerFacing) {
    where.push('COALESCE(p.hidden_from_customer, false) = false');
    where.push("a.status = 'completed'");
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT f.id AS file_id, f.appointment_id, f.customer_id, f.mime_type, f.file_name, f.file_size, f.storage_object_key,
            p.id AS photo_id, p.label, p.caption, COALESCE(p.hidden_from_customer, false) AS hidden_from_customer,
            COALESCE(p.taken_at, f.created_at) AS taken_at,
            a.scheduled_date::text AS scheduled_date, a.status AS appointment_status,
            tu.first_name || ' ' || tu.last_name AS technician_name
     FROM files f
     LEFT JOIN photos p ON p.file_id = f.id
     LEFT JOIN appointments a ON a.id = f.appointment_id
     LEFT JOIN employees te ON te.id = COALESCE(p.taken_by, a.technician_id)
     LEFT JOIN users tu ON tu.id = te.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.scheduled_date DESC NULLS LAST, COALESCE(p.taken_at, f.created_at) ASC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export const serviceMediaService = {
  /** Photos/videos with short-lived viewing links, newest visit first. */
  async list(filters: ListFilters): Promise<ServiceMediaItem[]> {
    const rows = await listRows(filters);
    return Promise.all(rows.map(async (r) => ({
      id: String(r.photo_id ?? r.file_id),
      fileId: String(r.file_id),
      appointmentId: r.appointment_id ? String(r.appointment_id) : null,
      customerId: r.customer_id ? String(r.customer_id) : null,
      kind: mediaKind(String(r.mime_type)),
      mimeType: String(r.mime_type),
      fileName: String(r.file_name),
      fileSize: r.file_size == null ? null : Number(r.file_size),
      label: (MEDIA_LABELS as readonly string[]).includes(String(r.label)) ? (r.label as MediaLabel) : null,
      caption: r.caption ?? null,
      hiddenFromCustomer: Boolean(r.hidden_from_customer),
      takenAt: r.taken_at instanceof Date ? r.taken_at.toISOString() : (r.taken_at ? String(r.taken_at) : null),
      technicianName: r.technician_name ?? null,
      scheduledDate: r.scheduled_date ?? null,
      appointmentStatus: r.appointment_status ?? null,
      url: await storage.getDownloadUrl(String(r.storage_object_key), VIEW_URL_TTL_SECONDS),
    })));
  },

  /** How many photos and videos the customer will be able to see for a visit. */
  async customerVisibleCounts(appointmentId: string) {
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE f.mime_type NOT LIKE 'video/%')::int AS photos,
              count(*) FILTER (WHERE f.mime_type LIKE 'video/%')::int AS videos
       FROM files f LEFT JOIN photos p ON p.file_id = f.id
       WHERE f.appointment_id = $1 AND f.file_type = 'service_photo' AND f.upload_status = 'uploaded' AND f.deleted_at IS NULL
         AND COALESCE(p.hidden_from_customer, false) = false`,
      [appointmentId],
    );
    return { photos: Number(rows[0]?.photos ?? 0), videos: Number(rows[0]?.videos ?? 0) };
  },

  /** Tag a capture (label + caption) right after its upload is confirmed. */
  async tag(fileId: string, data: { label?: MediaLabel | null; caption?: string | null }) {
    await pool.query(
      `UPDATE photos SET label = COALESCE($2, label), caption = COALESCE($3, caption) WHERE file_id = $1`,
      [fileId, data.label ?? null, data.caption ?? null],
    );
  },

  /** Office control: keep a capture on file but keep it off the customer's portal. */
  async setHiddenFromCustomer(fileId: string, hidden: boolean) {
    const { rowCount } = await pool.query(
      `UPDATE photos SET hidden_from_customer = $2 WHERE file_id = $1`,
      [fileId, hidden],
    );
    if (!rowCount) throw ApiError.notFound('Photo not found');
    return { fileId, hiddenFromCustomer: hidden };
  },
};
