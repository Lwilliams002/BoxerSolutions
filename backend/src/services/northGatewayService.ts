import crypto from 'crypto';
import { config } from '../config';
import { ApiError } from '../utils/errors';

interface NorthAuthResponse {
  accountId: number;
  token: string;
  mid: string;
}

interface NorthInvoiceResponse {
  url: string;
}

interface InvoicePaymentInput {
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  invoiceNumber: string;
  dueDate: string;
  amount: number;
  taxRate?: number | null;
  description?: string | null;
}

interface NorthCustomerData {
  FirstName: string;
  LastName: string;
  Phone?: string;
  Email?: string;
}

interface NorthCreditCardData {
  AccountNumber: string;
  ExpirationDate: string;
  CVV: string;
  FirstName: string;
  LastName: string;
  PostalCode?: string;
  StreetAddress?: string;
}

interface NorthBankAccountData {
  AccountNumber: string;
  RoutingNumber: string;
  FirstName: string;
  LastName: string;
  BankAccountType: 'Checking' | 'Savings';
}

interface NorthSubscriptionData {
  Amount: number;
  Frequency: 'Weekly' | 'BiWeekly' | 'Monthly';
  BillingDate: string;
  FailureOption?: 'Forward' | 'Skip' | 'Pause';
  NumberOfPayments?: number;
  Retries?: number;
  Description?: string;
}

interface NorthSubscriptionPaymentMethod {
  CreditCardData?: NorthCreditCardData;
  BankAccountData?: NorthBankAccountData;
}

interface NorthCreateSubscriptionInput {
  customerData: NorthCustomerData;
  paymentMethod: NorthSubscriptionPaymentMethod;
  subscriptionData: NorthSubscriptionData;
}

function assertNorthConfig() {
  const { mid, developerKey, password, appSource, signatureSecret } = config.north;
  if (!mid || !developerKey || !password || !appSource || !signatureSecret) {
    throw new ApiError(
      424,
      'North Developer credentials are not configured. Set NORTH_MID, NORTH_DEVELOPER_KEY, NORTH_PASSWORD, NORTH_APPSOURCE, and NORTH_SIGNATURE_SECRET.',
    );
  }
}

function jsonBody(payload: unknown) {
  return JSON.stringify(payload);
}

class NorthGatewayService {
  private auth?: NorthAuthResponse;
  private authAt = 0;

  private async requestAuth(): Promise<NorthAuthResponse> {
    assertNorthConfig();
    if (this.auth && Date.now() - this.authAt < 50 * 60 * 1000) {
      return this.auth;
    }

    const res = await fetch(`${config.north.functionsBaseUrl}/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nabwss-appsource': config.north.appSource,
      },
      body: jsonBody({
        mid: config.north.mid,
        developerKey: config.north.developerKey,
        password: config.north.password,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(502, `North auth failed: ${(data as { message?: string } | null)?.message ?? res.statusText}`);
    }
    this.auth = data as NorthAuthResponse;
    this.authAt = Date.now();
    return this.auth;
  }

  private signature(endpoint: string, payload: unknown): string {
    assertNorthConfig();
    const hmac = crypto.createHmac('sha256', config.north.signatureSecret);
    hmac.update(`${endpoint}\n${JSON.stringify(payload)}`);
    return hmac.digest('hex');
  }

  private async northFetch(path: string, payload: unknown, baseUrl = config.north.billingBaseUrl) {
    const auth = await this.requestAuth();
    const body = jsonBody(payload);
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
        'x-nabwss-appsource': config.north.appSource,
        'EPI-Id': auth.mid,
        'EPI-Signature': this.signature(path, payload),
      },
      body,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw ApiError.badGateway(`North request failed: ${(data as { message?: string } | null)?.message ?? res.statusText}`);
    }
    return data;
  }

  async createInvoiceLink(input: InvoicePaymentInput): Promise<string> {
    const auth = await this.requestAuth();
    const payload = {
      type: 'ondemand',
      qrcode: false,
      invoice: {
        customer: {
          first_name: input.customerFirstName,
          last_name: input.customerLastName,
          email: input.customerEmail ?? undefined,
          phone: input.customerPhone ?? undefined,
        },
        name: input.description?.trim() || `Invoice ${input.invoiceNumber}`,
        description: input.description?.trim() || `Payment for invoice ${input.invoiceNumber}`,
        number: input.invoiceNumber,
        due_date: input.dueDate,
        send_date: new Date().toISOString(),
        amount: Number(input.amount.toFixed(2)),
        tax_rate: Number((input.taxRate ?? 0).toFixed(4)),
        service_fee_enabled: false,
      },
    };
    const res = await fetch(`${config.north.functionsBaseUrl}/accounts/${auth.accountId}/invoices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
        'x-nabwss-appsource': config.north.appSource,
      },
      body: jsonBody(payload),
    });
    const data = (await res.json().catch(() => null)) as NorthInvoiceResponse | { message?: string } | null;
    if (!res.ok || !data || typeof (data as NorthInvoiceResponse).url !== 'string') {
      throw new ApiError(502, `North invoice link failed: ${(data as { message?: string } | null)?.message ?? res.statusText}`);
    }
    return (data as NorthInvoiceResponse).url;
  }

  async createSubscription(input: NorthCreateSubscriptionInput) {
    return this.northFetch('/subscription', {
      customerData: input.customerData,
      paymentMethod: input.paymentMethod,
      subscriptionData: input.subscriptionData,
    });
  }

  async chargePaymentMethod(paymentMethodID: number, amount: number) {
    return this.northFetch('/chargepaymentmethod', {
      paymentMethodID,
      amount,
    });
  }

  async payBill(billID: number) {
    return this.northFetch('/paybill', {
      billID,
    });
  }
}

export const northGatewayService = new NorthGatewayService();
