import { Queryable, pool } from '../config/db';

export interface CompanySettings {
  companyName: string;
  phone: string;
  address: string;
  licenseNumber: string;
  defaultTaxRate: number;
  invoiceDueDays: number;
  appointmentReminderHours: number;
}

export const DEFAULT_SETTINGS: CompanySettings = {
  companyName: 'Boxer Solutions Pest Control',
  phone: '3057135011',
  address: '2500 Bee Cave Rd, Austin, TX 78746',
  licenseNumber: 'TPCL-0099421',
  defaultTaxRate: 0.0825,
  invoiceDueDays: 15,
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
    address: String(company.address ?? DEFAULT_SETTINGS.address),
    licenseNumber: String(company.licenseNumber ?? company.license ?? DEFAULT_SETTINGS.licenseNumber),
    defaultTaxRate: readNumber(company.defaultTaxRate ?? company.taxRate ?? invoicing.defaultTaxRate, DEFAULT_SETTINGS.defaultTaxRate),
    invoiceDueDays: readNumber(invoicing.invoiceDueDays ?? invoicing.defaultDueDays, DEFAULT_SETTINGS.invoiceDueDays),
    appointmentReminderHours: readNumber(appointments.appointmentReminderHours ?? appointments.reminderHours, DEFAULT_SETTINGS.appointmentReminderHours),
  };
}
