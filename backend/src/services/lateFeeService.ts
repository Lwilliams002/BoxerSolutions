import { pool, withTransaction } from '../config/db';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { todayIso } from '../utils/dates';
import { getCompanySettings } from './settingsService';
import { computeLateFee, lateFeeDescription, LateFeePolicy } from '../utils/lateFee';
import { recordAudit } from './auditService';
import { communicationService, safelyQueueCommunication } from './communicationService';

/** Invoices that can still accrue a fee. */
const OPEN_STATUSES = ['open', 'sent', 'past_due', 'partially_paid'];

/**
 * Bring one invoice's late fee line up to date for `today`. Adjusts the
 * invoice subtotal/total and the customer's balance by the difference, and
 * drops the cached PDF so the next view regenerates with the fee.
 */
async function syncInvoiceLateFee(invoiceId: string, today: string, policy: LateFeePolicy) {
  return withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, customer_id, due_date::text AS due_date, status, late_fee_days, late_fee_amount, late_fee_waived, late_fee_item_id
       FROM invoices WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [invoiceId],
    );
    const inv = rows[0];
    if (!inv) return null;
    const target = inv.late_fee_waived || !OPEN_STATUSES.includes(String(inv.status))
      ? { days: 0, amount: 0 }
      : computeLateFee(String(inv.due_date).slice(0, 10), today, policy);
    const currentAmount = Number(inv.late_fee_amount ?? 0);
    const currentDays = Number(inv.late_fee_days ?? 0);
    if (target.days === currentDays && Math.abs(target.amount - currentAmount) < 0.005) return null;
    const delta = Math.round((target.amount - currentAmount) * 100) / 100;

    let itemId: string | null = inv.late_fee_item_id ?? null;
    if (target.days > 0) {
      const description = lateFeeDescription(target.days, policy);
      if (itemId) {
        await tx.query(
          `UPDATE invoice_items SET description = $2, quantity = $3, unit_price = $4, line_total = $5 WHERE id = $1`,
          [itemId, description, target.days, policy.dailyFee, target.amount],
        );
      } else {
        const ins = await tx.query(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, discount, taxable, line_total)
           VALUES ($1, $2, $3, $4, 0, false, $5) RETURNING id`,
          [invoiceId, description, target.days, policy.dailyFee, target.amount],
        );
        itemId = ins.rows[0].id as string;
      }
    } else if (itemId) {
      await tx.query('DELETE FROM invoice_items WHERE id = $1', [itemId]);
      itemId = null;
    }
    await tx.query(
      `UPDATE invoices SET subtotal = subtotal + $2, total = total + $2, late_fee_days = $3, late_fee_amount = $4,
         late_fee_item_id = $5, pdf_file_id = NULL, updated_at = now()
       WHERE id = $1`,
      [invoiceId, delta, target.days, target.amount, itemId],
    );
    await tx.query('UPDATE customers SET balance = balance + $1, updated_at = now() WHERE id = $2', [delta, inv.customer_id]);
    // First fee on this invoice: tell the customer once. Re-arms if the fee is
    // later removed (paid down, waived, due date moved) and comes back.
    let notify = false;
    if (target.days > 0 && currentDays === 0) {
      const marked = await tx.query(
        'UPDATE invoices SET late_fee_notified_at = now() WHERE id = $1 AND late_fee_notified_at IS NULL RETURNING id',
        [invoiceId],
      );
      notify = (marked.rowCount ?? 0) > 0;
    } else if (target.days === 0 && currentDays > 0) {
      await tx.query('UPDATE invoices SET late_fee_notified_at = NULL WHERE id = $1', [invoiceId]);
    }
    return { invoiceId, customerId: String(inv.customer_id), days: target.days, amount: target.amount, delta, notify, dueDate: String(inv.due_date).slice(0, 10) };
  });
}

function fmtDueDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function queueLateFeeNotice(res: { invoiceId: string; amount: number; dueDate: string } | null, policy: LateFeePolicy, notify: boolean) {
  if (!res || !notify) return;
  safelyQueueCommunication(() => communicationService.sendInvoiceTemplate(res.invoiceId, 'late_fee_added', null, {
    amount: res.amount,
    dailyFee: policy.dailyFee,
    dueDate: fmtDueDate(res.dueDate),
    reason: `It was due on ${fmtDueDate(res.dueDate)} and a $${policy.dailyFee.toFixed(2)}/day late fee now applies.`,
  }));
}

export const lateFeeService = {
  /** Hourly job: accrue the daily fee on every invoice past its grace period. Idempotent per day. */
  async applyLateFees(today = todayIso()) {
    const settings = await getCompanySettings();
    const policy: LateFeePolicy = { dailyFee: settings.lateFeeDaily, graceDays: settings.lateFeeGraceDays };
    // Candidates: past grace and not yet billed for today, or previously billed but now waived/closed.
    const { rows } = await pool.query(
      `SELECT id FROM invoices
       WHERE deleted_at IS NULL
         AND ((status = ANY($1::text[]) AND late_fee_waived = false AND due_date < CURRENT_DATE - ($2::int))
              OR late_fee_amount > 0)
       ORDER BY due_date`,
      [OPEN_STATUSES, Math.max(0, Math.floor(policy.graceDays))],
    );
    let updated = 0;
    for (const r of rows) {
      try {
        const res = await syncInvoiceLateFee(String(r.id), today, policy);
        if (res) { updated += 1; queueLateFeeNotice(res, policy, res.notify); }
      } catch (err) {
        logger.warn({ err, invoiceId: r.id }, 'late fee update failed');
      }
    }
    return { checked: rows.length, updated };
  },

  /** Office: waive (or reinstate) the late fee on one invoice. */
  async setWaived(invoiceId: string, waived: boolean, userId: string) {
    const { rowCount } = await pool.query(
      'UPDATE invoices SET late_fee_waived = $2, updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [invoiceId, waived],
    );
    if (!rowCount) throw ApiError.notFound('Invoice not found');
    const settings = await getCompanySettings();
    await syncInvoiceLateFee(invoiceId, todayIso(), { dailyFee: settings.lateFeeDaily, graceDays: settings.lateFeeGraceDays });
    await recordAudit({ userId, action: waived ? 'invoice.late_fee_waived' : 'invoice.late_fee_reinstated', entityType: 'invoice', entityId: invoiceId, newValue: { waived } });
    return { invoiceId, waived };
  },
};
