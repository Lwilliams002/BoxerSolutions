/** Card processing surcharge: a percentage of the amount, cents-rounded; never applied to bank/cash/check. */
export function computeSurcharge(amount: number, percent: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(percent) || amount <= 0 || percent <= 0) return 0;
  return Math.round(amount * percent) / 100;
}

export function surchargeLabel(percent: number): string {
  return `Card processing surcharge (${Number(percent.toFixed(2))}%)`;
}
