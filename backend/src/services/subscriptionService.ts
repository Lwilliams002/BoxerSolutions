import { PoolClient } from 'pg';
import { pool, withTransaction } from '../config/db';
import { ApiError } from '../utils/errors';
import { recordAudit } from './auditService';
import { rowsToCamel, toCamel } from './customerService';

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'custom';

export interface SubscriptionServiceInput {
  serviceId: string;
  quantity?: number;
  priceOverride?: number | null;
}

export interface SubscriptionCreateInput {
  customerId: string;
  serviceLocationId: string;
  frequency: Frequency;
  intervalDays?: number | null;
  preferredTechnicianId?: string | null;
  preferredTime?: string | null;
  startDate: string;
  endDate?: string | null;
  nextServiceDate?: string | null;
  generateAheadDays?: number;
  services: SubscriptionServiceInput[];
}

export interface SubscriptionUpdateInput {
  serviceLocationId?: string;
  frequency?: Frequency;
  intervalDays?: number | null;
  preferredTechnicianId?: string | null;
  preferredTime?: string | null;
  startDate?: string;
  endDate?: string | null;
  nextServiceDate?: string | null;
  generateAheadDays?: number;
  status?: 'active' | 'paused' | 'cancelled';
  services?: SubscriptionServiceInput[];
}

