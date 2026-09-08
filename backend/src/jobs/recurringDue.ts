import { pool } from '../config/db';
import { notifications } from '../integrations/notifications';
import { logger } from '../utils/logger';
import { recurringChargeService } from '../services/recurringChargeService';
import { SERVICE_FREQUENCY_LABELS } from '../utils/serviceSchedule';

/** Roles that run the office and should hear when a customer's service is due. */
export const RECURRING_DUE_NOTIFY_ROLES = ['OWNER', 'ADMIN', 'OFFICE_MANAGER'] as const;

export interface DueRecurringRow {
  id: string;
  customerId: string;
  customerName: string;
  amount: number;
  frequency: keyof typeof SERVICE_FREQUENCY_LABELS;
  nextDueDate: string | null;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function longDate(iso: string | null) {
  if (!iso) return 'today';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Notification copy for one due plan (pure, for tests). */
export function buildDueNotification(row: DueRecurringRow) {
  const cadence = SERVICE_FREQUENCY_LABELS[row.frequency]?.toLowerCase() ?? 'recurring';
  return {
    type: 'recurring_service_due',
    title: `Service due: ${row.customerName}`,
    body: `${money(row.amount)} ${cadence} service was due ${longDate(row.nextDueDate)}. Open the customer to schedule and charge it.`,
    data: { recurringChargeId: row.id, customerId: row.customerId, dueDate: row.nextDueDate, amount: row.amount },
  };
}

/**
 * Due-service job: once per due date, tell every office user that a
 * customer's regular service has come around. Charging stays manual.
 */
export async function notifyDueRecurringServices() {
  const due = await recurringChargeService.listDue();
  const pending = due.filter((row) => row.nextDueDate != null);
  if (!pending.length) return { notified: 0, due: 0 };

  const admins = await pool.query(
    `SELECT DISTINCT u.id FROM users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id
     WHERE r.code = ANY($1) AND u.deleted_at IS NULL AND COALESCE(u.is_active, true)`,
    [RECURRING_DUE_NOTIFY_ROLES],
  );
  const adminIds = admins.rows.map((r) => String(r.id));

  let notified = 0;
  for (const row of pending) {
    // Claim this due date first so a second cycle can't double-notify.
    const claimed = await pool.query(
      `UPDATE recurring_charges SET last_notified_due_date = next_due_date, updated_at = now()
       WHERE id = $1 AND active = true AND next_due_date = $2
         AND (last_notified_due_date IS NULL OR last_notified_due_date < next_due_date)`,
      [row.id, row.nextDueDate],
    );
    if (!claimed.rowCount) continue;
    const payload = buildDueNotification(row);
    try {
      if (adminIds.length) {
        for (const userId of adminIds) {
          await notifications.send({ userId, customerId: row.customerId, channel: 'push', ...payload });
        }
      } else {
        await notifications.send({ userId: null, customerId: row.customerId, channel: 'push', ...payload });
      }
      notified++;
    } catch (err) {
      logger.error({ err, recurringChargeId: row.id }, 'due service notification failed');
    }
  }
  logger.info({ due: pending.length, notified }, 'due recurring services job complete');
  return { notified, due: pending.length };
}
