/**
 * Customer-facing explanations printed on every service agreement. Mirrored
 * in backend/src/content/agreementTerms.ts so the in-app document and the
 * emailed/signed versions read the same.
 */
export const EGG_CYCLE_TITLE = 'Egg Cycle';
export const EGG_CYCLE_BADGE = '30-45 Day Followup';
export const EGG_CYCLE_TEXT =
  "The first treatment around your home is what is called an 'initial flush out'. This special treatment attempts to gain control over existing pest populations. Your first regular treatment should follow within 30-45 days of the initial treatment to help break up egg cycles. Insects are immune to treatments while in their egg shells and our products must be active to catch pests as they hatch.";

export const INSECT_ACTIVITY_TITLE = 'Insect Activity';
export function insectActivityText(phone: string) {
  return `Initially you may see a slight increase in pest activity as pest populations are disrupted. Within a few weeks you should see this activity drastically decline as our products take effect. Over time, these pest levels will continually decrease as regular services are performed. Regular treatments are critical in maintaining protective barriers and preventing infestations from reoccurring. If you see more than the occasional pest around your home, please call ${phone} at any time for a complimentary retreat!`;
}

/** Shown in place of the egg-cycle explanation when the follow-up was turned off on the agreement. */
export const EGG_CYCLE_SKIPPED_TEXT =
  'The 30-day egg-cycle follow-up is not included in this agreement. Regular service starts one interval after the initial service.';

/** Note under the charge schedule grid. */
export function scheduleNote(frequencyLabel: string, termMonths: number, isUpdate: boolean, eggCycle = true) {
  const first = eggCycle
    ? `First regular service 30 days after the initial to break the egg cycle, then ${frequencyLabel.toLowerCase()}`
    : `Regular service ${frequencyLabel.toLowerCase()} starting one interval after the initial (no 30-day egg-cycle follow-up)`;
  return `(I) ${isUpdate ? 'due now for the added services' : 'initial flush-out service'}. ${first} through the ${termMonths}-month term, continuing at the same cadence until canceled. Months without a charge are left blank.`;
}
