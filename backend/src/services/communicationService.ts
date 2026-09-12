import { QueryResultRow } from 'pg';
import { ApiError } from '../utils/errors';
import { pool } from '../config/db';
import { EmailAttachment, getOutboundMessageProvider } from '../integrations/notifications';
import { storage } from '../integrations/storage';
import { rowsToCamel, toCamel } from './customerService';
import { logger } from '../utils/logger';
import { fileService } from './fileService';
import { invoiceService } from './invoiceService';
import { agreementSigningService } from './agreementSigningService';
import {
  ServiceNotificationContext, ServiceNotificationKind,
  renderServiceNotificationHtml, renderServiceNotificationText,
} from '../content/serviceNotificationEmail';
import { getCompanyInfo } from './settingsService';
import { parseIsoDateLocal } from '../utils/dates';
import { escapeHtml } from '../content/serviceNotificationEmail';

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
  | 'agreement_review_sign'
  | 'agreement_signed_copy'
  | 'service_completed';

const COMPANY = {
  name: 'Boxer Solutions Pest Control',
  phone: '3057135011',
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
  agreement_signed_copy: 'email',
  service_completed: 'email',
};

function fmtDate(value: string | Date) {
  const date = value instanceof Date ? value : (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? parseIsoDateLocal(String(value)) : new Date(value));
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
            c.company AS customer_company, c.email AS customer_email, c.phone AS customer_phone,
            c.billing_address_line1 AS bill_line1, c.billing_address_line2 AS bill_line2,
            c.billing_city AS bill_city, c.billing_state AS bill_state, c.billing_postal_code AS bill_postal_code
     FROM invoices i
     JOIN customers c ON c.id = i.customer_id
     WHERE i.id = $1 AND i.deleted_at IS NULL`,
    [invoiceId],
  );
  return rows[0];
}

function clockTime(value: unknown) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

function addressLines(row: QueryResultRow | null | undefined, prefix: string) {
  if (!row) return [];
  const line1 = row[`${prefix}line1`];
  const line2 = row[`${prefix}line2`];
  const cityLine = [row[`${prefix}city`], [row[`${prefix}state`], row[`${prefix}postal_code`]].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [line1, line2, cityLine].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

/** Everything the formatted "Service Notification" email shows for an invoice. */
async function serviceNotificationContext(
  ctx: QueryResultRow,
  kind: ServiceNotificationKind,
  extra?: Record<string, unknown>,
): Promise<ServiceNotificationContext> {
  const invoiceId = String(ctx.id);
  const [company, items, location, appointment, payments, balance] = await Promise.all([
    getCompanyInfo(),
    pool.query(
      `SELECT description, quantity, unit_price, line_total FROM invoice_items WHERE invoice_id = $1 ORDER BY created_at`,
      [invoiceId],
    ),
    pool.query(
      `SELECT address_line1 AS loc_line1, address_line2 AS loc_line2, city AS loc_city, state AS loc_state, postal_code AS loc_postal_code
       FROM service_locations WHERE id = COALESCE($1::uuid, (SELECT service_location_id FROM appointments WHERE id = $2::uuid))`,
      [ctx.service_location_id ?? null, ctx.appointment_id ?? null],
    ),
    ctx.appointment_id
      ? pool.query(
          `SELECT a.scheduled_date, a.window_start, a.window_end, a.arrived_at, a.started_at, a.completed_at,
                  tu.first_name || ' ' || tu.last_name AS technician_name,
                  (SELECT json_agg(json_build_object('name', p.name, 'quantity', ap.quantity, 'unit', ap.unit, 'applicationMethod', ap.application_method, 'targetPests', ap.target_pests) ORDER BY p.name)
                   FROM appointment_products ap JOIN products p ON p.id = ap.product_id WHERE ap.appointment_id = a.id) AS products,
                  (SELECT json_agg(s.name ORDER BY s.name) FROM appointment_services aps JOIN services s ON s.id = aps.service_id WHERE aps.appointment_id = a.id) AS services,
                  (SELECT n.body FROM notes n WHERE n.appointment_id = a.id AND n.deleted_at IS NULL AND n.is_internal = false ORDER BY n.created_at DESC LIMIT 1) AS comments
           FROM appointments a
           LEFT JOIN employees te ON te.id = a.technician_id
           LEFT JOIN users tu ON tu.id = te.user_id
           WHERE a.id = $1`,
          [ctx.appointment_id],
        )
      : Promise.resolve({ rows: [] as QueryResultRow[] }),
    pool.query(
      `SELECT p.amount, COALESCE(p.processed_at, p.created_at) AS paid_at, p.receipt_number, pm.brand, pm.last4, pm.method_type
       FROM payments p LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
       WHERE p.invoice_id = $1 AND p.status = 'succeeded' ORDER BY COALESCE(p.processed_at, p.created_at)`,
      [invoiceId],
    ),
    pool.query(
      `SELECT COALESCE(SUM(i.total - i.amount_paid), 0) AS previous_balance
       FROM invoices i
       WHERE i.customer_id = $1 AND i.id <> $2 AND i.deleted_at IS NULL
         AND i.status IN ('open','sent','partially_paid','past_due')`,
      [ctx.customer_id, invoiceId],
    ),
  ]);

  const appt = appointment.rows[0];
  const eventAmount = extra?.amount != null ? Number(extra.amount) : null;
  return {
    kind,
    company,
    eventAmount,
    eventReason: typeof extra?.reason === 'string' ? extra.reason : null,
    customer: {
      name: customerName(ctx),
      firstName: firstName(ctx),
      email: ctx.customer_email ?? null,
      phone: ctx.customer_phone ?? null,
      billingAddress: addressLines(ctx, 'bill_'),
    },
    invoice: {
      number: String(ctx.invoice_number),
      date: ctx.invoice_date,
      dueDate: ctx.due_date ?? null,
      subtotal: Number(ctx.subtotal ?? 0),
      discount: Number(ctx.discount_amount ?? 0),
      taxRate: Number(ctx.tax_rate ?? 0),
      taxAmount: Number(ctx.tax_amount ?? 0),
      total: Number(ctx.total ?? 0),
      amountPaid: Number(ctx.amount_paid ?? 0),
      notes: ctx.notes ?? null,
      items: items.rows.map((r) => ({
        description: String(r.description),
        quantity: Number(r.quantity ?? 1),
        unitPrice: Number(r.unit_price ?? 0),
        lineTotal: Number(r.line_total ?? 0),
      })),
    },
    serviceAddress: addressLines(location.rows[0], 'loc_'),
    appointment: appt
      ? {
          date: appt.scheduled_date ?? null,
          technician: appt.technician_name ?? null,
          services: Array.isArray(appt.services) ? (appt.services as string[]) : [],
          window: appt.window_start ? `${fmtTime(String(appt.window_start))} - ${fmtTime(String(appt.window_end))}` : null,
          timeIn: clockTime(appt.arrived_at ?? appt.started_at),
          timeOut: clockTime(appt.completed_at),
          comments: appt.comments ?? null,
          products: Array.isArray(appt.products) ? appt.products.map((p: any) => ({ name: String(p.name), quantity: Number(p.quantity), unit: String(p.unit ?? ''), applicationMethod: p.applicationMethod ?? null, targetPests: p.targetPests ?? null })) : [],
        }
      : null,
    payments: payments.rows.map((p) => ({
      amount: Number(p.amount),
      date: p.paid_at ?? null,
      method: p.brand || p.last4 ? `${p.method_type === 'bank_account' ? 'Bank' : (p.brand ?? 'Card')}${p.last4 ? ` ····${p.last4}` : ''}` : null,
      receiptNumber: p.receipt_number ?? null,
    })),
    previousBalance: Number(balance.rows[0]?.previous_balance ?? 0),
  };
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
    case 'service_completed':
      return {
        subject: `Service report from ${String(extra?.companyName ?? COMPANY.name)}`,
        body: `Hi ${firstName(ctx)}, your service visit is complete. Thank you for choosing ${String(extra?.companyName ?? COMPANY.name)}.`,
      };
    case 'agreement_signed_copy':
      return {
        subject: `Your signed service agreement with ${String(extra?.companyName ?? COMPANY.name)}`,
        body: `Hi ${firstName(ctx)}, thank you for choosing ${String(extra?.companyName ?? COMPANY.name)}. A copy of the service agreement you signed on ${String(extra?.signedOn ?? 'today')} is attached for your records. Questions? Reply to this email or call ${String(extra?.companyPhone ?? COMPANY.phone)}.`,
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
  html?: string | null;
  attachments?: EmailAttachment[] | null;
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
      html: data.html ?? null,
      attachments: data.attachments ?? null,
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
    // Invoice emails go out as the formatted Service Notification document;
    // the short template text stays as the plain-text part and the log entry.
    let html: string | null = null;
    let body = rendered.body;
    try {
      const notification = await serviceNotificationContext(ctx, templateKey, extra);
      html = renderServiceNotificationHtml(notification);
      body = renderServiceNotificationText(notification);
    } catch (err) {
      logger.warn({ err, invoiceId }, 'service notification email fell back to plain text');
    }
    return insertAndSend({
      customerId: ctx.customer_id,
      appointmentId: ctx.appointment_id,
      invoiceId,
      channel: DEFAULT_CHANNEL[templateKey],
      templateKey,
      subject: rendered.subject,
      body,
      html,
      sentBy,
      to: ctx.customer_email,
    });
  },

  /** Service report after a visit that produced no invoice (products, comments, times). */
  async sendServiceReport(appointmentId: string, sentBy?: string | null) {
    const appt = await pool.query(
      `SELECT a.id, a.customer_id, a.scheduled_date, a.service_location_id, c.first_name AS customer_first_name, c.last_name AS customer_last_name,
              c.company AS customer_company, c.email AS customer_email, c.phone AS customer_phone,
              c.billing_address_line1 AS bill_line1, c.billing_address_line2 AS bill_line2, c.billing_city AS bill_city, c.billing_state AS bill_state, c.billing_postal_code AS bill_postal_code
       FROM appointments a JOIN customers c ON c.id = a.customer_id WHERE a.id = $1 AND a.deleted_at IS NULL`,
      [appointmentId],
    );
    const ctx = appt.rows[0];
    if (!ctx) throw new Error('Appointment not found for service report');
    if (!ctx.customer_email) return null;
    // Reuse the invoice-shaped context with an empty invoice so the report shows the visit only.
    const pseudo = { ...ctx, appointment_id: appointmentId, invoice_number: `VISIT-${String(appointmentId).slice(0, 8).toUpperCase()}`, invoice_date: ctx.scheduled_date, due_date: null, subtotal: 0, discount_amount: 0, tax_rate: 0, tax_amount: 0, total: 0, amount_paid: 0, notes: null };
    const company = await getCompanyInfo();
    const notification = await serviceNotificationContext(pseudo, 'service_completed', {});
    notification.invoice.items = [];
    notification.payments = [];
    const rendered = renderTemplate('service_completed', ctx, { companyName: company.name });
    return insertAndSend({
      customerId: ctx.customer_id,
      appointmentId,
      invoiceId: null,
      channel: 'email',
      templateKey: 'service_completed',
      subject: rendered.subject,
      body: renderServiceNotificationText(notification),
      html: renderServiceNotificationHtml(notification),
      sentBy,
      to: ctx.customer_email,
    });
  },

  /**
   * Email the customer a copy of the agreement they just signed (in the rep's
   * app or through the email link). The signed document file is attached.
   */
  async sendSignedAgreementCopy(customerId: string, fileId: string, sentBy?: string | null) {
    const ctx = await customerContext(customerId);
    if (!ctx) throw new Error('Customer not found for communication');
    if (!ctx.customer_email) {
      logger.info({ customerId }, 'signed agreement copy skipped: customer has no email');
      return null;
    }
    const file = await pool.query(
      `SELECT file_name, mime_type, storage_object_key, created_at FROM files
       WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL AND upload_status = 'uploaded'`,
      [fileId, customerId],
    );
    const row = file.rows[0];
    if (!row) throw new Error('Signed agreement file not found');
    const content = await storage.getObject(row.storage_object_key);
    const mime = String(row.mime_type || 'application/octet-stream');
    const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'bin';
    const company = await getCompanyInfo();
    const signedOn = new Date(row.created_at ?? Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const templateKey: CommunicationTemplateKey = 'agreement_signed_copy';
    const rendered = renderTemplate(templateKey, ctx, { companyName: company.name, companyPhone: company.phone, signedOn });
    const html = `<!DOCTYPE html><html><body style="margin:0;background:#F0FAF8;padding:16px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:10px;"><tr><td style="padding:18px 24px;border-bottom:3px solid #0D0D0D;font:700 16px Helvetica,Arial,sans-serif;color:#0D0D0D;">${escapeHtml(company.name)}</td></tr><tr><td style="padding:14px 24px;background:#0F7B3F;color:#fff;font:700 16px Helvetica,Arial,sans-serif;">Your signed service agreement</td></tr><tr><td style="padding:18px 24px;font:14px/20px Helvetica,Arial,sans-serif;color:#0D0D0D;">Hi ${escapeHtml(firstName(ctx))},<br><br>Thank you for choosing ${escapeHtml(company.name)}. A copy of the service agreement you signed on ${escapeHtml(signedOn)} is attached to this email for your records.<br><br>Questions? Reply to this email or call ${escapeHtml(company.phone)}.</td></tr><tr><td style="padding:0 24px 18px;font:11px Helvetica,Arial,sans-serif;color:#5B6B68;text-align:center;">${escapeHtml(company.name)}${company.addressLines.length ? ` · ${escapeHtml(company.addressLines.join(', '))}` : ''} · ${escapeHtml(company.license)}</td></tr></table></td></tr></table></body></html>`;
    return insertAndSend({
      customerId,
      appointmentId: null,
      invoiceId: null,
      channel: 'email',
      templateKey,
      subject: rendered.subject,
      body: rendered.body,
      html,
      attachments: [{ filename: `service-agreement-signed.${ext}`, contentType: mime, content }],
      sentBy,
      to: ctx.customer_email,
    });
  },

  /**
   * One communication with everything the office needs to deliver it by hand
   * when the automated send failed: recipient, full text, and share links
   * (fresh signing link, signed agreement, invoice PDF, receipt).
   */
  async getDetail(communicationId: string, apiBaseUrl: string, userId: string | null) {
    const { rows } = await pool.query(
      `SELECT cm.*, c.first_name || ' ' || c.last_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
       FROM communications cm JOIN customers c ON c.id = cm.customer_id WHERE cm.id = $1`,
      [communicationId],
    );
    const comm = rows[0];
    if (!comm) throw ApiError.notFound('Communication not found');
    const key = comm.template_key as CommunicationTemplateKey;
    const links: { label: string; url: string; note: string }[] = [];
    const fileLink = (label: string, fileId: string, note = 'Link works for 30 days') =>
      links.push({ label, url: `${apiBaseUrl}/api/v1/public/files/${fileService.issueShareToken(fileId)}`, note });

    if (key === 'agreement_review_sign') {
      links.push({ label: 'Review & sign link', url: await agreementSigningService.buildReviewUrl(comm.customer_id, apiBaseUrl), note: 'New link, valid 7 days' });
    }
    if (key === 'agreement_signed_copy') {
      const f = await pool.query(
        `SELECT id FROM files WHERE customer_id = $1 AND deleted_at IS NULL AND upload_status = 'uploaded'
           AND mime_type = 'application/pdf' AND file_name LIKE 'service-agreement-signed-%' ORDER BY updated_at DESC LIMIT 1`,
        [comm.customer_id],
      );
      if (f.rows[0]) fileLink('Signed agreement (PDF)', f.rows[0].id);
    }
    if (comm.invoice_id) {
      const inv = await pool.query(`SELECT pdf_file_id, deleted_at FROM invoices WHERE id = $1`, [comm.invoice_id]);
      if (inv.rows[0] && !inv.rows[0].deleted_at) {
        let pdfFileId: string | null = inv.rows[0].pdf_file_id;
        if (!pdfFileId) {
          try {
            pdfFileId = (await invoiceService.generatePdf(comm.invoice_id, String(userId ?? comm.sent_by ?? ''))).fileId;
          } catch (err) {
            logger.warn({ err, invoiceId: comm.invoice_id }, 'could not generate invoice pdf for share link');
          }
        }
        if (pdfFileId) fileLink('Invoice (PDF)', pdfFileId);
      }
      if (key === 'payment_received' || key === 'payment_refunded') {
        const pay = await pool.query(
          `SELECT receipt_file_id FROM payments WHERE invoice_id = $1 AND receipt_file_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
          [comm.invoice_id],
        );
        if (pay.rows[0]) fileLink('Receipt (PDF)', pay.rows[0].receipt_file_id);
      }
    }
    for (const m of String(comm.body).match(/https?:\/\/[^\s)>"']+/g) ?? []) {
      if (!links.some((l) => l.url === m) && !m.includes('/agreements/sign?token=')) links.push({ label: 'Link in message', url: m, note: '' });
    }
    return { ...(toCamel(comm) as Record<string, unknown>), customerId: String(comm.customer_id), links };
  },

  /**
   * Re-send a failed communication. The message is re-rendered from the
   * current record (invoice, appointment, agreement) so it reflects today's
   * data; the original failed row keeps its audit trail and points at the
   * new row through resent_communication_id.
   */
  async resend(communicationId: string, sentBy: string | null, apiBaseUrl?: string | null) {
    const { rows } = await pool.query(`SELECT * FROM communications WHERE id = $1`, [communicationId]);
    const comm = rows[0];
    if (!comm) throw ApiError.notFound('Communication not found');
    if (comm.status !== 'failed') throw ApiError.badRequest('Only failed communications can be re-sent');
    if (comm.resent_communication_id) throw ApiError.badRequest('This communication was already re-sent');
    const key = comm.template_key as CommunicationTemplateKey;
    let result: Record<string, unknown> | null | undefined = null;
    switch (key) {
      case 'appointment_confirmation':
      case 'appointment_reminder':
      case 'technician_on_my_way':
      case 'appointment_rescheduled':
        if (!comm.appointment_id) throw ApiError.badRequest('Appointment no longer exists');
        result = await communicationService.sendAppointmentTemplate(comm.appointment_id, key, sentBy);
        break;
      case 'invoice_created':
      case 'payment_received':
      case 'payment_failed':
      case 'payment_refunded': {
        if (!comm.invoice_id) throw ApiError.badRequest('Invoice no longer exists');
        const extra: Record<string, unknown> = {};
        if (key !== 'invoice_created') {
          const status = key === 'payment_received' ? 'succeeded' : key === 'payment_failed' ? 'failed' : 'refunded';
          const pay = await pool.query(
            `SELECT amount, refunded_amount FROM payments WHERE invoice_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1`,
            [comm.invoice_id, status],
          );
          const p = pay.rows[0];
          if (p) extra.amount = key === 'payment_refunded' ? Number(p.refunded_amount || p.amount) : Number(p.amount);
        }
        result = await communicationService.sendInvoiceTemplate(comm.invoice_id, key, sentBy, extra);
        break;
      }
      case 'service_completed':
        if (!comm.appointment_id) throw ApiError.badRequest('Appointment no longer exists');
        result = await communicationService.sendServiceReport(comm.appointment_id, sentBy);
        break;
      case 'agreement_signed_copy': {
        const file = await pool.query(
          `SELECT id FROM files
           WHERE customer_id = $1 AND deleted_at IS NULL AND upload_status = 'uploaded'
             AND mime_type = 'application/pdf' AND file_name LIKE 'service-agreement-signed-%'
           ORDER BY updated_at DESC LIMIT 1`,
          [comm.customer_id],
        );
        if (!file.rows[0]) throw ApiError.badRequest('No signed agreement on file for this customer');
        result = await communicationService.sendSignedAgreementCopy(comm.customer_id, file.rows[0].id, sentBy);
        break;
      }
      case 'agreement_review_sign':
        result = await communicationService.sendAgreementReviewRequest(comm.customer_id, sentBy, null, apiBaseUrl ?? null);
        break;
      default:
        throw ApiError.badRequest(`${String(key).replace(/_/g, ' ')} messages cannot be re-sent`);
    }
    if (!result) throw ApiError.badRequest('Customer has no email address on file');
    await pool.query(`UPDATE communications SET resent_communication_id = $2 WHERE id = $1`, [communicationId, result.id]);
    return result;
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
