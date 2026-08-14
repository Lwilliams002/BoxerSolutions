import { pool } from '../config/db';

export interface ReportFilters {
  from: string;
  to: string;
  technicianId?: string;
}

const OPEN_INVOICE_STATUSES = `'open','sent','partially_paid','past_due'`;

function numberValue(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '');
}

function addTechnicianFilter(params: unknown[], technicianId?: string) {
  if (!technicianId) return { clause: '', params };
  params.push(technicianId);
  return { clause: `AND COALESCE(i.technician_id, a.technician_id) = $${params.length}`, params };
}

export const reportService = {
  async revenue(filters: ReportFilters) {
    const baseParams: unknown[] = [filters.from, filters.to];
    const { clause: techClause, params } = addTechnicianFilter(baseParams, filters.technicianId);
    const { rows } = await pool.query(
      `WITH days AS (
         SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
       ), invoice_daily AS (
         SELECT i.invoice_date AS day, COALESCE(SUM(i.total), 0) AS invoiced
         FROM invoices i
         LEFT JOIN appointments a ON a.id = i.appointment_id
         WHERE i.deleted_at IS NULL AND i.status <> 'void' AND i.invoice_date BETWEEN $1::date AND $2::date ${techClause}
         GROUP BY i.invoice_date
       ), payment_daily AS (
         SELECT p.processed_at::date AS day, COALESCE(SUM(p.amount), 0) AS collected
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN appointments a ON a.id = COALESCE(i.appointment_id, NULL)
         WHERE p.status = 'succeeded' AND p.payment_source <> 'refund' AND p.amount > 0
           AND p.processed_at::date BETWEEN $1::date AND $2::date ${techClause}
         GROUP BY p.processed_at::date
       ), refund_daily AS (
         SELECT p.processed_at::date AS day, COALESCE(SUM(ABS(p.amount)), 0) AS refunded
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         LEFT JOIN appointments a ON a.id = COALESCE(i.appointment_id, NULL)
         WHERE p.status = 'succeeded' AND (p.payment_source = 'refund' OR p.amount < 0)
           AND p.processed_at::date BETWEEN $1::date AND $2::date ${techClause}
         GROUP BY p.processed_at::date
       ), outstanding AS (
         SELECT COALESCE(SUM(i.total - i.amount_paid), 0) AS total
         FROM invoices i
         LEFT JOIN appointments a ON a.id = i.appointment_id
         WHERE i.deleted_at IS NULL AND i.status IN (${OPEN_INVOICE_STATUSES}) ${techClause}
       )
       SELECT
         COALESCE((SELECT SUM(invoiced) FROM invoice_daily), 0) AS total_invoiced,
         COALESCE((SELECT SUM(collected) FROM payment_daily), 0) AS total_collected,
         COALESCE((SELECT SUM(refunded) FROM refund_daily), 0) AS total_refunded,
         (SELECT total FROM outstanding) AS outstanding,
         COALESCE(json_agg(json_build_object(
           'date', days.day::text,
           'invoiced', COALESCE(invoice_daily.invoiced, 0),
           'collected', COALESCE(payment_daily.collected, 0)
         ) ORDER BY days.day), '[]'::json) AS series
       FROM days
       LEFT JOIN invoice_daily ON invoice_daily.day = days.day
       LEFT JOIN payment_daily ON payment_daily.day = days.day`,
      params,
    );
    const row = rows[0];
    return {
      from: filters.from,
      to: filters.to,
      totalInvoiced: numberValue(row.total_invoiced),
      totalCollected: numberValue(row.total_collected),
      totalRefunded: numberValue(row.total_refunded),
      outstanding: numberValue(row.outstanding),
      series: (row.series ?? []).map((r: any) => ({ date: dateValue(r.date), invoiced: numberValue(r.invoiced), collected: numberValue(r.collected) })),
    };
  },

  async technicianPerformance(filters: ReportFilters) {
    const params: unknown[] = [filters.from, filters.to];
    let techWhere = '';
    if (filters.technicianId) {
      params.push(filters.technicianId);
      techWhere = `AND e.id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `WITH appt_stats AS (
         SELECT a.technician_id,
                COUNT(*) FILTER (WHERE a.status = 'completed')::int AS completed_appointments,
                COUNT(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled_appointments,
                COUNT(*) FILTER (WHERE a.status IN ('completed','cancelled'))::int AS decided_appointments
         FROM appointments a
         WHERE a.deleted_at IS NULL AND a.technician_id IS NOT NULL AND a.scheduled_date BETWEEN $1::date AND $2::date
         GROUP BY a.technician_id
       ), revenue_stats AS (
         SELECT COALESCE(i.technician_id, a.technician_id) AS technician_id,
                COALESCE(SUM(p.amount), 0) AS collected
         FROM payments p
         JOIN invoices i ON i.id = p.invoice_id AND i.deleted_at IS NULL
         LEFT JOIN appointments a ON a.id = i.appointment_id
         WHERE p.status = 'succeeded' AND p.payment_source <> 'refund' AND p.amount > 0
           AND p.processed_at::date BETWEEN $1::date AND $2::date
         GROUP BY COALESCE(i.technician_id, a.technician_id)
       )
       SELECT e.id AS technician_id,
              u.first_name || ' ' || u.last_name AS technician_name,
              COALESCE(appt_stats.completed_appointments, 0)::int AS completed_appointments,
              COALESCE(appt_stats.cancelled_appointments, 0)::int AS cancelled_appointments,
              CASE WHEN COALESCE(appt_stats.decided_appointments, 0) = 0 THEN 0
                   ELSE ROUND((appt_stats.completed_appointments::numeric / appt_stats.decided_appointments::numeric) * 100, 1)
              END AS completion_rate,
              COALESCE(revenue_stats.collected, 0) AS revenue_collected,
              CASE WHEN COALESCE(appt_stats.completed_appointments, 0) = 0 THEN 0
                   ELSE ROUND(COALESCE(revenue_stats.collected, 0) / appt_stats.completed_appointments, 2)
              END AS avg_per_job
       FROM employees e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN appt_stats ON appt_stats.technician_id = e.id
       LEFT JOIN revenue_stats ON revenue_stats.technician_id = e.id
       WHERE e.deleted_at IS NULL AND e.is_active AND u.is_active ${techWhere}
       ORDER BY revenue_collected DESC, completed_appointments DESC, technician_name`,
      params,
    );
    return {
      from: filters.from,
      to: filters.to,
      technicians: rows.map((r) => ({
        technicianId: r.technician_id,
        technicianName: r.technician_name,
        completedAppointments: numberValue(r.completed_appointments),
        cancelledAppointments: numberValue(r.cancelled_appointments),
        completionRate: numberValue(r.completion_rate),
        revenueCollected: numberValue(r.revenue_collected),
        avgPerJob: numberValue(r.avg_per_job),
      })),
    };
  },

  async appointments(filters: ReportFilters) {
    const params: unknown[] = [filters.from, filters.to];
    let techClause = '';
    if (filters.technicianId) {
      params.push(filters.technicianId);
      techClause = `AND technician_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `WITH days AS (
         SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
       ), status_counts AS (
         SELECT status, COUNT(*)::int AS count
         FROM appointments
         WHERE deleted_at IS NULL AND scheduled_date BETWEEN $1::date AND $2::date ${techClause}
         GROUP BY status
       ), daily AS (
         SELECT scheduled_date AS day,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
         FROM appointments
         WHERE deleted_at IS NULL AND scheduled_date BETWEEN $1::date AND $2::date ${techClause}
         GROUP BY scheduled_date
       )
       SELECT
         COALESCE((SELECT json_agg(json_build_object('status', status, 'count', count) ORDER BY status) FROM status_counts), '[]'::json) AS status_counts,
         COALESCE(json_agg(json_build_object(
           'date', days.day::text,
           'completed', COALESCE(daily.completed, 0),
           'cancelled', COALESCE(daily.cancelled, 0)
         ) ORDER BY days.day), '[]'::json) AS series
       FROM days
       LEFT JOIN daily ON daily.day = days.day`,
      params,
    );
    const row = rows[0];
    return {
      from: filters.from,
      to: filters.to,
      statusCounts: (row.status_counts ?? []).map((r: any) => ({ status: String(r.status), count: numberValue(r.count) })),
      series: (row.series ?? []).map((r: any) => ({ date: dateValue(r.date), completed: numberValue(r.completed), cancelled: numberValue(r.cancelled) })),
    };
  },

  async arAging() {
    const { rows } = await pool.query(
      `WITH open_invoices AS (
         SELECT i.*, GREATEST((CURRENT_DATE - i.due_date), 0) AS days_past_due, (i.total - i.amount_paid) AS balance
         FROM invoices i
         WHERE i.deleted_at IS NULL AND i.status IN (${OPEN_INVOICE_STATUSES}) AND (i.total - i.amount_paid) > 0
       ), buckets AS (
         SELECT
           COALESCE(SUM(balance) FILTER (WHERE days_past_due = 0), 0) AS current,
           COALESCE(SUM(balance) FILTER (WHERE days_past_due BETWEEN 1 AND 30), 0) AS one_to_thirty,
           COALESCE(SUM(balance) FILTER (WHERE days_past_due BETWEEN 31 AND 60), 0) AS thirty_one_to_sixty,
           COALESCE(SUM(balance) FILTER (WHERE days_past_due BETWEEN 61 AND 90), 0) AS sixty_one_to_ninety,
           COALESCE(SUM(balance) FILTER (WHERE days_past_due > 90), 0) AS over_ninety,
           COALESCE(SUM(balance), 0) AS total
         FROM open_invoices
       ), top_balances AS (
         SELECT c.id AS customer_id,
                COALESCE(c.company, c.first_name || ' ' || c.last_name) AS customer_name,
                SUM(open_invoices.balance) AS balance,
                MIN(open_invoices.due_date)::text AS oldest_due_date,
                COUNT(open_invoices.id)::int AS invoice_count
         FROM open_invoices
         JOIN customers c ON c.id = open_invoices.customer_id AND c.deleted_at IS NULL
         GROUP BY c.id
         ORDER BY balance DESC
         LIMIT 10
       )
       SELECT buckets.*,
              COALESCE((SELECT json_agg(json_build_object(
                'customerId', customer_id,
                'customerName', customer_name,
                'balance', balance,
                'oldestDueDate', oldest_due_date,
                'invoiceCount', invoice_count
              ) ORDER BY balance DESC) FROM top_balances), '[]'::json) AS top_balances
       FROM buckets`,
    );
    const row = rows[0];
    return {
      buckets: {
        current: numberValue(row.current),
        oneToThirty: numberValue(row.one_to_thirty),
        thirtyOneToSixty: numberValue(row.thirty_one_to_sixty),
        sixtyOneToNinety: numberValue(row.sixty_one_to_ninety),
        overNinety: numberValue(row.over_ninety),
        total: numberValue(row.total),
      },
      topBalances: (row.top_balances ?? []).map((r: any) => ({
        customerId: String(r.customerId),
        customerName: String(r.customerName),
        balance: numberValue(r.balance),
        oldestDueDate: dateValue(r.oldestDueDate),
        invoiceCount: numberValue(r.invoiceCount),
      })),
    };
  },

  async recurring(filters: ReportFilters) {
    const params: unknown[] = [];
    let subTechClause = '';
    let apptTechClause = '';
    if (filters.technicianId) {
      params.push(filters.technicianId);
      subTechClause = `AND s.preferred_technician_id = $${params.length}`;
      apptTechClause = `AND a.technician_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `WITH filtered_subs AS (
         SELECT s.*
         FROM subscriptions s
         WHERE s.deleted_at IS NULL ${subTechClause}
       ), status_counts AS (
         SELECT status, COUNT(*)::int AS count
         FROM filtered_subs
         GROUP BY status
       ), monthly_prices AS (
         SELECT fs.id,
                SUM(COALESCE(ss.price_override, svc.price) * ss.quantity) *
                CASE fs.frequency
                  WHEN 'weekly' THEN 52.0 / 12.0
                  WHEN 'biweekly' THEN 26.0 / 12.0
                  WHEN 'monthly' THEN 1.0
                  WHEN 'quarterly' THEN 1.0 / 3.0
                  WHEN 'custom' THEN CASE WHEN COALESCE(fs.interval_days, 0) > 0 THEN 30.4375 / fs.interval_days ELSE 1.0 END
                  ELSE 1.0
                END AS monthly_amount
         FROM filtered_subs fs
         JOIN subscription_services ss ON ss.subscription_id = fs.id
         JOIN services svc ON svc.id = ss.service_id AND svc.deleted_at IS NULL
         WHERE fs.status = 'active'
         GROUP BY fs.id, fs.frequency, fs.interval_days
       ), upcoming AS (
         SELECT COUNT(*)::int AS count
         FROM appointments a
         WHERE a.deleted_at IS NULL AND a.subscription_id IS NOT NULL
           AND a.scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
           AND a.status <> 'cancelled' ${apptTechClause}
       )
       SELECT COALESCE((SELECT json_agg(json_build_object('status', status, 'count', count) ORDER BY status) FROM status_counts), '[]'::json) AS status_counts,
              COALESCE((SELECT SUM(monthly_amount) FROM monthly_prices), 0) AS mrr_estimate,
              COALESCE((SELECT count FROM upcoming), 0) AS upcoming_appointment_count`,
      params,
    );
    const row = rows[0];
    const statusCounts = (row.status_counts ?? []).map((r: any) => ({ status: String(r.status), count: numberValue(r.count) }));
    return {
      statusCounts,
      active: statusCounts.find((s: { status: string }) => s.status === 'active')?.count ?? 0,
      paused: statusCounts.find((s: { status: string }) => s.status === 'paused')?.count ?? 0,
      cancelled: statusCounts.find((s: { status: string }) => s.status === 'cancelled')?.count ?? 0,
      mrrEstimate: numberValue(row.mrr_estimate),
      upcomingAppointmentCount: numberValue(row.upcoming_appointment_count),
    };
  },

  async customerGrowth(filters: ReportFilters) {
    const { rows } = await pool.query(
      `WITH weeks AS (
         SELECT generate_series(date_trunc('week', $1::date)::date, date_trunc('week', $2::date)::date, interval '1 week')::date AS week
       ), weekly AS (
         SELECT date_trunc('week', created_at)::date AS week, COUNT(*)::int AS new_customers
         FROM customers
         WHERE deleted_at IS NULL AND created_at::date BETWEEN $1::date AND $2::date
         GROUP BY 1
       ), totals AS (
         SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive,
                COUNT(*) FILTER (WHERE created_at::date BETWEEN $1::date AND $2::date)::int AS new_this_period
         FROM customers
         WHERE deleted_at IS NULL
       )
       SELECT totals.active, totals.inactive, totals.new_this_period,
              COALESCE(json_agg(json_build_object('week', weeks.week::text, 'newCustomers', COALESCE(weekly.new_customers, 0)) ORDER BY weeks.week), '[]'::json) AS series
       FROM totals
       CROSS JOIN weeks
       LEFT JOIN weekly ON weekly.week = weeks.week
       GROUP BY totals.active, totals.inactive, totals.new_this_period`,
      [filters.from, filters.to],
    );
    const row = rows[0];
    return {
      from: filters.from,
      to: filters.to,
      active: numberValue(row.active),
      inactive: numberValue(row.inactive),
      newThisPeriod: numberValue(row.new_this_period),
      series: (row.series ?? []).map((r: any) => ({ week: dateValue(r.week), newCustomers: numberValue(r.newCustomers) })),
    };
  },

  async outstanding() {
    const { rows } = await pool.query(
      `SELECT c.id AS customer_id,
              c.first_name || ' ' || c.last_name AS customer_name,
              c.company,
              COALESCE(SUM(i.total - i.amount_paid), 0) AS outstanding,
              MIN(i.due_date)::text AS oldest_due_date,
              COUNT(i.id)::int AS open_invoices
       FROM customers c
       JOIN invoices i ON i.customer_id = c.id AND i.deleted_at IS NULL
         AND i.status IN (${OPEN_INVOICE_STATUSES})
       WHERE c.deleted_at IS NULL
       GROUP BY c.id
       ORDER BY outstanding DESC
       LIMIT 100`,
    );
    return rows.map((r) => ({
      customerId: r.customer_id,
      customerName: r.customer_name,
      company: r.company,
      outstanding: numberValue(r.outstanding),
      oldestDueDate: dateValue(r.oldest_due_date),
      openInvoices: numberValue(r.open_invoices),
    }));
  },

  async serviceRevenue(filters: ReportFilters) {
    const { rows } = await pool.query(
      `SELECT s.id AS service_id,
              s.name,
              COALESCE(SUM(ii.line_total), 0) AS revenue,
              COUNT(DISTINCT ii.invoice_id)::int AS invoice_count
       FROM services s
       JOIN invoice_items ii ON ii.service_id = s.id
       JOIN invoices i ON i.id = ii.invoice_id
        AND i.invoice_date BETWEEN $1::date AND $2::date
        AND i.deleted_at IS NULL
        AND i.status <> 'void'
       GROUP BY s.id
       ORDER BY revenue DESC`,
      [filters.from, filters.to],
    );
    return {
      from: filters.from,
      to: filters.to,
      rows: rows.map((r) => ({
        serviceId: r.service_id,
        name: r.name,
        revenue: numberValue(r.revenue),
        invoiceCount: numberValue(r.invoice_count),
      })),
    };
  },
};
