/**
 * Recurring service cadence captured on a signed agreement, and the charge
 * schedule it implies over the agreement term. Pure functions; mirrored in
 * mobile/src/lib/serviceSchedule.ts so the document the customer signs and
 * the server's due-date bookkeeping agree.
 */
export type ServiceFrequency = 'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'quarterly';

export const SERVICE_FREQUENCIES: readonly ServiceFrequency[] = ['weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly'];

export const SERVICE_FREQUENCY_LABELS: Record<ServiceFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  bimonthly: 'Every 2 months',
  quarterly: 'Every 3 months',
};

export const DEFAULT_SERVICE_FREQUENCY: ServiceFrequency = 'monthly';

export function parseServiceFrequency(value: unknown): ServiceFrequency | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  switch (key) {
    case 'weekly': case 'week': case 'everyweek': return 'weekly';
    case 'biweekly': case 'every2weeks': case 'everytwoweeks': case '2weeks': return 'biweekly';
    case 'monthly': case 'month': case 'everymonth': return 'monthly';
    case 'bimonthly': case 'every2months': case 'everytwomonths': case '2months': return 'bimonthly';
    case 'quarterly': case 'every3months': case 'everythreemonths': case '3months': return 'quarterly';
    default: return null;
  }
}

function parseIso(dateIso: string) {
  const [y, m, d] = dateIso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Add months while clamping to the last day of the target month (Jan 31 + 1 month = Feb 28). */
function addMonthsClamped(d: Date, months: number) {
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 12, 0, 0));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12, 0, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/** Days between the initial "flush out" service and the first regular service (egg-cycle follow-up). */
export const FIRST_REGULAR_FOLLOW_UP_DAYS = 30;

/** First regular service date: 30 days after the initial service, regardless of cadence. */
export function firstRegularServiceDate(startIso: string): string {
  const d = parseIso(startIso);
  d.setUTCDate(d.getUTCDate() + FIRST_REGULAR_FOLLOW_UP_DAYS);
  return toIso(d);
}

/** The service date one interval after `dateIso`. */
export function addServiceInterval(dateIso: string, frequency: ServiceFrequency): string {
  const d = parseIso(dateIso);
  switch (frequency) {
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); return toIso(d);
    case 'biweekly': d.setUTCDate(d.getUTCDate() + 14); return toIso(d);
    case 'monthly': return toIso(addMonthsClamped(d, 1));
    case 'bimonthly': return toIso(addMonthsClamped(d, 2));
    case 'quarterly': return toIso(addMonthsClamped(d, 3));
  }
}

/**
 * Next due date after a service is performed/charged: keeps the agreed cadence
 * anchored to `currentDueIso` and always lands after `todayIso`, so a badly
 * overdue plan does not produce a string of already-past dates.
 */
export function advanceDueDate(currentDueIso: string | null, frequency: ServiceFrequency, todayIso: string): string {
  let next = currentDueIso ?? todayIso;
  do {
    next = addServiceInterval(next, frequency);
  } while (next <= todayIso);
  return next;
}

export interface ScheduledCharge {
  date: string;
  amount: number;
  kind: 'initial' | 'regular';
}

export interface ChargeScheduleInput {
  /** Date of the initial service (signing date). */
  startDate: string;
  frequency: ServiceFrequency;
  termMonths: number;
  initialAmount: number;
  recurringAmount: number;
  /** First regular service date; defaults to 30 days after `startDate` (egg-cycle follow-up). */
  firstRegularDate?: string | null;
}

/**
 * Every charge inside the agreement term: the initial service on the start
 * date, the first regular service 30 days later (egg-cycle follow-up), then
 * the recurring amount at each interval until the term ends.
 */
export function buildChargeSchedule(input: ChargeScheduleInput): ScheduledCharge[] {
  const termEnd = toIso(addMonthsClamped(parseIso(input.startDate), Math.max(1, input.termMonths)));
  const out: ScheduledCharge[] = [{ date: input.startDate, amount: round2(input.initialAmount), kind: 'initial' }];
  let cursor = input.firstRegularDate && input.firstRegularDate > input.startDate
    ? input.firstRegularDate
    : firstRegularServiceDate(input.startDate);
  while (cursor < termEnd && out.length < 120) {
    out.push({ date: cursor, amount: round2(input.recurringAmount), kind: 'regular' });
    cursor = addServiceInterval(cursor, input.frequency);
  }
  return out;
}

function round2(n: number) {
  return Number((Number.isFinite(n) ? n : 0).toFixed(2));
}
