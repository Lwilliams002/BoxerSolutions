import type { Queryable } from '../config/db';
import { logger } from '../utils/logger';
import { todayIso, toIsoDate } from '../utils/dates';
import { advanceDueDate, addServiceInterval, parseServiceFrequency, DEFAULT_SERVICE_FREQUENCY, type ServiceFrequency } from '../utils/serviceSchedule';

/**
 * A fully paid invoice that covers the plan amount counts as the plan's
 * payment for the current cycle, even when the office invoiced by hand or
 * the visit was rescheduled and never marked complete. Rolls the plan's
 * next due date forward so it stops showing as due.
 *
 * Skipped for the initial-agreement invoice and for invoices the plan
 * created itself (those already advance the due date).
 */
export async function markPlanCycleCoveredByInvoice(q: Queryable, invoiceId: string) {
  const inv = (await q.query(
    `SELECT id, customer_id, total, notes, created_at FROM invoices WHERE id = $1 AND deleted_at IS NULL`,
    [invoiceId],
  )).rows[0];
  if (!inv) return [];
  const note = String(inv.notes ?? '');
  if (note === 'Recurring service charge' || note === 'Initial agreement charge') return [];

  const plans = (await q.query(
    `SELECT id, frequency, amount, next_due_date, last_charged_at, created_at
     FROM recurring_charges WHERE customer_id = $1 AND active = true AND next_due_date IS NOT NULL`,
    [inv.customer_id],
  )).rows;
  const advanced: { planId: string; nextDueDate: string }[] = [];
  for (const plan of plans) {
    if (Number(inv.total) + 0.01 < Number(plan.amount)) continue;
    if (new Date(inv.created_at).getTime() <= new Date(plan.created_at).getTime() + 60_000) continue; // signing-time invoice
    const frequency = parseServiceFrequency(plan.frequency) ?? DEFAULT_SERVICE_FREQUENCY;
    const due = toIsoDate(plan.next_due_date);
    if (!due) continue;
    // The cycle this due date belongs to starts one interval earlier; a payment before that belongs to the previous cycle.
    const cycleStart = subtractInterval(due, frequency);
    const invoiceDate = toIsoDate(inv.created_at) ?? todayIso();
    if (invoiceDate < cycleStart) continue;
    if (plan.last_charged_at && (toIsoDate(plan.last_charged_at) ?? '') >= cycleStart) continue; // already covered this cycle
    const nextDueDate = advanceDueDate(due, frequency, invoiceDate > todayIso() ? invoiceDate : todayIso());
    await q.query(
      `UPDATE recurring_charges SET last_charged_invoice_id = $2, last_charged_at = now(), next_due_date = $3, updated_at = now() WHERE id = $1`,
      [plan.id, inv.id, nextDueDate],
    );
    logger.info({ planId: plan.id, invoiceId: inv.id, from: due, to: nextDueDate }, 'recurring plan cycle covered by paid invoice');
    advanced.push({ planId: String(plan.id), nextDueDate });
  }
  return advanced;
}

/** Date one service interval before `dateIso` (walks forward from a year back to stay on the clamped-month cadence). */
function subtractInterval(dateIso: string, frequency: ServiceFrequency) {
  let probe = `${Number(dateIso.slice(0, 4)) - 1}${dateIso.slice(4)}`;
  let prev = probe;
  while (probe < dateIso) { prev = probe; probe = addServiceInterval(probe, frequency); }
  return prev;
}
