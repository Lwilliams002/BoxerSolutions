import crypto from 'crypto';
import { config } from '../../config';

/**
 * PCI-safe payment provider abstraction. The application never sees or stores
 * card numbers/CVV — only provider tokens. Swap the mock provider for a real
 * adapter (e.g. Stripe) by implementing this interface and setting
 * PAYMENT_PROVIDER in the environment.
 */
export interface TokenizedPaymentMethod {
  providerPaymentMethodId: string;
  brand: string;
  last4: string;
  expirationMonth: number;
  expirationYear: number;
}

export interface ChargeResult {
  success: boolean;
  transactionId: string | null;
  failureReason: string | null;
}

export interface PaymentProvider {
  name: string;
  /** Exchange a client-side token for a stored payment method reference. */
  attachPaymentMethod(token: string): Promise<TokenizedPaymentMethod>;
  charge(providerPaymentMethodId: string, amountCents: number, currency: string, description: string): Promise<ChargeResult>;
  refund(transactionId: string, amountCents: number): Promise<ChargeResult>;
}

/**
 * Mock provider for development/testing. Accepts tokens shaped like
 * `tok_<brand>_<last4>` (e.g. tok_visa_4242). Tokens containing `declined`
 * simulate failures; charging a method whose id contains `fail` also fails —
 * this exercises the failed-payment path end to end.
 */
class MockPaymentProvider implements PaymentProvider {
  name = 'mock';

  async attachPaymentMethod(token: string): Promise<TokenizedPaymentMethod> {
    // Accepts the legacy `tok_<brand>_<last4>` shape and the richer
    // `tok_<brand>_<last4>_<mm>_<yyyy>` shape produced by the mobile card form.
    const match = /^tok_([a-z]+)_(\d{4})(?:_(\d{1,2})_(\d{2,4}))?$/.exec(token);
    if (!match) throw new Error('Invalid payment token');
    const brandMap: Record<string, string> = {
      visa: 'Visa',
      mastercard: 'Mastercard',
      amex: 'American Express',
      discover: 'Discover',
      declined: 'Visa',
      ach: 'Bank Account',
    };
    const brand = brandMap[match[1]] ?? 'Card';
    const now = new Date();
    let expirationMonth = 8;
    let expirationYear = now.getFullYear() + 3;
    if (match[3] && match[4]) {
      expirationMonth = parseInt(match[3], 10);
      const y = parseInt(match[4], 10);
      expirationYear = y < 100 ? 2000 + y : y;
    }
    return {
      providerPaymentMethodId: `pm_mock_${match[1]}_${match[2]}_${crypto.randomBytes(6).toString('hex')}`,
      brand,
      last4: match[2],
      expirationMonth,
      expirationYear,
    };
  }

  async charge(providerPaymentMethodId: string, amountCents: number): Promise<ChargeResult> {
    if (amountCents <= 0) {
      return { success: false, transactionId: null, failureReason: 'Invalid amount' };
    }
    if (providerPaymentMethodId.includes('declined') || providerPaymentMethodId.includes('fail')) {
      return { success: false, transactionId: null, failureReason: 'Card declined' };
    }
    return { success: true, transactionId: `txn_mock_${crypto.randomBytes(10).toString('hex')}`, failureReason: null };
  }

  async refund(transactionId: string): Promise<ChargeResult> {
    return { success: true, transactionId: `re_${transactionId}`, failureReason: null };
  }
}

function createProvider(): PaymentProvider {
  switch (config.payments.provider) {
    case 'mock':
      return new MockPaymentProvider();
    default:
      throw new Error(`Unknown payment provider: ${config.payments.provider}`);
  }
}

export const paymentProvider: PaymentProvider = createProvider();
