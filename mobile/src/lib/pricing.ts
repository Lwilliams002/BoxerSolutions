// Boxer Solutions residential pest control pricing sheet.
// Initial = one-time initial service charge. Regular = recurring per-treatment charge.

export interface SizeTier {
  label: string;
  initial: number;
  regular: number;
}

// Standard Four Point Service — tiered by home size.
export const HOME_SIZES: SizeTier[] = [
  { label: 'Townhome', initial: 340, regular: 139 },
  { label: '1,000–2,000 sf', initial: 360, regular: 149 },
  { label: '2,000–3,000 sf', initial: 380, regular: 159 },
  { label: '3,000–4,000 sf', initial: 400, regular: 169 },
  { label: '4,000–5,000 sf', initial: 420, regular: 189 },
  { label: '5,000–6,000 sf', initial: 440, regular: 209 },
  { label: '6,000–7,000 sf', initial: 460, regular: 229 },
  { label: '8,000 sf+', initial: 490, regular: 249 },
];

export const STANDARD_PESTS = [
  'Box Elder Bugs',
  'Asian Beetles',
  'Centipedes',
  'Clovermites',
  'Crickets',
  'Sow / Pill Bug',
  'Spiders',
  'Household Ants',
  'Palmetto Bugs',
];

// Additional Service: All Yard Ants (incl. Fire Ants & Carpenter Ants) — own tiers.
export const YARD_ANT_TIERS: SizeTier[] = [
  { label: '1,000–2,000 sf', initial: 205, regular: 99 },
  { label: '2,000–3,000 sf', initial: 225, regular: 109 },
  { label: '3,000–4,000 sf', initial: 255, regular: 119 },
  { label: '4,000 sf+', initial: 310, regular: 129 },
];
export const YARD_ANT_PESTS = ['Yard Ants', 'Fire Ants', 'Carpenter Ants'];

// Recurring add-ons (added to the Regular Treatment charge).
export interface AddOn {
  key: string;
  label: string;
  addRegular: number;
  pests: string[];
}
export const ADDONS: AddOn[] = [
  {
    key: 'pet',
    label: 'Outdoor Pet Protection (Flea & Tick)',
    addRegular: 32,
    pests: ['Fleas', 'Ticks'],
  },
  {
    key: 'venomous',
    label: 'Black Widow / Brown Recluse',
    addRegular: 1,
    pests: ['Black Widow', 'Brown Recluse'],
  },
];

// Web Removal + Web Prevention: initial-only fee, $0.08/sf, $150 minimum.
export const WEB_REMOVAL = { perSqft: 0.08, minimum: 150, pest: 'Spider Web Removal' };
export function webRemovalFee(sqft: number): number {
  return Math.max(WEB_REMOVAL.minimum, Math.round(sqft * WEB_REMOVAL.perSqft));
}

// Odd Jobs — single-pest specialized services. One-time total over N treatments.
export interface OddJob {
  key: string;
  label: string;
  total: number;
  treatments: number;
  pest: string;
}
export const ODD_JOBS: OddJob[] = [
  { key: 'wasps', label: 'Wasps / Hornets', total: 150, treatments: 1, pest: 'Wasps / Hornets' },
  { key: 'millipedes', label: 'Millipedes', total: 285, treatments: 3, pest: 'Millipedes' },
  { key: 'silverfish', label: 'Silverfish', total: 185, treatments: 2, pest: 'Silverfish' },
  { key: 'earwigs', label: 'Earwigs', total: 220, treatments: 2, pest: 'Earwigs' },
];

export const AGREEMENT_TERM_MONTHS = 12;
