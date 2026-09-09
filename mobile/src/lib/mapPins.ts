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