export function addFrequencyInterval(dateStr: string, frequency: Frequency, intervalDays?: number | null): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  switch (frequency) {
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'biweekly': d.setUTCDate(d.getUTCDate() + 14); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'custom': d.setUTCDate(d.getUTCDate() + (intervalDays ?? 30)); break;
  }
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timePlusMinutes(time: string, minutes: number) {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min((h * 60 + m + Math.max(minutes, 30)), 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const DETAIL_SELECT = `
  SELECT sub.*, c.first_name || ' ' || c.last_name AS customer_name, c.company AS customer_company,
         sl.address_line1, sl.city, sl.state, sl.postal_code,
         tu.first_name || ' ' || tu.last_name AS preferred_technician_name,
         (SELECT json_agg(json_build_object('serviceId', ss.service_id, 'name', s.name, 'quantity', ss.quantity,
             'priceOverride', ss.price_override, 'price', s.price, 'durationMinutes', s.duration_minutes) ORDER BY s.name)
          FROM subscription_services ss JOIN services s ON s.id = ss.service_id WHERE ss.subscription_id = sub.id) AS services,
         (SELECT json_agg(json_build_object('id', a.id, 'scheduledDate', a.scheduled_date, 'windowStart', a.window_start,
             'windowEnd', a.window_end, 'status', a.status, 'technicianName', au.first_name || ' ' || au.last_name)
             ORDER BY a.scheduled_date DESC)
          FROM appointments a
          LEFT JOIN employees ae ON ae.id = a.technician_id
          LEFT JOIN users au ON au.id = ae.user_id
          WHERE a.subscription_id = sub.id AND a.deleted_at IS NULL) AS generated_appointments
  FROM subscriptions sub
  JOIN customers c ON c.id = sub.customer_id
  JOIN service_locations sl ON sl.id = sub.service_location_id
  LEFT JOIN employees te ON te.id = sub.preferred_technician_id
  LEFT JOIN users tu ON tu.id = te.user_id`;

async function replaceServices(tx: PoolClient, subscriptionId: string, services: SubscriptionServiceInput[]) {
  const serviceIds = services.map((s) => s.serviceId);
  const found = await tx.query('SELECT id FROM services WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL', [serviceIds]);
  if (found.rows.length !== serviceIds.length) throw ApiError.badRequest('One or more services not found');
  await tx.query('DELETE FROM subscription_services WHERE subscription_id = $1', [subscriptionId]);
  for (const s of services) {
    await tx.query(
      `INSERT INTO subscription_services (subscription_id, service_id, quantity, price_override) VALUES ($1,$2,$3,$4)`,
      [subscriptionId, s.serviceId, s.quantity ?? 1, s.priceOverride ?? null],
    );
  }
}

export const subscriptionService = {
  async list(filters: { customerId?: string; status?: string }, limit: number, offset: number) {
    const where = ['sub.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.customerId) { params.push(filters.customerId); where.push(`sub.customer_id = $${params.length}`); }
    if (filters.status) { params.push(filters.status); where.push(`sub.status = $${params.length}`); }
    const whereSql = where.join(' AND ');
    const count = await pool.query(`SELECT count(*)::int AS total FROM subscriptions sub WHERE ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `${DETAIL_SELECT} WHERE ${whereSql} ORDER BY sub.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel(rows), total: count.rows[0].total };
  },

  async getById(id: string) {
    const { rows } = await pool.query(`${DETAIL_SELECT} WHERE sub.id = $1 AND sub.deleted_at IS NULL`, [id]);
    if (!rows[0]) throw ApiError.notFound('Subscription not found');
    return toCamel(rows[0]);
  },

  async create(data: SubscriptionCreateInput, userId: string) {
    if (data.frequency === 'custom' && !data.intervalDays) throw ApiError.badRequest('intervalDays is required for custom frequency');
    const sub = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO subscriptions (customer_id, service_location_id, frequency, interval_days, preferred_technician_id,
           preferred_time, start_date, end_date, next_generation_date, next_service_date, generate_ahead_days)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10) RETURNING *`,
        [data.customerId, data.serviceLocationId, data.frequency, data.intervalDays ?? null, data.preferredTechnicianId ?? null,
         data.preferredTime ?? '09:00', data.startDate, data.endDate ?? null, data.nextServiceDate ?? data.startDate,
         data.generateAheadDays ?? 30],
      );
      await replaceServices(tx, rows[0].id, data.services);
      await recordAudit({ userId, action: 'subscription.created', entityType: 'subscription', entityId: rows[0].id, newValue: data }, tx);
      return rows[0];
    });
    return this.getById(sub.id);
  },

  async update(id: string, data: SubscriptionUpdateInput, userId: string) {
    const existing = await this.getById(id);
    if (data.frequency === 'custom' && !data.intervalDays) throw ApiError.badRequest('intervalDays is required for custom frequency');
    await withTransaction(async (tx) => {
      const map: Record<string, string> = {
        serviceLocationId: 'service_location_id', frequency: 'frequency', intervalDays: 'interval_days',
        preferredTechnicianId: 'preferred_technician_id', preferredTime: 'preferred_time', startDate: 'start_date',
        endDate: 'end_date', nextServiceDate: 'next_service_date', generateAheadDays: 'generate_ahead_days', status: 'status',
      };
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const [key, col] of Object.entries(map)) {
        if (key in data) { params.push((data as Record<string, unknown>)[key]); sets.push(`${col} = $${params.length}`); }
      }
      if (sets.length) {
        params.push(id);
        const { rowCount } = await tx.query(
          `UPDATE subscriptions SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} AND deleted_at IS NULL`,
          params,
        );
        if (!rowCount) throw ApiError.notFound('Subscription not found');
      }
      if (data.services) await replaceServices(tx, id, data.services);
      await recordAudit({ userId, action: 'subscription.updated', entityType: 'subscription', entityId: id, previousValue: existing, newValue: data }, tx);
    });
    return this.getById(id);
  },

  async setStatus(id: string, status: 'active' | 'paused' | 'cancelled', userId: string) {
    return this.update(id, { status }, userId);
  },

  async softDelete(id: string, userId: string) {
    const { rowCount } = await pool.query('UPDATE subscriptions SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!rowCount) throw ApiError.notFound('Subscription not found');
    await recordAudit({ userId, action: 'subscription.deleted', entityType: 'subscription', entityId: id });
  },

  async skipNext(id: string, userId: string) {
    const sub = await this.getById(id) as any;
    const today = todayIso();
    const apptRes = await pool.query(
      `SELECT id, scheduled_date FROM appointments
       WHERE subscription_id = $1 AND deleted_at IS NULL AND status NOT IN ('cancelled','completed') AND scheduled_date >= $2
       ORDER BY scheduled_date LIMIT 1`,
      [id, today],
    );
    const occurrenceDate = apptRes.rows[0]?.scheduled_date?.toISOString?.().slice(0, 10) ?? apptRes.rows[0]?.scheduled_date ?? sub.nextServiceDate;
    if (!occurrenceDate) throw ApiError.badRequest('No upcoming service date to skip');
    const advanced = addFrequencyInterval(occurrenceDate, sub.frequency, sub.intervalDays);
    const newNext = sub.nextServiceDate && sub.nextServiceDate > advanced ? sub.nextServiceDate : advanced;

    await withTransaction(async (tx) => {
      if (apptRes.rows[0]) {
        await tx.query(
          `UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Skipped by recurring plan', updated_at = now() WHERE id = $1`,
          [apptRes.rows[0].id],
        );
      }
      await tx.query('UPDATE subscriptions SET next_service_date = $1, next_generation_date = $1, updated_at = now() WHERE id = $2', [newNext, id]);
      await recordAudit({ userId, action: 'subscription.skip_next', entityType: 'subscription', entityId: id, newValue: { skippedDate: occurrenceDate, nextServiceDate: newNext, appointmentId: apptRes.rows[0]?.id ?? null } }, tx);
    });
    return { subscription: await this.getById(id), skippedDate: occurrenceDate, cancelledAppointmentId: apptRes.rows[0]?.id ?? null };
  },
};

export { timePlusMinutes };
