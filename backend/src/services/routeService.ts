import { pool, withTransaction } from '../config/db';
import { ApiError } from '../utils/errors';
import { recordAudit } from './auditService';
import { rowsToCamel, toCamel } from './customerService';
import { routeOptimizer, OptimizableStop } from '../integrations/maps/optimizer';

const ROUTE_SELECT = `
  SELECT r.*, u.first_name || ' ' || u.last_name AS technician_name,
         (SELECT count(*)::int FROM route_stops rs WHERE rs.route_id = r.id) AS stop_count,
         (SELECT count(*)::int FROM route_stops rs JOIN appointments a ON a.id = rs.appointment_id
           WHERE rs.route_id = r.id AND a.status = 'completed') AS completed_count
  FROM routes r
  JOIN employees e ON e.id = r.technician_id
  JOIN users u ON u.id = e.user_id`;

async function getStops(routeId: string) {
  const { rows } = await pool.query(
    `SELECT rs.id AS stop_id, rs.stop_order, rs.estimated_arrival, rs.estimated_travel_minutes,
            a.id AS appointment_id, a.status, a.scheduled_date, a.window_start, a.window_end, a.duration_minutes,
            a.customer_id, c.first_name || ' ' || c.last_name AS customer_name, c.company, c.phone,
            sl.address_line1, sl.city, sl.state, sl.postal_code, sl.latitude, sl.longitude, sl.access_notes,
            (SELECT json_agg(json_build_object('name', s.name, 'unitPrice', aps.unit_price, 'quantity', aps.quantity))
             FROM appointment_services aps JOIN services s ON s.id = aps.service_id
             WHERE aps.appointment_id = a.id) AS services,
            (SELECT coalesce(sum(aps.unit_price * aps.quantity), 0) FROM appointment_services aps
             WHERE aps.appointment_id = a.id) AS estimated_total
     FROM route_stops rs
     JOIN appointments a ON a.id = rs.appointment_id
     JOIN customers c ON c.id = a.customer_id
     JOIN service_locations sl ON sl.id = a.service_location_id
     WHERE rs.route_id = $1
     ORDER BY rs.stop_order`,
    [routeId],
  );
  return rowsToCamel(rows);
}

