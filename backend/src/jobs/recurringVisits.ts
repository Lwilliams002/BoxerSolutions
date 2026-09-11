import { pool } from '../config/db';
import { logger } from '../utils/logger';
import { todayIso, toIsoDate } from '../utils/dates';
import { pointInPolygon, LatLng } from '../utils/geo';
import { SERVICE_FREQUENCY_LABELS, parseServiceFrequency, DEFAULT_SERVICE_FREQUENCY, addServiceInterval } from '../utils/serviceSchedule';

/** How far ahead a recurring visit is put on the calendar. */
export const VISIT_HORIZON_DAYS = 7;
export const DEFAULT_VISIT_START = '09:00';
export const DEFAULT_VISIT_MINUTES = 60;

export interface RecurringPlanRow {
  id: string;
  customerId: string;
  nextDueDate: string | null;
  frequency: string;
  assignedTechnicianId: string | null;
  locationId: string | null;
  latitude: number | null;
  longitude: number | null;
  lastVisitStart: string | null;
  hasVisitForDueDate: boolean;
}

export interface TerritoryRow { technicianId: string; polygon: LatLng[] }

export interface PlannedVisit {
  recurringChargeId: string;
  customerId: string;
  locationId: string;
  technicianId: string | null;
  scheduledDate: string;
  windowStart: string;
  windowEnd: string;
  durationMinutes: number;
  notes: string;
}

export function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function daysFromToday(today: string, days: number) {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
  return dt.toISOString().slice(0, 10);
}

/** Technician whose territory contains the pin, if any. */
export function technicianForPoint(point: LatLng | null, territories: TerritoryRow[]): string | null {
  if (!point) return null;
  const hit = territories.find((t) => pointInPolygon(point, t.polygon ?? []));
  return hit?.technicianId ?? null;
}

/**
 * Decide which recurring plans get a visit created this run (pure, for tests):
 * due within the horizon, has a location, and no visit already linked for that date.
 */
export function planRecurringVisits(plans: RecurringPlanRow[], territories: TerritoryRow[], today = todayIso(), opts: { ignoreHorizon?: boolean } = {}): PlannedVisit[] {
  const horizon = daysFromToday(today, VISIT_HORIZON_DAYS);
  const out: PlannedVisit[] = [];
  for (const plan of plans) {
    const due = plan.nextDueDate;
    if (!due || (!opts.ignoreHorizon && due > horizon) || plan.hasVisitForDueDate || !plan.locationId) continue;
    // Overdue plans are scheduled for today rather than in the past.
    const scheduledDate = due < today ? today : due;
    const point = plan.latitude != null && plan.longitude != null ? { latitude: plan.latitude, longitude: plan.longitude } : null;
    const technicianId = plan.assignedTechnicianId ?? technicianForPoint(point, territories);
    const windowStart = plan.lastVisitStart?.slice(0, 5) || DEFAULT_VISIT_START;
    const frequency = parseServiceFrequency(plan.frequency) ?? DEFAULT_SERVICE_FREQUENCY;
    out.push({
      recurringChargeId: plan.id,
      customerId: plan.customerId,
      locationId: plan.locationId,
      technicianId,
      scheduledDate,
      windowStart,
      windowEnd: addMinutes(windowStart, DEFAULT_VISIT_MINUTES),
      durationMinutes: DEFAULT_VISIT_MINUTES,
      notes: `Recurring service · ${SERVICE_FREQUENCY_LABELS[frequency]}`,
    });
  }
  return out;
}

async function loadPlans(today: string, onlyId?: string): Promise<RecurringPlanRow[]> {
  const { rows } = await pool.query(
    `SELECT rc.id, rc.customer_id, rc.next_due_date, rc.frequency, c.assigned_technician_id,
            sl.id AS location_id, sl.latitude, sl.longitude,
            (SELECT a.window_start::text FROM appointments a WHERE a.customer_id = c.id AND a.status = 'completed' AND a.deleted_at IS NULL
               ORDER BY a.scheduled_date DESC LIMIT 1) AS last_visit_start,
            EXISTS (
              SELECT 1 FROM appointments a WHERE a.recurring_charge_id = rc.id AND a.deleted_at IS NULL
                AND a.status <> 'cancelled' AND a.scheduled_date >= $1::date
            ) AS has_visit_for_due_date
     FROM recurring_charges rc
     JOIN customers c ON c.id = rc.customer_id AND c.deleted_at IS NULL AND c.status <> 'inactive'
     LEFT JOIN LATERAL (
       SELECT id, latitude, longitude FROM service_locations
       WHERE customer_id = c.id AND deleted_at IS NULL
       ORDER BY is_primary DESC, (latitude IS NOT NULL) DESC, created_at LIMIT 1
     ) sl ON true
     WHERE rc.active = true AND rc.next_due_date IS NOT NULL AND ($2::uuid IS NULL OR rc.id = $2::uuid)`,
    [today, onlyId ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    nextDueDate: toIsoDate(r.next_due_date),
    frequency: r.frequency,
    assignedTechnicianId: r.assigned_technician_id ?? null,
    locationId: r.location_id ?? null,
    latitude: r.latitude == null ? null : Number(r.latitude),
    longitude: r.longitude == null ? null : Number(r.longitude),
    lastVisitStart: r.last_visit_start ?? null,
    hasVisitForDueDate: !!r.has_visit_for_due_date,
  }));
}

