import { pool, withTransaction } from '../config/db';
import { ApiError } from '../utils/errors';
import { rowsToCamel, toCamel } from './customerService';
import { recordAudit } from './auditService';

/** Door-knocking outcomes a rep can record on a house. */
export const PROSPECT_STATUSES = ['not_home', 'talked_to', 'call_back', 'not_interested'] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export interface ProspectInput {
  latitude: number;
  longitude: number;
  status: ProspectStatus;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  notes?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  callbackDate?: string | null;
}

const SELECT = `
  SELECT p.*, (u.first_name || ' ' || u.last_name) AS created_by_name, (uu.first_name || ' ' || uu.last_name) AS updated_by_name,
         (c.first_name || ' ' || c.last_name) AS converted_customer_name
  FROM prospects p
  LEFT JOIN users u ON u.id = p.created_by
  LEFT JOIN users uu ON uu.id = p.updated_by
  LEFT JOIN customers c ON c.id = p.converted_customer_id`;

/** Roughly 40 meters: close enough to call it the same house. */
const SAME_HOUSE_DEGREES = 0.00036;

export const prospectService = {
  /** Every live pin (not deleted, not yet a customer) for the map. */
  async list() {
    const { rows } = await pool.query(`${SELECT} WHERE p.deleted_at IS NULL AND p.converted_customer_id IS NULL ORDER BY p.updated_at DESC`);
    return rowsToCamel(rows);
  },

  async getById(id: string) {
    const { rows } = await pool.query(`${SELECT} WHERE p.id = $1 AND p.deleted_at IS NULL`, [id]);
    if (!rows[0]) throw ApiError.notFound('Pin not found');
    const events = await pool.query(
      `SELECT e.*, (u.first_name || ' ' || u.last_name) AS created_by_name FROM prospect_events e LEFT JOIN users u ON u.id = e.created_by
       WHERE e.prospect_id = $1 ORDER BY e.created_at DESC LIMIT 30`,
      [id],
    );
    return { ...toCamel(rows[0]), events: rowsToCamel(events.rows) };
  },

  /** Call-backs due today or earlier (and anything knocked with a call-back in the next `daysAhead` days). */
  async callbacksDue(daysAhead = 0) {
    const { rows } = await pool.query(
      `${SELECT} WHERE p.deleted_at IS NULL AND p.converted_customer_id IS NULL AND p.status = 'call_back'
         AND p.callback_date IS NOT NULL AND p.callback_date <= CURRENT_DATE + $1::int
       ORDER BY p.callback_date, p.updated_at`,
      [daysAhead],
    );
    return rowsToCamel(rows);
  },

  /** Drop a pin. If a live pin already sits on this house, record the knock on it instead of making a duplicate. */
  async create(input: ProspectInput, userId: string) {
    const existing = await pool.query(
      `SELECT id FROM prospects WHERE deleted_at IS NULL AND converted_customer_id IS NULL
         AND abs(latitude - $1) < $3 AND abs(longitude - $2) < $3 ORDER BY updated_at DESC LIMIT 1`,
      [input.latitude, input.longitude, SAME_HOUSE_DEGREES],
    );
    if (existing.rows[0]) return this.update(String(existing.rows[0].id), input, userId);
    const id = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO prospects (address_line1, city, state, postal_code, latitude, longitude, status, notes, contact_name, contact_phone, callback_date, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING id`,
        [input.addressLine1 ?? null, input.city ?? null, input.state ?? null, input.postalCode ?? null, input.latitude, input.longitude,
         input.status, input.notes ?? null, input.contactName ?? null, input.contactPhone ?? null, input.status === 'call_back' ? input.callbackDate ?? null : null, userId],
      );
      const id = String(rows[0].id);
      await tx.query('INSERT INTO prospect_events (prospect_id, status, note, callback_date, created_by) VALUES ($1,$2,$3,$4,$5)',
        [id, input.status, input.notes ?? null, input.status === 'call_back' ? input.callbackDate ?? null : null, userId]);
      await recordAudit({ userId, action: 'prospect.created', entityType: 'prospect', entityId: id, newValue: input }, tx);
      return id;
    });
    return this.getById(id);
  },

  /** Record another knock: new status, note and call-back date. Address and contact fields update when given. */
  async update(id: string, input: Partial<ProspectInput> & { status: ProspectStatus }, userId: string) {
    await withTransaction(async (tx) => {
      const current = await tx.query('SELECT id FROM prospects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
      if (!current.rows[0]) throw ApiError.notFound('Pin not found');
      const callback = input.status === 'call_back' ? input.callbackDate ?? null : null;
      await tx.query(
        `UPDATE prospects SET status = $2, notes = COALESCE($3, notes), callback_date = $4,
           address_line1 = COALESCE($5, address_line1), city = COALESCE($6, city), state = COALESCE($7, state), postal_code = COALESCE($8, postal_code),
           contact_name = COALESCE($9, contact_name), contact_phone = COALESCE($10, contact_phone),
           knock_count = knock_count + 1, last_knocked_at = now(), updated_by = $11, updated_at = now()
         WHERE id = $1`,
        [id, input.status, input.notes ?? null, callback, input.addressLine1 ?? null, input.city ?? null, input.state ?? null, input.postalCode ?? null,
         input.contactName ?? null, input.contactPhone ?? null, userId],
      );
      await tx.query('INSERT INTO prospect_events (prospect_id, status, note, callback_date, created_by) VALUES ($1,$2,$3,$4,$5)',
        [id, input.status, input.notes ?? null, callback, userId]);
    });
    return this.getById(id);
  },

  async remove(id: string, userId: string) {
    const { rowCount } = await pool.query('UPDATE prospects SET deleted_at = now(), updated_by = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL', [id, userId]);
    if (!rowCount) throw ApiError.notFound('Pin not found');
    await recordAudit({ userId, action: 'prospect.deleted', entityType: 'prospect', entityId: id });
  },

  /** A customer was created at this spot: the pin turns into that customer. */
  async markConvertedNear(customerId: string, latitude: number, longitude: number, userId: string | null) {
    const { rows } = await pool.query(
      `UPDATE prospects SET converted_customer_id = $1, updated_by = COALESCE($4, updated_by), updated_at = now()
       WHERE deleted_at IS NULL AND converted_customer_id IS NULL AND abs(latitude - $2) < $5 AND abs(longitude - $3) < $5
       RETURNING id`,
      [customerId, latitude, longitude, userId, SAME_HOUSE_DEGREES],
    );
    for (const r of rows) {
      await pool.query('INSERT INTO prospect_events (prospect_id, status, note, created_by) VALUES ($1, $2, $3, $4)', [r.id, 'converted', 'Became a customer', userId]);
    }
    return rows.length;
  },

  async markConverted(id: string, customerId: string, userId: string) {
    const { rowCount } = await pool.query(
      'UPDATE prospects SET converted_customer_id = $2, updated_by = $3, updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [id, customerId, userId],
    );
    if (!rowCount) throw ApiError.notFound('Pin not found');
    await pool.query('INSERT INTO prospect_events (prospect_id, status, note, created_by) VALUES ($1, $2, $3, $4)', [id, 'converted', 'Became a customer', userId]);
    return this.getById(id);
  },
};
