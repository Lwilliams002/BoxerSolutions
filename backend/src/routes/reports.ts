import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { pool } from '../config/db';
import { rowsToCamel } from '../services/customerService';

const router = Router();
router.use(authenticate, authorize('reports:read'));

function dateRange(req: { query: Record<string, unknown> }) {
  const from = (req.query.from as string) ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const to = (req.query.to as string) ?? new Date().toISOString().slice(0, 10);
  return { from, to };
}

router.get(
  '/revenue',
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const params: unknown[] = [from, to];
    let techFilter = '';
    if (req.query.technicianId) { params.push(req.query.technicianId); techFilter = `AND i.technician_id = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT i.invoice_date::text AS date,
              sum(i.total) AS invoiced, sum(i.amount_paid) AS collected, count(*)::int AS invoice_count
       FROM invoices i
       WHERE i.invoice_date BETWEEN $1 AND $2 AND i.deleted_at IS NULL AND i.status <> 'void' ${techFilter}
       GROUP BY i.invoice_date ORDER BY i.invoice_date`,
      params,
    );
    ok(res, { from, to, rows: rowsToCamel(rows) });
  }),
);

router.get(
  '/technician-performance',
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const { rows } = await pool.query(
      `SELECT e.id AS technician_id, u.first_name || ' ' || u.last_name AS technician_name,
              count(a.id) FILTER (WHERE a.status = 'completed')::int AS completed_appointments,
              count(a.id) FILTER (WHERE a.status = 'cancelled')::int AS cancelled_appointments,
              coalesce(sum(i.total) FILTER (WHERE a.status = 'completed'), 0) AS revenue,
              avg(EXTRACT(EPOCH FROM (a.completed_at - a.started_at)) / 60) FILTER (WHERE a.completed_at IS NOT NULL AND a.started_at IS NOT NULL) AS avg_service_minutes
       FROM employees e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN appointments a ON a.technician_id = e.id AND a.scheduled_date BETWEEN $1 AND $2 AND a.deleted_at IS NULL
       LEFT JOIN invoices i ON i.appointment_id = a.id AND i.deleted_at IS NULL
       WHERE e.deleted_at IS NULL
       GROUP BY e.id, u.first_name, u.last_name
       ORDER BY revenue DESC`,
      [from, to],
    );
    ok(res, { from, to, rows: rowsToCamel(rows) });
  }),
);

router.get(
  '/outstanding',
  asyncHandler(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT c.id AS customer_id, c.first_name || ' ' || c.last_name AS customer_name, c.company,
              coalesce(sum(i.total - i.amount_paid), 0) AS outstanding,
              min(i.due_date)::text AS oldest_due_date,
              count(i.id)::int AS open_invoices
       FROM customers c
       JOIN invoices i ON i.customer_id = c.id AND i.deleted_at IS NULL
         AND i.status IN ('open','sent','partially_paid','past_due')
       WHERE c.deleted_at IS NULL
       GROUP BY c.id ORDER BY outstanding DESC LIMIT 100`,
    );
    ok(res, rowsToCamel(rows));
  }),
);

router.get(
  '/customer-growth',
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const { rows } = await pool.query(
      `SELECT date_trunc('week', created_at)::date::text AS week, count(*)::int AS new_customers
       FROM customers WHERE created_at::date BETWEEN $1 AND $2 AND deleted_at IS NULL
       GROUP BY 1 ORDER BY 1`,
      [from, to],
    );
    ok(res, { from, to, rows: rowsToCamel(rows) });
  }),
);

router.get(
  '/service-revenue',
  asyncHandler(async (req, res) => {
    const { from, to } = dateRange(req);
    const { rows } = await pool.query(
      `SELECT s.id AS service_id, s.name,
              coalesce(sum(ii.line_total), 0) AS revenue, count(DISTINCT ii.invoice_id)::int AS invoice_count
       FROM services s
       JOIN invoice_items ii ON ii.service_id = s.id
       JOIN invoices i ON i.id = ii.invoice_id AND i.invoice_date BETWEEN $1 AND $2 AND i.deleted_at IS NULL AND i.status <> 'void'
       GROUP BY s.id ORDER BY revenue DESC`,
      [from, to],
    );
    ok(res, { from, to, rows: rowsToCamel(rows) });
  }),
);

export default router;
