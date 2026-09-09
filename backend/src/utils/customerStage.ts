/** Where a customer is in the pipeline, shown as the pin color on the map. */
export type CustomerStage = 'lead' | 'signed' | 'serviced';

export const STAGE_COLORS: Record<CustomerStage, string> = { lead: '#8A9A96', signed: '#2DC4A2', serviced: '#0F7B3F' };

export function deriveStage(input: { hasSignedAgreement: boolean; hasCompletedService: boolean }): CustomerStage {
  if (input.hasCompletedService) return 'serviced';
  if (input.hasSignedAgreement) return 'signed';
  return 'lead';
}
