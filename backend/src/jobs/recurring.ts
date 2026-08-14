import { pool, withTransaction } from '../config/db';
import { logger } from '../utils/logger';
import { addFrequencyInterval, Frequency, timePlusMinutes } from '../services/subscriptionService';

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Generates scheduled appointments for a subscription through its configured
 * horizon. Idempotence is per subscription/date: existing generated visits are
 * never moved or duplicated, so manual reschedules remain untouched.
 */
export async function generateAppointmentsForSubscription(
  subscriptionId: string,
  userId: string,
  horizonDays?: number,
): Promise<{ generatedAppointments: number; throughDate: string | null; nextServiceDate: string | null }> {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT sub.*, (SELECT json_agg(json_build_object(
           'serviceId', ss.service_id, 'quantity', ss.quantity, 'priceOverride', ss.price_override,
           'price', s.price, 'durationMinutes', s.duration_minutes))
         FROM subscription_services ss JOIN services s ON s.id = ss.service_id WHERE ss.subscription_id = sub.id) AS services
       FROM subscriptions sub
       WHERE sub.id = $1 AND sub.status = 'active' AND sub.deleted_at IS NULL
       FOR UPDATE`,
      [subscriptionId],
    );
    const sub = rows[0];
    if (!sub || !sub.services?.length) return { generatedAppointments: 0, throughDate: null, nextServiceDate: null };

    const today = todayIso();
    const ahead = horizonDays ?? sub.generate_ahead_days ?? 30;
    const horizon = addDays(today, ahead);
    let cursor = toIsoDate(sub.next_service_date) ?? toIsoDate(sub.next_generation_date) ?? toIsoDate(sub.start_date)!;
    const endDate = toIsoDate(sub.end_date);
    const preferredTime = String(sub.preferred_time ?? '09:00').slice(0, 5);
    const totalDuration = (sub.services as Array<{ durationMinutes?: number }>).reduce((sum, s) => sum + (s.durationMinutes ?? 30), 0) || 30;
    const windowEnd = timePlusMinutes(preferredTime, totalDuration);
    let count = 0;
    let lastGeneratedDate: string | null = null;

    while (cursor <= horizon && (!endDate || cursor <= endDate) && count < 90) {
      const exists = await tx.query(
        'SELECT 1 FROM appointments WHERE subscription_id = $1 AND scheduled_date = $2 AND deleted_at IS NULL',
        [subscriptionId, cursor],
      );
      if (!exists.rows[0]) {
        const appt = await tx.query(
          `INSERT INTO appointments (customer_id, service_location_id, technician_id, subscription_id,
             scheduled_date, window_start, window_end, duration_minutes, status, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled','Generated from recurring service plan',$9)
           RETURNING id`,
          [sub.customer_id, sub.service_location_id, sub.preferred_technician_id ?? null, subscriptionId,
           cursor, preferredTime, windowEnd, totalDuration, userId],
        );
        for (const svc of sub.services as Array<{ serviceId: string; quantity?: number; priceOverride?: string | number | null; price: string | number }>) {
          await tx.query(
            `INSERT INTO appointment_services (appointment_id, service_id, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
            [appt.rows[0].id, svc.serviceId, svc.quantity ?? 1, svc.priceOverride ?? svc.price],
          );
        }
        count++;
      }
      lastGeneratedDate = cursor;
      cursor = addFrequencyInterval(cursor, sub.frequency as Frequency, sub.interval_days);
    }

    if (lastGeneratedDate) {
      await tx.query(
        `UPDATE subscriptions
         SET next_service_date = $1, next_generation_date = $1, last_generated_date = $2, updated_at = now()
         WHERE id = $3`,
        [cursor, lastGeneratedDate, subscriptionId],
      );
    }
    logger.info({ subscriptionId, count, horizon }, 'recurring appointments generated');
    return { generatedAppointments: count, throughDate: lastGeneratedDate, nextServiceDate: lastGeneratedDate ? cursor : cursor };
  });
}

/** Scheduler entry point: extend all active subscriptions by each plan's horizon. */
export async function generateAllRecurringAppointments(systemUserId: string) {
  const today = todayIso();
  const { rows } = await pool.query(
    `SELECT id FROM subscriptions
     WHERE status = 'active' AND deleted_at IS NULL
       AND COALESCE(next_service_date, next_generation_date, start_date) <= (CURRENT_DATE + (generate_ahead_days || ' days')::interval)::date
     ORDER BY COALESCE(next_service_date, next_generation_date, start_date)`,
  );
  let total = 0;
  const details = [] as Array<{ subscriptionId: string; generatedAppointments: number }>;
  for (const row of rows) {
    const result = await generateAppointmentsForSubscription(row.id, systemUserId);
    total += result.generatedAppointments;
    details.push({ subscriptionId: row.id, generatedAppointments: result.generatedAppointments });
  }
  logger.info({ today, total, subscriptions: rows.length }, 'recurring generation job complete');
  return { generatedAppointments: total, subscriptionsProcessed: rows.length, details };
}
