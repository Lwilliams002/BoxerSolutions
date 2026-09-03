import crypto from 'crypto';
import { config } from '../config';
import { ApiError } from '../utils/errors';
import { northCertLog } from '../utils/northCertLog';

/**
 * EPX Server Post API (North processor) — BRIC token transactions.
 *
 * Per North certification guidance, since the Recurring Billing API is
 * unavailable, card-on-file charging is done as a TOKEN SALE against the BRIC
 * returned by an Embedded Checkout STORAGE transaction. No raw card data is
 * ever sent through this API (that would put us in full PCI scope).
 *
 * Requests are form-urlencoded POSTs; responses are XML
 * (<RESPONSE><FIELDS><FIELD KEY="AUTH_RESP">00</FIELD>…</FIELDS></RESPONSE>).
 *
 * Env: EPX_SERVER_POST_URL, EPX_CUST_NBR, EPX_MERCH_NBR, EPX_DBA_NBR,
 * EPX_TERMINAL_NBR, EPX_TRAN_TYPE_SALE (confirm code with North cert team).
 *
 * Every raw request/response is appended to the North certification log
 * (logs/north-cert.log) for submission to North.
 */

export interface ServerPostResult {
  approved: boolean;
  authGuid: string | null;
  authCode: string | null;
  responseCode: string | null;
  responseText: string | null;
  raw: Record<string, string>;
}

function assertServerPostConfig() {
  const { custNbr, merchNbr, dbaNbr, terminalNbr } = config.north.serverPost;
  if (!custNbr || !merchNbr || !dbaNbr || !terminalNbr) {
    throw new ApiError(
      424,
      'EPX Server Post is not configured. Set EPX_CUST_NBR, EPX_MERCH_NBR, EPX_DBA_NBR, and EPX_TERMINAL_NBR (request the 4-part key from North).',
    );
  }
}

function parseXmlFields(xml: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const re = /<FIELD\s+KEY="([^"]+)"\s*>([^<]*)<\/FIELD>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    fields[match[1]] = match[2];
  }
  return fields;
}

async function postServerPost(label: string, fields: Record<string, string>): Promise<ServerPostResult> {
  assertServerPostConfig();
  const body = new URLSearchParams(fields).toString();
  const url = config.north.serverPost.baseUrl;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text().catch(() => '');
  northCertLog({
    api: 'EPX Server Post',
    label,
    method: 'POST',
    url,
    requestHeaders: { 'Content-Type': 'application/x-www-form-urlencoded' },
    requestBody: body,
    status: res.status,
    statusText: res.statusText,
    responseBody: text,
  });
  if (!res.ok) {
    throw new ApiError(502, `EPX Server Post ${label} failed: HTTP ${res.status} ${res.statusText}`);
  }
  const parsed = parseXmlFields(text);
  const responseCode = parsed.AUTH_RESP ?? parsed.RESP_CODE ?? null;
  return {
    approved: responseCode === '00',
    authGuid: parsed.AUTH_GUID ?? null,
    authCode: parsed.AUTH_CODE ?? null,
    responseCode,
    responseText: parsed.AUTH_RESP_TEXT ?? parsed.RESP_TEXT ?? null,
    raw: parsed,
  };
}

export const epxServerPostService = {
  isConfigured(): boolean {
    const { custNbr, merchNbr, dbaNbr, terminalNbr } = config.north.serverPost;
    return Boolean(custNbr && merchNbr && dbaNbr && terminalNbr);
  },

  /**
   * TOKEN SALE — charge a stored BRIC. TRAN_NBR must be unique per
   * transaction; BATCH_ID groups the day's transactions.
   */
  async tokenSale(bric: string, amount: number, options: { tranNbr?: string; invoiceNbr?: string; orderNbr?: string } = {}): Promise<ServerPostResult> {
    const sp = config.north.serverPost;
    const now = new Date();
    const batchId = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const tranNbr = options.tranNbr ?? String(crypto.randomInt(1, 2_147_483_647));
    return postServerPost('TOKEN SALE (BRIC)', {
      CUST_NBR: sp.custNbr,
      MERCH_NBR: sp.merchNbr,
      DBA_NBR: sp.dbaNbr,
      TERMINAL_NBR: sp.terminalNbr,
      TRAN_TYPE: sp.tranTypeSale,
      AMOUNT: amount.toFixed(2),
      BRIC: bric,
      TRAN_NBR: tranNbr,
      BATCH_ID: batchId,
      INDUSTRY_TYPE: 'E',
      ...(options.invoiceNbr ? { INVOICE_NBR: options.invoiceNbr } : {}),
      ...(options.orderNbr ? { ORDER_NBR: options.orderNbr } : {}),
    });
  },
};

