import { pool } from '../config/db';
import { paymentService } from '../services/paymentService';
import { notifications } from '../integrations/notifications';
import { logger } from '../utils/logger';
import { communicationService } from '../services/communicationService';

const MAX_AUTOPAY_RETRIES = 3;

/**
 * AutoPay job: charge default payment methods for customers with autopay
 * enabled and open invoices whose due date has arrived. Failures increment a
 * retry counter; after MAX_AUTOPAY_RETRIES the customer is notified and
 * skipped until office follow-up.
 */
export async function processAutopay(systemUserId: string) {
  const { rows } = await pool.query(
    `SELECT ap.customer_id, ap.payment_method_id, ap.failure_count, i.id AS invoice_id, i.total, i.amount_paid
     FROM autopay_settings ap
     JOIN invoices i ON i.customer_id = ap.customer_id AND i.deleted_at IS NULL
       AND i.status IN ('open','sent','partially_paid','past_due') AND i.due_date <= CURRENT_DATE
     WHERE ap.enabled = true AND ap.payment_method_id IS NOT NULL AND ap.failure_count < $1
     ORDER BY i.due_date`,
    [MAX_AUTOPAY_RETRIES],
  );

  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await paymentService.chargeInvoice(row.invoice_id, row.payment_method_id, null, systemUserId, null);
      succeeded++;
    } catch (err) {
      failed++;
      await pool.query(
        `UPDATE autopay_settings SET failure_count = failure_count + 1, last_failure_at = now(), updated_at = now()
         WHERE customer_id = $1`,
        [row.customer_id],
      );
      const newCount = row.failure_count + 1;
      if (newCount >= MAX_AUTOPAY_RETRIES) {
        await notifications.send({
          customerId: row.customer_id, channel: 'email', type: 'autopay_suspended',
          title: 'AutoPay needs attention',
          body: 'We were unable to process your automatic payment. Please update your payment method.',
        });
      }
      logger.warn({ customerId: row.customer_id, err: (err as Error).message }, 'autopay charge failed');
    }
  }
  return { succeeded, failed };
}

/** Appointment reminder job: notify customers of tomorrow's appointments. */
export async function sendAppointmentReminders() {
  const { rows } = await pool.query(
    `SELECT a.id
     FROM appointments a
     WHERE a.scheduled_date = CURRENT_DATE + 1 AND a.status = 'scheduled' AND a.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM communications cm WHERE cm.appointment_id = a.id
           AND cm.template_key = 'appointment_reminder' AND cm.status IN ('queued','sent')
       )`,
  );
  let sent = 0;
  for (const row of rows) {
    try {
      await communicationService.sendAppointmentTemplate(row.id, 'appointment_reminder', null);
      sent++;
    } catch (err) {
      logger.error({ err, appointmentId: row.id }, 'appointment reminder communication failed');
    }
  }
  return sent;
}

/** Mark overdue invoices past_due. */
export async function markPastDueInvoices() {
  const { rowCount } = await pool.query(
    `UPDATE invoices SET status = 'past_due', updated_at = now()
     WHERE status IN ('open','sent','partially_paid') AND due_date < CURRENT_DATE AND deleted_at IS NULL`,
  );
  return rowCount ?? 0;
}
