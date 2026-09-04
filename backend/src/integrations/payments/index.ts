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

export interface ChargeOptions {
  /**
   * Merchant-Initiated Transaction (AutoPay / recurring billing). Per EPX,
   * MIT token sales must include aci_ext (e.g. RB for Recurring Billing);
   * Customer-Initiated (CIT) transactions omit it.
   */
  mit?: boolean;
}

export interface PaymentProvider {
  name: string;
  /** Exchange a client-side token for a stored payment method reference. */
  attachPaymentMethod(token: string): Promise<TokenizedPaymentMethod>;
  charge(providerPaymentMethodId: string, amountCents: number, currency: string, description: string, options?: ChargeOptions): Promise<ChargeResult>;
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
    // Accepts the JSON payload shape used by the North provider so the same
    // mobile card form works against the mock in development.
    if (token.trim().startsWith('{')) {
      try {
        const data = JSON.parse(token) as {
          type?: string; number?: string; expMonth?: number; expYear?: number; accountNumber?: string;
        };
        const now = new Date();
        if (data.type === 'card' && data.number) {
          const digits = String(data.number).replace(/\D/g, '');
          const brandKey = /^4/.test(digits) ? 'Visa'
            : /^5[1-5]/.test(digits) || /^2[2-7]/.test(digits) ? 'Mastercard'
            : /^3[47]/.test(digits) ? 'American Express'
            : /^6(?:011|5)/.test(digits) ? 'Discover' : 'Card';
          return {
            providerPaymentMethodId: `pm_mock_json_${digits.slice(-4)}_${crypto.randomBytes(6).toString('hex')}`,
            brand: brandKey,
            last4: digits.slice(-4),
            expirationMonth: Number(data.expMonth) || 12,
            expirationYear: Number(data.expYear) || now.getFullYear() + 3,
          };
        }
        if (data.type === 'ach' && data.accountNumber) {
          const digits = String(data.accountNumber).replace(/\D/g, '');
          return {
            providerPaymentMethodId: `pm_mock_ach_${digits.slice(-4)}_${crypto.randomBytes(6).toString('hex')}`,
            brand: 'Bank Account',
            last4: digits.slice(-4),
            expirationMonth: 12,
            expirationYear: now.getFullYear() + 20,
          };
        }
        throw new Error('Invalid payment token');
      } catch {
        throw new Error('Invalid payment token');
      }
    }
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
    case 'north': {
      // Lazy require avoids a circular import (northGatewayService → config).
      const { NorthPaymentProvider } = require('./northProvider') as typeof import('./northProvider');
      return new NorthPaymentProvider();
    }
    default:
      throw new Error(`Unknown payment provider: ${config.payments.provider}`);
  }
}

export const paymentProvider: PaymentProvider = createProvider();
