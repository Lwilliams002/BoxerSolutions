export type ProviderName = 'north' | 'mock';

/**
 * The provider that must handle a stored method or recorded payment. Rows
 * created by North Embedded Checkout carry 'north' (older rows
 * 'north_embedded'); they are always charged/refunded through North so a
 * misconfigured PAYMENT_PROVIDER can never turn a real card into a mock.
 */
export function resolveProviderName(storedProvider: string | null | undefined, configuredProvider: string): ProviderName {
  const stored = (storedProvider ?? '').toLowerCase();
  if (stored === 'north' || stored === 'north_embedded') return 'north';
  if (stored === 'mock') return 'mock';
  return configuredProvider === 'north' ? 'north' : 'mock';
}
