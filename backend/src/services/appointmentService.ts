import { PoolClient } from 'pg';
import { pool, withTransaction } from '../config/db';
import { ApiError } from '../utils/errors';
import { recordAudit } from './auditService';
import { rowsToCamel, toCamel } from './customerService';
import { invoiceService } from './invoiceService';
import { notifications } from '../integrations/notifications';

const VALID_TRANSITIONS: Record<string, string[]> = {
  scheduled: ['en_route', 'arrived', 'in_progress', 'cancelled', 'no_access', 'rescheduled'],
  en_route: ['arrived', 'in_progress', 'cancelled', 'no_access', 'scheduled'],
  arrived: ['in_progress', 'cancelled', 'no_access'],
  in_progress: ['completed', 'cancelled', 'no_access'],
  completed: [],
  cancelled: ['scheduled'],
  no_access: ['scheduled', 'rescheduled'],
  rescheduled: [],
};

const APPOINTMENT_SELECT = `
  SELECT a.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
         c.company AS customer_company, c.phone AS customer_phone, c.balance AS customer_balance,
         c.autopay_enabled AS customer_autopay,
         sl.address_line1, sl.address_line2, sl.city, sl.state, sl.postal_code,
         sl.latitude, sl.longitude, sl.access_notes,
         tu.first_name || ' ' || tu.last_name AS technician_name,
         (SELECT json_agg(json_build_object('id', aps.id, 'serviceId', s.id, 'name', s.name,
            'quantity', aps.quantity, 'unitPrice', aps.unit_price, 'durationMinutes', s.duration_minutes,
            'taxable', s.taxable))
          FROM appointment_services aps JOIN services s ON s.id = aps.service_id
          WHERE aps.appointment_id = a.id) AS services,
         (SELECT i.id FROM invoices i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL LIMIT 1) AS invoice_id
  FROM appointments a
  JOIN customers c ON c.id = a.customer_id
  JOIN service_locations sl ON sl.id = a.service_location_id
  LEFT JOIN employees te ON te.id = a.technician_id
  LEFT JOIN users tu ON tu.id = te.user_id`;

async function detectConflict(
  db: PoolClient | typeof pool,
  technicianId: string,
  date: string,
  windowStart: string,
  windowEnd: string,
  excludeAppointmentId?: string,
) {
  const params: unknown[] = [technicianId, date, windowStart, windowEnd];
  let exclude = '';
  if (excludeAppointmentId) {
    params.push(excludeAppointmentId);
    exclude = `AND a.id <> $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT a.id, a.window_start, a.window_end, c.first_name, c.last_name
     FROM appointments a JOIN customers c ON c.id = a.customer_id
     WHERE a.technician_id = $1 AND a.scheduled_date = $2 AND a.deleted_at IS NULL
       AND a.status NOT IN ('cancelled','rescheduled')
       AND (a.window_start, a.window_end) OVERLAPS ($3::time, $4::time) ${exclude}`,
    params,
  );
  return rows;
}

