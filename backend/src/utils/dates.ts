/**
 * Calendar-date helpers. The API runs in the business's local timezone
 * (config.timezone, applied to process.env.TZ at startup), so "today" here is
 * the office's today, not UTC's.
 */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** DATE columns arrive as 'YYYY-MM-DD' strings; tolerate Date objects and timestamps too. */
export function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return todayIso(value);
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** Parse a date-only string at local noon so formatting never slips a day. */
export function parseIsoDateLocal(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}
