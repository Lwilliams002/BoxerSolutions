/**
 * Customer-facing emails about visits: a single appointment (confirmed,
 * reminder, on the way, rescheduled) or the whole upcoming schedule (built or
 * updated). Pure: takes preformatted strings and returns HTML / plain text.
 */
import { escapeHtml } from './serviceNotificationEmail';

export interface ScheduleEmailVisit {
  /** "Monday, October 5, 2026" */
  date: string;
  /** "9:00 AM – 10:00 AM" */
  window: string;
  technician?: string | null;
  /** Short tag such as "Initial service". */
  note?: string | null;
}

export interface ScheduleEmailInput {
  company: { name: string; phone: string; email: string; addressLines: string[]; license: string };
  heading: string;
  intro: string;
  /** Service address line, shown above the visits. */
  address?: string | null;
  visits: ScheduleEmailVisit[];
  /** "Plus 14 more visits through …" */
  moreNote?: string | null;
  closing?: string | null;
  /** Boxed note under the visits, used for the payment line. */
  highlight?: string | null;
  portalUrl?: string | null;
}

const TEAL = '#2DC4A2';
const INK = '#0D0D0D';
const MUTED = '#5B6B68';

export function renderScheduleEmailHtml(input: ScheduleEmailInput): string {
  const rows = input.visits.map((v) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #E3ECEA;font:700 13px Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(v.date)}${v.note ? `<br><span style="font:11px Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(v.note)}</span>` : ''}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E3ECEA;font:13px Helvetica,Arial,sans-serif;color:${INK};white-space:nowrap;">${escapeHtml(v.window)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #E3ECEA;font:13px Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(v.technician || 'To be assigned')}</td>
        </tr>`).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.heading)}</title></head>
<body style="margin:0;padding:0;background:#F0FAF8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0FAF8;padding:16px 0;">
<tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border-radius:10px;overflow:hidden;">
  <tr><td style="background:${INK};padding:16px 24px;">
    <div style="font:900 18px Helvetica,Arial,sans-serif;color:#FFFFFF;">${escapeHtml(input.company.name)}</div>
    <div style="font:12px Helvetica,Arial,sans-serif;color:#BFD2CE;margin-top:2px;">${escapeHtml(input.company.phone)} &nbsp;·&nbsp; ${escapeHtml(input.company.license)}</div>
  </td></tr>
  <tr><td style="padding:20px 24px 6px;">
    <div style="font:800 20px Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(input.heading)}</div>
    <p style="margin:10px 0 0;font:14px/21px Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(input.intro)}</p>
    ${input.address ? `<p style="margin:10px 0 0;font:13px/19px Helvetica,Arial,sans-serif;color:${MUTED};"><b style="color:${INK};">Service address:</b> ${escapeHtml(input.address)}</p>` : ''}
  </td></tr>
  <tr><td style="padding:12px 24px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #D5EDE9;border-radius:8px;border-collapse:separate;overflow:hidden;">
      <tr>
        <th align="left" style="padding:8px 12px;background:${TEAL};font:800 12px Helvetica,Arial,sans-serif;color:${INK};">Date</th>
        <th align="left" style="padding:8px 12px;background:${TEAL};font:800 12px Helvetica,Arial,sans-serif;color:${INK};">Arrival window</th>
        <th align="left" style="padding:8px 12px;background:${TEAL};font:800 12px Helvetica,Arial,sans-serif;color:${INK};">Technician</th>
      </tr>${rows}
    </table>
    ${input.moreNote ? `<p style="margin:8px 0 0;font:12px/18px Helvetica,Arial,sans-serif;color:${MUTED};">${escapeHtml(input.moreNote)}</p>` : ''}
  </td></tr>
  ${input.highlight ? `<tr><td style="padding:12px 24px 0;"><div style="background:#EAF8F5;border:1px solid #BFE8DF;border-radius:8px;padding:12px 14px;font:13px/20px Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(input.highlight)}</div></td></tr>` : ''}
  ${input.portalUrl ? `<tr><td style="padding:12px 24px 0;"><a href="${escapeHtml(input.portalUrl)}" style="display:inline-block;background:${TEAL};color:${INK};font:700 13px Helvetica,Arial,sans-serif;text-decoration:none;padding:10px 18px;border-radius:6px;">View in your customer portal</a></td></tr>` : ''}
  <tr><td style="padding:14px 24px 20px;">
    ${input.closing ? `<p style="margin:0;font:13px/20px Helvetica,Arial,sans-serif;color:${INK};">${escapeHtml(input.closing)}</p>` : ''}
    <p style="margin:12px 0 0;font:11px/16px Helvetica,Arial,sans-serif;color:${MUTED};border-top:1px solid #E3ECEA;padding-top:10px;">${escapeHtml(input.company.name)}${input.company.addressLines.length ? ` · ${escapeHtml(input.company.addressLines.join(', '))}` : ''} · ${escapeHtml(input.company.phone)} · ${escapeHtml(input.company.email)}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function renderScheduleEmailText(input: ScheduleEmailInput): string {
  return [
    input.heading,
    '',
    input.intro,
    ...(input.address ? ['', `Service address: ${input.address}`] : []),
    '',
    ...input.visits.map((v) => `- ${v.date}, ${v.window}${v.technician ? ` · ${v.technician}` : ''}${v.note ? ` (${v.note})` : ''}`),
    ...(input.moreNote ? ['', input.moreNote] : []),
    ...(input.highlight ? ['', input.highlight] : []),
    ...(input.closing ? ['', input.closing] : []),
    ...(input.portalUrl ? ['', `Customer portal: ${input.portalUrl}`] : []),
    '',
    `${input.company.name} · ${input.company.phone}`,
  ].join('\n');
}
