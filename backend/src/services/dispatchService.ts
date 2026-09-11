import { pool } from '../config/db';
import { logger } from '../utils/logger';
import { pointInPolygon, LatLng } from '../utils/geo';
import { todayIso, toIsoDate } from '../utils/dates';
import { notifications, getOutboundMessageProvider } from '../integrations/notifications';
import { getCompanyInfo } from './settingsService';
import { config } from '../config';

/** Dispatch helpers: who can take a visit, and telling the office what still needs a technician. */
export interface TechRow { employeeId: string; name: string; workStart: string; workEnd: string }
export interface VisitRow { id: string; customerId: string; customerName: string; assignedTechnicianId: string | null; point: LatLng | null; date: string; windowStart: string; windowEnd: string }
export interface Territory { technicianId: string; polygon: LatLng[] }

export function minutes(hhmm: string) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }
export function hhmm(total: number) { return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }

/** 0 = the customer's own tech, 1 = territory covers the pin, 2 = anyone else. */
export function fitScore(visit: Pick<VisitRow, 'assignedTechnicianId' | 'point'>, techId: string, territories: Territory[]): number {
  if (visit.assignedTechnicianId === techId) return 0;
  if (visit.point && territories.some((t) => t.technicianId === techId && pointInPolygon(visit.point!, t.polygon ?? []))) return 1;
  return 2;
}

/** Gaps of at least `minGap` minutes between booked blocks inside working hours. */
export function freeWindows(blocks: { start: string; end: string }[], workStart: string, workEnd: string, minGap = 30): { start: string; end: string }[] {
  const sorted = blocks.map((b) => ({ s: minutes(b.start), e: minutes(b.end) })).sort((a, b) => a.s - b.s);
  const out: { start: string; end: string }[] = [];
  let cursor = minutes(workStart);
  const end = minutes(workEnd);
  for (const b of sorted) {
    if (b.s - cursor >= minGap) out.push({ start: hhmm(cursor), end: hhmm(Math.min(b.s, end)) });
    cursor = Math.max(cursor, b.e);
  }
  if (end - cursor >= minGap) out.push({ start: hhmm(cursor), end: hhmm(end) });
  return out;
}

export function withinWorkHours(tech: TechRow, windowStart: string, windowEnd: string) {
  return minutes(windowStart) >= minutes(tech.workStart) && minutes(windowEnd) <= minutes(tech.workEnd);
}

/** Order candidate technicians for a visit: fit first, then the lightest day. */
export function rankTechnicians(visit: VisitRow, techs: TechRow[], loadByTech: Record<string, number>, territories: Territory[]) {
  return techs
    .filter((t) => withinWorkHours(t, visit.windowStart, visit.windowEnd))
    .map((t) => ({ tech: t, score: fitScore(visit, t.employeeId, territories), load: loadByTech[t.employeeId] ?? 0 }))
    .sort((a, b) => a.score - b.score || a.load - b.load || a.tech.name.localeCompare(b.tech.name));
}

async function loadTechs(): Promise<TechRow[]> {
  const { rows } = await pool.query(
    `SELECT e.id, u.first_name || ' ' || u.last_name AS name, e.work_start_time::text AS ws, e.work_end_time::text AS we
     FROM employees e JOIN users u ON u.id = e.user_id
     WHERE e.deleted_at IS NULL AND e.is_active AND u.is_active AND u.deleted_at IS NULL ORDER BY name`,
  );
  return rows.map((r) => ({ employeeId: r.id, name: r.name, workStart: String(r.ws ?? '08:00').slice(0, 5), workEnd: String(r.we ?? '17:00').slice(0, 5) }));
}

async function loadTerritories(): Promise<Territory[]> {
  const { rows } = await pool.query('SELECT technician_id, polygon FROM technician_territories');
  return rows.map((r) => ({ technicianId: r.technician_id, polygon: Array.isArray(r.polygon) ? r.polygon : [] }));
}

async function loadUnassigned(from: string, to: string): Promise<VisitRow[]> {
  const { rows } = await pool.query(
    `SELECT a.id, a.customer_id, c.company, c.first_name, c.last_name, c.assigned_technician_id, sl.latitude, sl.longitude,
            a.scheduled_date, a.window_start::text AS ws, a.window_end::text AS we
     FROM appointments a JOIN customers c ON c.id = a.customer_id JOIN service_locations sl ON sl.id = a.service_location_id
     WHERE a.deleted_at IS NULL AND a.status = 'scheduled' AND a.technician_id IS NULL AND a.scheduled_date BETWEEN $1 AND $2
     ORDER BY a.scheduled_date, a.window_start`,
    [from, to],
  );
  return rows.map((r) => ({
    id: r.id, customerId: r.customer_id, customerName: r.company || `${r.first_name} ${r.last_name}`,
    assignedTechnicianId: r.assigned_technician_id, point: r.latitude != null && r.longitude != null ? { latitude: Number(r.latitude), longitude: Number(r.longitude) } : null,
    date: toIsoDate(r.scheduled_date)!, windowStart: String(r.ws).slice(0, 5), windowEnd: String(r.we).slice(0, 5),
  }));
}

