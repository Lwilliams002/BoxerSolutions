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

export interface NorthCustomerData {
  FirstName: string;
  LastName: string;
  Phone?: string;
  Email?: string;
}

export interface NorthCreditCardData {
  AccountNumber: string;
  ExpirationDate: string;
  CVV: string;
  FirstName: string;
  LastName: string;
  PostalCode?: string;
  StreetAddress?: string;
}

export interface NorthBankAccountData {
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

export interface NorthSubscriptionPaymentMethod {
  CreditCardData?: NorthCreditCardData;
  BankAccountData?: NorthBankAccountData;
}

interface NorthCreateSubscriptionInput {
  customerData: NorthCustomerData;
  paymentMethod: NorthSubscriptionPaymentMethod;
  subscriptionData: NorthSubscriptionData;
}

interface NorthEmbeddedProduct {
  name: string;
  quantity: number;
  price: number;
}

interface CreateEmbeddedSessionInput {
  amount: number;
  products?: NorthEmbeddedProduct[];
  orderId?: string;
  customerEmail?: string | null;
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

function assertNorthEmbeddedConfig() {
  const { embeddedCheckoutId, embeddedProfileId, embeddedPrivateApiKey } = config.north;
  if (!embeddedCheckoutId || !embeddedProfileId || !embeddedPrivateApiKey) {
    throw new ApiError(
      424,
      'North Embedded Checkout is not configured. Set NORTH_EMBEDDED_CHECKOUT_ID, NORTH_EMBEDDED_PROFILE_ID, and NORTH_EMBEDDED_PRIVATE_API_KEY.',
    );
  }
}

function jsonBody(payload: unknown) {
  return JSON.stringify(payload);
}

function embeddedConfigDiagnostics() {
  const { embeddedBaseUrl, embeddedCheckoutId, embeddedProfileId, embeddedPrivateApiKey } = config.north;
  return {
    embeddedBaseUrl,
    embeddedCheckoutIdLength: embeddedCheckoutId.length,
    embeddedProfileIdLength: embeddedProfileId.length,
    embeddedPrivateApiKeyLength: embeddedPrivateApiKey.length,
    embeddedCheckoutIdLooksUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(embeddedCheckoutId),
    embeddedProfileIdLooksUuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(embeddedProfileId),
    embeddedPrivateApiKeyLooksHex: /^[0-9a-f]+$/i.test(embeddedPrivateApiKey),
  };
}

function embeddedPayloadDiagnostics(payload: Record<string, unknown>) {
  const products = Array.isArray(payload.products) ? payload.products : [];
  return {
    amount: payload.amount,
    hasEmail: typeof payload.email === 'string' && payload.email.length > 0,
    hasOrderId: typeof payload.orderId === 'string' && payload.orderId.length > 0,
    productCount: products.length,
    payloadKeys: Object.keys(payload).sort(),
  };
}

function describeNorthError(data: Record<string, unknown> | null, fallback: string) {
  if (!data) return fallback;
  const details = data.details;
  const errors = data.errors;
  if (Array.isArray(details) && details.length) {
    return `${fallback}: ${details.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('; ')}`;
  }
  if (Array.isArray(errors) && errors.length) {
    return `${fallback}: ${errors.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('; ')}`;
  }
  if (details && typeof details === 'object') {
    return `${fallback}: ${JSON.stringify(details)}`;
  }
  if (errors && typeof errors === 'object') {
    return `${fallback}: ${JSON.stringify(errors)}`;
  }
  return fallback;
}

async function readNorthErrorResponse(res: Response, prefix: string) {
  const requestId = res.headers.get('x-request-id');
  const text = await res.text().catch(() => '');
  let data: Record<string, unknown> | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      data = null;
    }
  }
  let message = prefix;
  if (data) {
    message = describeNorthError(data, prefix);
  } else if (text.trim()) {
    message = `${prefix}: ${text.trim()}`;
  }
  if (requestId) {
    message = `${message} (North request id: ${requestId})`;
  }
  return { message, details: data ?? { status: res.status, statusText: res.statusText, requestId, body: text || null } };
}

class NorthGatewayService {
  private auth?: NorthAuthResponse;
  private authAt = 0;

