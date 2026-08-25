import { QueryResultRow } from 'pg';
import { pool } from '../config/db';
import { getOutboundMessageProvider } from '../integrations/notifications';
import { rowsToCamel, toCamel } from './customerService';
import { logger } from '../utils/logger';
import { agreementSigningService } from './agreementSigningService';

export type CommunicationChannel = 'sms' | 'email' | 'push';
export type CommunicationTemplateKey =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'technician_on_my_way'
  | 'appointment_rescheduled'
  | 'invoice_created'
  | 'payment_received'
  | 'payment_failed'
  | 'payment_refunded'
  | 'agreement_review_sign';

const COMPANY = {
  name: 'Boxer Solutions Pest Control',
  phone: '(512) 555-0142',
  email: 'service@boxersolutionspestcontrol.com',
};

const DEFAULT_CHANNEL: Record<CommunicationTemplateKey, CommunicationChannel> = {
  appointment_confirmation: 'sms',
  appointment_reminder: 'sms',
  technician_on_my_way: 'sms',
  appointment_rescheduled: 'sms',
  invoice_created: 'email',
  payment_received: 'email',
  payment_failed: 'email',
  payment_refunded: 'email',
  agreement_review_sign: 'email',
};

function fmtDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtTime(value: string | null | undefined) {
  if (!value) return '';
  const [hours, minutes] = value.split(':').map(Number);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

function money(value: string | number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function customerName(row: QueryResultRow) {
  return row.customer_company || `${row.customer_first_name} ${row.customer_last_name}`;
}

function firstName(row: QueryResultRow) {
  return row.customer_first_name || customerName(row);
}

function serviceNames(row: QueryResultRow) {
  const services = (row.services ?? []) as { name: string }[];
  return services.length ? services.map((s) => s.name).join(', ') : 'pest control service';
}

async function appointmentContext(appointmentId: string) {
  const { rows } = await pool.query(
    `SELECT a.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            c.company AS customer_company, c.email AS customer_email, c.phone AS customer_phone,
            sl.address_line1, sl.city, sl.state, sl.postal_code,
            tu.first_name || ' ' || tu.last_name AS technician_name,
            (SELECT json_agg(json_build_object('name', s.name, 'quantity', aps.quantity))
             FROM appointment_services aps
             JOIN services s ON s.id = aps.service_id
             WHERE aps.appointment_id = a.id) AS services
     FROM appointments a
     JOIN customers c ON c.id = a.customer_id
     JOIN service_locations sl ON sl.id = a.service_location_id
     LEFT JOIN employees te ON te.id = a.technician_id
     LEFT JOIN users tu ON tu.id = te.user_id
     WHERE a.id = $1 AND a.deleted_at IS NULL`,
    [appointmentId],
  );
  return rows[0];
}

async function invoiceContext(invoiceId: string) {
  const { rows } = await pool.query(
    `SELECT i.*, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            c.company AS customer_company, c.email AS customer_email, c.phone AS customer_phone
     FROM invoices i
     JOIN customers c ON c.id = i.customer_id
     WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [invoiceId],
  );
  return rows[0];
}

async function customerContext(customerId: string) {
  const { rows } = await pool.query(
    `SELECT c.id, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
            c.company AS customer_company, c.email AS customer_email, c.phone AS customer_phone
     FROM customers c
     WHERE c.id = $1 AND c.deleted_at IS NULL`,
    [customerId],
  );
  return rows[0];
}

function renderTemplate(templateKey: CommunicationTemplateKey, ctx: QueryResultRow, extra?: Record<string, unknown>) {
  const date = ctx.scheduled_date ? fmtDate(ctx.scheduled_date) : '';
  const window = ctx.window_start ? `${fmtTime(ctx.window_start)}–${fmtTime(ctx.window_end)}` : '';
  const tech = String(extra?.technicianName ?? ctx.technician_name ?? 'Your technician');
  const eta = String(extra?.etaWindow ?? window);

  switch (templateKey) {
    case 'appointment_confirmation':
      return {
        subject: 'Appointment confirmed',
        body: `Hi ${firstName(ctx)}, your ${serviceNames(ctx)} with ${COMPANY.name} is confirmed for ${date}, ${window}. Questions? ${COMPANY.phone}.`,
      };
    case 'appointment_reminder':
      return {
        subject: 'Appointment reminder',
        body: `Reminder: ${COMPANY.name} will be at ${ctx.address_line1} tomorrow, ${date}, between ${window} for ${serviceNames(ctx)}.`,
      };
    case 'technician_on_my_way':
      return {
        subject: 'Technician on the way',
        body: `${tech} from ${COMPANY.name} is on the way to ${ctx.address_line1}. ETA window: ${eta}.`,
      };
    case 'appointment_rescheduled':
      return {
        subject: 'Appointment rescheduled',
        body: `Hi ${firstName(ctx)}, your ${COMPANY.name} appointment has been rescheduled to ${date}, ${window}.`,
      };
    case 'invoice_created':
      return {
        subject: `Invoice ${ctx.invoice_number} from ${COMPANY.name}`,
        body: `Hi ${firstName(ctx)}, invoice ${ctx.invoice_number} for ${money(ctx.total)} is ready. Please contact ${COMPANY.phone} with questions.`,
      };
    case 'payment_received':
      return {
        subject: `Payment received for invoice ${ctx.invoice_number}`,
        body: `Thank you, ${firstName(ctx)}. We received your payment of ${money(extra?.amount as number | string | undefined)} for invoice ${ctx.invoice_number}.`,
      };
    case 'payment_failed':
      return {
        subject: `Payment failed for invoice ${ctx.invoice_number}`,
        body: `Hi ${firstName(ctx)}, your payment of ${money(extra?.amount as number | string | undefined)} for invoice ${ctx.invoice_number} failed${extra?.reason ? `: ${String(extra.reason)}` : ''}. Please call ${COMPANY.phone}.`,
      };
    case 'payment_refunded':
      return {
        subject: `Refund processed for invoice ${ctx.invoice_number}`,
        body: `Hi ${firstName(ctx)}, we processed a refund of ${money(extra?.amount as number | string | undefined)} for invoice ${ctx.invoice_number}.`,
      };
    case 'agreement_review_sign':
      return {
        subject: `Review and sign your service agreement with ${COMPANY.name}`,
        body: `Hi ${firstName(ctx)}, your service agreement is ready for review and signature. ${extra?.reviewUrl ? `Please open ${String(extra.reviewUrl)} to review and sign.` : `Please reply to this email or call ${COMPANY.phone} and we will walk you through signing.`}`,
      };
  }
}

async function insertAndSend(data: {
  customerId: string;
  appointmentId?: string | null;
  invoiceId?: string | null;
  channel: CommunicationChannel;
  templateKey: CommunicationTemplateKey;
  subject: string | null;
  body: string;
  sentBy?: string | null;
  to?: string | null;
}) {
  const { rows } = await pool.query(
    `INSERT INTO communications (customer_id, appointment_id, invoice_id, channel, template_key, subject, body, status, sent_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8) RETURNING *`,
    [
      data.customerId,
      data.appointmentId ?? null,
      data.invoiceId ?? null,
      data.channel,
      data.templateKey,
      data.subject,
      data.body,
      data.sentBy ?? null,
    ],
  );
  const comm = rows[0];
  try {
    await getOutboundMessageProvider(data.channel).send({
      communicationId: comm.id,
      channel: data.channel,
      to: data.to,
      subject: data.subject,
      body: data.body,
      templateKey: data.templateKey,
    });
    const sent = await pool.query(
      `UPDATE communications SET status = 'sent', sent_at = now() WHERE id = $1 RETURNING *`,
      [comm.id],
    );
    return toCamel(sent.rows[0]);
  } catch (err) {
    await pool.query(`UPDATE communications SET status = 'failed' WHERE id = $1`, [comm.id]);
    logger.error({ err, communicationId: comm.id }, 'communication send failed');
    throw err;
  }
}

export function safelyQueueCommunication(work: () => Promise<unknown>) {
  void work().catch((err) => logger.error({ err }, 'communication hook failed'));
}

export const communicationService = {
  async list(filters: { customerId?: string }, limit: number, offset: number) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.customerId) {
      params.push(filters.customerId);
      where.push(`cm.customer_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await pool.query(`SELECT count(*)::int AS total FROM communications cm ${whereSql}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT cm.*, c.first_name || ' ' || c.last_name AS customer_name, c.company AS customer_company
       FROM communications cm
       JOIN customers c ON c.id = cm.customer_id
       ${whereSql}
       ORDER BY cm.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rowsToCamel(rows), total: count.rows[0].total };
  },

  async sendAppointmentTemplate(
    appointmentId: string,
    templateKey: Extract<CommunicationTemplateKey, 'appointment_confirmation' | 'appointment_reminder' | 'technician_on_my_way' | 'appointment_rescheduled'>,
    sentBy?: string | null,
    extra?: Record<string, unknown>,
  ) {
    const ctx = await appointmentContext(appointmentId);
    if (!ctx) throw new Error('Appointment not found for communication');
    const rendered = renderTemplate(templateKey, ctx, extra);
    return insertAndSend({
      customerId: ctx.customer_id,
      appointmentId,
      invoiceId: null,
      channel: DEFAULT_CHANNEL[templateKey],
      templateKey,
      subject: rendered.subject,
      body: rendered.body,
      sentBy,
      to: DEFAULT_CHANNEL[templateKey] === 'email' ? ctx.customer_email : ctx.customer_phone,
    });
  },

  async sendInvoiceTemplate(
    invoiceId: string,
    templateKey: Extract<CommunicationTemplateKey, 'invoice_created' | 'payment_received' | 'payment_failed' | 'payment_refunded'>,
    sentBy?: string | null,
    extra?: Record<string, unknown>,
  ) {
    const ctx = await invoiceContext(invoiceId);
    if (!ctx) throw new Error('Invoice not found for communication');
    const rendered = renderTemplate(templateKey, ctx, extra);
    return insertAndSend({
      customerId: ctx.customer_id,
      appointmentId: ctx.appointment_id,
      invoiceId,
      channel: DEFAULT_CHANNEL[templateKey],
      templateKey,
      subject: rendered.subject,
      body: rendered.body,
      sentBy,
      to: ctx.customer_email,
    });
  },

  async sendAgreementReviewRequest(
    customerId: string,
    sentBy?: string | null,
    reviewUrl?: string | null,
    apiBaseUrl?: string | null,
  ) {
    const ctx = await customerContext(customerId);
    if (!ctx) throw new Error('Customer not found for communication');
    if (!ctx.customer_email) throw new Error('Customer email is required to send agreement review request');
    const templateKey: CommunicationTemplateKey = 'agreement_review_sign';
    const resolvedReviewUrl =
      reviewUrl ??
      (apiBaseUrl ? await agreementSigningService.buildReviewUrl(customerId, apiBaseUrl) : null);
    const rendered = renderTemplate(templateKey, ctx, resolvedReviewUrl ? { reviewUrl: resolvedReviewUrl } : undefined);
    return insertAndSend({
      customerId,
      appointmentId: null,
      invoiceId: null,
      channel: DEFAULT_CHANNEL[templateKey],
      templateKey,
      subject: rendered.subject,
      body: rendered.body,
      sentBy,
      to: ctx.customer_email,
    });
  },
};
