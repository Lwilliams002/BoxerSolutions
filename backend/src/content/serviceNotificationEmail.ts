
/**
 * Customer-facing "Service Notification" email: the invoice as a formatted
 * document (customer, service, technician comments, items, statement) with a
 * status banner for the event that triggered it. Pure: takes a context object
 * and returns HTML + plain text, so it is unit-testable and provider-agnostic.
 */
export type ServiceNotificationKind = 'invoice_created' | 'payment_received' | 'payment_failed' | 'payment_refunded';

export interface ServiceNotificationItem {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface ServiceNotificationPayment {
  amount: number;
  date: string | Date | null;
  method: string | null;
  receiptNumber: string | null;
}

export interface ServiceNotificationCompany {
  name: string;
  phone: string;
  email: string;
  addressLines: string[];
  /** Already formatted, e.g. "License #: JB500216" or "License #: ---------". */
  license: string;
}

const POISON_CONTROL = '(800) 222-1222';

export interface ServiceNotificationContext {
  kind: ServiceNotificationKind;
  company: ServiceNotificationCompany;
  /** Amount for the triggering event (payment/refund/failed attempt). */
  eventAmount?: number | null;
  eventReason?: string | null;
  customer: {
    name: string;
    firstName: string;
    email: string | null;
    phone: string | null;
    billingAddress: string[];
  };
  invoice: {
    number: string;
    date: string | Date;
    dueDate: string | Date | null;
    subtotal: number;
    discount: number;
    taxRate: number;
    taxAmount: number;
    total: number;
    amountPaid: number;
    notes: string | null;
    items: ServiceNotificationItem[];
  };
  serviceAddress: string[];
  appointment: {
    date: string | Date | null;
    technician: string | null;
    services: string[];
    window: string | null;
    timeIn: string | null;
    timeOut: string | null;
    comments: string | null;
  } | null;
  payments: ServiceNotificationPayment[];
  previousBalance: number;
}

const GREEN = '#0F7B3F';
const TEAL = '#2DC4A2';
const INK = '#0D0D0D';
const MUTED = '#5B6B68';
const RULE = '#0D0D0D';

export function money(n: number | null | undefined) {
  return `$${Number(n ?? 0).toFixed(2)}`;
}

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function longDate(value: string | Date | null | undefined) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function bannerFor(ctx: ServiceNotificationContext): { title: string; detail: string; color: string } {
  const amount = money(ctx.eventAmount ?? ctx.invoice.total);
  switch (ctx.kind) {
    case 'payment_received':
      return { title: `Payment received — ${amount}`, detail: `Thank you, ${ctx.customer.firstName}. This payment was applied to invoice ${ctx.invoice.number}.`, color: GREEN };
    case 'payment_failed':
      return { title: `Payment could not be processed — ${amount}`, detail: `${ctx.eventReason ? `${ctx.eventReason}. ` : ''}Please call ${ctx.company.phone} or update your payment method.`, color: '#B42318' };
    case 'payment_refunded':
      return { title: `Refund processed — ${amount}`, detail: `A refund was issued to your original payment method for invoice ${ctx.invoice.number}.`, color: GREEN };
    default:
      return { title: `Invoice ${ctx.invoice.number} is ready`, detail: `Please pay from this invoice${ctx.invoice.dueDate ? ` by ${longDate(ctx.invoice.dueDate)}` : ''}.`, color: INK };
  }
}

export function statementFor(ctx: ServiceNotificationContext) {
  const serviceTotal = ctx.invoice.total;
  const paymentsTotal = ctx.payments.reduce((s, p) => s + p.amount, 0);
  const collected = Math.max(paymentsTotal, ctx.invoice.amountPaid);
  const amountDue = Math.max(0, serviceTotal + ctx.previousBalance - collected);
  return { serviceTotal, previousBalance: ctx.previousBalance, payments: collected, amountDue };
}

function sectionTitle(text: string) {
  return `<tr><td colspan="2" style="padding:14px 0 4px;font:700 14px Helvetica,Arial,sans-serif;color:${GREEN};border-bottom:2px solid ${RULE};">${escapeHtml(text)}</td></tr>`;
}

function kv(label: string, value: string, opts: { html?: boolean } = {}) {
  const v = opts.html ? value : escapeHtml(value);
  return `<tr><td style="padding:3px 0;font:700 12px Helvetica,Arial,sans-serif;color:${INK};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:3px 0 3px 12px;font:12px Helvetica,Arial,sans-serif;color:${INK};text-align:right;">${v}</td></tr>`;
}

export function renderServiceNotificationHtml(ctx: ServiceNotificationContext): string {
  const banner = bannerFor(ctx);
  const stmt = statementFor(ctx);
  const appt = ctx.appointment;
  const companyAddress = ctx.company.addressLines;

  const itemsRows = ctx.invoice.items.map((item) => `
    <tr>
      <td style="padding:6px 0;font:12px Helvetica,Arial,sans-serif;color:${INK};border-bottom:1px solid #E3ECEA;">${escapeHtml(item.description)}${item.quantity !== 1 ? ` <span style="color:${MUTED}">× ${item.quantity}</span>` : ''}</td>
      <td style="padding:6px 0;font:12px Helvetica,Arial,sans-serif;color:${INK};text-align:right;border-bottom:1px solid #E3ECEA;white-space:nowrap;">${money(item.lineTotal)}</td>
    </tr>`).join('');

  const paymentsRows = ctx.payments.length
    ? ctx.payments.map((p) => `
      <tr>
        <td style="padding:4px 0;font:12px Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(longDate(p.date))}${p.method ? ` · ${escapeHtml(p.method)}` : ''}${p.receiptNumber ? ` · Receipt ${escapeHtml(p.receiptNumber)}` : ''}</td>
        <td style="padding:4px 0;font:12px Helvetica,Arial,sans-serif;color:${INK};text-align:right;white-space:nowrap;">${money(p.amount)}</td>
      </tr>`).join('')
    : '';

  const serviceInfo = appt ? `
    ${kv('Tech', appt.technician ?? '—')}
    ${kv('Date', longDate(appt.date))}
    ${kv('Service', appt.services.join(', ') || '—')}
    ${appt.window ? kv('Service Time', appt.window) : ''}
    ${appt.timeIn ? kv('Time In', appt.timeIn) : ''}
    ${appt.timeOut ? kv('Time Out', appt.timeOut) : ''}` : `
    ${kv('Date', longDate(ctx.invoice.date))}
    ${kv('Service', ctx.invoice.items.map((i) => i.description).join(', ') || '—')}`;

  const comments = appt?.comments?.trim() || ctx.invoice.notes?.trim() || '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(banner.title)}</title></head>
<body style="margin:0;padding:0;background:#F0FAF8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0FAF8;padding:16px 0;">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;">

  <!-- Header -->
  <tr><td style="padding:18px 24px 12px;border-bottom:3px solid ${INK};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:top;">
        <div style="font:700 16px Helvetica,Arial,sans-serif;color:${INK};">Service Notification</div>
        <div style="font:13px Helvetica,Arial,sans-serif;color:${INK};margin-top:4px;">${escapeHtml(ctx.company.name)}</div>
        ${companyAddress.map((l) => `<div style="font:13px Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(l)}</div>`).join('')}
        <div style="font:12px Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(ctx.company.license)}</div>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font:700 13px Helvetica,Arial,sans-serif;color:${GREEN};">Customer Service</div>
        <div style="font:13px Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(ctx.company.email)}</div>
        <div style="font:13px Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(ctx.company.phone)}</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Status banner -->
  <tr><td style="padding:14px 24px;background:${banner.color};">
    <div style="font:700 16px Helvetica,Arial,sans-serif;color:#FFFFFF;">${escapeHtml(banner.title)}</div>
    <div style="font:13px Helvetica,Arial,sans-serif;color:#FFFFFF;opacity:.92;margin-top:3px;">${escapeHtml(banner.detail)}</div>
  </td></tr>

  <!-- Customer / Service info -->
  <tr><td style="padding:4px 24px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" style="vertical-align:top;padding-right:12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${sectionTitle('Customer Information')}
          ${kv('Customer', ctx.customer.name)}
          ${ctx.customer.email ? kv('Email', ctx.customer.email) : ''}
          ${ctx.customer.phone ? kv('Phone', ctx.customer.phone) : ''}
          ${kv('Invoice #', ctx.invoice.number)}
          ${kv('Invoice Date', longDate(ctx.invoice.date))}
          ${ctx.serviceAddress.length ? kv('Service Address', ctx.serviceAddress.map(escapeHtml).join('<br>'), { html: true }) : ''}
        </table>
      </td>
      <td width="50%" style="vertical-align:top;padding-left:12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${sectionTitle('Service Information')}
          ${serviceInfo}
        </table>
      </td>
    </tr></table>
  </td></tr>

  ${comments ? `
  <tr><td style="padding:0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${sectionTitle('Technician Comments')}
      <tr><td colspan="2" style="padding:8px 0 0;font:12px/18px Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(comments).replace(/\n/g, '<br>')}</td></tr>
    </table>
  </td></tr>` : ''}

  <!-- Invoice items -->
  <tr><td style="padding:0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${sectionTitle('Invoice Items')}
      ${itemsRows}
      <tr><td style="padding:6px 0 2px;font:12px Helvetica,Arial,sans-serif;color:${INK};">Subtotal</td><td style="padding:6px 0 2px;font:12px Helvetica,Arial,sans-serif;text-align:right;">${money(ctx.invoice.subtotal)}</td></tr>
      ${ctx.invoice.discount > 0 ? `<tr><td style="padding:2px 0;font:12px Helvetica,Arial,sans-serif;color:${INK};">Discount</td><td style="padding:2px 0;font:12px Helvetica,Arial,sans-serif;text-align:right;">-${money(ctx.invoice.discount)}</td></tr>` : ''}
      <tr><td style="padding:2px 0;font:12px Helvetica,Arial,sans-serif;color:${INK};">Tax ${(ctx.invoice.taxRate * 100).toFixed(3)} %</td><td style="padding:2px 0;font:12px Helvetica,Arial,sans-serif;text-align:right;">${money(ctx.invoice.taxAmount)}</td></tr>
      <tr><td style="padding:6px 0;font:700 13px Helvetica,Arial,sans-serif;color:${INK};border-top:2px solid ${RULE};">Service Total:</td><td style="padding:6px 0;font:700 13px Helvetica,Arial,sans-serif;text-align:right;border-top:2px solid ${RULE};">${money(ctx.invoice.total)}</td></tr>
    </table>
  </td></tr>

  ${paymentsRows ? `
  <tr><td style="padding:0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${sectionTitle('Payments')}
      ${paymentsRows}
    </table>
  </td></tr>` : ''}

  <!-- Safety footer -->
  <tr><td style="padding:18px 24px 12px;">
    <div style="font:11px/16px Helvetica,Arial,sans-serif;color:${INK};text-align:center;border-top:2px solid ${RULE};padding-top:12px;">
      ${escapeHtml(ctx.company.name)} is committed to the safety of our customers and our environment. All materials used by ${escapeHtml(ctx.company.name)} have been registered by the Environmental Protection Agency. Please avoid unnecessary contact with materials and comply with all instructions and recommendations from our technicians. Thanks for your patronage!<br>
      National Emergency Poison Control: ${POISON_CONTROL}
    </div>
  </td></tr>

  <!-- Billing / Total due / Statement -->
  <tr><td style="padding:0 24px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="34%" style="vertical-align:top;padding-right:8px;">
        <div style="background:${GREEN};color:#FFFFFF;font:700 12px Helvetica,Arial,sans-serif;text-align:center;padding:7px;border-radius:6px;">BILLING INFORMATION</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
          ${kv('Customer', ctx.customer.name)}
          ${kv('Invoice #', ctx.invoice.number)}
          ${ctx.customer.billingAddress.length ? kv('Address', ctx.customer.billingAddress.map(escapeHtml).join('<br>'), { html: true }) : ''}
          ${ctx.customer.phone ? kv('Phone', ctx.customer.phone) : ''}
          ${appt?.date ? kv('Service Date', longDate(appt.date)) : ''}
        </table>
      </td>
      <td width="32%" style="vertical-align:top;padding:0 8px;text-align:center;">
        <div style="font:700 13px Helvetica,Arial,sans-serif;color:${INK};margin-top:6px;">${stmt.amountDue > 0 ? 'Please pay from this invoice' : 'Paid in full — thank you'}</div>
        <div style="font:11px/15px Helvetica,Arial,sans-serif;color:${INK};margin-top:6px;">${stmt.amountDue > 0 ? 'If you are not able to pay online or remit payment to:' : 'Keep this notification for your records.'}</div>
        ${stmt.amountDue > 0 && companyAddress.length ? `<div style="font:11px/15px Helvetica,Arial,sans-serif;color:${INK};margin-top:6px;">${companyAddress.map(escapeHtml).join('<br>')}</div>` : ''}
        <div style="background:${GREEN};color:#FFFFFF;border-radius:8px;padding:12px 8px;margin-top:12px;">
          <div style="font:700 15px Helvetica,Arial,sans-serif;">Total Due</div>
          <div style="font:700 26px Helvetica,Arial,sans-serif;margin-top:2px;">${money(stmt.amountDue)}</div>
        </div>
      </td>
      <td width="34%" style="vertical-align:top;padding-left:8px;">
        <div style="background:${GREEN};color:#FFFFFF;font:700 12px Helvetica,Arial,sans-serif;text-align:center;padding:7px;border-radius:6px;">ACCOUNT STATEMENT</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
          ${kv('Service Total', money(stmt.serviceTotal))}
          ${kv('Previous Balance', money(stmt.previousBalance))}
          ${kv('Payments', money(stmt.payments))}
          <tr><td style="padding:6px 0;font:700 12px Helvetica,Arial,sans-serif;border-top:2px solid ${RULE};">Amount Due</td><td style="padding:6px 0 6px 12px;font:700 12px Helvetica,Arial,sans-serif;text-align:right;border-top:2px solid ${RULE};">${money(stmt.amountDue)}</td></tr>
        </table>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:0 24px 18px;font:11px Helvetica,Arial,sans-serif;color:${MUTED};text-align:center;">
    Questions? Reply to this email or call ${escapeHtml(ctx.company.phone)}. <span style="color:${TEAL}">■</span> ${escapeHtml(ctx.company.name)}
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** Plain-text twin for clients that don't render HTML, and for the communications log. */
export function renderServiceNotificationText(ctx: ServiceNotificationContext): string {
  const banner = bannerFor(ctx);
  const stmt = statementFor(ctx);
  const lines = [
    banner.title,
    banner.detail,
    '',
    `${ctx.company.name} · ${ctx.company.phone} · ${ctx.company.email}`,
    ...ctx.company.addressLines,
    ctx.company.license,
    '',
    `Customer: ${ctx.customer.name}`,
    `Invoice #: ${ctx.invoice.number} (${longDate(ctx.invoice.date)})`,
    ...(ctx.serviceAddress.length ? [`Service Address: ${ctx.serviceAddress.join(', ')}`] : []),
    ...(ctx.appointment ? [
      `Tech: ${ctx.appointment.technician ?? '—'}`,
      `Service Date: ${longDate(ctx.appointment.date)}`,
      `Service: ${ctx.appointment.services.join(', ') || '—'}`,
      ...(ctx.appointment.comments ? ['', 'Technician Comments:', ctx.appointment.comments] : []),
    ] : []),
    '',
    'Invoice Items:',
    ...ctx.invoice.items.map((i) => `  ${i.description}${i.quantity !== 1 ? ` x${i.quantity}` : ''}  ${money(i.lineTotal)}`),
    `  Subtotal ${money(ctx.invoice.subtotal)}`,
    ...(ctx.invoice.discount > 0 ? [`  Discount -${money(ctx.invoice.discount)}`] : []),
    `  Tax ${money(ctx.invoice.taxAmount)}`,
    `  Service Total ${money(ctx.invoice.total)}`,
    ...(ctx.payments.length ? ['', 'Payments:', ...ctx.payments.map((p) => `  ${longDate(p.date)}${p.method ? ` ${p.method}` : ''}  ${money(p.amount)}`)] : []),
    '',
    `Previous Balance ${money(stmt.previousBalance)}`,
    `Payments ${money(stmt.payments)}`,
    `Amount Due ${money(stmt.amountDue)}`,
  ];
  return lines.join('\n');
}
