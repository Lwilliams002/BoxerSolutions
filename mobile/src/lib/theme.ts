// Boxer Solutions Pest Control brand palette
// Teal: #2DC4A2  |  Black: #0D0D0D  |  White: #FFFFFF
export const company = {
  name: 'Boxer Solutions Pest Control',
  tagline: 'Pest Control',
  addressLine1: '2500 Bee Cave Rd',
  addressLine2: 'Austin, TX 78746',
  phone: '(3057135011',
  email: 'service@boxersolutionspestcontrol.com',
  license: 'License #: TPCL-0099421',
};

export const colors = {
  primary: '#2DC4A2',
  primaryDark: '#1E9C81',
  accent: '#0D0D0D',
  bg: '#F0FAF8',
  card: '#FFFFFF',
  text: '#0D0D0D',
  textMuted: '#607D78',
  border: '#D5EDE9',
  danger: '#D93025',
  success: '#2DC4A2',
  warning: '#D4860A',
  info: '#1A7A9E',
};

export const statusColors: Record<string, string> = {
  owner: colors.accent,
  trusted_technician: colors.primary,
  technician: colors.info,
  scheduled: colors.info,
  en_route: colors.accent,
  arrived: colors.accent,
  in_progress: colors.warning,
  completed: colors.success,
  cancelled: colors.textMuted,
  no_access: colors.danger,
  rescheduled: colors.info,
  draft: colors.textMuted,
  sent: colors.info,
  open: colors.info,
  partially_paid: colors.warning,
  paid: colors.success,
  past_due: colors.danger,
  void: colors.textMuted,
  active: colors.success,
  paused: colors.warning,
  inactive: colors.textMuted,
  succeeded: colors.success,
  failed: colors.danger,
};

export function statusLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function money(v: string | number | null | undefined): string {
  const n = typeof v === 'string' ? parseFloat(v) : v ?? 0;
  return `$${(Number.isFinite(n) ? (n as number) : 0).toFixed(2)}`;
}

export function fmtTime(t?: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function fmtDate(d?: string | null): string {
  if (!d) return '';
  // Date-only strings parse as UTC midnight and shift a day in negative-offset
  // timezones; anchor them to local noon instead.
  const dt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
