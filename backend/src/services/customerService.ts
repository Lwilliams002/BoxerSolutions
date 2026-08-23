import { pool, withTransaction } from '../config/db';
import { ApiError } from '../utils/errors';
import { recordAudit } from './auditService';

function camel(row: Record<string, unknown> | undefined | null) {
  if (!row) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}
export const toCamel = camel;
export const rowsToCamel = (rows: Record<string, unknown>[]) => rows.map((r) => camel(r));

export interface CustomerFilters {
  search?: string;
  status?: string;
  pastDue?: boolean;
  autopay?: boolean;
  scheduledToday?: boolean;
  upcoming?: boolean;
  noAppointment?: boolean;
  technicianId?: string;
  sort?: string;
}

export const customerService = {
  async list(filters: CustomerFilters, page: number, pageSize: number, offset: number) {
    const where: string[] = ['c.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filters.search) {
      params.push(`%${filters.search.toLowerCase()}%`);
      const p = `$${params.length}`;
      where.push(`(
        lower(c.first_name || ' ' || c.last_name) LIKE ${p}
        OR lower(coalesce(c.company,'')) LIKE ${p}
        OR lower(coalesce(c.email,'')) LIKE ${p}
        OR coalesce(c.phone,'') LIKE ${p}
        OR c.customer_number::text LIKE ${p}
        OR EXISTS (
          SELECT 1 FROM service_locations sl WHERE sl.customer_id = c.id AND sl.deleted_at IS NULL
          AND lower(sl.address_line1 || ' ' || sl.city) LIKE ${p}
        )
      )`);
    }
    if (filters.status) {
      params.push(filters.status);
      where.push(`c.status = $${params.length}`);
    }
    if (filters.pastDue) {
      where.push(`EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.deleted_at IS NULL
        AND i.status IN ('open','sent','partially_paid','past_due') AND i.due_date < CURRENT_DATE)`);
    }
    if (filters.autopay) where.push('c.autopay_enabled = true');
    if (filters.scheduledToday) {
      where.push(`EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.id AND a.deleted_at IS NULL
        AND a.scheduled_date = CURRENT_DATE AND a.status NOT IN ('cancelled'))`);
    }
    if (filters.upcoming) {
      where.push(`EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.id AND a.deleted_at IS NULL
        AND a.scheduled_date > CURRENT_DATE AND a.status = 'scheduled')`);
    }
    if (filters.noAppointment) {
      where.push(`NOT EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.id AND a.deleted_at IS NULL
        AND a.scheduled_date >= CURRENT_DATE AND a.status NOT IN ('cancelled'))`);
    }
    if (filters.technicianId) {
      params.push(filters.technicianId);
      where.push(`c.assigned_technician_id = $${params.length}`);
    }

    const sortMap: Record<string, string> = {
      name: 'lower(c.last_name), lower(c.first_name)',
      created: 'c.created_at DESC',
      balance: 'c.balance DESC',
    };
    const orderBy = sortMap[filters.sort ?? 'name'] ?? sortMap.name;

    const whereSql = where.join(' AND ');
    const countRes = await pool.query(`SELECT count(*)::int AS total FROM customers c WHERE ${whereSql}`, params);

    params.push(pageSize, offset);
    const { rows } = await pool.query(
      `SELECT c.id, c.customer_number, c.first_name, c.last_name, c.company, c.email, c.phone,
              c.customer_type, c.status, c.balance, c.autopay_enabled, c.assigned_technician_id,
              (SELECT sl.address_line1 || ', ' || sl.city FROM service_locations sl
                WHERE sl.customer_id = c.id AND sl.deleted_at IS NULL ORDER BY sl.is_primary DESC, sl.created_at LIMIT 1) AS primary_address
             ,(SELECT MAX(a.completed_at)
               FROM appointments a
               WHERE a.customer_id = c.id AND a.deleted_at IS NULL AND a.status = 'completed') AS last_serviced_at
       FROM customers c
       WHERE ${whereSql}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items: rowsToCamel(rows), page, pageSize, total: countRes.rows[0].total };
  },

  async getById(id: string) {
    const { rows } = await pool.query(
      `SELECT c.*,
              (SELECT json_agg(json_build_object(
                 'id', sl.id, 'label', sl.label, 'addressLine1', sl.address_line1, 'addressLine2', sl.address_line2,
                 'city', sl.city, 'state', sl.state, 'postalCode', sl.postal_code,
                 'latitude', sl.latitude, 'longitude', sl.longitude, 'accessNotes', sl.access_notes,
                 'isPrimary', sl.is_primary) ORDER BY sl.is_primary DESC, sl.created_at)
               FROM service_locations sl WHERE sl.customer_id = c.id AND sl.deleted_at IS NULL) AS service_locations,
              (SELECT json_agg(json_build_object(
                 'id', sub.id, 'frequency', sub.frequency, 'status', sub.status,
                 'nextServiceDate', COALESCE(sub.next_service_date, sub.next_generation_date),
                 'preferredTime', sub.preferred_time,
                 'services', (SELECT json_agg(json_build_object('serviceId', ss.service_id, 'name', s.name, 'quantity', ss.quantity) ORDER BY s.name)
                              FROM subscription_services ss JOIN services s ON s.id = ss.service_id WHERE ss.subscription_id = sub.id))
                 ORDER BY sub.status = 'active' DESC, COALESCE(sub.next_service_date, sub.next_generation_date))
               FROM subscriptions sub WHERE sub.customer_id = c.id AND sub.deleted_at IS NULL AND sub.status <> 'cancelled') AS recurring_plans,
              (SELECT e.user_id FROM employees e WHERE e.id = c.assigned_technician_id) AS technician_user_id
       FROM customers c WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [id],
    );
    if (!rows[0]) throw ApiError.notFound('Customer not found');
    return camel(rows[0]);
  },

  async create(data: Record<string, any>, userId: string) {
    return withTransaction(async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO customers (first_name, last_name, company, email, phone, customer_type, status,
           billing_address_line1, billing_address_line2, billing_city, billing_state, billing_postal_code,
           assigned_technician_id, autopay_enabled, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          data.firstName, data.lastName, data.company ?? null, data.email ?? null, data.phone ?? null,
          data.customerType, data.status, data.billingAddressLine1 ?? null, data.billingAddressLine2 ?? null,
          data.billingCity ?? null, data.billingState ?? null, data.billingPostalCode ?? null,
          data.assignedTechnicianId ?? null, data.autopayEnabled, data.notes ?? null, userId,
        ],
      );
      const customer = rows[0];

      if (data.serviceLocation) {
        const l = data.serviceLocation;
        await tx.query(
          `INSERT INTO service_locations (customer_id, label, address_line1, address_line2, city, state, postal_code,
             latitude, longitude, access_notes, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
          [customer.id, l.label, l.addressLine1, l.addressLine2 ?? null, l.city, l.state, l.postalCode,
           l.latitude ?? null, l.longitude ?? null, l.accessNotes ?? null],
        );
      }

      await recordAudit(
        { userId, action: 'customer.created', entityType: 'customer', entityId: customer.id, newValue: { name: `${data.firstName} ${data.lastName}` } },
        tx,
      );
      return camel(customer);
    });
  },

  async update(id: string, data: Record<string, any>, userId: string) {
    const existing = await this.getById(id);
    const fieldMap: Record<string, string> = {
      firstName: 'first_name', lastName: 'last_name', company: 'company', email: 'email', phone: 'phone',
      customerType: 'customer_type', status: 'status',
      billingAddressLine1: 'billing_address_line1', billingAddressLine2: 'billing_address_line2',
      billingCity: 'billing_city', billingState: 'billing_state', billingPostalCode: 'billing_postal_code',
      assignedTechnicianId: 'assigned_technician_id', autopayEnabled: 'autopay_enabled', notes: 'notes',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(fieldMap)) {
      if (k in data) {
        params.push(data[k]);
        sets.push(`${col} = $${params.length}`);
      }
    }
    if (sets.length === 0) return existing;
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE customers SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
      params,
    );
    if (!rows[0]) throw ApiError.notFound('Customer not found');
    await recordAudit({
      userId, action: 'customer.updated', entityType: 'customer', entityId: id,
      previousValue: existing, newValue: data,
    });
    return camel(rows[0]);
  },

  async softDelete(id: string, userId: string) {
    const { rowCount } = await pool.query(
      'UPDATE customers SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    if (!rowCount) throw ApiError.notFound('Customer not found');
    await recordAudit({ userId, action: 'customer.deleted', entityType: 'customer', entityId: id });
  },

  async serviceHistory(customerId: string) {
    const { rows } = await pool.query(
      `SELECT a.id, a.scheduled_date, a.status, a.completed_at,
              json_agg(json_build_object('name', s.name, 'quantity', aps.quantity, 'unitPrice', aps.unit_price)) FILTER (WHERE s.id IS NOT NULL) AS services,
              (SELECT i.invoice_number FROM invoices i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL LIMIT 1) AS invoice_number,
              (SELECT i.status FROM invoices i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL LIMIT 1) AS invoice_status,
              u.first_name || ' ' || u.last_name AS technician_name
       FROM appointments a
       LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
       LEFT JOIN services s ON s.id = aps.service_id
       LEFT JOIN employees e ON e.id = a.technician_id
       LEFT JOIN users u ON u.id = e.user_id
       WHERE a.customer_id = $1 AND a.deleted_at IS NULL AND a.status = 'completed'
       GROUP BY a.id, u.first_name, u.last_name
       ORDER BY a.completed_at DESC NULLS LAST
       LIMIT 100`,
      [customerId],
    );
    return rowsToCamel(rows);
  },
};
