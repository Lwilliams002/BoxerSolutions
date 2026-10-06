/** Shared pin model for the territory map (native + web). */
export type CustomerStage = 'lead' | 'signed' | 'serviced';

export interface MapPin {
  id: string;
  customerId: string;
  addressLine1: string;
  city: string;
  state?: string;
  postalCode?: string;
  latitude: number;
  longitude: number;
  firstName: string;
  lastName: string;
  company: string | null;
  stage: CustomerStage;
  inactive: boolean;
  dealOwnerName: string | null;
  technicianName: string | null;
  canOpen: boolean;
  createdAt?: string;
  /** Last completed visit (YYYY-MM-DD). */
  lastServiceDate?: string | null;
  nextServiceDate?: string | null;
  planAmount?: string | number | null;
  planFrequency?: string | null;
}

/** Door-knocking outcomes recorded on a house that is not (yet) a customer. */
export type ProspectStatus = 'not_home' | 'talked_to' | 'call_back' | 'not_interested';

export interface ProspectPin {
  id: string;
  latitude: number;
  longitude: number;
  status: ProspectStatus;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  callbackDate: string | null;
  knockCount: number;
  lastKnockedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  events?: { id: string; status: string; note: string | null; callbackDate: string | null; createdByName: string | null; createdAt: string }[];
}

export const PROSPECT_STATUS_META: Record<ProspectStatus, { label: string; color: string; icon: string }> = {
  not_home: { label: 'Not home', color: '#8A9A96', icon: 'home-outline' },
  talked_to: { label: 'Talked to', color: '#2F80ED', icon: 'chatbubble-ellipses-outline' },
  call_back: { label: 'Call back', color: '#F2994A', icon: 'call-outline' },
  not_interested: { label: 'Not interested', color: '#D93025', icon: 'close-circle-outline' },
};

export const PROSPECT_STATUS_ORDER: ProspectStatus[] = ['not_home', 'talked_to', 'call_back', 'not_interested'];

export function prospectTitle(p: Pick<ProspectPin, 'addressLine1' | 'city' | 'contactName'>) {
  return p.addressLine1 || p.contactName || 'Dropped pin';
}

/** "Call back Tue, Oct 6" / "Knocked 3× · last Mon" */
export function prospectSubtitle(p: ProspectPin) {
  const parts: string[] = [PROSPECT_STATUS_META[p.status].label];
  if (p.status === 'call_back' && p.callbackDate) parts.push(`call back ${fmtShort(p.callbackDate)}`);
  parts.push(`knocked ${p.knockCount}× · last ${fmtShort(p.lastKnockedAt)}`);
  return parts.join(' · ');
}

function fmtShort(value: string) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function fmtPinDate(value: string | null | undefined) {
  if (!value) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}

const FREQ_LABEL: Record<string, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', bimonthly: 'Every 2 months', quarterly: 'Quarterly' };
export function planLabel(pin: Pick<MapPin, 'planAmount' | 'planFrequency'>) {
  if (pin.planAmount == null) return null;
  const amount = `$${Number(pin.planAmount).toFixed(2)}`;
  return `${FREQ_LABEL[pin.planFrequency ?? ''] ?? 'Recurring'} · ${amount}/visit`;
}

export const STAGE_META: Record<CustomerStage, { label: string; color: string }> = {
  lead: { label: 'Lead', color: '#8A9A96' },
  signed: { label: 'Signed', color: '#2DC4A2' },
  serviced: { label: 'Serviced', color: '#0F7B3F' },
};

export const STAGE_ORDER: CustomerStage[] = ['lead', 'signed', 'serviced'];

export function pinColor(pin: Pick<MapPin, 'stage' | 'inactive'>) {
  return pin.inactive ? '#B9C9C5' : STAGE_META[pin.stage].color;
}

export function pinTitle(pin: Pick<MapPin, 'company' | 'firstName' | 'lastName'>) {
  return pin.company ?? `${pin.firstName} ${pin.lastName}`;
}

export function pinSubtitle(pin: MapPin) {
  const parts = [`${STAGE_META[pin.stage].label}${pin.inactive ? ' · Inactive' : ''}`];
  if (pin.dealOwnerName) parts.push(`Deal: ${pin.dealOwnerName}`);
  if (pin.technicianName) parts.push(`Tech: ${pin.technicianName}`);
  return parts.join(' · ');
}

export function filterPins(pins: MapPin[], stages: Set<CustomerStage>) {
  return pins.filter((p) => stages.has(p.stage));
}
