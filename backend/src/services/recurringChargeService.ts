import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { invoiceService } from './invoiceService';
import { paymentService } from './paymentService';
import { logger } from '../utils/logger';
import {
  DEFAULT_SERVICE_FREQUENCY, SERVICE_FREQUENCY_LABELS, ServiceFrequency,
  addServiceInterval, advanceDueDate, parseServiceFrequency, firstRegularServiceDate,
} from '../utils/serviceSchedule';

import { todayIso, toIsoDate } from '../utils/dates';
import { buildTermVisits, cancelFutureVisits } from '../jobs/recurringVisits';
import { dispatchService } from './dispatchService';

export interface RecurringChargeUpsertOptions {
  frequency?: ServiceFrequency | null;
  /** Date of the initial service; the first regular service is one interval later. */
  startDate?: string | null;
  /** Agreement update: keep the existing due date unless the cadence changed. */
  isUpdate?: boolean;
  /** User performing the signing (falls back to the owner) — recorded on generated visits. */
  createdBy?: string | null;
}

async function ownerUserId(): Promise<string> {
  const { rows } = await pool.query(`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.code = 'OWNER' ORDER BY u.created_at LIMIT 1`);
  return rows[0]?.id;
}

function mapRow(row: any) {
  const frequency = parseServiceFrequency(row.frequency) ?? DEFAULT_SERVICE_FREQUENCY;
  const nextDueDate = toIsoDate(row.next_due_date);
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.company || `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim(),
    description: row.description,
    amount: Number(row.amount),
    frequency,
    frequencyLabel: SERVICE_FREQUENCY_LABELS[frequency],
    nextDueDate,
    isDue: nextDueDate != null && nextDueDate <= todayIso(),
    active: row.active,
    lastChargedInvoiceId: row.last_charged_invoice_id,
    lastChargedAt: row.last_charged_at,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export const recurringChargeService = {
  /**
   * Create or update the customer's recurring "Regular" charge from a signed
   * agreement. Signing a newer agreement replaces the previous amount.
   */
  async upsertFromAgreement(
    customerId: string,
    amount: number,
    sourceAgreementFileId: string | null,
    options: RecurringChargeUpsertOptions = {},
  ) {
    const normalized = Number(amount.toFixed(2));
    if (!Number.isFinite(normalized) || normalized <= 0) return null;
    const existing = await pool.query(
      'SELECT id, frequency, next_due_date FROM recurring_charges WHERE customer_id = $1 AND active = true LIMIT 1',
      [customerId],
    );
    const current = existing.rows[0] as { id: string; frequency: string; next_due_date: unknown } | undefined;
    const today = todayIso();
    const startDate = options.startDate ?? today;
    // A new agreement always sets the cadence; an update keeps the one on file
    // unless it names a different one.
    const frequency = options.frequency
      ?? (options.isUpdate && current ? parseServiceFrequency(current.frequency) : null)
      ?? DEFAULT_SERVICE_FREQUENCY;
    const firstRegular = firstRegularServiceDate(startDate);
    let nextDueDate = firstRegular;
    if (current && options.isUpdate) {
      const currentDue = toIsoDate(current.next_due_date);
      const sameCadence = parseServiceFrequency(current.frequency) === frequency;
      nextDueDate = sameCadence && currentDue ? currentDue : advanceDueDate(null, frequency, today);
    }

    const { rows } = await pool.query(
      `INSERT INTO recurring_charges (customer_id, description, amount, source_agreement_file_id, active, frequency, next_due_date)
       VALUES ($1, 'Regular recurring service', $2, $3, true, $4, $5)
       ON CONFLICT (customer_id) WHERE active
       DO UPDATE SET
         amount = EXCLUDED.amount,
         source_agreement_file_id = EXCLUDED.source_agreement_file_id,
         frequency = EXCLUDED.frequency,
         next_due_date = EXCLUDED.next_due_date,
         last_notified_due_date = CASE
           WHEN recurring_charges.next_due_date IS DISTINCT FROM EXCLUDED.next_due_date THEN NULL
           ELSE recurring_charges.last_notified_due_date END,
         updated_at = now()
       RETURNING *`,
      [customerId, normalized, sourceAgreementFileId, frequency, nextDueDate],
    );
    const row = rows[0] ?? null;
    // Put the customer's visits for the agreement term on the calendar. A new
    // agreement or a cadence change rebuilds the future; an update keeps them.
    if (row) {
      try {
        const cadenceChanged = !!current && parseServiceFrequency(current.frequency) !== frequency;
        if (!options.isUpdate || cadenceChanged) await cancelFutureVisits(row.id);
        const built = await buildTermVisits(row.id, options.createdBy ?? (await ownerUserId()), 12);
        if (built.created) {
          const unassigned = await pool.query('SELECT count(*)::int AS n FROM appointments WHERE recurring_charge_id = $1 AND technician_id IS NULL AND status = $2 AND deleted_at IS NULL', [row.id, 'scheduled']);
          if (unassigned.rows[0].n > 0) {
            const cust = await pool.query('SELECT company, first_name, last_name FROM customers WHERE id = $1', [customerId]);
            const name = cust.rows[0]?.company || `${cust.rows[0]?.first_name ?? ''} ${cust.rows[0]?.last_name ?? ''}`.trim();
            await dispatchService.notifyOffice(
              `${name}: ${unassigned.rows[0].n} visit${unassigned.rows[0].n === 1 ? '' : 's'} need a technician`,
              `The agreement was signed and the ${SERVICE_FREQUENCY_LABELS[frequency].toLowerCase()} visits are on the calendar starting ${built.dates[0]}, but the customer has no technician. Assign one under Schedule → Dispatch.`,
              { screen: 'schedule', customerId },
            ).catch(() => undefined);
          }
        }
      } catch (err) {
        logger.warn({ err, recurringChargeId: row.id }, 'could not build the agreement visit schedule');
      }
    }
    return row;
  },

  /** Upcoming visits generated from the plan (next 12 months). */
  async listVisits(id: string) {
    const { rows } = await pool.query(
      `SELECT a.id, a.scheduled_date, a.window_start, a.window_end, a.status, a.technician_id,
              tu.first_name || ' ' || tu.last_name AS technician_name,
              EXISTS (SELECT 1 FROM route_stops rs WHERE rs.appointment_id = a.id) AS on_route,
              (SELECT i.id FROM invoices i WHERE i.appointment_id = a.id AND i.deleted_at IS NULL LIMIT 1) AS invoice_id
       FROM appointments a
       LEFT JOIN employees te ON te.id = a.technician_id LEFT JOIN users tu ON tu.id = te.user_id
       WHERE a.recurring_charge_id = $1 AND a.deleted_at IS NULL AND a.status <> 'cancelled'
         AND a.scheduled_date >= CURRENT_DATE - 30
       ORDER BY a.scheduled_date, a.window_start`,
      [id],
    );
    return rows.map((r) => ({
      id: r.id, scheduledDate: toIsoDate(r.scheduled_date), windowStart: String(r.window_start).slice(0, 5), windowEnd: String(r.window_end).slice(0, 5),
      status: r.status, technicianId: r.technician_id, technicianName: r.technician_name, onRoute: !!r.on_route, invoiceId: r.invoice_id,
    }));
  },

  /** Rebuild the future schedule (owner action after fixing address/technician). */
  async rebuildSchedule(id: string, userId: string) {
    const cancelled = await cancelFutureVisits(id);
    const built = await buildTermVisits(id, userId, 12);
    return { cancelled, created: built.created };
  },

  /** Active recurring plans whose next service date has arrived. */
  async listDue() {
    const { rows } = await pool.query(
      `SELECT rc.*, c.first_name, c.last_name, c.company
       FROM recurring_charges rc
       JOIN customers c ON c.id = rc.customer_id
       WHERE rc.active = true AND c.deleted_at IS NULL AND rc.next_due_date <= CURRENT_DATE
       ORDER BY rc.next_due_date, c.last_name, c.first_name`,
    );
    return rows.map(mapRow);
  },

  async list(filters: { customerId?: string }) {
    const params: unknown[] = [];
    let where = 'rc.active = true AND c.deleted_at IS NULL';
    if (filters.customerId) {
      params.push(filters.customerId);
      where += ` AND rc.customer_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT rc.*, c.first_name, c.last_name, c.company
       FROM recurring_charges rc
       JOIN customers c ON c.id = rc.customer_id
       WHERE ${where}
       ORDER BY (rc.next_due_date <= CURRENT_DATE) DESC NULLS LAST, rc.next_due_date NULLS LAST, rc.updated_at DESC`,
      params,
    );
    return { items: rows.map(mapRow), total: rows.length };
  },

  /**
   * A recurring visit was completed: invoice the recurring amount (linked to
   * the appointment), optionally charge the saved method, and move the plan's
   * next due date forward.
   */
  async completeVisit(id: string, appointmentId: string, userId: string, opts: { charge: boolean }) {
    const { rows } = await pool.query('SELECT * FROM recurring_charges WHERE id = $1 AND active = true', [id]);
    const charge = rows[0];
    if (!charge) throw ApiError.notFound('Recurring charge not found.');
    const amount = Number(Number(charge.amount).toFixed(2));
    const invoice = (await invoiceService.create(
      {
        customerId: charge.customer_id,
        appointmentId,
        dueDate: todayIso(),
        taxRate: 0,
        notes: 'Recurring service charge',
        items: [{ description: charge.description || 'Regular recurring service', quantity: 1, unitPrice: amount, taxable: false }],
      },
      userId,
    )) as { id?: unknown };
    const invoiceId = String(invoice?.id ?? '');
    const frequency = parseServiceFrequency(charge.frequency) ?? DEFAULT_SERVICE_FREQUENCY;
    const nextDueDate = advanceDueDate(toIsoDate(charge.next_due_date), frequency, todayIso());
    await pool.query('UPDATE recurring_charges SET next_due_date = $2, updated_at = now() WHERE id = $1', [id, nextDueDate]);

    let charged = false;
    let reason: string | null = null;
    if (opts.charge && invoiceId) {
      const methods = (await paymentService.listMethods(charge.customer_id)) as Array<{ id: string; isDefault?: boolean }>;
      const method = methods.find((m) => m.isDefault) ?? methods[0];
      if (!method) reason = 'No saved payment method on file.';
      else {
        try {
          await paymentService.chargeInvoice(invoiceId, method.id, null, userId, null, { mit: true });
          await pool.query('UPDATE recurring_charges SET last_charged_invoice_id = $2, last_charged_at = now(), updated_at = now() WHERE id = $1', [id, invoiceId]);
          charged = true;
        } catch (error) {
          reason = error instanceof Error ? error.message : 'Recurring charge failed.';
          logger.warn({ err: error, recurringChargeId: id, invoiceId }, 'recurring visit charge failed');
        }
      }
    }
    return { invoiceId: invoiceId || null, amount, charged, reason, nextDueDate };
  },

  /**
   * Create an invoice for the recurring amount and immediately attempt to
   * charge it on the customer's saved payment method.
   */
  async chargeNow(id: string, userId: string, paymentMethodId?: string | null) {
    const { rows } = await pool.query(
      `SELECT * FROM recurring_charges WHERE id = $1 AND active = true`,
      [id],
    );
    const charge = rows[0];
    if (!charge) throw ApiError.notFound('Recurring charge not found.');
    const amount = Number(Number(charge.amount).toFixed(2));
    if (amount <= 0) throw ApiError.badRequest('Recurring charge amount must be greater than zero.');

    const invoice = (await invoiceService.create(
      {
        customerId: charge.customer_id,
        dueDate: todayIso(),
        taxRate: 0,
        notes: 'Recurring service charge',
        items: [
          {
            description: charge.description || 'Regular recurring service',
            quantity: 1,
            unitPrice: amount,
            taxable: false,
          },
        ],
      },
      userId,
    )) as { id?: unknown };
    const invoiceId = String(invoice?.id ?? '');
    if (!invoiceId) throw ApiError.badRequest('Recurring invoice could not be created.');

    let methodId = paymentMethodId ?? null;
    if (!methodId) {
      const methods = (await paymentService.listMethods(charge.customer_id)) as Array<{
        id: string;
        isDefault?: boolean;
      }>;
      const method = methods.find((m) => m.isDefault) ?? methods[0];
      methodId = method?.id ?? null;
    }

    if (!methodId) {
      return {
        charged: false,
        invoiceId,
        amount,
        reason: 'No saved payment method on file. Open the invoice to collect payment.',
      };
    }

    try {
      // Recurring billing charges are Merchant-Initiated (MIT) — the token
      // sale includes aci_ext=RB per EPX guidance.
      const result = await paymentService.chargeInvoice(invoiceId, methodId, null, userId, null, { mit: true });
      // The service was performed and paid: roll the due date forward one
      // interval on the agreed cadence.
      const frequency = parseServiceFrequency(charge.frequency) ?? DEFAULT_SERVICE_FREQUENCY;
      const nextDueDate = advanceDueDate(toIsoDate(charge.next_due_date), frequency, todayIso());
      await pool.query(
        `UPDATE recurring_charges
         SET last_charged_invoice_id = $2, last_charged_at = now(), next_due_date = $3, updated_at = now()
         WHERE id = $1`,
        [id, invoiceId, nextDueDate],
      );
      return { charged: true, invoiceId, amount, nextDueDate, receipt: result.receipt };
    } catch (error) {
      logger.warn({ err: error, recurringChargeId: id, invoiceId }, 'recurring charge payment failed');
      return {
        charged: false,
        invoiceId,
        amount,
        reason: error instanceof Error ? error.message : 'Recurring charge failed.',
      };
    }
  },
};

