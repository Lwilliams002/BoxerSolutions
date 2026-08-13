import { logger } from '../utils/logger';
import { generateAllRecurringAppointments } from './recurring';
import { processAutopay, sendAppointmentReminders, markPastDueInvoices } from './billing';
import { pool } from '../config/db';

/**
 * Lightweight in-process scheduler for background jobs (spec §40). In AWS
 * these run as EventBridge-scheduled ECS tasks or Lambda functions; locally a
 * simple interval keeps behavior identical without extra infrastructure.
 */
export function startJobScheduler() {
  const run = async () => {
    try {
      const sys = await pool.query(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id WHERE r.code = 'OWNER' LIMIT 1`,
      );
      const systemUserId = sys.rows[0]?.id;
      if (!systemUserId) return;

      const pastDue = await markPastDueInvoices();
      const reminders = await sendAppointmentReminders();
      const recurring = await generateAllRecurringAppointments(systemUserId);
      const autopay = await processAutopay(systemUserId);
      logger.info({ pastDue, reminders, recurring, autopay }, 'background jobs cycle complete');
    } catch (err) {
      logger.error(err, 'background job cycle failed');
    }
  };

  // Hourly cycle; first run 30s after boot so startup isn't blocked.
  setTimeout(run, 30_000);
  setInterval(run, 60 * 60 * 1000);
}
