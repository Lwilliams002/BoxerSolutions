import { northGatewayService } from '../../services/northGatewayService';
import { epxEmbeddedPaymentsService } from '../../services/epxEmbeddedPaymentsService';
import type { ChargeOptions, ChargeResult, PaymentProvider, RefundOptions, TokenizedPaymentMethod } from './index';

/**
 * North (Payments Hub) card-on-file provider.
 *
 * Vaulting: the mobile card form sends card/bank details as a JSON token over
 * TLS. They are forwarded straight to North's Recurring Billing API and never
 * stored or logged by this application — only North's numeric payment method
 * id plus display metadata (brand/last4/expiry) are persisted.
 *
 * Charging: `/chargepaymentmethod` (one-time payment, independent of any
 * subscription).
 *
 * Requires NORTH_MID, NORTH_DEVELOPER_KEY, NORTH_PASSWORD, NORTH_APPSOURCE and
 * NORTH_SIGNATURE_SECRET.
 */

interface CardTokenPayload {
  type: 'card';
  number: string;
  expMonth: number;
  expYear: number; // 4-digit
  cvv: string;
  firstName: string;
  lastName: string;
  postalCode?: string;
}

interface AchTokenPayload {
  type: 'ach';
  accountNumber: string;
  routingNumber: string;
  accountType: 'checking' | 'savings';
  firstName: string;
  lastName: string;
}

type NorthTokenPayload = CardTokenPayload | AchTokenPayload;

function detectBrand(digits: string): string {
  if (/^4/.test(digits)) return 'Visa';
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'American Express';
  if (/^6(?:011|5)/.test(digits)) return 'Discover';
  return 'Card';
}

function formatNorthFailure(result: { responseCode: string | null; responseText: string | null }): string {
  const parts = [] as string[];
  if (result.responseCode) parts.push(`AUTH_RESP ${result.responseCode}`);
  if (result.responseText) parts.push(result.responseText);
  return parts.length > 0 ? parts.join(' — ') : 'North token sale failed.';
}

function parseToken(token: string): NorthTokenPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(token);
  } catch {
    throw new Error('Invalid payment token: expected card or bank details payload.');
  }
  const data = parsed as {
    type?: string;
    number?: string | number;
    expMonth?: number | string;
    expYear?: number | string;
    cvv?: string | number;
    firstName?: string;
    lastName?: string;
    postalCode?: string | number;
    accountNumber?: string | number;
    routingNumber?: string | number;
    accountType?: string;
  };
  if (data.type === 'card') {
    const digits = String(data.number ?? '').replace(/\D/g, '');
    const expMonth = Number(data.expMonth);
    const expYear = Number(data.expYear);
    if (digits.length < 13 || digits.length > 19) throw new Error('Invalid card number.');
    if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) throw new Error('Invalid expiration month.');
    if (!Number.isInteger(expYear) || expYear < 2000 || expYear > 2100) throw new Error('Invalid expiration year.');
    if (!/^\d{3,4}$/.test(String(data.cvv ?? ''))) throw new Error('Invalid CVV.');
    if (!data.firstName || !data.lastName) throw new Error('Cardholder first and last name are required.');
    return {
      type: 'card',
      number: digits,
      expMonth,
      expYear,
      cvv: String(data.cvv),
      firstName: String(data.firstName),
      lastName: String(data.lastName),
      postalCode: data.postalCode ? String(data.postalCode) : undefined,
    };
  }
  if (data.type === 'ach') {
    const account = String(data.accountNumber ?? '').replace(/\D/g, '');
    const routing = String(data.routingNumber ?? '').replace(/\D/g, '');
    if (account.length < 4 || account.length > 17) throw new Error('Invalid bank account number.');
    if (routing.length !== 9) throw new Error('Routing number must be 9 digits.');
    if (data.accountType !== 'checking' && data.accountType !== 'savings') throw new Error('Account type must be checking or savings.');
    if (!data.firstName || !data.lastName) throw new Error('Account holder first and last name are required.');
    return {
      type: 'ach',
      accountNumber: account,
      routingNumber: routing,
      accountType: data.accountType,
      firstName: String(data.firstName),
      lastName: String(data.lastName),
    };
  }
  throw new Error('Invalid payment token: unknown payment method type.');
}

