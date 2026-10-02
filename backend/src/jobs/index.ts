import { logger } from '../utils/logger';
import { generateAllRecurringAppointments } from './recurring';
import { processAutopay, sendAppointmentReminders, sendUpcomingVisitNotices, isCustomerEmailHour, markPastDueInvoices } from './billing';
import { lateFeeService } from '../services/lateFeeService';
import { notifyDueRecurringServices } from './recurringDue';
import { geocodePendingLocations } from '../services/geocodingService';
import { scheduleRecurringVisits } from './recurringVisits';
import { routeService } from '../services/routeService';
import { dispatchService } from '../services/dispatchService';
import { todayIso } from '../utils/dates';
import { pool } from '../config/db';

/**
 * Lightweight in-process scheduler for background jobs (spec §40). In AWS
 * these run as EventBridge-scheduled ECS tasks or Lambda functions; locally a
 * simple interval keeps behavior identical without extra infrastructure.
 */
/** Late fees change once a day, so that pass runs on the first cycle of each calendar day only. */
let lastLateFeeDate: string | null = null;

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
      const today = todayIso();
      const lateFees = lastLateFeeDate === today
        ? 'skipped (already ran today)'
        : await lateFeeService.applyLateFees(today).then((r) => { lastLateFeeDate = today; return r; }).catch((err) => { logger.warn({ err }, 'late fee cycle failed'); return null; });
      // Visit emails are real emails now, so they only go out between 8am and 8pm office time.
      const emailHours = isCustomerEmailHour();
      const reminders = emailHours ? await sendAppointmentReminders() : 'outside email hours';
      const visitNotices = emailHours ? await sendUpcomingVisitNotices().catch((err) => { logger.warn({ err }, 'upcoming visit notices failed'); return null; }) : 'outside email hours';
      const recurring = await generateAllRecurringAppointments(systemUserId);
      const autopay = await processAutopay(systemUserId);
      const dueServices = await notifyDueRecurringServices();
      const geocoding = await geocodePendingLocations();
      const recurringVisits = await scheduleRecurringVisits(systemUserId);
      // From 5am local, keep today's routes built from the schedule (idempotent).
      const routeBuild = new Date().getHours() >= 5
        ? await routeService.buildForDate(todayIso(), null, systemUserId).catch((err) => { logger.warn({ err }, 'route build failed'); return null; })
        : null;
      const digest = await dispatchService.dailyDigest().catch((err) => { logger.warn({ err }, 'dispatch digest failed'); return null; });
      logger.info({ pastDue, lateFees, reminders, visitNotices, recurring, autopay, dueServices, geocoding, recurringVisits, routeBuild, digest }, 'background jobs cycle complete');
    } catch (err) {
      logger.error(err, 'background job cycle failed');
    }
  };

  // Hourly cycle; first run 30s after boot so startup isn't blocked.
  setTimeout(run, 30_000);
  setInterval(run, 60 * 60 * 1000);
}
