import { pool } from '../config/db';
import { paymentService } from '../services/paymentService';
import { notifications } from '../integrations/notifications';
import { logger } from '../utils/logger';
import { communicationService } from '../services/communicationService';

const MAX_AUTOPAY_RETRIES = 3;
const RETRY_DAYS = 3;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * AutoPay job: charge default payment methods for customers with AutoPay
 * enabled and due invoices. Idempotence is per invoice/day.
 */
export async function processAutopay(systemUserId: string) {
  const attemptDate = todayIso();
  const { rows } = await pool.query(
    `SELECT i.id AS invoice_id, i.customer_id, i.autopay_retry_count,
            COALESCE(ap.payment_method_id, pm.id) AS payment_method_id
     FROM invoices i
     JOIN customers c ON c.id = i.customer_id AND c.autopay_enabled = true
     LEFT JOIN autopay_settings ap ON ap.customer_id = c.id AND ap.enabled = true
     LEFT JOIN payment_methods pm ON pm.customer_id = c.id AND pm.is_default = true AND pm.deleted_at IS NULL
     WHERE i.deleted_at IS NULL
       AND i.status IN ('open','sent','past_due')
       AND i.due_date <= CURRENT_DATE
       AND COALESCE(i.next_autopay_retry_date, i.due_date) <= CURRENT_DATE
       AND i.autopay_retry_count < $1
       AND COALESCE(ap.payment_method_id, pm.id) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM payments p
         WHERE p.invoice_id = i.id AND p.payment_source = 'autopay' AND p.autopay_attempt_date = CURRENT_DATE
       )
     ORDER BY i.due_date, i.created_at
     LIMIT 100`,
    [MAX_AUTOPAY_RETRIES],
  );

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      await paymentService.chargeInvoice(row.invoice_id, row.payment_method_id, null, systemUserId, null, {
        source: 'autopay',
        autopayAttemptDate: attemptDate,
        sendFailureCommunication: false,
      });
      succeeded++;
    } catch (err) {
      if ((err as any).statusCode === 409) {
        skipped++;
        continue;
      }
      failed++;
      const nextCount = Number(row.autopay_retry_count ?? 0) + 1;
      const maxed = nextCount >= MAX_AUTOPAY_RETRIES;
      await pool.query(
        `UPDATE invoices
         SET autopay_retry_count = $1,
             last_autopay_attempt_date = CURRENT_DATE,
             next_autopay_retry_date = $2,
             status = CASE WHEN $3 THEN 'past_due' ELSE status END,
             updated_at = now()
         WHERE id = $4`,
        [nextCount, maxed ? null : addDaysIso(RETRY_DAYS), maxed, row.invoice_id],
      );
      await pool.query(
        `UPDATE autopay_settings SET failure_count = failure_count + 1, last_failure_at = now(), updated_at = now()
         WHERE customer_id = $1`,
        [row.customer_id],
      );
      if (maxed) {
        await communicationService.sendInvoiceTemplate(row.invoice_id, 'payment_failed', null, { reason: 'AutoPay failed after maximum retry attempts' });
        await notifications.send({
          customerId: row.customer_id, channel: 'email', type: 'autopay_suspended',
          title: 'AutoPay needs attention',
          body: 'We were unable to process your automatic payment. Please update your payment method.',
        });
      }
      logger.warn({ customerId: row.customer_id, invoiceId: row.invoice_id, err: (err as Error).message }, 'autopay charge failed');
    }
  }
  return { succeeded, failed, skipped, processed: rows.length };
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