export class NorthPaymentProvider implements PaymentProvider {
  name = 'north';

  async attachPaymentMethod(token: string): Promise<TokenizedPaymentMethod> {
    const payload = parseToken(token);
    const customerData = {
      FirstName: payload.firstName,
      LastName: payload.lastName,
    };

    if (payload.type === 'card') {
      // North expects YYMM
      const expirationDate = `${String(payload.expYear % 100).padStart(2, '0')}${String(payload.expMonth).padStart(2, '0')}`;
      const result = await northGatewayService.vaultPaymentMethod(customerData, {
        CreditCardData: {
          AccountNumber: payload.number,
          ExpirationDate: expirationDate,
          CVV: payload.cvv,
          FirstName: payload.firstName,
          LastName: payload.lastName,
          PostalCode: payload.postalCode,
        },
      });
      return {
        providerPaymentMethodId: String(result.paymentMethodId),
        brand: detectBrand(payload.number),
        last4: payload.number.slice(-4),
        expirationMonth: payload.expMonth,
        expirationYear: payload.expYear,
      };
    }

    const result = await northGatewayService.vaultPaymentMethod(customerData, {
      BankAccountData: {
        AccountNumber: payload.accountNumber,
        RoutingNumber: payload.routingNumber,
        FirstName: payload.firstName,
        LastName: payload.lastName,
        BankAccountType: payload.accountType === 'savings' ? 'Savings' : 'Checking',
      },
    });
    const now = new Date();
    return {
      providerPaymentMethodId: String(result.paymentMethodId),
      brand: 'Bank Account',
      last4: payload.accountNumber.slice(-4),
      expirationMonth: 12,
      expirationYear: now.getFullYear() + 20,
    };
  }

  async charge(providerPaymentMethodId: string, amountCents: number, _currency?: string, _description?: string, options: ChargeOptions = {}): Promise<ChargeResult> {
    if (amountCents <= 0) {
      return { success: false, transactionId: null, failureReason: 'Invalid amount' };
    }
    const amount = Number((amountCents / 100).toFixed(2));
    const paymentMethodID = Number(providerPaymentMethodId);

    // Non-numeric ids are BRICs from Embedded Checkout STORAGE — charge them
    // as a TOKEN SALE via the Embedded Checkout Payments API
    // (POST /api/payments/token/sale). Per EPX, Merchant-Initiated (MIT)
    // transactions include aci_ext (RB); Customer-Initiated (CIT) omit it.
    if (!Number.isInteger(paymentMethodID) || paymentMethodID <= 0) {
      if (!epxEmbeddedPaymentsService.isConfigured()) {
        return {
          success: false,
          transactionId: null,
          failureReason: 'This card is stored as a North BRIC token. Configure North Embedded Checkout (NORTH_EMBEDDED_CHECKOUT_ID/NORTH_EMBEDDED_PROFILE_ID/NORTH_EMBEDDED_PRIVATE_API_KEY) to charge it.',
        };
      }
      try {
        const result = await epxEmbeddedPaymentsService.tokenSale({
          authGuid: providerPaymentMethodId,
          amount,
          paymentMethod: options.paymentMethod ?? 'credit',
          mit: options.mit === true,
          customer: options.customer,
          invoiceNumber: options.invoiceNumber ?? null,
        });
        if (!result.approved) {
          return {
            success: false,
            transactionId: result.authGuid,
            failureReason: formatNorthFailure(result),
          };
        }
        return { success: true, transactionId: result.authGuid ?? `north_${Date.now()}`, failureReason: null };
      } catch (error) {
        return { success: false, transactionId: null, failureReason: (error as Error).message || 'North token sale failed.' };
      }
    }

    interface NorthChargeResponse { successful?: boolean; code?: string; text?: string; GUID?: string }
    let response: NorthChargeResponse | null = null;
    try {
      response = (await northGatewayService.chargePaymentMethod(paymentMethodID, amount)) as NorthChargeResponse | null;
    } catch (error) {
      return { success: false, transactionId: null, failureReason: (error as Error).message || 'North charge request failed.' };
    }
    const approved = response?.successful === true || response?.code === '00';
    if (!approved) {
      return {
        success: false,
        transactionId: typeof response?.GUID === 'string' ? response.GUID : null,
        failureReason: response?.text || `Declined (code ${response?.code ?? 'unknown'})`,
      };
    }
    return {
      success: true,
      transactionId: typeof response?.GUID === 'string' ? response.GUID : `north_${Date.now()}`,
      failureReason: null,
    };
  }