  private async postEmbeddedSession(payload: Record<string, unknown>) {
    const res = await fetch(`${config.north.embeddedBaseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.north.embeddedPrivateApiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ServiceFinance Embedded Checkout',
      },
      body: jsonBody(payload),
    });
    if (!res.ok) {
      const err = await readNorthErrorResponse(res, `North embedded session failed: ${res.statusText || `HTTP ${res.status}`}`);
      throw new ApiError(502, err.message, {
        upstream: err.details,
        config: embeddedConfigDiagnostics(),
        request: embeddedPayloadDiagnostics(payload),
      });
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data) {
      const requestId = res.headers.get('x-request-id');
      throw new ApiError(
        502,
        `North embedded session failed: North returned an empty response${requestId ? ` (North request id: ${requestId})` : ''}`,
        {
          upstream: { status: res.status, statusText: res.statusText, requestId },
          config: embeddedConfigDiagnostics(),
          request: embeddedPayloadDiagnostics(payload),
        },
      );
    }
    return data;
  }

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

  async pauseSubscription(subscriptionID: number) {
    return this.northFetch('/subscription/pause', { subscriptionID });
  }

  /**
   * Vaults a payment method with North for card-on-file charging.
   *
   * North's Recurring Billing API only creates payment methods inside a
   * subscription, so we create one with a billing date a year out and pause it
   * immediately — nothing is ever charged by the subscription itself. The
   * returned paymentMethodId can then be charged on demand via
   * `/chargepaymentmethod` (see chargePaymentMethod).
   */
  async vaultPaymentMethod(customerData: NorthCustomerData, paymentMethod: NorthSubscriptionPaymentMethod) {
    const billingDate = new Date();
    billingDate.setFullYear(billingDate.getFullYear() + 1);
    const created = (await this.createSubscription({
      customerData,
      paymentMethod,
      subscriptionData: {
        Amount: 1,
        Frequency: 'Monthly',
        BillingDate: billingDate.toISOString().slice(0, 10),
        FailureOption: 'Pause',
        NumberOfPayments: 1,
        Description: 'Card on file (vault only — paused, never charged)',
      },
    })) as { id?: number; paymentmethodId?: number; verifyResult?: { code?: string; text?: string } } | null;

    const subscriptionId = Number(created?.id);
    const paymentMethodId = Number(created?.paymentmethodId);
    if (!Number.isFinite(paymentMethodId) || paymentMethodId <= 0) {
      throw new ApiError(502, `North did not return a payment method id${created?.verifyResult?.text ? `: ${created.verifyResult.text}` : ''}`);
    }
    if (Number.isFinite(subscriptionId) && subscriptionId > 0) {
      try {
        await this.pauseSubscription(subscriptionId);
      } catch {
        // Non-fatal: the subscription only has 1 payment a year out. Log-free
        // best effort — the payment method itself is already usable.
      }
    }
    return { paymentMethodId, subscriptionId: Number.isFinite(subscriptionId) ? subscriptionId : null, verifyResult: created?.verifyResult ?? null };
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

  async createEmbeddedSession(input: CreateEmbeddedSessionInput): Promise<string> {
    assertNorthEmbeddedConfig();
    const amount = Number(input.amount.toFixed(2));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw ApiError.badRequest('Embedded checkout amount must be greater than 0.');
    }
    const payload: Record<string, unknown> = {
      checkoutId: config.north.embeddedCheckoutId,
      profileId: config.north.embeddedProfileId,
      amount,
    };
    if (input.products?.length) payload.products = input.products;
    if (input.orderId) payload.orderId = input.orderId;
    if (input.customerEmail) payload.email = input.customerEmail;
    let data: Record<string, unknown> | null = null;
    try {
      data = await this.postEmbeddedSession(payload);
    } catch (error) {
      const hasOptionalFields = Boolean(payload.products || payload.orderId || payload.email);
      if (!hasOptionalFields) throw error;
      data = await this.postEmbeddedSession({
        checkoutId: config.north.embeddedCheckoutId,
        profileId: config.north.embeddedProfileId,
        amount,
      });
    }
    const tokenCandidate = [
      data.sessionToken,
      data.session_token,
      data.token,
      (data.data as Record<string, unknown> | undefined)?.sessionToken,
      (data.data as Record<string, unknown> | undefined)?.token,
    ].find((value) => typeof value === 'string' && value.length > 10) as string | undefined;
    if (!tokenCandidate) {
      throw new ApiError(502, 'North embedded session response did not include a session token.');
    }
    return tokenCandidate;
  }

  async getEmbeddedSessionStatus(sessionToken: string) {
    assertNorthEmbeddedConfig();
    const res = await fetch(`${config.north.embeddedBaseUrl}/api/sessions/status`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.north.embeddedPrivateApiKey}`,
        'Content-Type': 'application/json',
        SessionToken: sessionToken,
        CheckoutId: config.north.embeddedCheckoutId,
        ProfileId: config.north.embeddedProfileId,
        'User-Agent': 'ServiceFinance Embedded Checkout',
      },
    });
    if (!res.ok) {
      const err = await readNorthErrorResponse(res, `North embedded session status failed: ${res.statusText || `HTTP ${res.status}`}`);
      throw new ApiError(502, err.message, err.details);
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data) {
      const requestId = res.headers.get('x-request-id');
      throw new ApiError(
        502,
        `North embedded session status failed: North returned an empty response${requestId ? ` (North request id: ${requestId})` : ''}`,
        { status: res.status, statusText: res.statusText, requestId },
      );
    }
    return data;
  }
}

export const northGatewayService = new NorthGatewayService();