async function loadTerritories(): Promise<TerritoryRow[]> {
  const { rows } = await pool.query('SELECT technician_id, polygon FROM technician_territories');
  return rows.map((r) => ({ technicianId: r.technician_id, polygon: Array.isArray(r.polygon) ? r.polygon : [] }));
}

async function insertVisit(v: PlannedVisit, systemUserId: string) {
  await pool.query(
    `INSERT INTO appointments (customer_id, service_location_id, technician_id, recurring_charge_id,
       scheduled_date, window_start, window_end, duration_minutes, status, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9,$10)`,
    [v.customerId, v.locationId, v.technicianId, v.recurringChargeId, v.scheduledDate, v.windowStart, v.windowEnd, v.durationMinutes, v.notes, systemUserId],
  );
}

/**
 * Build the customer's whole schedule for the agreement term: one visit per
 * interval from the plan's next due date through `months` months. Dates that
 * already have a linked visit are kept as they are (reschedules survive).
 */
export async function buildTermVisits(recurringChargeId: string, systemUserId: string, months = 12) {
  const today = todayIso();
  const [plans, territories] = await Promise.all([loadPlans(today, recurringChargeId), loadTerritories()]);
  const plan = plans[0];
  if (!plan || !plan.nextDueDate || !plan.locationId) return { created: 0, dates: [] as string[] };
  const frequency = parseServiceFrequency(plan.frequency) ?? DEFAULT_SERVICE_FREQUENCY;
  const existing = await pool.query(
    `SELECT scheduled_date::text AS d FROM appointments WHERE recurring_charge_id = $1 AND deleted_at IS NULL AND status <> 'cancelled'`,
    [recurringChargeId],
  );
  const taken = new Set(existing.rows.map((r) => String(r.d).slice(0, 10)));
  const [y, m, d] = today.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months, d, 12)).toISOString().slice(0, 10);
  const base = planRecurringVisits([{ ...plan, hasVisitForDueDate: false }], territories, today, { ignoreHorizon: true })[0];
  const dates: string[] = [];
  let cursor = plan.nextDueDate < today ? today : plan.nextDueDate;
  while (cursor <= end && dates.length < 60) {
    if (!taken.has(cursor) && base) {
      await insertVisit({ ...base, scheduledDate: cursor }, systemUserId);
      dates.push(cursor);
    }
    cursor = addServiceInterval(cursor, frequency);
  }
  return { created: dates.length, dates };
}

/** Drop future, untouched visits of a plan (used before rebuilding after a cadence change). */
export async function cancelFutureVisits(recurringChargeId: string) {
  const { rowCount } = await pool.query(
    `UPDATE appointments SET status = 'cancelled', cancellation_reason = 'Agreement schedule rebuilt', updated_at = now()
     WHERE recurring_charge_id = $1 AND deleted_at IS NULL AND status = 'scheduled' AND scheduled_date > CURRENT_DATE
       AND NOT EXISTS (SELECT 1 FROM route_stops rs WHERE rs.appointment_id = appointments.id)`,
    [recurringChargeId],
  );
  return rowCount ?? 0;
}

/** Job: put upcoming recurring visits on the schedule. */
export async function scheduleRecurringVisits(systemUserId: string) {
  const today = todayIso();
  const [plans, territories] = await Promise.all([loadPlans(today), loadTerritories()]);
  const visits = planRecurringVisits(plans, territories, today);
  let created = 0;
  for (const v of visits) {
    try {
      await pool.query(
        `INSERT INTO appointments (customer_id, service_location_id, technician_id, recurring_charge_id,
           scheduled_date, window_start, window_end, duration_minutes, status, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9,$10)`,
        [v.customerId, v.locationId, v.technicianId, v.recurringChargeId, v.scheduledDate, v.windowStart, v.windowEnd, v.durationMinutes, v.notes, systemUserId],
      );
      created++;
    } catch (err) {
      logger.error({ err, recurringChargeId: v.recurringChargeId }, 'could not create recurring visit');
    }
  }
  if (visits.length) logger.info({ candidates: plans.length, created }, 'recurring visits scheduled');
  return { candidates: plans.length, created };
}