  /**
   * Refunds.
   *
   * Embedded Checkout (EPX) transactions — identified by a non-numeric
   * AUTH_GUID — are refunded via PUT /api/payments/refund; if the refund is
   * rejected (typically because the transaction has not settled yet) and the
   * full amount is being returned, we fall back to PUT /api/payments/reversal
   * (Void).
   *
   * North gateway transactions (numeric ids, e.g. "ccs_87654321") continue to
   * use the Gateway Functions transactions endpoint with the same
   * refund-then-void strategy.
   */
  async refund(transactionId: string, amountCents: number, options: RefundOptions = {}): Promise<ChargeResult> {
    if (amountCents <= 0) {
      return { success: false, transactionId: null, failureReason: 'Invalid refund amount' };
    }
    const amount = Number((amountCents / 100).toFixed(2));

    // Embedded Checkout / EPX transaction GUIDs are alphanumeric BRIC-style
    // strings; North gateway ids are numeric (optionally "ccs_"-prefixed).
    const gatewayId = Number(String(transactionId).replace(/^ccs_/i, ''));
    const isGatewayTransaction = Number.isInteger(gatewayId) && gatewayId > 0;

    if (!isGatewayTransaction) {
      if (!epxEmbeddedPaymentsService.isConfigured()) {
        return {
          success: false,
          transactionId: null,
          failureReason: 'North Embedded Checkout is not configured; issue the refund from the Payments Hub portal.',
        };
      }
      const paymentMethod = options.paymentMethod ?? 'credit';
      let refundError: string;
      try {
        const res = await epxEmbeddedPaymentsService.refund({ authGuid: transactionId, amount, paymentMethod });
        if (res.approved) return { success: true, transactionId: res.authGuid ?? transactionId, failureReason: null };
        refundError = formatNorthFailure(res);
      } catch (error) {
        refundError = (error as Error).message || 'North refund request failed.';
      }
      // Unsettled transactions cannot be refunded; a full-amount return can be
      // reversed (card) or voided (ACH) instead.
      if (options.fullAmount) {
        try {
          const res = paymentMethod === 'ach'
            ? await epxEmbeddedPaymentsService.voidTransaction({ authGuid: transactionId, paymentMethod })
            : await epxEmbeddedPaymentsService.reversal({ authGuid: transactionId });
          if (res.approved) return { success: true, transactionId: res.authGuid ?? transactionId, failureReason: null };
        } catch {
          // report the original refund error
        }
      }
      return { success: false, transactionId: null, failureReason: refundError };
    }

    interface TxActionResponse { refund_id?: number; void_id?: number; status_code?: string; status_message?: string }
    let refundError: string | null = null;
    try {
      const res = (await northGatewayService.refundTransaction(gatewayId, amount)) as TxActionResponse | null;
      if (res?.status_code === '00' || typeof res?.refund_id === 'number') {
        return { success: true, transactionId: String(res.refund_id ?? gatewayId), failureReason: null };
      }
      refundError = res?.status_message ?? 'Refund was not approved.';
    } catch (error) {
      refundError = (error as Error).message || 'North refund request failed.';
    }

    // Reversal (Void) fallback — only valid for the full transaction amount
    // and only before settlement.
    try {
      const res = (await northGatewayService.voidTransaction(gatewayId)) as TxActionResponse | null;
      if (res?.status_code === '00' || typeof res?.void_id === 'number') {
        return { success: true, transactionId: String(res.void_id ?? gatewayId), failureReason: null };
      }
    } catch {
      // Fall through to report the original refund error.
    }
    return { success: false, transactionId: null, failureReason: refundError };
  }
}



