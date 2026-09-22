/**
 * Late fee policy: an invoice unpaid for `graceDays` after its due date
 * accrues `dailyFee` for every day past that grace period. Pure, so the
 * hourly job and the documents agree on the number.
 */
export interface LateFeePolicy {
  /** Dollars added per day past the grace period; 0 turns the fee off. */
  dailyFee: number;
  /** Days after the due date before the fee starts. */
  graceDays: number;
}

function parseIso(dateIso: string) {
  const [y, m, d] = dateIso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Days billed and the fee amount for an invoice due on `dueDateIso` as of `todayIso`. */
export function computeLateFee(dueDateIso: string, todayIso: string, policy: LateFeePolicy) {
  if (!(policy.dailyFee > 0)) return { days: 0, amount: 0 };
  const daysPastDue = Math.floor((parseIso(todayIso) - parseIso(dueDateIso)) / 86_400_000);
  const days = Math.max(0, daysPastDue - Math.max(0, Math.floor(policy.graceDays)));
  return { days, amount: Math.round(days * policy.dailyFee * 100) / 100 };
}

/** Line-item wording shown on the invoice. */
export function lateFeeDescription(days: number, policy: LateFeePolicy) {
  return `Late fee — $${policy.dailyFee.toFixed(2)}/day after ${policy.graceDays}-day grace period (${days} day${days === 1 ? '' : 's'})`;
}

/** One-line policy statement for invoices and emails. */
export function lateFeePolicyText(policy: LateFeePolicy) {
  if (!(policy.dailyFee > 0)) return '';
  return `Invoices unpaid ${policy.graceDays} days after the due date accrue a $${policy.dailyFee.toFixed(2)} late fee for each additional day until paid.`;
}