export const dispatchService = {
  /** Give every unassigned visit in the range to the best available technician. */
  async autoAssign(from: string, to: string, userId: string) {
    const [visits, techs, territories] = await Promise.all([loadUnassigned(from, to), loadTechs(), loadTerritories()]);
    const assigned: { appointmentId: string; customerName: string; date: string; technicianId: string; technicianName: string; reason: string }[] = [];
    const skipped: { appointmentId: string; customerName: string; date: string; reason: string }[] = [];
    for (const v of visits) {
      const loads = await pool.query(
        `SELECT technician_id, count(*)::int AS n FROM appointments WHERE scheduled_date = $1 AND deleted_at IS NULL AND status NOT IN ('cancelled') AND technician_id IS NOT NULL GROUP BY technician_id`,
        [v.date],
      );
      const loadByTech: Record<string, number> = Object.fromEntries(loads.rows.map((r) => [String(r.technician_id), Number(r.n)]));
      let done = false;
      for (const c of rankTechnicians(v, techs, loadByTech, territories)) {
        const conflict = await pool.query(
          `SELECT 1 FROM appointments WHERE technician_id = $1 AND scheduled_date = $2 AND deleted_at IS NULL AND status NOT IN ('cancelled','completed','no_access')
             AND window_start < $4::time AND window_end > $3::time LIMIT 1`,
          [c.tech.employeeId, v.date, v.windowStart, v.windowEnd],
        );
        if (conflict.rows[0]) continue;
        await pool.query('UPDATE appointments SET technician_id = $1, updated_at = now() WHERE id = $2', [c.tech.employeeId, v.id]);
        assigned.push({ appointmentId: v.id, customerName: v.customerName, date: v.date, technicianId: c.tech.employeeId, technicianName: c.tech.name, reason: c.score === 0 ? "customer's technician" : c.score === 1 ? 'territory' : 'lightest day' });
        done = true;
        break;
      }
      if (!done) skipped.push({ appointmentId: v.id, customerName: v.customerName, date: v.date, reason: techs.length ? 'every technician is busy or off at that time' : 'no active technicians' });
    }
    logger.info({ from, to, assigned: assigned.length, skipped: skipped.length, userId }, 'auto-assign complete');
    return { assigned, skipped };
  },

  /** What the office still has to handle this week. */
  async summary(days = 7) {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM appointments a WHERE a.deleted_at IS NULL AND a.status = 'scheduled' AND a.technician_id IS NULL AND a.scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int) AS unassigned,
         (SELECT count(*)::int FROM recurring_charges rc JOIN customers c ON c.id = rc.customer_id AND c.deleted_at IS NULL AND c.status <> 'inactive'
            WHERE rc.active AND rc.next_due_date IS NOT NULL AND rc.next_due_date <= CURRENT_DATE + $1::int
              AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.recurring_charge_id = rc.id AND a.deleted_at IS NULL AND a.status <> 'cancelled' AND a.scheduled_date >= CURRENT_DATE)) AS due_plans`,
      [days],
    );
    return { unassigned: Number(rows[0].unassigned), duePlans: Number(rows[0].due_plans) };
  },

  /** Tell owners/admins/office managers something needs a technician or a visit. */
  async notifyOffice(title: string, body: string, data: Record<string, unknown> = {}, email = true) {
    const office = await pool.query(
      `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE r.code IN ('OWNER','ADMIN','OFFICE_MANAGER') AND u.deleted_at IS NULL AND u.is_active = true`,
    );
    for (const o of office.rows) {
      await notifications.send({ userId: o.id, channel: 'push', type: 'dispatch', title, body, data });
    }
    if (email) {
      try {
        const company = await getCompanyInfo();
        await getOutboundMessageProvider('email').send({ communicationId: `dispatch-${Date.now()}`, channel: 'email', to: company.email, templateKey: 'dispatch', subject: title, body: `${body}\n\nOpen the app → Schedule to assign technicians.` });
      } catch (err) {
        logger.warn({ err }, 'dispatch email failed');
      }
    }
  },

  /** Daily 7am digest (idempotent per day via the settings table). */
  async dailyDigest() {
    const now = new Date();
    const today = todayIso(now);
    if (now.getHours() < 7) return { sent: false, reason: 'before 7am' };
    const last = await pool.query(`SELECT value->>'dispatchDigestDate' AS d FROM settings WHERE key = 'jobs'`);
    if (last.rows[0]?.d === today) return { sent: false, reason: 'already sent' };
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('jobs', jsonb_build_object('dispatchDigestDate', $1::text), now())
       ON CONFLICT (key) DO UPDATE SET value = settings.value || jsonb_build_object('dispatchDigestDate', $1::text), updated_at = now()`,
      [today],
    );
    const s = await this.summary(7);
    if (!s.unassigned && !s.duePlans) return { sent: false, reason: 'nothing to do' };
    const parts = [];
    if (s.unassigned) parts.push(`${s.unassigned} visit${s.unassigned === 1 ? '' : 's'} in the next 7 days ${s.unassigned === 1 ? 'has' : 'have'} no technician`);
    if (s.duePlans) parts.push(`${s.duePlans} customer${s.duePlans === 1 ? ' is' : 's are'} due with no visit on the calendar`);
    await this.notifyOffice('Scheduling needs attention', parts.join(' · '), { screen: 'schedule', ...s });
    return { sent: true, ...s };
  },
};