export const appointmentService = {
  detectConflict: (technicianId: string, date: string, ws: string, we: string, excludeId?: string) =>
    detectConflict(pool, technicianId, date, ws, we, excludeId),

  async list(filters: {
    date?: string; from?: string; to?: string; technicianId?: string; customerId?: string; status?: string;
  }, limit: number, offset: number) {
    const where: string[] = ['a.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.date) { params.push(filters.date); where.push(`a.scheduled_date = $${params.length}`); }
    if (filters.from) { params.push(filters.from); where.push(`a.scheduled_date >= $${params.length}`); }
    if (filters.to) { params.push(filters.to); where.push(`a.scheduled_date <= $${params.length}`); }
    if (filters.technicianId) { params.push(filters.technicianId); where.push(`a.technician_id = $${params.length}`); }
    if (filters.customerId) { params.push(filters.customerId); where.push(`a.customer_id = $${params.length}`); }
    if (filters.status) { params.push(filters.status); where.push(`a.status = $${params.length}`); }
    const whereSql = where.join(' AND ');
    const count = await pool.query(`SELECT count(*)::int AS total FROM appointments a WHERE ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `${APPOINTMENT_SELECT} WHERE ${whereSql}
       ORDER BY a.scheduled_date, a.window_start LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel(rows), total: count.rows[0].total };
  },

  async getById(id: string) {
    const { rows } = await pool.query(`${APPOINTMENT_SELECT} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
    if (!rows[0]) throw ApiError.notFound('Appointment not found');
    return toCamel(rows[0]);
  },

  async create(data: {
    customerId: string; serviceLocationId: string; technicianId?: string | null;
    scheduledDate: string; windowStart: string; windowEnd: string;
    serviceIds: { serviceId: string; quantity?: number }[]; notes?: string | null;
    subscriptionId?: string | null; allowConflict?: boolean;
  }, userId: string) {
    return withTransaction(async (tx) => {
      if (data.technicianId && !data.allowConflict) {
        const conflicts = await detectConflict(tx, data.technicianId, data.scheduledDate, data.windowStart, data.windowEnd);
        if (conflicts.length > 0) {
          throw new ApiError(409, 'Technician has a conflicting appointment in this window', {
            conflicts: rowsToCamel(conflicts),
          });
        }
      }

      const svcRes = await tx.query(
        'SELECT id, price, duration_minutes FROM services WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
        [data.serviceIds.map((s) => s.serviceId)],
      );
      if (svcRes.rows.length !== data.serviceIds.length) throw ApiError.badRequest('One or more services not found');
      const totalDuration = svcRes.rows.reduce((sum: number, s: any) => sum + s.duration_minutes, 0) || 30;

      const { rows } = await tx.query(
        `INSERT INTO appointments (customer_id, service_location_id, technician_id, subscription_id,
           scheduled_date, window_start, window_end, duration_minutes, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [data.customerId, data.serviceLocationId, data.technicianId ?? null, data.subscriptionId ?? null,
         data.scheduledDate, data.windowStart, data.windowEnd, totalDuration, data.notes ?? null, userId],
      );
      const appt = rows[0];

      for (const s of data.serviceIds) {
        const svc = svcRes.rows.find((r: any) => r.id === s.serviceId);
        await tx.query(
          `INSERT INTO appointment_services (appointment_id, service_id, quantity, unit_price) VALUES ($1,$2,$3,$4)`,
          [appt.id, s.serviceId, s.quantity ?? 1, svc.price],
        );
      }

      await recordAudit({ userId, action: 'appointment.created', entityType: 'appointment', entityId: appt.id, newValue: data }, tx);
      return toCamel(appt);
    });
  },

  async reschedule(id: string, data: { scheduledDate: string; windowStart: string; windowEnd: string; technicianId?: string | null; allowConflict?: boolean }, userId: string) {
    const existing = await this.getById(id) as any;
    if (['completed', 'cancelled'].includes(existing.status)) {
      throw ApiError.badRequest(`Cannot reschedule a ${existing.status} appointment`);
    }
    const technicianId = data.technicianId !== undefined ? data.technicianId : existing.technicianId;
    if (technicianId && !data.allowConflict) {
      const conflicts = await detectConflict(pool, technicianId, data.scheduledDate, data.windowStart, data.windowEnd, id);
      if (conflicts.length > 0) {
        throw new ApiError(409, 'Technician has a conflicting appointment in this window', { conflicts: rowsToCamel(conflicts) });
      }
    }
    const { rows } = await pool.query(
      `UPDATE appointments SET scheduled_date = $1, window_start = $2, window_end = $3, technician_id = $4,
         status = 'scheduled', updated_at = now() WHERE id = $5 RETURNING *`,
      [data.scheduledDate, data.windowStart, data.windowEnd, technicianId ?? null, id],
    );
    await recordAudit({
      userId, action: 'appointment.rescheduled', entityType: 'appointment', entityId: id,
      previousValue: { date: existing.scheduledDate, windowStart: existing.windowStart, windowEnd: existing.windowEnd },
      newValue: { date: data.scheduledDate, windowStart: data.windowStart, windowEnd: data.windowEnd },
    });
    await notifications.send({
      customerId: existing.customerId, channel: 'push', type: 'appointment_rescheduled',
      title: 'Appointment rescheduled', body: `Now scheduled for ${data.scheduledDate} ${data.windowStart}`,
    });
    return toCamel(rows[0]);
  },

  async updateStatus(id: string, newStatus: string, userId: string, employeeId?: string | null) {
    const existing = await this.getById(id) as any;
    const allowed = VALID_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw ApiError.badRequest(`Cannot transition from ${existing.status} to ${newStatus}`);
    }
    const timestampCol: Record<string, string> = {
      en_route: 'en_route_at', arrived: 'arrived_at', in_progress: 'started_at', completed: 'completed_at',
    };
    const extra = timestampCol[newStatus] ? `, ${timestampCol[newStatus]} = now()` : '';
    const completedBy = newStatus === 'completed' && employeeId ? ', completed_by = $3' : '';
    const params: unknown[] = [newStatus, id];
    if (completedBy) params.push(employeeId);
    const { rows } = await pool.query(
      `UPDATE appointments SET status = $1${extra}${completedBy}, updated_at = now() WHERE id = $2 RETURNING *`,
      params,
    );
    await recordAudit({
      userId, action: `appointment.status_changed`, entityType: 'appointment', entityId: id,
      previousValue: { status: existing.status }, newValue: { status: newStatus },
    });
    if (newStatus === 'en_route') {
      await notifications.send({
        customerId: existing.customerId, channel: 'sms', type: 'technician_on_the_way',
        title: 'Your technician is on the way', body: `${existing.technicianName ?? 'Your technician'} is heading to your location.`,
      });
    }
    return toCamel(rows[0]);
  },

  /**
   * Complete Appointment — the real operation (spec §51): validates state,
   * records completion time + technician, optionally saves a completion note,
   * generates the invoice inside the same transaction, and returns everything.
   */
  async complete(
    id: string,
    opts: { note?: string | null; generateInvoice?: boolean; taxRate?: number },
    userId: string,
    employeeId: string | null,
  ) {
    const existing = await this.getById(id) as any;
    if (!['in_progress', 'arrived'].includes(existing.status)) {
      throw ApiError.badRequest(`Appointment must be in progress to complete (current: ${existing.status})`);
    }
    if (!existing.services || existing.services.length === 0) {
      throw ApiError.badRequest('Appointment has no services to complete');
    }

    const result = await withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `UPDATE appointments SET status = 'completed', completed_at = now(), completed_by = $1, updated_at = now()
         WHERE id = $2 RETURNING *`,
        [employeeId, id],
      );

      if (opts.note) {
        await tx.query(
          `INSERT INTO notes (customer_id, appointment_id, author_id, body) VALUES ($1, $2, $3, $4)`,
          [existing.customerId, id, userId, opts.note],
        );
      }

      let invoice = null;
      if (opts.generateInvoice !== false) {
        invoice = await invoiceService.createFromAppointment(tx, existing, userId, opts.taxRate ?? 0.0825);
      }

      await recordAudit({
        userId, action: 'appointment.completed', entityType: 'appointment', entityId: id,
        newValue: { completedBy: employeeId, invoiceId: (invoice as any)?.id ?? null },
      }, tx);

      return { appointment: toCamel(rows[0]), invoice };
    });

    await notifications.send({
      customerId: existing.customerId, channel: 'email', type: 'service_completed',
      title: 'Service completed', body: 'Your service visit has been completed. Thank you!',
    });

    return result;
  },

  async cancel(id: string, reason: string | null, userId: string) {
    const existing = await this.getById(id) as any;
    if (existing.status === 'completed') throw ApiError.badRequest('Cannot cancel a completed appointment');
    const { rows } = await pool.query(
      `UPDATE appointments SET status = 'cancelled', cancellation_reason = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [reason, id],
    );
    await recordAudit({
      userId, action: 'appointment.cancelled', entityType: 'appointment', entityId: id,
      previousValue: { status: existing.status }, newValue: { status: 'cancelled', reason },
    });
    return toCamel(rows[0]);
  },
};
