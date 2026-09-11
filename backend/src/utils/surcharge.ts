/**
 * Cash / ACH discount: listed prices include card processing, and customers
 * who pay by bank account, cash or check get this percentage off. Card
 * payments pay the listed price — no surcharge is ever added.
 */
export function computeDiscount(amount: number, percent: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(percent) || amount <= 0 || percent <= 0) return 0;
  return Math.round(amount * percent) / 100;
}

export function discountLabel(percent: number, method: 'bank' | 'cash' | 'check'): string {
  const how = method === 'bank' ? 'Bank payment' : method === 'cash' ? 'Cash payment' : 'Check payment';
  return `${how} discount (${Number(percent.toFixed(2))}%)`;
}
