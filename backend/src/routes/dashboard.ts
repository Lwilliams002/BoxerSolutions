import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope } from '../middleware/scope';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { pool } from '../config/db';

const router = Router();
router.use(authenticate);

/** Office + technician dashboard metrics (spec §12). Technicians see only their own slice. */
router.get(
  '/',
  authorize('dashboard:read', 'appointments:read_assigned'),
  asyncHandler(async (req, res) => {
    const scope = technicianScope(req, 'dashboard:read');
    const techFilter = scope ? 'AND a.technician_id = $1' : '';
    const params = scope ? [scope] : [];

    const [appts, routes, revenue, invoices, activity] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
                count(*) FILTER (WHERE a.status NOT IN ('completed','cancelled'))::int AS remaining,
                count(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled
         FROM appointments a
         WHERE a.scheduled_date = CURRENT_DATE AND a.deleted_at IS NULL ${techFilter}`,
        params,
      ),
      pool.query(
        scope
          ? `SELECT count(*)::int AS total FROM routes r WHERE r.route_date = CURRENT_DATE AND r.deleted_at IS NULL AND r.technician_id = $1`
          : `SELECT count(*)::int AS total FROM routes r WHERE r.route_date = CURRENT_DATE AND r.deleted_at IS NULL`,
        params,
      ),
      pool.query(
        scope
          ? `SELECT coalesce(sum(p.amount), 0) AS collected_today,
                    count(*) FILTER (WHERE p.status = 'failed' AND p.created_at::date = CURRENT_DATE)::int AS failed_today
             FROM payments p WHERE p.status IN ('succeeded','failed') AND p.processed_at::date = CURRENT_DATE AND p.collected_by = $1`
          : `SELECT coalesce(sum(p.amount) FILTER (WHERE p.status = 'succeeded'), 0) AS collected_today,
                    count(*) FILTER (WHERE p.status = 'failed')::int AS failed_today
             FROM payments p WHERE p.processed_at::date = CURRENT_DATE`,
        params,
      ),
      pool.query(
        `SELECT coalesce(sum(i.total - i.amount_paid) FILTER (WHERE i.status IN ('open','sent','partially_paid','past_due')), 0) AS outstanding,
                coalesce(sum(i.total - i.amount_paid) FILTER (WHERE i.status IN ('open','sent','partially_paid','past_due') AND i.due_date < CURRENT_DATE), 0) AS past_due,
                coalesce(sum(i.total) FILTER (WHERE i.invoice_date = CURRENT_DATE), 0) AS invoiced_today
         FROM invoices i WHERE i.deleted_at IS NULL`,
      ),
      scope
        ? Promise.resolve({ rows: [] })
        : pool.query(
            `SELECT u.first_name || ' ' || u.last_name AS technician_name,
                    count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
                    count(*) FILTER (WHERE a.status NOT IN ('completed','cancelled'))::int AS remaining
             FROM appointments a
             JOIN employees e ON e.id = a.technician_id
             JOIN users u ON u.id = e.user_id
             WHERE a.scheduled_date = CURRENT_DATE AND a.deleted_at IS NULL
             GROUP BY u.first_name, u.last_name ORDER BY completed DESC`,
          ),
    ]);

    const upcoming = await pool.query(
      `SELECT count(*)::int AS total FROM appointments a
       WHERE a.scheduled_date > CURRENT_DATE AND a.scheduled_date <= CURRENT_DATE + 7
         AND a.status = 'scheduled' AND a.deleted_at IS NULL ${techFilter}`,
      params,
    );

    ok(res, {
      today: {
        appointments: appts.rows[0].total,
        completedStops: appts.rows[0].completed,
        remainingStops: appts.rows[0].remaining,
        cancelled: appts.rows[0].cancelled,
        routes: routes.rows[0].total,
        paymentsCollected: Number(revenue.rows[0].collected_today),
        failedPayments: revenue.rows[0].failed_today,
        revenueInvoiced: Number(invoices.rows[0].invoiced_today),
      },
      invoices: {
        outstanding: Number(invoices.rows[0].outstanding),
        pastDue: Number(invoices.rows[0].past_due),
      },
      upcomingAppointments: upcoming.rows[0].total,
      technicianActivity: activity.rows,
    });
  }),
);

export default router;
