import { pool } from '../config/db';
import { config } from '../config';
import { logger } from '../utils/logger';
import { customerService } from './customerService';
import { getCompanyInfo } from './settingsService';
import { getOutboundMessageProvider, notifications } from '../integrations/notifications';

/**
 * Public service requests (website form, app "Request service" for new
 * customers). Anyone can submit; the request becomes a Lead customer (or
 * attaches to the existing customer with the same email/phone) plus a
 * service request for the office to review, quote and schedule.
 */
export interface PublicRequestInput {
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  pest?: string | null;
  message?: string | null;
  source: 'website' | 'app';
}

export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? 'Customer', lastName: '(lead)' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

/** "20560 NW 17th Ave, Miami Gardens, FL 33056" → parts; tolerant of missing pieces. */
export function parseAddress(address: string | null | undefined): { addressLine1: string; city: string; state: string; postalCode: string } | null {
  const raw = (address ?? '').trim();
  if (!raw) return null;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const addressLine1 = parts[0] ?? raw;
  let city = parts[1] ?? '';
  let state = 'FL';
  let postalCode = '';
  const tail = parts.slice(2).join(' ') || '';
  const m = `${city} ${tail}`.match(/\b([A-Z]{2})\b\s*(\d{5})?/);
  if (m) { state = m[1]; postalCode = m[2] ?? ''; }
  // ZIP lives after the street; never read the house number as a ZIP.
  const afterStreet = parts.slice(1).join(', ');
  const zip = afterStreet.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zip) postalCode = zip[1];
  city = city.replace(/\b[A-Z]{2}\b\s*\d{5}(-\d{4})?/, '').replace(/\d{5}(-\d{4})?/, '').trim();
  return { addressLine1, city: city || 'Unknown', state, postalCode };
}

async function systemUserId(): Promise<string> {
  const { rows } = await pool.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.code = 'OWNER' ORDER BY u.created_at LIMIT 1`,
  );
  return rows[0]?.id;
}

export async function submitPublicRequest(input: PublicRequestInput) {
  const phone = normalizePhone(input.phone);
  const email = input.email?.trim().toLowerCase() || null;
  const { firstName, lastName } = splitName(input.name);
  const description = [input.pest ? `Pest: ${input.pest}` : null, input.message?.trim() || null, `Submitted from the ${input.source}${input.address ? ` · Address given: ${input.address.trim()}` : ''}`]
    .filter(Boolean).join('\n');

  // Attach to an existing customer when the email or phone is already on file.
  const existing = await pool.query(
    `SELECT id, status FROM customers WHERE deleted_at IS NULL AND (($1::text <> '' AND lower(email) = $1) OR ($2::text <> '' AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $2))
     ORDER BY created_at LIMIT 1`,
    [email ?? '', phone],
  );
  let customerId: string;
  let isNewCustomer = false;
  if (existing.rows[0]) {
    customerId = existing.rows[0].id;
  } else {
    const owner = await systemUserId();
    const loc = parseAddress(input.address);
    const created = (await customerService.create(
      {
        firstName, lastName, email, phone: phone || null, customerType: 'residential', status: 'lead', autopayEnabled: false,
        notes: `Lead from the ${input.source} form`,
        ...(loc ? { serviceLocation: { label: 'Home', ...loc } } : {}),
      },
      owner,
    )) as { id: string };
    customerId = created.id;
    isNewCustomer = true;
  }

  const sr = await pool.query('INSERT INTO service_requests (customer_id, description) VALUES ($1, $2) RETURNING id', [customerId, description]);
  const requestId = String(sr.rows[0].id);

  // Office: in-app + push to owners, plus an email to the customer service inbox.
  try {
    const company = await getCompanyInfo();
    const owners = await pool.query(
      `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE r.code IN ('OWNER','ADMIN','OFFICE_MANAGER') AND u.deleted_at IS NULL AND u.is_active = true`,
    );
    for (const o of owners.rows) {
      await notifications.send({
        userId: o.id, customerId, channel: 'push', type: 'service_request_submitted',
        title: `${isNewCustomer ? 'New lead' : 'Service request'}: ${input.name.trim()}`,
        body: `${input.phone}${input.pest ? ` · ${input.pest}` : ''}${input.address ? ` · ${input.address.trim()}` : ''}`,
        data: { serviceRequestId: requestId, customerId },
      });
    }
    await getOutboundMessageProvider('email').send({
      communicationId: `public-request-${requestId}`, channel: 'email', to: company.email, templateKey: 'website_estimate',
      subject: `${isNewCustomer ? 'New lead' : 'Service request'} — ${input.name.trim()}${input.pest ? ` (${input.pest})` : ''}`,
      body: [`${isNewCustomer ? 'A new lead' : 'An existing customer'} requested service from the ${input.source}.`, '', `Name: ${input.name.trim()}`, `Phone: ${input.phone}`, `Email: ${email ?? 'not provided'}`, `Address: ${input.address?.trim() || 'not provided'}`, `Pest: ${input.pest || 'not specified'}`, '', input.message?.trim() || '(no additional details)', '', 'Review it under Needs Approval on the dashboard.', `Submitted ${new Date().toLocaleString('en-US', { timeZone: config.timezone })}`].join('\n'),
    });
    if (email) {
      await getOutboundMessageProvider('email').send({
        communicationId: `public-request-ack-${requestId}`, channel: 'email', to: email, templateKey: 'website_estimate',
        subject: `We received your request — ${company.name}`,
        body: `Hi ${firstName},\n\nThanks for reaching out to ${company.name}. We received your request${input.pest ? ` about ${input.pest.toLowerCase()}` : ''} and will call ${input.phone} shortly to confirm details and schedule your visit.\n\nQuestions in the meantime? Call ${company.phone} or reply to this email.\n\n${company.name}${company.addressLines.length ? `\n${company.addressLines.join(', ')}` : ''}`,
      });
    }
  } catch (err) {
    logger.error({ err, requestId }, 'public request notifications failed');
  }
  return { customerId, requestId, isNewCustomer };
}
