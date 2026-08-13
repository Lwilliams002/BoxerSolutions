import { pool } from '../config/db';
import { appointmentService } from '../services/appointmentService';
import { logger } from '../utils/logger';

function addInterval(date: Date, frequency: string, intervalDays?: number | null): Date {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'custom': d.setDate(d.getDate() + (intervalDays ?? 30)); break;
  }
  return d;
}

/**
 * Generates future appointments for a subscription up to `horizonDays` ahead
 * (spec §21). Called on-demand from the API and by the daily job. Conflicts
 * with the preferred technician's calendar are allowed here (allowConflict)
 * because office staff review recurring schedules.
 */
export async function generateAppointmentsForSubscription(subscriptionId: string, userId: string, horizonDays = 90): Promise<number> {
  const { rows } = await pool.query(
    `SELECT sub.*, (SELECT json_agg(json_build_object('serviceId', ss.service_id, 'quantity', ss.quantity))
       FROM subscription_services ss WHERE ss.subscription_id = sub.id) AS services
     FROM subscriptions sub WHERE sub.id = $1 AND sub.status = 'active' AND sub.deleted_at IS NULL`,
    [subscriptionId],
  );
  const sub = rows[0];
  if (!sub || !sub.services?.length) return 0;

  const horizon = new Date();
  horizon.setDate(horizon.getDate() + horizonDays);
  let cursor = sub.next_generation_date ? new Date(sub.next_generation_date) : new Date(sub.start_date);
  const endDate = sub.end_date ? new Date(sub.end_date) : null;
  let count = 0;

  while (cursor <= horizon && (!endDate || cursor <= endDate) && count < 60) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const exists = await pool.query(
      'SELECT 1 FROM appointments WHERE subscription_id = $1 AND scheduled_date = $2 AND deleted_at IS NULL',
      [subscriptionId, dateStr],
    );
    if (!exists.rows[0]) {
      await appointmentService.create(
        {
          customerId: sub.customer_id,
          serviceLocationId: sub.service_location_id,
          technicianId: sub.preferred_technician_id,
          scheduledDate: dateStr,
          windowStart: '09:00',
          windowEnd: '12:00',
          serviceIds: sub.services,
          subscriptionId,
          allowConflict: true,
        },
        userId,
      );
      count++;
    }
    cursor = addInterval(cursor, sub.frequency, sub.interval_days);
  }

  await pool.query('UPDATE subscriptions SET next_generation_date = $1, updated_at = now() WHERE id = $2',
    [cursor.toISOString().slice(0, 10), subscriptionId]);
  logger.info({ subscriptionId, count }, 'recurring appointments generated');
  return count;
}

/** Daily job: extend all active subscriptions. */
export async function generateAllRecurringAppointments(systemUserId: string) {
  const { rows } = await pool.query(
    `SELECT id FROM subscriptions WHERE status = 'active' AND deleted_at IS NULL
       AND (next_generation_date IS NULL OR next_generation_date <= CURRENT_DATE + 90)`,
  );
  let total = 0;
  for (const row of rows) {
    total += await generateAppointmentsForSubscription(row.id, systemUserId, 90);
  }
  return total;
}