export const routeService = {
  async list(filters: { date?: string; technicianId?: string; from?: string; to?: string }, limit: number, offset: number) {
    const where: string[] = ['r.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.date) { params.push(filters.date); where.push(`r.route_date = $${params.length}`); }
    if (filters.from) { params.push(filters.from); where.push(`r.route_date >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); where.push(`r.route_date <= $${params.length}`); }
    if (filters.technicianId) { params.push(filters.technicianId); where.push(`r.technician_id = $${params.length}`); }
    const whereSql = where.join(' AND ');
    const count = await pool.query(`SELECT count(*)::int AS total FROM routes r WHERE ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `${ROUTE_SELECT} WHERE ${whereSql} ORDER BY r.route_date DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel(rows), total: count.rows[0].total };
  },

  async getById(id: string) {
    const { rows } = await pool.query(`${ROUTE_SELECT} WHERE r.id = $1 AND r.deleted_at IS NULL`, [id]);
    if (!rows[0]) throw ApiError.notFound('Route not found');
    const route = toCamel(rows[0]) as any;
    route.stops = await getStops(id);
    return route;
  },

  /** Create (or fetch) the route for a technician+date. */
  async createOrGet(routeDate: string, technicianId: string, userId: string) {
    const existing = await pool.query(
      'SELECT id FROM routes WHERE route_date = $1 AND technician_id = $2 AND deleted_at IS NULL',
      [routeDate, technicianId],
    );
    if (existing.rows[0]) return this.getById(existing.rows[0].id);

    const emp = await pool.query('SELECT home_base_lat, home_base_lng FROM employees WHERE id = $1', [technicianId]);
    if (!emp.rows[0]) throw ApiError.notFound('Technician not found');
    const { rows } = await pool.query(
      `INSERT INTO routes (route_date, technician_id, start_lat, start_lng)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [routeDate, technicianId, emp.rows[0].home_base_lat, emp.rows[0].home_base_lng],
    );
    await recordAudit({ userId, action: 'route.created', entityType: 'route', entityId: rows[0].id, newValue: { routeDate, technicianId } });
    return this.getById(rows[0].id);
  },

  /** Add an appointment to a route as the last stop. */
  async addStop(routeId: string, appointmentId: string, userId: string) {
    return withTransaction(async (tx) => {
      const route = await tx.query('SELECT * FROM routes WHERE id = $1 AND deleted_at IS NULL', [routeId]);
      if (!route.rows[0]) throw ApiError.notFound('Route not found');
      const appt = await tx.query('SELECT * FROM appointments WHERE id = $1 AND deleted_at IS NULL', [appointmentId]);
      if (!appt.rows[0]) throw ApiError.notFound('Appointment not found');
      if (appt.rows[0].scheduled_date.toISOString().slice(0, 10) !== route.rows[0].route_date.toISOString().slice(0, 10)) {
        throw ApiError.badRequest('Appointment date does not match route date');
      }
      // Keep the appointment's technician in sync with the route.
      await tx.query('UPDATE appointments SET technician_id = $1, updated_at = now() WHERE id = $2', [route.rows[0].technician_id, appointmentId]);
      const orderRes = await tx.query('SELECT coalesce(max(stop_order), 0) + 1 AS next FROM route_stops WHERE route_id = $1', [routeId]);
      const { rows } = await tx.query(
        `INSERT INTO route_stops (route_id, appointment_id, stop_order) VALUES ($1,$2,$3)
         ON CONFLICT (appointment_id) DO UPDATE SET route_id = $1, stop_order = $3, updated_at = now()
         RETURNING *`,
        [routeId, appointmentId, orderRes.rows[0].next],
      );
      await recordAudit({ userId, action: 'route.stop_added', entityType: 'route', entityId: routeId, newValue: { appointmentId } }, tx);
      return toCamel(rows[0]);
    });
  },

  async removeStop(routeId: string, stopId: string, userId: string) {
    const { rowCount } = await pool.query('DELETE FROM route_stops WHERE id = $1 AND route_id = $2', [stopId, routeId]);
    if (!rowCount) throw ApiError.notFound('Stop not found');
    await recordAudit({ userId, action: 'route.stop_removed', entityType: 'route', entityId: routeId, newValue: { stopId } });
  },

  /** Manual reorder of route stops. */
  async reorderStops(routeId: string, orderedStopIds: string[], userId: string) {
    return withTransaction(async (tx) => {
      // two-phase update to avoid transient unique/order collisions
      for (let i = 0; i < orderedStopIds.length; i++) {
        await tx.query('UPDATE route_stops SET stop_order = $1, updated_at = now() WHERE id = $2 AND route_id = $3',
          [1000 + i, orderedStopIds[i], routeId]);
      }
      for (let i = 0; i < orderedStopIds.length; i++) {
        await tx.query('UPDATE route_stops SET stop_order = $1 WHERE id = $2 AND route_id = $3',
          [i + 1, orderedStopIds[i], routeId]);
      }
      await recordAudit({ userId, action: 'route.reordered', entityType: 'route', entityId: routeId }, tx);
      return getStops(routeId);
    });
  },

  /** Optimize the route respecting appointment windows (spec §15). */
  async optimize(routeId: string, userId: string) {
    const route = (await this.getById(routeId)) as any;
    const tech = await pool.query(
      `SELECT e.home_base_lat, e.home_base_lng, e.work_start_time, e.work_end_time FROM employees e WHERE e.id = $1`,
      [route.technicianId],
    );
    const t = tech.rows[0];
    const stops: OptimizableStop[] = (route.stops as any[])
      .filter((s) => s.latitude != null && s.longitude != null && s.status !== 'completed')
      .map((s) => ({
        stopId: s.stopId,
        latitude: Number(s.latitude),
        longitude: Number(s.longitude),
        windowStart: String(s.windowStart).slice(0, 5),
        windowEnd: String(s.windowEnd).slice(0, 5),
        durationMinutes: s.durationMinutes ?? 30,
      }));
    if (stops.length === 0) throw ApiError.badRequest('No optimizable stops (need coordinates and non-completed status)');

    const optimized = await routeOptimizer.optimize(
      {
        latitude: Number(t.home_base_lat ?? stops[0].latitude),
        longitude: Number(t.home_base_lng ?? stops[0].longitude),
        workStart: String(t.work_start_time).slice(0, 5),
        workEnd: String(t.work_end_time).slice(0, 5),
      },
      stops,
    );

    await withTransaction(async (tx) => {
      for (const s of optimized) {
        await tx.query(
          `UPDATE route_stops SET stop_order = $1 + 100, estimated_arrival = $2, estimated_travel_minutes = $3, updated_at = now()
           WHERE id = $4`,
          [s.order, s.estimatedArrival, s.estimatedTravelMinutes, s.stopId],
        );
      }
      await tx.query('UPDATE route_stops SET stop_order = stop_order - 100 WHERE route_id = $1 AND stop_order > 100', [routeId]);
      await tx.query('UPDATE routes SET optimized_at = now(), updated_at = now() WHERE id = $1', [routeId]);
      await recordAudit({ userId, action: 'route.optimized', entityType: 'route', entityId: routeId, newValue: { optimizer: routeOptimizer.name } }, tx);
    });

    return this.getById(routeId);
  },
};
