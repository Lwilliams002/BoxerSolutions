/**
 * Customer-facing explanations printed on every service agreement (in-app
 * document, emailed signing page, and the signed PDF). Mirrored in
 * mobile/src/lib/agreementContent.ts.
 */
export const EGG_CYCLE_TITLE = 'Egg Cycle';
export const EGG_CYCLE_BADGE = '30-45 Day Followup';
export const EGG_CYCLE_TEXT =
  "The first treatment around your home is what is called an 'initial flush out'. This special treatment attempts to gain control over existing pest populations. Your first regular treatment should follow within 30-45 days of the initial treatment to help break up egg cycles. Insects are immune to treatments while in their egg shells and our products must be active to catch pests as they hatch.";

export const INSECT_ACTIVITY_TITLE = 'Insect Activity';
export function insectActivityText(phone: string) {
  return `Initially you may see a slight increase in pest activity as pest populations are disrupted. Within a few weeks you should see this activity drastically decline as our products take effect. Over time, these pest levels will continually decrease as regular services are performed. Regular treatments are critical in maintaining protective barriers and preventing infestations from reoccurring. If you see more than the occasional pest around your home, please call ${phone} at any time for a complimentary retreat!`;
}

/** Note under the charge schedule grid. */
export function scheduleNote(frequencyLabel: string, termMonths: number, isUpdate: boolean) {
  return `(I) ${isUpdate ? 'due now for the added services' : 'initial flush-out service'}. First regular service 30 days after the initial to break the egg cycle, then ${frequencyLabel.toLowerCase()} through the ${termMonths}-month term, continuing at the same cadence until canceled.`;
}

/** Price-sheet pest lists, always printed on the agreement (mirrors mobile/src/lib/pricing.ts). */
export const INCLUDED_PESTS = ['Box Elder Bugs', 'Asian Beetles', 'Centipedes', 'Clovermites', 'Crickets', 'Sow / Pill Bug', 'Spiders', 'Household Ants', 'Palmetto Bugs'];
export const ADDITIONAL_PESTS = ['Yard Ants', 'Fire Ants', 'Carpenter Ants', 'Fleas', 'Ticks', 'Black Widow', 'Brown Recluse', 'Spider Web Removal', 'Wasps / Hornets', 'Millipedes', 'Silverfish', 'Earwigs'];

function pestKey(name: string) {
  const k = name.toLowerCase().replace(/[^a-z]/g, '');
  return k.endsWith('s') ? k : `${k}s`;
}
export interface AgreementPest { name: string; selected: boolean }
/** Both lists with each pest flagged if the signed agreement covers it. */
export function agreementPestLists(covered: string[]): { included: AgreementPest[]; additional: AgreementPest[] } {
  const on = new Set(covered.map(pestKey));
  return {
    included: INCLUDED_PESTS.map((name) => ({ name, selected: on.has(pestKey(name)) })),
    additional: ADDITIONAL_PESTS.map((name) => ({ name, selected: on.has(pestKey(name)) })),
  };
}
