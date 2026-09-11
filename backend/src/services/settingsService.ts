import { Queryable, pool } from '../config/db';

export interface CompanySettings {
  companyName: string;
  phone: string;
  email: string;
  address: string;
  licenseNumber: string;
  defaultTaxRate: number;
  invoiceDueDays: number;
  /** Charge the saved payment method when a recurring visit is completed (owner default: off). */
  chargeRecurringOnCompletion: boolean;
  /** Percentage added to card payments to offset processing fees (0 disables). Never applied to bank/cash/check. */
  cardSurchargePercent: number;
  appointmentReminderHours: number;
}

export const DEFAULT_SETTINGS: CompanySettings = {
  companyName: 'Boxer Solutions Pest Control',
  phone: '3057135011',
  email: 'service@boxersolutionspestcontrol.com',
  address: '',
  licenseNumber: '',
  defaultTaxRate: 0.0825,
  invoiceDueDays: 15,
  chargeRecurringOnCompletion: false,
  cardSurchargePercent: 4,
  appointmentReminderHours: 24,
};

function readNumber(value: unknown, fallback: number) {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export async function getCompanySettings(db: Queryable = pool): Promise<CompanySettings> {
  const { rows } = await db.query(`SELECT key, value FROM settings WHERE key IN ('company', 'invoicing', 'appointments')`);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value ?? {}])) as Record<string, Record<string, unknown>>;
  const company = byKey.company ?? {};
  const invoicing = byKey.invoicing ?? {};
  const appointments = byKey.appointments ?? {};
  return {
    companyName: String(company.companyName ?? company.name ?? DEFAULT_SETTINGS.companyName),
    phone: String(company.phone ?? DEFAULT_SETTINGS.phone),
    email: String(company.email ?? DEFAULT_SETTINGS.email),
    address: String(company.address ?? DEFAULT_SETTINGS.address),
    licenseNumber: String(company.licenseNumber ?? company.license ?? DEFAULT_SETTINGS.licenseNumber),
    defaultTaxRate: readNumber(company.defaultTaxRate ?? company.taxRate ?? invoicing.defaultTaxRate, DEFAULT_SETTINGS.defaultTaxRate),
    invoiceDueDays: readNumber(invoicing.invoiceDueDays ?? invoicing.defaultDueDays, DEFAULT_SETTINGS.invoiceDueDays),
    chargeRecurringOnCompletion: invoicing.chargeRecurringOnCompletion === true,
    cardSurchargePercent: readNumber(invoicing.cardSurchargePercent, DEFAULT_SETTINGS.cardSurchargePercent),
    appointmentReminderHours: readNumber(appointments.appointmentReminderHours ?? appointments.reminderHours, DEFAULT_SETTINGS.appointmentReminderHours),
  };
}

/** Printed when the owner has not entered a license number. */
export const LICENSE_PLACEHOLDER = '---------';

/** Company identity as printed on customer-facing emails and documents. */
export interface CompanyInfo {
  name: string;
  phone: string;
  email: string;
  addressLines: string[];
  /** "License #: …" or the placeholder dashes when blank. */
  license: string;
  licenseNumber: string;
  cardSurchargePercent: number;
}

export function formatPhone(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return raw.trim();
}

/** "20560 NW 17th Ave, Miami Gardens, FL 33056" → ["20560 NW 17th Ave", "Miami Gardens, FL 33056"]; newlines are kept as lines. */
export function splitAddressLines(address: string): string[] {
  const trimmed = address.trim();
  if (!trimmed) return [];
  if (trimmed.includes('\n')) return trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const comma = trimmed.indexOf(',');
  if (comma === -1) return [trimmed];
  return [trimmed.slice(0, comma).trim(), trimmed.slice(comma + 1).trim()].filter(Boolean);
}

export function toCompanyInfo(settings: Pick<CompanySettings, 'companyName' | 'phone' | 'email' | 'address' | 'licenseNumber'> & { cardSurchargePercent?: number }): CompanyInfo {
  const licenseNumber = settings.licenseNumber.trim();
  return {
    name: settings.companyName.trim() || DEFAULT_SETTINGS.companyName,
    phone: formatPhone(settings.phone || DEFAULT_SETTINGS.phone),
    email: settings.email.trim() || DEFAULT_SETTINGS.email,
    addressLines: splitAddressLines(settings.address),
    license: `License #: ${licenseNumber || LICENSE_PLACEHOLDER}`,
    licenseNumber,
    cardSurchargePercent: Number(settings.cardSurchargePercent ?? 0) || 0,
  };
}

export async function getCompanyInfo(db: Queryable = pool): Promise<CompanyInfo> {
  return toCompanyInfo(await getCompanySettings(db));
}
