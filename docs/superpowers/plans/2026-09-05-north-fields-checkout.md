# North Fields Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every North payment path onto the Embedded Checkout **Fields** integration with real Storage → Token Sale, ACH Sale, Refund and Reversal calls that North can certify.

**Architecture:** One Fields checkout and one credential set. Pure, dependency-free modules build EPX request bodies and parse EPX/session responses (unit-tested); thin services call North and write the cert log; a shared `northFieldsPaymentService` drives the three flows (pay by card = STORAGE + server token sale, pay by bank = ACH SALE in checkout, store only = STORAGE) for both the staff app routes and the public agreement page. Charges and refunds are routed by the provider recorded on the stored method, never by the global `PAYMENT_PROVIDER`. Mobile gets one shared checkout library, one hook, one layout and one route (native + web).

**Tech Stack:** Node 26, TypeScript 7, Express 5, pg, zod 4, `node:test` via `tsx`; Expo Router / React Native (+ react-native-webview) on mobile.

**Spec:** `docs/superpowers/specs/2026-09-05-north-fields-checkout-design.md`

## Global Constraints

- North Payments API bodies contain **only** spec fields: `payment_method` (`credit` | `ach`), `amount`, `orig_auth_guid`, `aci_ext` (MIT only), name/address, `industry_type: 'E'`, `invoice_nbr`, `order_nbr`, `tran_nbr` (digits, ≤10), `batch_id` (digits, ≤10). Never `token`, `transaction`, `checkoutId`, `profileId` in the body.
- Every outbound `User-Agent` header must contain the string `Embedded Checkout`.
- Session `transactionType` values used: `SALE`, `STORAGE` only.
- Approved iff `auth_resp === '00'` (payments API) / `status === 'Approved'` (session status).
- No PAN, CVV, routing or account numbers may ever reach the server or logs.
- Canonical env: `NORTH_EMBEDDED_CHECKOUT_ID`, `NORTH_EMBEDDED_PROFILE_ID`, `NORTH_EMBEDDED_PRIVATE_API_KEY`, `NORTH_WEBHOOK_SECRET`. `NORTH_EMBEDDED_FIELDS_*` names are deprecated aliases read first when set.
- `npx tsc --noEmit` must pass in `backend/` and `mobile/` at the end of every task. `npm test` in `backend/` must pass from Task 1 on.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Pure modules (`backend/src/services/epx/epxPayloads.ts`, `backend/src/utils/northSessionResult.ts`, `backend/src/integrations/payments/resolveProvider.ts`) must not import `config`, `db`, or anything that reads `process.env`.

## File map

| File | Responsibility |
|---|---|
| `backend/package.json`, `backend/tsconfig.json`, `backend/test/**` | `node:test` harness (Task 1) |
| `backend/src/services/epx/epxPayloads.ts` | Pure builders for token sale / refund / reversal / void bodies + response parser (Task 2) |
| `backend/src/utils/northSessionResult.ts` | Pure extraction of session status → method type, BRIC, amount, brand, last4, expiry (Task 3) |
| `backend/src/config/index.ts`, `backend/.env.example` | Single credential set + aliases, ACH terms version (Task 4) |
| `backend/src/content/achAuthorizationTerms.ts` | ACH consent text + version (Task 4) |
| `backend/migrations/021_ach_authorizations.sql` | Consent retention table (Task 4) |
| `backend/src/services/northGatewayService.ts` | Session create/status with one credential set (Task 5) |
| `backend/src/services/epxEmbeddedPaymentsService.ts` | Token sale / refund / reversal / void HTTP + cert log (Task 6) |
| `backend/src/utils/northEmbedded.ts` | `waitForNorthSession` polling (Task 7) |
| `backend/src/integrations/payments/resolveProvider.ts`, `index.ts`, `northProvider.ts` | Provider routing by stored method, charge/refund options (Task 8) |
| `backend/src/services/paymentService.ts` | method_type on vault, provider routing, external payment linking (Task 8) |
| `backend/src/services/northFieldsPaymentService.ts` | The three flows, shared by staff routes and agreement page (Task 9) |
| `backend/src/routes/payments.ts` | `/north/fields/*` endpoints (Task 9) |
| `backend/src/services/agreementSigningService.ts`, `backend/src/routes/agreements.ts` | Agreement pay page on Fields with card/bank + consent (Task 10) |
| `mobile/src/lib/northFieldsCheckout.ts` | Script loader, mount, submit, WebView HTML, message parsing (Task 11) |
| `mobile/src/lib/useFieldsCheckout.ts`, `mobile/src/components/FieldsCheckoutLayout.tsx` | Session/confirm state + shared UI (Task 12) |
| `mobile/app/payments/fields-checkout.tsx`, `.web.tsx` | Route screens; old screens deleted; navigation updated (Task 13) |
| Cleanup + docs (Task 14), sandbox verification (Task 15) |

---

### Task 1: Backend test harness

**Files:**
- Modify: `backend/package.json` (scripts)
- Modify: `backend/tsconfig.json` (exclude `test`)
- Create: `backend/test/smoke.test.ts`

**Interfaces:**
- Produces: `npm test` runs `node --import tsx --test "test/**/*.test.ts"` from `backend/`. All later tests live in `backend/test/` and import from `../src/...`.

- [ ] **Step 1: Write the smoke test**

```ts
// backend/test/smoke.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('harness runs TypeScript tests', () => {
  const value: number = 1 + 1;
  assert.equal(value, 2);
});
```

- [ ] **Step 2: Run it to see it fail (no script yet)**

Run: `cd backend && npm test`
Expected: `Error: no test specified` and exit 1.

- [ ] **Step 3: Add the script and exclude tests from the build**

In `backend/package.json` replace the `test` script:

```json
"test": "node --import tsx --test \"test/**/*.test.ts\""
```

In `backend/tsconfig.json` change `"exclude": ["node_modules", "dist"]` to `"exclude": ["node_modules", "dist", "test"]`.

- [ ] **Step 4: Run tests and typecheck**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: `# pass 1`, `# fail 0`, tsc silent.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/test/smoke.test.ts
git commit -m "Backend: add node:test harness via tsx

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pure EPX payload builders and response parser

**Files:**
- Create: `backend/src/services/epx/epxPayloads.ts`
- Test: `backend/test/epxPayloads.test.ts`

**Interfaces:**
- Produces:
  - `type EpxPaymentMethod = 'credit' | 'ach'`
  - `interface EpxCustomer { firstName?, lastName?, address?, city?, state?, zipCode? }` (all `string | null | undefined`)
  - `interface TokenSaleInput { authGuid: string; amount: number; paymentMethod: EpxPaymentMethod; mit: boolean; customer?: EpxCustomer; invoiceNumber?: string | null; orderNumber?: string | null; tranNbr?: string; batchId?: string }`
  - `buildTokenSaleBody(input: TokenSaleInput): Record<string, unknown>`
  - `buildRefundBody(input: { authGuid: string; amount: number; paymentMethod: EpxPaymentMethod; tranNbr?: string; batchId?: string }): Record<string, unknown>`
  - `buildReversalBody(input: { authGuid: string; tranNbr?: string; batchId?: string }): Record<string, unknown>`
  - `buildVoidBody(input: { authGuid: string; paymentMethod: EpxPaymentMethod; tranNbr?: string; batchId?: string }): Record<string, unknown>`
  - `interface EpxResult { approved: boolean; authGuid: string | null; authCode: string | null; responseCode: string | null; responseText: string | null; amount: number | null; raw: Record<string, unknown> }`
  - `parseEpxResponse(raw: unknown): EpxResult`
  - `epxBatchId(now?: Date): string`, `epxTranNbr(nowMs?: number): string`, `sanitizeEpxText(value: unknown, max: number): string | undefined`

- [ ] **Step 1: Write the failing tests**

```ts
// backend/test/epxPayloads.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTokenSaleBody, buildRefundBody, buildReversalBody, buildVoidBody,
  parseEpxResponse, epxBatchId, epxTranNbr, sanitizeEpxText,
} from '../src/services/epx/epxPayloads';

test('token sale body uses spec field names and omits aci_ext for CIT', () => {
  const body = buildTokenSaleBody({
    authGuid: '0V7017HDJXK00PNZKBE', amount: 12.5, paymentMethod: 'credit', mit: false,
    customer: { firstName: 'John', lastName: 'Doe', address: '1234 My St', city: 'Phoenix', state: 'az', zipCode: '12345' },
    invoiceNumber: 'INV-1001', tranNbr: '123', batchId: '20260905',
  });
  assert.deepEqual(body, {
    payment_method: 'credit', amount: 12.5, orig_auth_guid: '0V7017HDJXK00PNZKBE', industry_type: 'E',
    tran_nbr: '123', batch_id: '20260905', first_name: 'John', last_name: 'Doe', address: '1234 My St',
    city: 'Phoenix', state: 'AZ', zip_code: '12345', invoice_nbr: 'INV-1001',
  });
  assert.equal('token' in body, false);
  assert.equal('checkoutId' in body, false);
});

test('token sale MIT adds aci_ext RB; ach adds recv_name', () => {
  const body = buildTokenSaleBody({ authGuid: 'ABC', amount: 5, paymentMethod: 'ach', mit: true, customer: { firstName: 'Jane', lastName: 'Smith' }, tranNbr: '1', batchId: '2' });
  assert.equal(body.aci_ext, 'RB');
  assert.equal(body.payment_method, 'ach');
  assert.equal(body.recv_name, 'Jane Smith');
});

test('token sale rejects amounts below one cent', () => {
  assert.throws(() => buildTokenSaleBody({ authGuid: 'ABC', amount: 0, paymentMethod: 'credit', mit: false }), /0\.01/);
});

test('refund, reversal and void bodies', () => {
  assert.deepEqual(buildRefundBody({ authGuid: 'G1', amount: 3.25, paymentMethod: 'ach', tranNbr: '7', batchId: '8' }),
    { payment_method: 'ach', amount: 3.25, orig_auth_guid: 'G1', tran_nbr: '7', batch_id: '8' });
  assert.deepEqual(buildReversalBody({ authGuid: 'G1', tranNbr: '7', batchId: '8' }),
    { payment_method: 'credit', orig_auth_guid: 'G1', tran_nbr: '7', batch_id: '8' });
  assert.deepEqual(buildVoidBody({ authGuid: 'G1', paymentMethod: 'ach', tranNbr: '7', batchId: '8' }),
    { payment_method: 'ach', orig_auth_guid: 'G1', tran_nbr: '7', batch_id: '8' });
});

test('tran_nbr and batch_id are numeric and within 10 digits', () => {
  assert.match(epxTranNbr(1_757_000_000_123), /^\d{1,10}$/);
  assert.equal(epxBatchId(new Date(2026, 8, 5)), '20260905');
  const auto = buildTokenSaleBody({ authGuid: 'G', amount: 1, paymentMethod: 'credit', mit: false });
  assert.match(String(auto.tran_nbr), /^\d{1,10}$/);
  assert.match(String(auto.batch_id), /^\d{8}$/);
});

test('sanitizeEpxText strips disallowed characters and truncates', () => {
  assert.equal(sanitizeEpxText("O'Brien & Sons <script>", 25), "O'Brien & Sons script");
  assert.equal(sanitizeEpxText('x'.repeat(40), 25)?.length, 25);
  assert.equal(sanitizeEpxText('   ', 25), undefined);
  assert.equal(sanitizeEpxText(null, 25), undefined);
});

test('parseEpxResponse reads lowercase, uppercase and nested keys', () => {
  const ok = parseEpxResponse({ auth_resp: '00', auth_guid: 'NEWGUID', auth_resp_text: 'APPROVED', auth_code: '008262', auth_amount: '12.55' });
  assert.equal(ok.approved, true);
  assert.equal(ok.authGuid, 'NEWGUID');
  assert.equal(ok.amount, 12.55);
  const upper = parseEpxResponse({ data: { AUTH_RESP: '05', AUTH_RESP_TEXT: 'DECLINE' } });
  assert.equal(upper.approved, false);
  assert.equal(upper.responseCode, '05');
  assert.equal(upper.responseText, 'DECLINE');
  const nested = parseEpxResponse({ transaction: { fullResponse: { auth_resp: '00', auth_guid: 'X' } } });
  assert.equal(nested.approved, true);
  assert.equal(nested.authGuid, 'X');
  const empty = parseEpxResponse(null);
  assert.equal(empty.approved, false);
  assert.equal(empty.responseCode, null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test`
Expected: FAIL, cannot find module `../src/services/epx/epxPayloads`.

- [ ] **Step 3: Implement the module**

```ts
// backend/src/services/epx/epxPayloads.ts
/**
 * Pure request builders / response parser for the North Embedded Checkout
 * Payments API (https://developer.north.com/.../api-spec/production/Payments).
 * No config, no I/O — unit tested in test/epxPayloads.test.ts.
 */
export type EpxPaymentMethod = 'credit' | 'ach';

export interface EpxCustomer {
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

export interface TokenSaleInput {
  authGuid: string;
  amount: number;
  paymentMethod: EpxPaymentMethod;
  /** Merchant-initiated (AutoPay / recurring). Adds aci_ext: 'RB'. */
  mit: boolean;
  customer?: EpxCustomer;
  invoiceNumber?: string | null;
  orderNumber?: string | null;
  tranNbr?: string;
  batchId?: string;
}

export interface EpxResult {
  approved: boolean;
  authGuid: string | null;
  authCode: string | null;
  responseCode: string | null;
  responseText: string | null;
  amount: number | null;
  raw: Record<string, unknown>;
}

const DISALLOWED = /[^a-zA-Z0-9 \/.\-@_*,#&+']/g;

export function sanitizeEpxText(value: unknown, max: number): string | undefined {
  if (value == null) return undefined;
  const cleaned = String(value).replace(DISALLOWED, '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return cleaned.length ? cleaned : undefined;
}

export function epxBatchId(now: Date = new Date()): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

/** Unique per millisecond, at most 10 digits (tran_nbr limit). */
export function epxTranNbr(nowMs: number = Date.now()): string {
  return String(nowMs % 10_000_000_000);
}

function withoutUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function customerFields(customer?: EpxCustomer): Record<string, unknown> {
  const zip = customer?.zipCode ? String(customer.zipCode).trim() : '';
  return withoutUndefined({
    first_name: sanitizeEpxText(customer?.firstName, 25),
    last_name: sanitizeEpxText(customer?.lastName, 25),
    address: sanitizeEpxText(customer?.address, 30),
    city: sanitizeEpxText(customer?.city, 25),
    state: customer?.state ? String(customer.state).trim().slice(0, 3).toUpperCase() || undefined : undefined,
    zip_code: zip.length >= 5 && zip.length <= 10 ? zip : undefined,
  });
}

function referenceFields(tranNbr?: string, batchId?: string) {
  return { tran_nbr: tranNbr ?? epxTranNbr(), batch_id: batchId ?? epxBatchId() };
}

export function buildTokenSaleBody(input: TokenSaleInput): Record<string, unknown> {
  const amount = Number(input.amount.toFixed(2));
  if (!Number.isFinite(amount) || amount < 0.01) throw new Error('Token sale amount must be at least 0.01');
  const body: Record<string, unknown> = {
    payment_method: input.paymentMethod,
    amount,
    orig_auth_guid: input.authGuid,
    industry_type: 'E',
    ...referenceFields(input.tranNbr, input.batchId),
    ...customerFields(input.customer),
  };
  const invoice = sanitizeEpxText(input.invoiceNumber, 25);
  if (invoice) body.invoice_nbr = invoice;
  const order = sanitizeEpxText(input.orderNumber, 25);
  if (order) body.order_nbr = order;
  if (input.mit) body.aci_ext = 'RB';
  if (input.paymentMethod === 'ach') {
    const recv = sanitizeEpxText([input.customer?.firstName, input.customer?.lastName].filter(Boolean).join(' '), 22);
    if (recv) body.recv_name = recv;
  }
  return body;
}

export function buildRefundBody(input: { authGuid: string; amount: number; paymentMethod: EpxPaymentMethod; tranNbr?: string; batchId?: string }): Record<string, unknown> {
  const amount = Number(input.amount.toFixed(2));
  if (!Number.isFinite(amount) || amount < 0.01) throw new Error('Refund amount must be at least 0.01');
  return { payment_method: input.paymentMethod, amount, orig_auth_guid: input.authGuid, ...referenceFields(input.tranNbr, input.batchId) };
}

export function buildReversalBody(input: { authGuid: string; tranNbr?: string; batchId?: string }): Record<string, unknown> {
  return { payment_method: 'credit', orig_auth_guid: input.authGuid, ...referenceFields(input.tranNbr, input.batchId) };
}

export function buildVoidBody(input: { authGuid: string; paymentMethod: EpxPaymentMethod; tranNbr?: string; batchId?: string }): Record<string, unknown> {
  return { payment_method: input.paymentMethod, orig_auth_guid: input.authGuid, ...referenceFields(input.tranNbr, input.batchId) };
}

/** Case-insensitive search for the first of `names`, up to 4 levels deep. */
function findField(value: unknown, names: string[], depth = 0): string | null {
  if (!value || typeof value !== 'object' || depth > 4) return null;
  const record = value as Record<string, unknown>;
  const lowerNames = names.map((n) => n.toLowerCase());
  for (const [key, v] of Object.entries(record)) {
    if (lowerNames.includes(key.toLowerCase()) && (typeof v === 'string' || typeof v === 'number') && String(v).length > 0) {
      return String(v);
    }
  }
  for (const v of Object.values(record)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const found = findField(v, names, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function parseAmount(value: string | null): number | null {
  if (value == null) return null;
  const n = Number.parseFloat(value.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

export function parseEpxResponse(raw: unknown): EpxResult {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const responseCode = findField(record, ['auth_resp']);
  return {
    approved: responseCode === '00',
    authGuid: findField(record, ['auth_guid']),
    authCode: findField(record, ['auth_code']),
    responseCode,
    responseText: findField(record, ['auth_resp_text', 'message', 'error']),
    amount: parseAmount(findField(record, ['auth_amount'])),
    raw: record,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/epx/epxPayloads.ts backend/test/epxPayloads.test.ts
git commit -m "EPX: spec-conformant token sale/refund/reversal/void payload builders and response parser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pure session-result extraction

**Files:**
- Create: `backend/src/utils/northSessionResult.ts`
- Test: `backend/test/northSessionResult.test.ts`

**Interfaces:**
- Produces:
  - `type NorthMethodType = 'card' | 'bank_account'`
  - `interface NorthSessionResult { status: string; approved: boolean; declined: boolean; terminal: boolean; authGuid: string | null; amount: number | null; responseCode: string | null; responseText: string | null; methodType: NorthMethodType; brand: string; last4: string | null; expirationMonth: number | null; expirationYear: number | null; body: Record<string, unknown> | null }`
  - `extractNorthSessionResult(payload: unknown, expected?: NorthMethodType): NorthSessionResult`

- [ ] **Step 1: Write the failing tests**

```ts
// backend/test/northSessionResult.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNorthSessionResult } from '../src/utils/northSessionResult';

const approvedCard = {
  status: 'Approved',
  body: { auth_guid: '09LNEUTYG4AWN6EYX3R', auth_masked_account_nbr: '************1111', auth_card_type: 'V', auth_code: '008262', auth_amount: '0.00', auth_resp: '00', auth_resp_text: 'APPROVED', exp_date: '1230' },
};

test('approved card storage session', () => {
  const r = extractNorthSessionResult(approvedCard);
  assert.equal(r.approved, true);
  assert.equal(r.terminal, true);
  assert.equal(r.authGuid, '09LNEUTYG4AWN6EYX3R');
  assert.equal(r.methodType, 'card');
  assert.equal(r.brand, 'Visa');
  assert.equal(r.last4, '1111');
  assert.equal(r.expirationMonth, 12);
  assert.equal(r.expirationYear, 2030);
  assert.equal(r.amount, 0);
});

test('payload wrapped in data and body under transaction.fullResponse', () => {
  const r = extractNorthSessionResult({ data: { status: 'approved', transaction: { fullResponse: { auth_guid: 'G2', auth_card_type: 'M', auth_amount: '45.10' } } } });
  assert.equal(r.approved, true);
  assert.equal(r.authGuid, 'G2');
  assert.equal(r.brand, 'Mastercard');
  assert.equal(r.amount, 45.1);
});

test('ACH sale detected from explicit fields', () => {
  const r = extractNorthSessionResult({ status: 'Approved', body: { auth_guid: 'ACH1', payment_method: 'ach', auth_masked_account_nbr: '*****6789', auth_amount: '120.00' } });
  assert.equal(r.methodType, 'bank_account');
  assert.equal(r.brand, 'Bank Account');
  assert.equal(r.last4, '6789');
  assert.equal(r.expirationMonth, null);
});

test('expected type is used when payload does not say', () => {
  const r = extractNorthSessionResult({ status: 'Approved', body: { auth_guid: 'X', auth_amount: '10.00' } }, 'bank_account');
  assert.equal(r.methodType, 'bank_account');
  const c = extractNorthSessionResult({ status: 'Approved', body: { auth_guid: 'X' } });
  assert.equal(c.methodType, 'card');
  assert.equal(c.brand, 'Card');
});

test('declined and open statuses', () => {
  const d = extractNorthSessionResult({ status: 'Declined', body: { auth_resp: '05', auth_resp_text: 'DO NOT HONOR' } });
  assert.equal(d.declined, true);
  assert.equal(d.terminal, true);
  assert.equal(d.responseText, 'DO NOT HONOR');
  const o = extractNorthSessionResult({ status: 'Open' });
  assert.equal(o.terminal, false);
  assert.equal(o.approved, false);
  assert.equal(o.authGuid, null);
});

test('MM/YY expiry and Amex code', () => {
  const r = extractNorthSessionResult({ status: 'Approved', body: { auth_guid: 'A', auth_card_type: 'X', exp_date: '03/29' } });
  assert.equal(r.brand, 'American Express');
  assert.equal(r.expirationMonth, 3);
  assert.equal(r.expirationYear, 2029);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// backend/src/utils/northSessionResult.ts
/**
 * Pure extraction of a North Embedded Checkout session-status payload
 * (GET /api/sessions/status → { status, body }). Also tolerates the shapes
 * observed in the wild: data wrapper, body under transaction/fullResponse,
 * uppercase EPX keys. No I/O, no config.
 */
export type NorthMethodType = 'card' | 'bank_account';

export interface NorthSessionResult {
  status: string;
  approved: boolean;
  declined: boolean;
  terminal: boolean;
  authGuid: string | null;
  amount: number | null;
  responseCode: string | null;
  responseText: string | null;
  methodType: NorthMethodType;
  brand: string;
  last4: string | null;
  expirationMonth: number | null;
  expirationYear: number | null;
  body: Record<string, unknown> | null;
}

const CARD_TYPE_NAMES: Record<string, string> = {
  V: 'Visa', M: 'Mastercard', X: 'American Express', A: 'American Express', D: 'Discover',
};
const APPROVED = ['approved', 'completed', 'complete', 'success'];
const DECLINED = ['declined', 'failed', 'error'];
const ENDED = ['expired', 'cancelled', 'canceled'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function findField(value: unknown, names: string[], depth = 0): string | null {
  const record = asRecord(value);
  if (!record || depth > 4) return null;
  const lower = names.map((n) => n.toLowerCase());
  for (const [key, v] of Object.entries(record)) {
    if (lower.includes(key.toLowerCase()) && (typeof v === 'string' || typeof v === 'number') && String(v).trim().length > 0) {
      return String(v).trim();
    }
  }
  for (const v of Object.values(record)) {
    const found = findField(v, names, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseAmount(value: string | null): number | null {
  if (value == null) return null;
  const n = Number.parseFloat(value.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function parseExpiry(raw: string | null): { month: number | null; year: number | null } {
  if (!raw) return { month: null, year: null };
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 4) return { month: null, year: null };
  const a = Number(digits.slice(0, 2));
  const b = Number(digits.slice(2));
  // "MM/YY" when a separator is present; otherwise EPX's YYMM, falling back
  // to MMYY when the trailing pair cannot be a month.
  if (raw.includes('/')) return { month: a >= 1 && a <= 12 ? a : null, year: 2000 + b };
  if (b >= 1 && b <= 12) return { month: b, year: 2000 + a };
  if (a >= 1 && a <= 12) return { month: a, year: 2000 + b };
  return { month: null, year: null };
}

function detectMethodType(body: Record<string, unknown> | null, expected: NorthMethodType): NorthMethodType {
  if (!body) return expected;
  const explicit = findField(body, ['payment_method', 'formType', 'form_type']);
  if (explicit) {
    if (/^(ach|bank)/i.test(explicit)) return 'bank_account';
    if (/^(credit|debit|card)/i.test(explicit)) return 'card';
  }
  const tranType = findField(body, ['tran_type', 'tranType']);
  if (tranType && /^(ach|ck|ec)/i.test(tranType)) return 'bank_account';
  if (findField(body, ['routing_nbr', 'account_type', 'std_entry_class', 'auth_routing_nbr'])) return 'bank_account';
  if (findField(body, ['auth_card_type'])) return 'card';
  return expected;
}

export function extractNorthSessionResult(payload: unknown, expected: NorthMethodType = 'card'): NorthSessionResult {
  const root = asRecord(payload) ?? {};
  const statusData = asRecord(root.data) ?? root;
  const status = String(statusData.status ?? root.status ?? '').toLowerCase();
  const body = asRecord(statusData.body) ?? asRecord(root.body) ?? asRecord(statusData.transaction) ?? null;

  const approved = APPROVED.includes(status);
  const declined = DECLINED.includes(status);
  const terminal = approved || declined || ENDED.includes(status);

  const authGuid = findField(body, ['auth_guid', 'bric', 'token']);
  const methodType = detectMethodType(body, expected);
  const masked = findField(body, ['auth_masked_account_nbr', 'masked_pan', 'maskedAccountNumber', 'lastFour', 'last_four']);
  const last4 = masked ? masked.replace(/\D/g, '').slice(-4) || null : null;

  let brand = 'Card';
  let expirationMonth: number | null = null;
  let expirationYear: number | null = null;
  if (methodType === 'bank_account') {
    brand = 'Bank Account';
  } else {
    const code = findField(body, ['auth_card_type', 'card_type', 'cardType']);
    if (code) brand = CARD_TYPE_NAMES[code.toUpperCase()] ?? (code.length === 1 ? 'Card' : code);
    const exp = parseExpiry(findField(body, ['exp_date', 'auth_exp_date', 'expDate']));
    expirationMonth = exp.month;
    expirationYear = exp.year;
  }

  return {
    status,
    approved,
    declined,
    terminal,
    authGuid,
    amount: parseAmount(findField(body, ['auth_amount', 'amount', 'approvedAmount']) ?? (typeof statusData.amount === 'number' ? String(statusData.amount) : null)),
    responseCode: findField(body, ['auth_resp']),
    responseText: findField(body, ['auth_resp_text', 'message']),
    methodType,
    brand,
    last4,
    expirationMonth,
    expirationYear,
    body,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: all pass. If the `MM/YY` test fails, adjust `parseExpiry` until both `'1230'` → 12/2030 and `'03/29'` → 3/2029 hold; the tests are the contract.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/northSessionResult.ts backend/test/northSessionResult.test.ts
git commit -m "North: pure session-status extraction with card/ACH detection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Config consolidation, ACH terms content, consent migration

**Files:**
- Modify: `backend/src/config/index.ts:44-70`
- Modify: `backend/.env.example`
- Create: `backend/src/content/achAuthorizationTerms.ts`
- Create: `backend/migrations/021_ach_authorizations.sql`

**Interfaces:**
- Produces: `config.north.embeddedCheckoutId`, `embeddedProfileId`, `embeddedPrivateApiKey`, `webhookSecret`, `legacyWebhookSecret`, `achTermsVersion`. The old `embeddedFields*` and `fieldsWebhookSecret` keys stay for now as aliases equal to the canonical values (removed in Task 14).
- Produces: `ACH_TERMS_TEXT: string`, `ACH_TERMS_VERSION: string` from `content/achAuthorizationTerms.ts`.
- Produces: table `ach_authorizations`.

- [ ] **Step 1: Replace the embedded block in `config.north`**

Replace lines from `embeddedCheckoutId:` through `fieldsWebhookSecret:` with:

```ts
    // One Embedded Checkout (Fields type) handles SALE and STORAGE sessions.
    // The NORTH_EMBEDDED_FIELDS_* names are deprecated aliases: they are read
    // first so deployments that already hold the Fields credentials there
    // keep working without an env change.
    embeddedCheckoutId: normalizedOptional('NORTH_EMBEDDED_FIELDS_CHECKOUT_ID', process.env.NORTH_EMBEDDED_CHECKOUT_ID ?? ''),
    embeddedProfileId: normalizedOptional('NORTH_EMBEDDED_FIELDS_PROFILE_ID', process.env.NORTH_EMBEDDED_PROFILE_ID ?? ''),
    embeddedPrivateApiKey: normalizedOptional('NORTH_EMBEDDED_FIELDS_PRIVATE_API_KEY', process.env.NORTH_EMBEDDED_PRIVATE_API_KEY ?? ''),
    webhookSecret: normalizedOptional('NORTH_EMBEDDED_FIELDS_WEBHOOK_SECRET', process.env.NORTH_WEBHOOK_SECRET ?? process.env.NORTH_SIGNATURE_SECRET ?? ''),
    legacyWebhookSecret: normalizedOptional('NORTH_WEBHOOK_SECRET'),
    achTermsVersion: normalizedOptional('NORTH_ACH_TERMS_VERSION', '2026-09-05'),
    // Deprecated aliases kept until Task 14 removes their last readers.
    embeddedFieldsCheckoutId: normalizedOptional('NORTH_EMBEDDED_FIELDS_CHECKOUT_ID', process.env.NORTH_EMBEDDED_CHECKOUT_ID ?? ''),
    embeddedFieldsProfileId: normalizedOptional('NORTH_EMBEDDED_FIELDS_PROFILE_ID', process.env.NORTH_EMBEDDED_PROFILE_ID ?? ''),
    embeddedFieldsPrivateApiKey: normalizedOptional('NORTH_EMBEDDED_FIELDS_PRIVATE_API_KEY', process.env.NORTH_EMBEDDED_PRIVATE_API_KEY ?? ''),
    fieldsWebhookSecret: normalizedOptional('NORTH_EMBEDDED_FIELDS_WEBHOOK_SECRET'),
```

- [ ] **Step 2: Rewrite the North section of `.env.example`**

Replace everything from `# North Embedded Checkout (recommended for agreement payment capture)` through the `# EPX_TRAN_TYPE_SALE=CCE1` line with:

```dotenv
# North Embedded Checkout — a single "Fields"-type checkout handles card
# payments (STORAGE + server-side token sale), Pay by Bank (ACH SALE) and
# saving methods on file. Create it in the Checkout Designer with
# "Pay by Bank (ACH)" enabled, then copy these from the checkout page.
NORTH_EMBEDDED_CHECKOUT_ID=
NORTH_EMBEDDED_PROFILE_ID=
NORTH_EMBEDDED_PRIVATE_API_KEY=
# Webhook signing secret (sec_...) from the checkout's API Keys modal
NORTH_WEBHOOK_SECRET=
# Optional override URL (default shown):
# NORTH_EMBEDDED_BASE_URL=https://checkout.north.com
# Version label stored with each ACH consent (bump when the terms text changes)
# NORTH_ACH_TERMS_VERSION=2026-09-05
# Deprecated aliases (read first when set): NORTH_EMBEDDED_FIELDS_CHECKOUT_ID,
# NORTH_EMBEDDED_FIELDS_PROFILE_ID, NORTH_EMBEDDED_FIELDS_PRIVATE_API_KEY,
# NORTH_EMBEDDED_FIELDS_WEBHOOK_SECRET.

# North certification logging — raw request/response text log for submission
# to North's certification team (credentials and card data are redacted).
# NORTH_CERT_LOG_ENABLED=true
# NORTH_CERT_LOG_PATH=logs/north-cert.log
```

Also change the `PAYMENT_PROVIDER` comment block to:

```dotenv
# Payments. Methods stored by North Embedded Checkout are always charged and
# refunded through North regardless of this value; PAYMENT_PROVIDER only
# selects the provider for the legacy raw-token /payment-methods POST route
# and for development fixtures. Use `north` in staging/production.
PAYMENT_PROVIDER=mock
PAYMENT_SECRET_KEY=mock-secret
```

- [ ] **Step 3: Create the ACH terms content**

```ts
// backend/src/content/achAuthorizationTerms.ts
import { config } from '../config';

/**
 * ACH (Pay by Bank) authorization shown on every bank payment form. North's
 * Fields integration requires the integrator to display its own terms and
 * capture explicit consent before submitting an ACH debit.
 *
 * OWNER ACTION: replace the placeholder text below with the company's
 * approved ACH authorization language and bump NORTH_ACH_TERMS_VERSION.
 */
export const ACH_TERMS_VERSION = config.north.achTermsVersion;

export const ACH_TERMS_TEXT = [
  '[PLACEHOLDER — replace with approved ACH authorization terms]',
  'By checking the box and submitting this payment, you authorize Boxer Solutions Pest Control to initiate a one-time electronic debit from the bank account you entered for the total amount shown above.',
  'You certify that you are an authorized user of this bank account and will not dispute this transaction with your bank, provided it corresponds to the terms of this authorization.',
  'If the payment is returned unpaid, you authorize a one-time debit for any returned-item fee permitted by law.',
  'This authorization is captured electronically with your IP address and time stamp and remains in effect for this transaction.',
].join('\n\n');
```

- [ ] **Step 4: Create the migration**

```sql
-- 021_ach_authorizations
-- Web-initiated ACH debits require the merchant to retain proof of the
-- customer's authorization. One row per consented bank payment.
CREATE TABLE ach_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  invoice_id UUID REFERENCES invoices(id),
  payment_id UUID REFERENCES payments(id),
  payment_method_id UUID REFERENCES payment_methods(id),
  amount NUMERIC(12,2) NOT NULL,
  terms_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ach_authorizations_customer ON ach_authorizations(customer_id);
CREATE INDEX idx_ach_authorizations_payment ON ach_authorizations(payment_id);
```

- [ ] **Step 5: Typecheck and run migrations locally**

Run: `cd backend && npx tsc --noEmit && npm run migrate`
Expected: tsc silent; log line `applying migration 021_ach_authorizations.sql` (requires the local Postgres from `.env`; if it is not running, note it and continue — the migration runs on boot in EC2).

- [ ] **Step 6: Commit**

```bash
git add backend/src/config/index.ts backend/.env.example backend/src/content/achAuthorizationTerms.ts backend/migrations/021_ach_authorizations.sql
git commit -m "North: single Fields checkout credential set, ACH terms content, ach_authorizations table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Session creation and status with one credential set

**Files:**
- Modify: `backend/src/services/northGatewayService.ts:74-133` (types + `embeddedCredentials`), `:509-628` (`createEmbeddedSession`, `getEmbeddedSessionStatus`)

**Interfaces:**
- Produces:
  - `interface CreateEmbeddedSessionInput { amount: number; transactionType: 'SALE' | 'STORAGE'; products?: NorthEmbeddedProduct[]; orderId?: string; customerEmail?: string | null; additionalFields?: Record<string, string> }`
  - `northGatewayService.createEmbeddedSession(input): Promise<{ sessionToken: string; sessionId: string | null }>`
  - `northGatewayService.getEmbeddedSessionStatus(sessionToken: string): Promise<Record<string, unknown>>`
- Consumes: `config.north.embeddedCheckoutId / embeddedProfileId / embeddedPrivateApiKey` (Task 4).

- [ ] **Step 1: Replace `CreateEmbeddedSessionInput`, `embeddedCredentials`**

```ts
interface CreateEmbeddedSessionInput {
  amount: number;
  transactionType: 'SALE' | 'STORAGE';
  products?: NorthEmbeddedProduct[];
  orderId?: string;
  customerEmail?: string | null;
  /** Prefill / reference fields (first_name, last_name, address, city, state, zip_code, industry_type, invoice_nbr, order_nbr). */
  additionalFields?: Record<string, string>;
}

interface EmbeddedCredentials {
  checkoutId: string;
  profileId: string;
  apiKey: string;
}

function embeddedCredentials(): EmbeddedCredentials {
  return {
    checkoutId: config.north.embeddedCheckoutId,
    profileId: config.north.embeddedProfileId,
    apiKey: config.north.embeddedPrivateApiKey,
  };
}
```

Delete the old `embeddedCredentials(variant?: 'storage')` function.

- [ ] **Step 2: Replace `createEmbeddedSession`**

```ts
  async createEmbeddedSession(input: CreateEmbeddedSessionInput): Promise<{ sessionToken: string; sessionId: string | null }> {
    assertNorthEmbeddedConfig();
    const creds = embeddedCredentials();
    const isStorage = input.transactionType === 'STORAGE';
    const amount = Number(input.amount.toFixed(2));
    if (!Number.isFinite(amount) || amount < 0 || (!isStorage && amount <= 0)) {
      throw ApiError.badRequest(isStorage ? 'Storage sessions use amount 0.00.' : 'Embedded checkout amount must be greater than 0.');
    }
    const minimal: Record<string, unknown> = {
      checkoutId: creds.checkoutId,
      profileId: creds.profileId,
      amount,
      transactionType: input.transactionType,
    };
    const full: Record<string, unknown> = { ...minimal };
    if (input.products?.length) full.products = input.products;
    if (input.orderId) full.orderId = input.orderId;
    if (input.customerEmail) full.email = input.customerEmail;
    if (input.additionalFields && Object.keys(input.additionalFields).length) full.additionalFields = input.additionalFields;

    let data: Record<string, unknown>;
    try {
      data = await this.postEmbeddedSession(full, creds.apiKey);
    } catch (error) {
      // North's sessions endpoint has returned 500 on optional fields for some
      // checkout configurations. Prefill is a nicety; retry once without it.
      if (Object.keys(full).length === Object.keys(minimal).length) throw error;
      logger.warn({ err: error }, 'north session create with optional fields failed; retrying minimal payload');
      data = await this.postEmbeddedSession(minimal, creds.apiKey);
    }
    const nested = asRecordOrNull(data.data);
    const session = asRecordOrNull(data.session) ?? asRecordOrNull(nested?.session);
    const sessionToken = [data.token, data.sessionToken, data.session_token, nested?.token, nested?.sessionToken]
      .find((v): v is string => typeof v === 'string' && v.length > 10);
    if (!sessionToken) throw new ApiError(502, 'North embedded session response did not include a session token.');
    const sessionId = typeof session?.id === 'string' ? session.id : null;
    return { sessionToken, sessionId };
  },
```

Add near the top of the file (after imports):

```ts
import { logger } from '../utils/logger';

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
```

- [ ] **Step 3: Replace `getEmbeddedSessionStatus`**

```ts
  async getEmbeddedSessionStatus(sessionToken: string): Promise<Record<string, unknown>> {
    assertNorthEmbeddedConfig();
    const creds = embeddedCredentials();
    const url = `${config.north.embeddedBaseUrl}/api/sessions/status`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
        SessionToken: sessionToken,
        CheckoutId: creds.checkoutId,
        ProfileId: creds.profileId,
        'User-Agent': 'ServiceFinance Embedded Checkout',
      },
    });
    const text = await res.text().catch(() => '');
    let data: Record<string, unknown> | null = null;
    try { data = text ? (JSON.parse(text) as Record<string, unknown>) : null; } catch { data = null; }
    northCertLog({
      api: 'Embedded Checkout',
      label: 'session status',
      method: 'GET',
      url,
      requestHeaders: { SessionToken: sessionToken, CheckoutId: creds.checkoutId },
      status: res.status,
      statusText: res.statusText,
      responseBody: data ?? text,
    });
    if (!res.ok) {
      const err = describeNorthError(data, `North embedded session status failed: ${res.statusText || `HTTP ${res.status}`}`);
      const requestId = res.headers.get('x-request-id');
      throw new ApiError(502, requestId ? `${err} (North request id: ${requestId})` : err, data ?? { status: res.status, body: text || null });
    }
    if (!data) throw new ApiError(502, 'North embedded session status failed: empty response');
    return data;
  }
```

- [ ] **Step 4: Fix the callers so tsc passes**

The signature changed from `Promise<string>` to `Promise<{ sessionToken, sessionId }>` and `transactionType` is now required. Update the three current callers minimally (they are rewritten in Tasks 9–10):

- `backend/src/routes/payments.ts` `/north/embedded/session`: `const { sessionToken } = await northGatewayService.createEmbeddedSession({ amount, transactionType: 'SALE', orderId: ..., customerEmail: ..., products });`
- `backend/src/routes/payments.ts` `/north/embedded/storage-session`: `const { sessionToken } = await northGatewayService.createEmbeddedSession({ amount: 0, transactionType: 'STORAGE', additionalFields, customerEmail: cust.email });`
- `backend/src/services/agreementSigningService.ts` `createInitialPaymentSession`: `const { sessionToken } = await northGatewayService.createEmbeddedSession({ amount, transactionType: 'SALE', orderId: invoice.invoice_number, customerEmail: invoice.customer_email, products: [...] });`
- `backend/src/utils/northEmbedded.ts`: remove the second `'storage'` argument from both `getEmbeddedSessionStatus(sessionToken, 'storage')` calls.
- In `backend/src/services/epxEmbeddedPaymentsService.ts` the `credentials()` helper still reads `config.north.embeddedFields*`; leave it (Task 6 rewrites the file).

- [ ] **Step 5: Typecheck and test**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src
git commit -m "North sessions: single credential set, explicit transactionType, one retry, return session id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Rewrite the EPX payments service to the spec

**Files:**
- Rewrite: `backend/src/services/epxEmbeddedPaymentsService.ts`

**Interfaces:**
- Consumes: `buildTokenSaleBody`, `buildRefundBody`, `buildReversalBody`, `buildVoidBody`, `parseEpxResponse`, `EpxResult`, `TokenSaleInput`, `EpxPaymentMethod` (Task 2); `config.north.embedded*` (Task 4).
- Produces:
  - `epxEmbeddedPaymentsService.isConfigured(): boolean`
  - `epxEmbeddedPaymentsService.tokenSale(input: TokenSaleInput): Promise<EpxResult>`
  - `epxEmbeddedPaymentsService.refund(input: { authGuid: string; amount: number; paymentMethod: EpxPaymentMethod }): Promise<EpxResult>`
  - `epxEmbeddedPaymentsService.reversal(input: { authGuid: string }): Promise<EpxResult>`
  - `epxEmbeddedPaymentsService.voidTransaction(input: { authGuid: string; paymentMethod: EpxPaymentMethod }): Promise<EpxResult>`
  - Declines are returned as `EpxResult` with `approved: false`; transport/validation failures throw `ApiError(502)`.

- [ ] **Step 1: Replace the whole file**

```ts
// backend/src/services/epxEmbeddedPaymentsService.ts
import { config } from '../config';
import { ApiError } from '../utils/errors';
import { northCertLog } from '../utils/northCertLog';
import {
  buildRefundBody, buildReversalBody, buildTokenSaleBody, buildVoidBody, parseEpxResponse,
  type EpxPaymentMethod, type EpxResult, type TokenSaleInput,
} from './epx/epxPayloads';

/**
 * North Embedded Checkout Payments API (EPX processor).
 *
 *   POST /api/payments/token/sale  — charge a stored BRIC (orig_auth_guid)
 *   PUT  /api/payments/refund      — return funds after settlement
 *   PUT  /api/payments/reversal    — release a card authorization / void pre-settlement
 *   PUT  /api/payments/void        — stop a sale/refund pre-settlement (cards and ACH)
 *
 * Bodies contain only spec fields (see services/epx/epxPayloads.ts). The
 * checkout's private API key authenticates; CheckoutId/ProfileId are sent as
 * headers. Every request/response is appended to the certification log.
 */

function credentials() {
  return {
    checkoutId: config.north.embeddedCheckoutId,
    profileId: config.north.embeddedProfileId,
    apiKey: config.north.embeddedPrivateApiKey,
  };
}

function assertConfigured() {
  const c = credentials();
  if (!c.checkoutId || !c.profileId || !c.apiKey) {
    throw new ApiError(424, 'North Embedded Checkout is not configured. Set NORTH_EMBEDDED_CHECKOUT_ID, NORTH_EMBEDDED_PROFILE_ID, and NORTH_EMBEDDED_PRIVATE_API_KEY.');
  }
}

async function request(label: string, method: 'POST' | 'PUT', path: string, body: Record<string, unknown>): Promise<EpxResult> {
  assertConfigured();
  const creds = credentials();
  const url = `${config.north.embeddedBaseUrl}${path}`;
  const headers = {
    Authorization: `Bearer ${creds.apiKey}`,
    'Content-Type': 'application/json',
    CheckoutId: creds.checkoutId,
    ProfileId: creds.profileId,
    'User-Agent': 'ServiceFinance Embedded Checkout',
  };
  const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
  const text = await res.text().catch(() => '');
  let data: Record<string, unknown> | null = null;
  try { data = text ? (JSON.parse(text) as Record<string, unknown>) : null; } catch { data = null; }
  northCertLog({
    api: 'Embedded Checkout Payments', label, method, url,
    requestHeaders: headers, requestBody: body,
    status: res.status, statusText: res.statusText, responseBody: data ?? text,
  });
  const parsed = parseEpxResponse(data);
  // A processor decline can arrive with a non-2xx status but still carries
  // auth_resp; report it as a decline rather than a transport failure.
  if (res.ok || parsed.responseCode) return parsed;
  const detail = parsed.responseText ?? (text.trim() || null);
  const requestId = res.headers.get('x-request-id');
  throw new ApiError(
    502,
    `EPX ${label} failed: HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}${requestId ? ` (North request id: ${requestId})` : ''}`,
    data ?? { status: res.status, body: text || null },
  );
}

export const epxEmbeddedPaymentsService = {
  isConfigured(): boolean {
    const c = credentials();
    return Boolean(c.checkoutId && c.profileId && c.apiKey);
  },

  /** TOKEN SALE — charge a stored BRIC. MIT charges carry aci_ext: 'RB'. */
  tokenSale(input: TokenSaleInput): Promise<EpxResult> {
    return request(input.mit ? 'TOKEN SALE (MIT)' : 'TOKEN SALE (CIT)', 'POST', '/api/payments/token/sale', buildTokenSaleBody(input));
  },

  /** REFUND — after settlement, full or partial. */
  refund(input: { authGuid: string; amount: number; paymentMethod: EpxPaymentMethod }): Promise<EpxResult> {
    return request('REFUND', 'PUT', '/api/payments/refund', buildRefundBody(input));
  },

  /** REVERSAL — card only, before settlement. */
  reversal(input: { authGuid: string }): Promise<EpxResult> {
    return request('REVERSAL', 'PUT', '/api/payments/reversal', buildReversalBody(input));
  },

  /** VOID — card or ACH, before settlement. */
  voidTransaction(input: { authGuid: string; paymentMethod: EpxPaymentMethod }): Promise<EpxResult> {
    return request('VOID', 'PUT', '/api/payments/void', buildVoidBody(input));
  },
};
```

- [ ] **Step 2: Patch the only caller so tsc passes**

In `backend/src/integrations/payments/northProvider.ts` (fully rewritten in Task 8) change the three call sites for now:

```ts
const result = await epxEmbeddedPaymentsService.tokenSale({ authGuid: providerPaymentMethodId, amount, paymentMethod: 'credit', mit: options.mit === true });
// ...
const res = await epxEmbeddedPaymentsService.refund({ authGuid: transactionId, amount, paymentMethod: 'credit' });
// ...
const res = await epxEmbeddedPaymentsService.reversal({ authGuid: transactionId });
```

- [ ] **Step 3: Typecheck and test**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/epxEmbeddedPaymentsService.ts backend/src/integrations/payments/northProvider.ts
git commit -m "EPX payments: token sale/refund/reversal/void with spec bodies (orig_auth_guid, payment_method, aci_ext)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Session polling helper

**Files:**
- Modify: `backend/src/utils/northEmbedded.ts` (add `waitForNorthSession`; keep the old exports until Task 14)

**Interfaces:**
- Consumes: `northGatewayService.getEmbeddedSessionStatus` (Task 5), `extractNorthSessionResult`, `NorthMethodType`, `NorthSessionResult` (Task 3).
- Produces: `waitForNorthSession(sessionToken: string, expected: NorthMethodType, options?: { timeoutMs?: number; intervalMs?: number }): Promise<NorthSessionResult>` — resolves only for an approved session with an `authGuid`; throws `ApiError(402)` on decline (message includes `auth_resp_text`), `ApiError(409)` on expired/cancelled or when not terminal before the timeout, `ApiError(502)` when approved without a BRIC.

- [ ] **Step 1: Add the function**

```ts
import { extractNorthSessionResult, type NorthMethodType, type NorthSessionResult } from './northSessionResult';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fields' checkout.submit() resolves before the client calls us, so North's
 * status endpoint is usually final on the first poll; keep polling briefly
 * because the "Approved" write can lag the client callback by a few seconds.
 */
export async function waitForNorthSession(
  sessionToken: string,
  expected: NorthMethodType,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<NorthSessionResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let result = extractNorthSessionResult(await northGatewayService.getEmbeddedSessionStatus(sessionToken), expected);
  while (!result.terminal && Date.now() < deadline) {
    await sleep(intervalMs);
    result = extractNorthSessionResult(await northGatewayService.getEmbeddedSessionStatus(sessionToken), expected);
  }
  if (result.declined) {
    const reason = result.responseText ? ` (${result.responseText})` : '';
    throw new ApiError(402, `The payment was declined by the processor${reason}. Please try a different payment method.`);
  }
  if (!result.approved) {
    if (['expired', 'cancelled', 'canceled'].includes(result.status)) {
      throw new ApiError(409, 'The checkout session has expired or was cancelled. Please start again.');
    }
    throw new ApiError(409, `The payment has not completed (North session status: ${result.status || 'unknown'}). Please try again.`);
  }
  if (!result.authGuid) {
    throw new ApiError(502, 'North approved the session but did not return a payment token (auth_guid).');
  }
  return result;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add backend/src/utils/northEmbedded.ts
git commit -m "North: waitForNorthSession polling helper built on pure session extraction

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Route charges and refunds by the stored method's provider

**Files:**
- Create: `backend/src/integrations/payments/resolveProvider.ts`
- Test: `backend/test/resolveProvider.test.ts`
- Modify: `backend/src/integrations/payments/index.ts` (options types, `providerFor`)
- Rewrite `charge`/`refund` in: `backend/src/integrations/payments/northProvider.ts:167-304`
- Modify: `backend/src/services/paymentService.ts` (`addVaultedMethod`, `chargeInvoice`, `recordExternalInvoicePayment`, `refundPayment`)

**Interfaces:**
- Consumes: `epxEmbeddedPaymentsService.tokenSale/refund/reversal/voidTransaction` (Task 6), `EpxCustomer`, `EpxPaymentMethod` (Task 2).
- Produces:
  - `resolveProviderName(storedProvider: string | null | undefined, configuredProvider: string): 'north' | 'mock'`
  - `providerFor(name: 'north' | 'mock'): PaymentProvider` (cached instances) in `integrations/payments/index.ts`; `paymentProvider` stays as the configured default for `addMethod`.
  - `interface ChargeOptions { mit?: boolean; paymentMethod?: EpxPaymentMethod; customer?: EpxCustomer; invoiceNumber?: string | null }`
  - `interface RefundOptions { paymentMethod?: EpxPaymentMethod; fullAmount?: boolean }`; `PaymentProvider.refund(transactionId, amountCents, options?)`
  - `paymentService.addVaultedMethod(customerId, { providerPaymentMethodId, provider?, methodType?: 'card' | 'bank_account', brand, last4, expirationMonth, expirationYear }, setDefault, userId)` → row incl. `methodType`, `duplicate`
  - `paymentService.recordExternalInvoicePayment(invoiceId, amount, providerName, providerTransactionId, userId, employeeId, options?: { paymentMethodId?: string | null; brand?: string | null; last4?: string | null })`
  - `paymentService.loadCustomerBillingInfo(customerId): Promise<EpxCustomer & { email: string | null }>`

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/resolveProvider.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderName } from '../src/integrations/payments/resolveProvider';

test('north-stored methods always resolve to north', () => {
  assert.equal(resolveProviderName('north', 'mock'), 'north');
  assert.equal(resolveProviderName('north_embedded', 'mock'), 'north');
  assert.equal(resolveProviderName('NORTH', 'mock'), 'north');
});

test('mock-stored methods resolve to mock even when north is configured', () => {
  assert.equal(resolveProviderName('mock', 'north'), 'mock');
});

test('unknown or missing stored provider falls back to the configured one', () => {
  assert.equal(resolveProviderName(null, 'north'), 'north');
  assert.equal(resolveProviderName(undefined, 'mock'), 'mock');
  assert.equal(resolveProviderName('stripe', 'north'), 'north');
  assert.equal(resolveProviderName(null, 'bogus'), 'mock');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test` → FAIL, module not found.

- [ ] **Step 3: Implement `resolveProvider.ts`**

```ts
// backend/src/integrations/payments/resolveProvider.ts
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
```

- [ ] **Step 4: Extend `integrations/payments/index.ts`**

Replace `ChargeOptions` and the `PaymentProvider.refund` signature, and add `providerFor`:

```ts
import type { EpxCustomer, EpxPaymentMethod } from '../../services/epx/epxPayloads';
import type { ProviderName } from './resolveProvider';

export interface ChargeOptions {
  /** Merchant-initiated (AutoPay / recurring). North token sales add aci_ext: 'RB'. */
  mit?: boolean;
  /** 'credit' for cards, 'ach' for bank accounts (from payment_methods.method_type). */
  paymentMethod?: EpxPaymentMethod;
  customer?: EpxCustomer;
  invoiceNumber?: string | null;
}

export interface RefundOptions {
  paymentMethod?: EpxPaymentMethod;
  /** True when the whole original amount is being returned (enables reversal/void fallback). */
  fullAmount?: boolean;
}

export interface PaymentProvider {
  name: string;
  attachPaymentMethod(token: string): Promise<TokenizedPaymentMethod>;
  charge(providerPaymentMethodId: string, amountCents: number, currency: string, description: string, options?: ChargeOptions): Promise<ChargeResult>;
  refund(transactionId: string, amountCents: number, options?: RefundOptions): Promise<ChargeResult>;
}
```

`MockPaymentProvider.refund(transactionId: string)` keeps its body (extra params are ignored). Replace `createProvider` / the export with:

```ts
const instances: Partial<Record<ProviderName, PaymentProvider>> = {};

export function providerFor(name: ProviderName): PaymentProvider {
  if (!instances[name]) {
    if (name === 'mock') {
      instances[name] = new MockPaymentProvider();
    } else {
      // Lazy require avoids a circular import (northGatewayService → config).
      const { NorthPaymentProvider } = require('./northProvider') as typeof import('./northProvider');
      instances[name] = new NorthPaymentProvider();
    }
  }
  return instances[name]!;
}

/** Provider for the legacy raw-token /payment-methods route and dev fixtures. */
export const paymentProvider: PaymentProvider = providerFor(config.payments.provider === 'north' ? 'north' : 'mock');
```

- [ ] **Step 5: Rewrite `charge` and `refund` in `northProvider.ts`**

Replace `charge` with:

```ts
  async charge(providerPaymentMethodId: string, amountCents: number, _currency?: string, _description?: string, options: ChargeOptions = {}): Promise<ChargeResult> {
    if (amountCents <= 0) return { success: false, transactionId: null, failureReason: 'Invalid amount' };
    const amount = Number((amountCents / 100).toFixed(2));
    const paymentMethodID = Number(providerPaymentMethodId);

    // Non-numeric ids are BRICs from Embedded Checkout (STORAGE or SALE).
    if (!Number.isInteger(paymentMethodID) || paymentMethodID <= 0) {
      if (!epxEmbeddedPaymentsService.isConfigured()) {
        return { success: false, transactionId: null, failureReason: 'North Embedded Checkout is not configured (NORTH_EMBEDDED_CHECKOUT_ID / PROFILE_ID / PRIVATE_API_KEY).' };
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
          return { success: false, transactionId: result.authGuid, failureReason: formatNorthFailure(result) };
        }
        return { success: true, transactionId: result.authGuid ?? `north_${Date.now()}`, failureReason: null };
      } catch (error) {
        return { success: false, transactionId: null, failureReason: (error as Error).message || 'North token sale failed.' };
      }
    }
    // ... keep the existing numeric (legacy chargePaymentMethod) branch unchanged ...
```

Replace the EPX branch of `refund` (keep the numeric gateway branch as is):

```ts
  async refund(transactionId: string, amountCents: number, options: RefundOptions = {}): Promise<ChargeResult> {
    if (amountCents <= 0) return { success: false, transactionId: null, failureReason: 'Invalid refund amount' };
    const amount = Number((amountCents / 100).toFixed(2));
    const gatewayId = Number(String(transactionId).replace(/^ccs_/i, ''));
    const isGatewayTransaction = Number.isInteger(gatewayId) && gatewayId > 0;

    if (!isGatewayTransaction) {
      if (!epxEmbeddedPaymentsService.isConfigured()) {
        return { success: false, transactionId: null, failureReason: 'North Embedded Checkout is not configured; issue the refund from the Payments Hub portal.' };
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
    // ... existing numeric gateway branch unchanged ...
```

Update the import line: `import type { ChargeOptions, ChargeResult, PaymentProvider, RefundOptions, TokenizedPaymentMethod } from './index';`

- [ ] **Step 6: `paymentService` changes**

Add imports at the top:

```ts
import { paymentProvider, providerFor } from '../integrations/payments';
import { resolveProviderName } from '../integrations/payments/resolveProvider';
import type { EpxCustomer, EpxPaymentMethod } from './epx/epxPayloads';
import { config } from '../config';
```

Add a helper method to `paymentService`:

```ts
  /** Name + primary service address for EPX AVS / receipts. Never card data. */
  async loadCustomerBillingInfo(customerId: string): Promise<EpxCustomer & { email: string | null }> {
    const { rows } = await pool.query(
      `SELECT c.first_name, c.last_name, c.email,
              sl.address_line1, sl.city, sl.state, sl.postal_code
       FROM customers c
       LEFT JOIN LATERAL (
         SELECT address_line1, city, state, postal_code
         FROM service_locations
         WHERE customer_id = c.id AND deleted_at IS NULL
         ORDER BY is_primary DESC, created_at ASC
         LIMIT 1
       ) sl ON true
       WHERE c.id = $1`,
      [customerId],
    );
    const r = rows[0] ?? {};
    return {
      firstName: r.first_name ?? null, lastName: r.last_name ?? null, email: r.email ?? null,
      address: r.address_line1 ?? null, city: r.city ?? null, state: r.state ?? null, zipCode: r.postal_code ?? null,
    };
  },
```

`addVaultedMethod`: add `methodType?: 'card' | 'bank_account'` to the `method` param type; include `method_type` in the SELECT, INSERT and RETURNING:

```ts
      const { rows } = await tx.query(
        `INSERT INTO payment_methods (customer_id, payment_provider, provider_payment_method_id, method_type, brand, last4, expiration_month, expiration_year, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, customer_id, payment_provider, method_type, brand, last4, expiration_month, expiration_year, is_default`,
        [customerId, method.provider ?? 'north', method.providerPaymentMethodId, method.methodType ?? 'card', method.brand,
         normalizeLast4(method.last4), method.expirationMonth ?? 12, method.expirationYear ?? now.getFullYear() + 10, setDefault],
      );
```

and the existing-row SELECT gains `method_type`. Audit `via` becomes `'north_embedded_fields'`.

`chargeInvoice`: after `methodRow` is resolved replace the provider call block with:

```ts
    const provider = providerFor(resolveProviderName(methodRow.payment_provider, config.payments.provider));
    const customer = await paymentService.loadCustomerBillingInfo(invoice.customer_id);
    const paymentMethod: EpxPaymentMethod = methodRow.method_type === 'bank_account' ? 'ach' : 'credit';
    const result = await provider.charge(
      methodRow.provider_payment_method_id,
      Math.round(chargeAmount * 100),
      'usd',
      `Invoice ${invoice.invoice_number}`,
      { mit, paymentMethod, customer, invoiceNumber: invoice.invoice_number },
    );
```

and replace both `paymentProvider.name` occurrences inside `chargeInvoice` with `provider.name`. (Reference `paymentService.loadCustomerBillingInfo` by name rather than `this`; the `export const paymentService = { ... }` binding is resolved at call time, so self-reference inside its methods is safe.)

`recordExternalInvoicePayment`: add a 7th parameter `options: { paymentMethodId?: string | null; brand?: string | null; last4?: string | null } = {}`; the INSERT uses `options.paymentMethodId ?? null` in place of the literal `NULL` (add it as a bound parameter), and the returned `receipt.brand` / `receipt.last4` use `options.brand ?? null` / `options.last4 ?? null`.

`refundPayment`: change the initial SELECT to also join the method type:

```sql
SELECT p.*, i.total AS invoice_total, i.amount_paid, i.status AS invoice_status, i.due_date,
       pm.method_type AS method_type
FROM payments p
LEFT JOIN invoices i ON i.id = p.invoice_id
LEFT JOIN payment_methods pm ON pm.id = p.payment_method_id
WHERE p.id = $1
```

and replace the provider call:

```ts
    const provider = providerFor(resolveProviderName(payment.payment_provider, config.payments.provider));
    const result = await provider.refund(payment.provider_transaction_id, Math.round(refundAmount * 100), {
      paymentMethod: payment.method_type === 'bank_account' ? 'ach' : 'credit',
      fullAmount: refundAmount >= remaining - 0.001,
    });
```

- [ ] **Step 7: Typecheck and test**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: clean; 4 test files pass.

- [ ] **Step 8: Commit**

```bash
git add backend/src backend/test
git commit -m "Payments: route charges/refunds by stored provider, pass method type and customer to token sales, void fallback for ACH

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `northFieldsPaymentService` and the `/payments/north/fields/*` routes

**Files:**
- Create: `backend/src/services/northFieldsPaymentService.ts`
- Modify: `backend/src/routes/payments.ts` (replace the four `/north/embedded/*` routes; webhook secret list)

**Interfaces:**
- Consumes: `northGatewayService.createEmbeddedSession` (Task 5), `waitForNorthSession` (Task 7), `paymentService.addVaultedMethod / chargeInvoice / recordExternalInvoicePayment / loadCustomerBillingInfo` (Task 8), `ACH_TERMS_TEXT / ACH_TERMS_VERSION` (Task 4).
- Produces:
  - `type FieldsPayMode = 'card' | 'bank'`
  - `interface FieldsBreakdown { subtotal: number; tax: number; total: number; previouslyPaid: number; amountDue: number }`
  - `interface FieldsPaySession { sessionToken: string; scriptUrl: string; mode: FieldsPayMode; invoiceId: string; invoiceNumber: string; amount: number; breakdown: FieldsBreakdown; achTerms: { version: string; text: string } | null }`
  - `interface FieldsConfirmResult { status: 'approved'; duplicate: boolean; amount: number | null; transactionId: string | null; receipt: unknown | null; payment: unknown | null; savedMethod: { id: string; methodType: 'card' | 'bank_account'; brand: string; last4: string | null } | null }`
  - `interface ConsentMeta { ip: string | null; userAgent: string | null }`
  - `northFieldsPaymentService.createPaySession({ invoiceId, mode }): Promise<FieldsPaySession>`
  - `northFieldsPaymentService.confirmPay({ invoiceId, mode, sessionToken, actorUserId, employeeId, achConsent, consentMeta }): Promise<FieldsConfirmResult>`
  - `northFieldsPaymentService.createStorageSession({ customerId }): Promise<{ sessionToken: string; scriptUrl: string; customerId: string }>`
  - `northFieldsPaymentService.confirmStorage({ customerId, sessionToken, setDefault, actorUserId }): Promise<{ id: string; methodType; brand; last4; duplicate: boolean }>`
  - HTTP: `POST /payments/north/fields/session`, `/confirm`, `/storage-session`, `/storage-confirm` (bodies below).

- [ ] **Step 1: Create the service**

```ts
// backend/src/services/northFieldsPaymentService.ts
import { config } from '../config';
import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { northGatewayService } from './northGatewayService';
import { paymentService } from './paymentService';
import { waitForNorthSession } from '../utils/northEmbedded';
import type { NorthMethodType } from '../utils/northSessionResult';
import { ACH_TERMS_TEXT, ACH_TERMS_VERSION } from '../content/achAuthorizationTerms';

/**
 * The three Embedded Checkout (Fields) flows, shared by the staff API and the
 * public agreement page:
 *   card payment  = STORAGE session → vault BRIC → server-side TOKEN SALE (CIT)
 *   bank payment  = ACH SALE session → record payment → vault auth_guid as bank account
 *   store only    = STORAGE session → vault
 * The client only tells us which session to create and when to verify; every
 * decision is made from North's session status endpoint.
 */
export type FieldsPayMode = 'card' | 'bank';

export interface FieldsBreakdown { subtotal: number; tax: number; total: number; previouslyPaid: number; amountDue: number }

export interface FieldsPaySession {
  sessionToken: string;
  scriptUrl: string;
  mode: FieldsPayMode;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  breakdown: FieldsBreakdown;
  achTerms: { version: string; text: string } | null;
}

export interface FieldsConfirmResult {
  status: 'approved';
  duplicate: boolean;
  amount: number | null;
  transactionId: string | null;
  receipt: unknown | null;
  payment: unknown | null;
  savedMethod: { id: string; methodType: NorthMethodType; brand: string; last4: string | null } | null;
}

export interface ConsentMeta { ip: string | null; userAgent: string | null }

interface InvoiceRow {
  id: string; invoice_number: string; customer_id: string; status: string;
  subtotal: string; tax_amount: string; discount_amount: string | null; total: string; amount_paid: string;
}

const money = (v: unknown) => Number(Number(v ?? 0).toFixed(2));
const scriptUrl = () => `${config.north.embeddedBaseUrl}/checkout.js`;

async function loadInvoice(invoiceId: string): Promise<InvoiceRow> {
  const { rows } = await pool.query(
    `SELECT id, invoice_number, customer_id, status, subtotal, tax_amount, discount_amount, total, amount_paid
     FROM invoices WHERE id = $1 AND deleted_at IS NULL`,
    [invoiceId],
  );
  const invoice = rows[0] as InvoiceRow | undefined;
  if (!invoice) throw ApiError.notFound('Invoice not found');
  if (invoice.status === 'void') throw ApiError.badRequest('This invoice has been voided.');
  return invoice;
}

function breakdownFor(invoice: InvoiceRow): FieldsBreakdown {
  const total = money(invoice.total);
  const previouslyPaid = money(invoice.amount_paid);
  return {
    subtotal: money(Number(invoice.subtotal) - Number(invoice.discount_amount ?? 0)),
    tax: money(invoice.tax_amount),
    total,
    previouslyPaid,
    amountDue: money(Math.max(0, total - previouslyPaid)),
  };
}

function additionalFieldsFor(customer: Awaited<ReturnType<typeof paymentService.loadCustomerBillingInfo>>, invoiceNumber?: string) {
  const fields: Record<string, string> = { industry_type: 'E' };
  if (customer.firstName) fields.first_name = customer.firstName;
  if (customer.lastName) fields.last_name = customer.lastName;
  if (customer.address) fields.address = customer.address;
  if (customer.city) fields.city = customer.city;
  if (customer.state) fields.state = customer.state;
  if (customer.zipCode) fields.zip_code = customer.zipCode;
  if (invoiceNumber) { fields.invoice_nbr = invoiceNumber; fields.order_nbr = invoiceNumber; }
  return fields;
}

export const northFieldsPaymentService = {
  async createPaySession(input: { invoiceId: string; mode: FieldsPayMode }): Promise<FieldsPaySession> {
    const invoice = await loadInvoice(input.invoiceId);
    const breakdown = breakdownFor(invoice);
    if (breakdown.amountDue <= 0) throw ApiError.badRequest('Invoice has no outstanding balance.');
    const customer = await paymentService.loadCustomerBillingInfo(invoice.customer_id);
    const additionalFields = additionalFieldsFor(customer, invoice.invoice_number);
    const { sessionToken } = input.mode === 'card'
      ? await northGatewayService.createEmbeddedSession({ amount: 0, transactionType: 'STORAGE', customerEmail: customer.email, additionalFields })
      : await northGatewayService.createEmbeddedSession({
          amount: breakdown.amountDue,
          transactionType: 'SALE',
          orderId: invoice.invoice_number,
          customerEmail: customer.email,
          products: [{ name: `Invoice ${invoice.invoice_number} balance`, quantity: 1, price: breakdown.amountDue }],
          additionalFields,
        });
    return {
      sessionToken,
      scriptUrl: scriptUrl(),
      mode: input.mode,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      amount: breakdown.amountDue,
      breakdown,
      achTerms: input.mode === 'bank' ? { version: ACH_TERMS_VERSION, text: ACH_TERMS_TEXT } : null,
    };
  },

  async confirmPay(input: {
    invoiceId: string; mode: FieldsPayMode; sessionToken: string;
    actorUserId: string; employeeId: string | null;
    achConsent?: boolean; consentMeta?: ConsentMeta;
  }): Promise<FieldsConfirmResult> {
    const invoice = await loadInvoice(input.invoiceId);
    if (input.mode === 'bank' && input.achConsent !== true) {
      throw ApiError.badRequest('Bank payments require acceptance of the ACH authorization terms.');
    }
    const expected: NorthMethodType = input.mode === 'bank' ? 'bank_account' : 'card';
    const result = await waitForNorthSession(input.sessionToken, expected);
    logger.info({ invoiceId: invoice.id, mode: input.mode, status: result.status, methodType: result.methodType }, 'north fields session approved');

    // Whatever the customer picked inside the fields, the BRIC goes on file.
    const method = (await paymentService.addVaultedMethod(
      invoice.customer_id,
      {
        providerPaymentMethodId: result.authGuid!,
        provider: 'north',
        methodType: result.methodType,
        brand: result.brand,
        last4: result.last4,
        expirationMonth: result.expirationMonth,
        expirationYear: result.expirationYear,
      },
      true,
      input.actorUserId,
    )) as { id: string; duplicate: boolean };
    const savedMethod = { id: method.id, methodType: result.methodType, brand: result.brand, last4: result.last4 };

    if (input.mode === 'card') {
      // STORAGE approved → charge the stored BRIC (customer-initiated, no aci_ext).
      try {
        const charged = await paymentService.chargeInvoice(invoice.id, method.id, null, input.actorUserId, input.employeeId, { source: 'manual', mit: false });
        return { status: 'approved', duplicate: false, amount: charged.receipt.amount, transactionId: charged.receipt.transactionId, receipt: charged.receipt, payment: charged.payment, savedMethod };
      } catch (error) {
        if (error instanceof ApiError && /already paid/i.test(error.message)) {
          return { status: 'approved', duplicate: true, amount: null, transactionId: null, receipt: null, payment: null, savedMethod };
        }
        throw error;
      }
    }

    // Bank: the SALE already moved the money inside the checkout.
    if (result.amount == null || result.amount <= 0) {
      throw ApiError.badGateway('North approved the ACH sale but did not report an amount.');
    }
    const recorded = await paymentService.recordExternalInvoicePayment(
      invoice.id, result.amount, 'north', result.authGuid!, input.actorUserId, input.employeeId,
      { paymentMethodId: method.id, brand: result.brand, last4: result.last4 },
    );
    if (!recorded.duplicate && result.methodType === 'bank_account') {
      await pool.query(
        `INSERT INTO ach_authorizations (customer_id, invoice_id, payment_id, payment_method_id, amount, terms_version, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoice.customer_id, invoice.id, (recorded.payment as { id: string }).id, method.id, result.amount, ACH_TERMS_VERSION, input.consentMeta?.ip ?? null, input.consentMeta?.userAgent ?? null],
      );
    }
    return {
      status: 'approved',
      duplicate: recorded.duplicate,
      amount: result.amount,
      transactionId: result.authGuid,
      receipt: recorded.receipt,
      payment: recorded.payment,
      savedMethod,
    };
  },

  async createStorageSession(input: { customerId: string }) {
    const customer = await paymentService.loadCustomerBillingInfo(input.customerId);
    const { sessionToken } = await northGatewayService.createEmbeddedSession({
      amount: 0, transactionType: 'STORAGE', customerEmail: customer.email, additionalFields: additionalFieldsFor(customer),
    });
    return { sessionToken, scriptUrl: scriptUrl(), customerId: input.customerId };
  },

  async confirmStorage(input: { customerId: string; sessionToken: string; setDefault: boolean; actorUserId: string }) {
    const result = await waitForNorthSession(input.sessionToken, 'card');
    const method = (await paymentService.addVaultedMethod(
      input.customerId,
      {
        providerPaymentMethodId: result.authGuid!,
        provider: 'north',
        methodType: result.methodType,
        brand: result.brand,
        last4: result.last4,
        expirationMonth: result.expirationMonth,
        expirationYear: result.expirationYear,
      },
      input.setDefault,
      input.actorUserId,
    )) as { id: string; duplicate: boolean };
    return { id: method.id, methodType: result.methodType, brand: result.brand, last4: result.last4, duplicate: method.duplicate };
  },
};
```

- [ ] **Step 2: Replace the four embedded routes in `routes/payments.ts`**

Delete the `/north/embedded/session`, `/north/embedded/confirm`, `/north/embedded/storage-session`, `/north/embedded/storage-confirm` handlers and the now-unused imports (`waitForApprovedNorthSession`, `waitForNorthStorageResult`, `extractNorthCardOnFile`, `northGatewayService` if unused elsewhere in the file — it is still used by `/north/invoice-link`, keep it). Add:

```ts
import { northFieldsPaymentService } from '../services/northFieldsPaymentService';

const payModeSchema = z.enum(['card', 'bank']);

router.post(
  '/north/fields/session',
  authorize('invoices:read', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ invoiceId: z.string().uuid(), mode: payModeSchema }).parse(req.body);
    const scope = technicianScope(req, 'invoices:read');
    await assertInvoiceAccess(scope, body.invoiceId);
    ok(res, await northFieldsPaymentService.createPaySession(body), 'North checkout session created', 201);
  }),
);

router.post(
  '/north/fields/confirm',
  authorize('invoices:read', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      invoiceId: z.string().uuid(),
      mode: payModeSchema,
      sessionToken: z.string().min(10),
      achConsent: z.boolean().optional(),
    }).parse(req.body);
    const scope = technicianScope(req, 'invoices:read');
    await assertInvoiceAccess(scope, body.invoiceId);
    const result = await northFieldsPaymentService.confirmPay({
      ...body,
      actorUserId: req.user!.id,
      employeeId: req.user!.employeeId,
      consentMeta: { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null },
    });
    ok(res, result, result.duplicate ? 'Payment already recorded' : 'Payment recorded', 201);
  }),
);

router.post(
  '/north/fields/storage-session',
  authorize('payments:collect_info', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ customerId: z.string().uuid() }).parse(req.body);
    const scope = technicianScope(req, 'payments:collect');
    if (scope) await assertCustomerAccess(scope, body.customerId);
    ok(res, await northFieldsPaymentService.createStorageSession(body), 'North storage session created', 201);
  }),
);

router.post(
  '/north/fields/storage-confirm',
  authorize('payments:collect_info', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({
      customerId: z.string().uuid(),
      sessionToken: z.string().min(10),
      setDefault: z.boolean().optional(),
    }).parse(req.body);
    const scope = technicianScope(req, 'payments:collect');
    if (scope) await assertCustomerAccess(scope, body.customerId);
    const method = await northFieldsPaymentService.confirmStorage({ ...body, setDefault: body.setDefault ?? true, actorUserId: req.user!.id });
    ok(res, method, method.duplicate ? 'Payment method already on file' : 'Payment method stored on file', 201);
  }),
);
```

Update `verifyNorthWebhookSignature` to `const secrets = [config.north.webhookSecret, config.north.legacyWebhookSecret].filter(Boolean);`.

- [ ] **Step 3: Typecheck and test**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: clean. (`agreementSigningService` still compiles against the old helpers; Task 10 replaces it.)

- [ ] **Step 4: Smoke the routes locally against the sandbox (optional if Postgres is up)**

Run the API (`npm run dev`), log in with a staff token, and:

```bash
curl -s -X POST http://localhost:4000/api/v1/payments/north/fields/storage-session -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"customerId":"<uuid>"}'
```

Expected: 201 with `sessionToken` and `scriptUrl`; `logs/north-cert.log` gains a `STORAGE session create` block.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/northFieldsPaymentService.ts backend/src/routes/payments.ts
git commit -m "North Fields: shared pay/store service and /payments/north/fields routes (card STORAGE+token sale, bank ACH sale, consent)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Agreement signing page on Fields (card / bank, consent)

**Files:**
- Modify: `backend/src/services/agreementSigningService.ts:706-836` (`createInitialPaymentSession`, `getInitialPaymentStatus`, `confirmInitialPayment`)
- Modify: `backend/src/routes/agreements.ts` (`payClientScript`, the three `/sign/pay/*` routes, the payment section HTML)

**Interfaces:**
- Consumes: `northFieldsPaymentService.createPaySession / confirmPay` (Task 9), `FieldsPayMode`.
- Produces:
  - `agreementSigningService.createInitialPaymentSession(paymentToken: string, mode: FieldsPayMode): Promise<FieldsPaySession>`
  - `agreementSigningService.confirmInitialPayment(paymentToken: string, mode: FieldsPayMode, northSessionToken: string, achConsent: boolean | undefined, consentMeta: ConsentMeta): Promise<FieldsConfirmResult>`
  - `agreementSigningService.getInitialPaymentStatus(paymentToken, northSessionToken)` unchanged.
  - HTTP `POST /agreements/sign/pay/session { payToken, mode }`, `POST /agreements/sign/pay/confirm { payToken, mode, sessionToken, achConsent? }`.

- [ ] **Step 1: Replace the two service methods**

```ts
  /**
   * Post-signing initial payment on the Fields checkout. Card = STORAGE then a
   * customer-initiated token sale; bank = ACH SALE inside the checkout. Either
   * way the method ends up on file for recurring charges.
   */
  async createInitialPaymentSession(paymentToken: string, mode: FieldsPayMode) {
    const payload = parseInitialPaymentToken(paymentToken);
    await assertInvoiceBelongsToCustomer(payload.invoiceId, payload.customerId);
    return northFieldsPaymentService.createPaySession({ invoiceId: payload.invoiceId, mode });
  },

  async confirmInitialPayment(
    paymentToken: string,
    mode: FieldsPayMode,
    northSessionToken: string,
    achConsent: boolean | undefined,
    consentMeta: ConsentMeta,
  ) {
    const payload = parseInitialPaymentToken(paymentToken);
    await assertInvoiceBelongsToCustomer(payload.invoiceId, payload.customerId);
    const ownerUserId = await getOwnerUserId();
    if (!ownerUserId) throw ApiError.badRequest('Owner account not available to record the initial payment.');
    return northFieldsPaymentService.confirmPay({
      invoiceId: payload.invoiceId,
      mode,
      sessionToken: northSessionToken,
      actorUserId: ownerUserId,
      employeeId: null,
      achConsent,
      consentMeta,
    });
  },
```

Add the module-level helper and imports:

```ts
import { northFieldsPaymentService, type ConsentMeta, type FieldsPayMode } from './northFieldsPaymentService';

async function assertInvoiceBelongsToCustomer(invoiceId: string, customerId: string) {
  const { rows } = await pool.query(
    'SELECT 1 FROM invoices WHERE id = $1 AND customer_id = $2 AND deleted_at IS NULL',
    [invoiceId, customerId],
  );
  if (!rows[0]) throw ApiError.notFound('Initial agreement invoice not found.');
}
```

Remove the imports of `extractNorthCardOnFile`, `waitForApprovedNorthSession`, `asRecord` from `../utils/northEmbedded` and of `config` if now unused in this file. `getInitialPaymentStatus` stays.

- [ ] **Step 2: Update the three routes in `routes/agreements.ts`**

```ts
const payModeSchema = z.enum(['card', 'bank']);

router.post(
  '/sign/pay/session',
  asyncHandler(async (req, res) => {
    const body = z.object({ payToken: z.string().min(20), mode: payModeSchema }).parse(req.body);
    ok(res, await agreementSigningService.createInitialPaymentSession(body.payToken, body.mode), 'Embedded checkout session created', 201);
  }),
);

router.post(
  '/sign/pay/confirm',
  asyncHandler(async (req, res) => {
    const body = z.object({
      payToken: z.string().min(20),
      mode: payModeSchema,
      sessionToken: z.string().min(10),
      achConsent: z.boolean().optional(),
      completion: z.unknown().optional(),
    }).parse(req.body);
    if (body.completion !== undefined) {
      logger.info({ northCompletionPayload: body.completion }, 'agreement pay checkout.submit() result');
    }
    const result = await agreementSigningService.confirmInitialPayment(
      body.payToken, body.mode, body.sessionToken, body.achConsent,
      { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null },
    );
    ok(res, result, result.duplicate ? 'Payment already recorded' : 'Payment recorded', 201);
  }),
);
```

`/sign/pay/status` is unchanged.

- [ ] **Step 3: Replace the payment section HTML (the `else if (paymentToken)` branch)**

```ts
      paymentSection = `
      <div style="margin-top:16px;border-top:1px solid #D5EDE9;padding-top:14px;">
        <h3 style="margin:0 0 6px 0;color:#0D0D0D;font-size:16px;">Pay Your Initial Service Charge</h3>
        <p style="margin:0 0 10px 0;color:#30433F;font-size:14px;">
          Choose how to pay${amountDue != null ? ` <strong>${money(Number(amountDue))}</strong>` : ''}. Your details are tokenized by our payment processor and never touch our systems; the method is saved on file for your recurring service charges.
        </p>
        <input id="payToken" type="hidden" value="${htmlEscape(paymentToken)}" />
        <div id="payModes" role="tablist" style="display:flex;gap:8px;margin:0 0 12px 0;">
          <button type="button" data-mode="card" class="pay-mode pay-mode-active" style="flex:1;padding:10px;border:1px solid #2DC4A2;border-radius:8px;background:#EAF8F5;font-weight:700;cursor:pointer;">Pay by Card</button>
          <button type="button" data-mode="bank" class="pay-mode" style="flex:1;padding:10px;border:1px solid #CBD7D4;border-radius:8px;background:#fff;font-weight:700;cursor:pointer;">Pay by Bank (ACH)</button>
        </div>
        <div id="payBreakdown" style="border:1px solid #E3EEEB;border-radius:10px;padding:10px 12px;margin:0 0 12px 0;font-size:14px;color:#30433F;"></div>
        <p id="payStatus" style="color:#607D78;font-size:14px;margin:10px 0;">Loading secure payment form…</p>
        <p id="payError" style="color:#B3261E;font-size:14px;margin:10px 0;display:none;"></p>
        <button type="button" id="payRetry" style="display:none;margin:0 0 12px 0;padding:8px 12px;border:1px solid #CBD7D4;border-radius:8px;background:#fff;cursor:pointer;">Try Again</button>
        <div id="checkoutWrap" style="border:1px solid #D5EDE9;border-radius:14px;background:#fff;padding:12px;">
          <div id="checkout-root" style="width:100%;min-height:320px;background:#FFFFFF;"></div>
        </div>
        <div id="achConsentWrap" style="display:none;margin-top:12px;border:1px solid #F0E3C4;background:#FDF8EC;border-radius:10px;padding:12px;">
          <pre id="achTermsText" style="white-space:pre-wrap;font-family:inherit;font-size:13px;color:#4A4A4A;margin:0 0 10px 0;"></pre>
          <label style="display:flex;gap:8px;align-items:flex-start;font-size:14px;color:#0D0D0D;cursor:pointer;">
            <input id="achConsent" type="checkbox" style="margin-top:3px;" />
            <span>I have read the authorization above and authorize this one-time debit from my bank account.</span>
          </label>
        </div>
        <button type="button" id="payNow" disabled style="display:inline-block;margin-top:12px;padding:12px 18px;background:#2DC4A2;color:#0D0D0D;border:none;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;">Pay ${amountDue != null ? money(Number(amountDue)) : 'Now'}</button>
        <div id="paySuccess" style="display:none;border:1px solid #BFE8DF;background:#EAF8F5;border-radius:10px;padding:14px;margin-top:12px;">
          <h3 style="margin:0 0 6px 0;color:#0D0D0D;font-size:15px;">Payment received — thank you!</h3>
          <p style="margin:0;color:#30433F;font-size:13px;">Your initial service charge has been paid and your payment method was securely saved on file for future service charges. A copy of the invoice and receipt is available in your account.</p>
          <p id="paySuccessDetail" style="margin:8px 0 0 0;color:#30433F;font-size:13px;"></p>
        </div>
      </div>`;
```

Bump the script tag to `/api/v1/agreements/sign/pay/client.js?v=7` and add `.pay-mode-active { border-color:#2DC4A2 !important; background:#EAF8F5 !important; }` to the page `<style>`.

- [ ] **Step 4: Replace `payClientScript()`**

```ts
function payClientScript() {
  return `'use strict';
(function () {
  var payTokenEl = document.getElementById('payToken');
  var statusEl = document.getElementById('payStatus');
  var errorEl = document.getElementById('payError');
  var retryBtn = document.getElementById('payRetry');
  var payBtn = document.getElementById('payNow');
  var checkoutWrap = document.getElementById('checkoutWrap');
  var successEl = document.getElementById('paySuccess');
  var successDetailEl = document.getElementById('paySuccessDetail');
  var breakdownEl = document.getElementById('payBreakdown');
  var consentWrap = document.getElementById('achConsentWrap');
  var consentBox = document.getElementById('achConsent');
  var termsEl = document.getElementById('achTermsText');
  var modeButtons = Array.prototype.slice.call(document.querySelectorAll('.pay-mode'));
  if (!payTokenEl || !statusEl || !errorEl || !checkoutWrap || !successEl || !payBtn) return;

  var payToken = String(payTokenEl.value || '');
  var mode = 'card';
  var session = null;
  var busy = false;
  var scriptPromise = null;

  function money(n) { return '$' + Number(n).toFixed(2); }
  function setStatus(message) { statusEl.textContent = message || ''; statusEl.style.display = message ? 'block' : 'none'; }
  function clearError() { errorEl.style.display = 'none'; if (retryBtn) retryBtn.style.display = 'none'; }
  function showError(message) {
    setStatus(''); busy = false; updatePayButton();
    errorEl.textContent = message || 'Unable to process the payment.'; errorEl.style.display = 'block';
    if (retryBtn) retryBtn.style.display = 'inline-block';
  }
  function updatePayButton() {
    var consentOk = mode !== 'bank' || (consentBox && consentBox.checked);
    payBtn.disabled = busy || !session || !consentOk;
  }
  function renderBreakdown(b) {
    if (!breakdownEl || !b) return;
    var rows = [['Subtotal', b.subtotal], ['Taxes & fees', b.tax], ['Total', b.total]];
    if (b.previouslyPaid > 0) rows.push(['Previously paid', -b.previouslyPaid]);
    rows.push(['Amount due today', b.amountDue]);
    breakdownEl.innerHTML = rows.map(function (r) {
      var strong = r[0] === 'Amount due today';
      return '<div style="display:flex;justify-content:space-between;padding:2px 0;' + (strong ? 'font-weight:700;' : '') + '"><span>' + r[0] + '</span><span>' + money(r[1]) + '</span></div>';
    }).join('');
  }
  function showSuccess(result) {
    setStatus(''); clearError();
    checkoutWrap.style.display = 'none'; payBtn.style.display = 'none';
    if (consentWrap) consentWrap.style.display = 'none';
    modeButtons.forEach(function (b) { b.disabled = true; });
    successEl.style.display = 'block';
    if (successDetailEl) {
      var parts = [];
      if (result && typeof result.amount === 'number') parts.push('Amount paid: ' + money(result.amount));
      if (result && result.receipt && result.receipt.receiptNumber) parts.push('Receipt: ' + result.receipt.receiptNumber);
      if (result && result.savedMethod && result.savedMethod.last4) parts.push('Saved on file: ' + (result.savedMethod.brand || 'Method') + ' ending in ' + result.savedMethod.last4);
      successDetailEl.textContent = parts.join('  ·  ');
    }
  }
  async function postJson(url, body) {
    var response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    var payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok || !payload || payload.success === false) throw new Error((payload && payload.message) || 'Request failed.');
    return payload.data;
  }
  function loadCheckoutScript(scriptUrl) {
    if (window.checkout && typeof window.checkout.mount === 'function') return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = scriptUrl; script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { scriptPromise = null; reject(new Error('Unable to load the secure payment form.')); };
      document.head.appendChild(script);
    });
    return scriptPromise;
  }

  async function startCheckout() {
    clearError(); session = null; busy = true; updatePayButton();
    setStatus('Loading secure payment form…');
    try {
      var created = await postJson('/api/v1/agreements/sign/pay/session', { payToken: payToken, mode: mode });
      renderBreakdown(created.breakdown);
      if (consentWrap) {
        consentWrap.style.display = mode === 'bank' ? 'block' : 'none';
        if (termsEl && created.achTerms) termsEl.textContent = created.achTerms.text;
        if (consentBox) consentBox.checked = false;
      }
      await loadCheckoutScript(created.scriptUrl);
      if (!window.checkout || typeof window.checkout.mount !== 'function' || typeof window.checkout.submit !== 'function') {
        throw new Error('The payment form did not load correctly.');
      }
      var rootEl = document.getElementById('checkout-root');
      if (rootEl) rootEl.innerHTML = '';
      await Promise.resolve(window.checkout.mount(created.sessionToken, 'checkout-root'));
      session = created; busy = false; setStatus(''); updatePayButton();
    } catch (err) {
      showError(err && err.message ? err.message : 'Unable to start the payment.');
    }
  }

  async function submitPayment() {
    if (busy || !session) return;
    if (mode === 'bank' && !(consentBox && consentBox.checked)) { showError('Please accept the ACH authorization to continue.'); return; }
    busy = true; clearError(); updatePayButton();
    setStatus(mode === 'bank' ? 'Authorizing your bank payment…' : 'Securing your card details…');
    var result;
    try {
      result = await window.checkout.submit();
    } catch (err) {
      showError(err && err.message === 'Submit timeout' ? 'The payment is taking longer than expected. Please try again.' : (err && err.message) || 'The payment could not be submitted.');
      return;
    }
    if (!result || result.type !== 'success') {
      var data = result && result.data ? result.data : {};
      showError(data.auth_resp_text || data.message || 'The payment was not approved. Please check your details and try again.');
      // A submitted session cannot be reused — mount a fresh one for the retry.
      startCheckout();
      return;
    }
    setStatus('Processing your payment… This can take a few seconds.');
    try {
      var confirmed = await postJson('/api/v1/agreements/sign/pay/confirm', {
        payToken: payToken, mode: mode, sessionToken: session.sessionToken,
        achConsent: mode === 'bank' ? true : undefined, completion: result
      });
      showSuccess(confirmed);
    } catch (err) {
      showError(err && err.message ? err.message : 'We could not record the payment. Please contact us before retrying.');
    }
  }

  modeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      if (busy) return;
      var next = button.getAttribute('data-mode') === 'bank' ? 'bank' : 'card';
      if (next === mode && session) return;
      mode = next;
      modeButtons.forEach(function (b) { b.classList.toggle('pay-mode-active', b === button); });
      startCheckout();
    });
  });
  if (consentBox) consentBox.addEventListener('change', updatePayButton);
  payBtn.addEventListener('click', submitPayment);
  if (retryBtn) retryBtn.addEventListener('click', startCheckout);

  startCheckout();
})();`;
}
```

- [ ] **Step 5: Typecheck**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: clean.

- [ ] **Step 6: Manual check**

Run the API locally, create a test agreement and open its signing link (see `agreementSigningService.buildSigningUrl` for how the link is generated). After signing, the page should show Card / Bank tabs, the breakdown, and mount the Fields inputs. With the sandbox card `4111 1111 1111 1111`, Pay must produce a `STORAGE session create`, `session status` and `TOKEN SALE (CIT)` block in `backend/logs/north-cert.log`, and the success panel must show the receipt number.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/agreementSigningService.ts backend/src/routes/agreements.ts
git commit -m "Agreement payment: Fields checkout with card/bank choice, ACH consent, shared pay service

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Mobile shared library `northFieldsCheckout.ts`

**Files:**
- Create: `mobile/src/lib/northFieldsCheckout.ts`
- Delete: `mobile/src/lib/northEmbeddedCheckout.ts` (its two consumers are deleted in Task 13; until then keep the old file — delete it in Task 13)

**Interfaces:**
- Produces:
  - `type FieldsPayMode = 'card' | 'bank'`; `type FieldsFlow = 'pay' | 'store'`
  - `interface FieldsBreakdown`, `interface FieldsPaySession`, `interface FieldsStorageSession { sessionToken; scriptUrl; customerId }`, `interface FieldsConfirmResult`, `interface FieldsStoredMethod { id; methodType; brand; last4; duplicate }` mirroring the backend shapes from Task 9.
  - `interface FieldsSubmitResult { type: 'success' | 'failure'; status?: number; data?: Record<string, unknown> }`
  - `type FieldsWebViewMessage = { type: 'fields-ready' } | { type: 'fields-result'; result: FieldsSubmitResult } | { type: 'fields-error'; message: string }`
  - `ensureCheckoutScript(scriptUrl: string): Promise<void>` (web)
  - `mountFields(sessionToken: string, containerId: string): Promise<void>` (web)
  - `submitFields(): Promise<FieldsSubmitResult>` (web; rejects on timeout / unmounted)
  - `buildFieldsWebViewHtml(sessionToken: string, scriptUrl: string): string` (native); the page exposes `window.__sfSubmit()`
  - `parseFieldsWebViewMessage(raw: string): FieldsWebViewMessage | null`
  - `describeFieldsFailure(result: FieldsSubmitResult): string`
  - `formatEmbeddedCheckoutError`, `NORTH_SANDBOX_TEST_CARDS`, `NORTH_SANDBOX_TEST_DETAILS` (moved verbatim from the old file)

- [ ] **Step 1: Create the file**

```ts
// mobile/src/lib/northFieldsCheckout.ts
import { ApiRequestError } from './api';

export type FieldsPayMode = 'card' | 'bank';
export type FieldsFlow = 'pay' | 'store';

export interface FieldsBreakdown { subtotal: number; tax: number; total: number; previouslyPaid: number; amountDue: number }

export interface FieldsPaySession {
  sessionToken: string;
  scriptUrl: string;
  mode: FieldsPayMode;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  breakdown: FieldsBreakdown;
  achTerms: { version: string; text: string } | null;
}

export interface FieldsStorageSession { sessionToken: string; scriptUrl: string; customerId: string }

export interface FieldsStoredMethod { id: string; methodType: 'card' | 'bank_account'; brand: string; last4: string | null; duplicate: boolean }

export interface FieldsConfirmResult {
  status: 'approved';
  duplicate: boolean;
  amount: number | null;
  transactionId: string | null;
  receipt: { receiptNumber?: string } | null;
  savedMethod: { id: string; methodType: 'card' | 'bank_account'; brand: string; last4: string | null } | null;
}

export interface FieldsSubmitResult { type: 'success' | 'failure'; status?: number; data?: Record<string, unknown> }

export type FieldsWebViewMessage =
  | { type: 'fields-ready' }
  | { type: 'fields-result'; result: FieldsSubmitResult }
  | { type: 'fields-error'; message: string };

declare global {
  interface Window {
    checkout?: {
      mount?: (sessionToken: string, containerId: string) => Promise<void> | void;
      submit?: () => Promise<FieldsSubmitResult>;
      onPaymentComplete?: (callback: (payload: unknown) => void) => (() => void) | void;
    };
  }
}

// ---- Web (DOM) helpers ------------------------------------------------------

let scriptPromise: Promise<void> | null = null;
let loadedScriptUrl = '';

export function ensureCheckoutScript(scriptUrl: string): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  if (typeof window.checkout?.mount === 'function' && loadedScriptUrl === scriptUrl) return Promise.resolve();
  if (scriptPromise && loadedScriptUrl === scriptUrl) return scriptPromise;
  loadedScriptUrl = scriptUrl;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const finish = () => (typeof window.checkout?.mount === 'function' ? resolve() : reject(new Error('North checkout API did not load correctly.')));
    const existing = Array.from(document.scripts).find((s) => s.src === scriptUrl);
    if (existing) {
      if (typeof window.checkout?.mount === 'function') return resolve();
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load North checkout script.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.onload = finish;
    script.onerror = () => { scriptPromise = null; reject(new Error('Unable to load North checkout script.')); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function mountFields(sessionToken: string, containerId: string): Promise<void> {
  if (typeof window.checkout?.mount !== 'function') throw new Error('North checkout API is not ready.');
  const host = document.getElementById(containerId);
  if (host) host.innerHTML = '';
  await window.checkout.mount(sessionToken, containerId);
}

export async function submitFields(): Promise<FieldsSubmitResult> {
  if (typeof window.checkout?.submit !== 'function') throw new Error('North checkout API is not ready.');
  const result = await window.checkout.submit();
  if (!result || (result.type !== 'success' && result.type !== 'failure')) {
    throw new Error('North returned an unexpected response from the payment fields.');
  }
  return result;
}

export function describeFieldsFailure(result: FieldsSubmitResult): string {
  const data = result.data ?? {};
  const text = [data.auth_resp_text, data.message, data.error].find((v) => typeof v === 'string' && v.length > 0) as string | undefined;
  return text ?? 'The payment was not approved. Please check the details and try again.';
}

// ---- Native (WebView) helpers ----------------------------------------------

/**
 * Standalone page for react-native-webview. It mounts the Fields inputs and
 * exposes window.__sfSubmit(), which React Native invokes via
 * injectJavaScript when the user taps our Pay / Save button. Results are
 * posted back as FieldsWebViewMessage JSON strings.
 */
export function buildFieldsWebViewHtml(sessionToken: string, scriptUrl: string): string {
  const safeToken = JSON.stringify(sessionToken);
  const safeScriptUrl = JSON.stringify(scriptUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      #fields-root { width: 100%; min-height: 260px; padding: 8px; box-sizing: border-box; }
      #fields-root iframe { width: 100% !important; border: 0; display: block; }
      #status { color: #5f6b68; font-size: 14px; text-align: center; margin: 16px 0 8px; }
      #error { color: #c0352b; font-size: 14px; text-align: center; margin: 16px 0; display: none; }
    </style>
  </head>
  <body>
    <div id="status">Loading secure payment form…</div>
    <div id="error"></div>
    <div id="fields-root"></div>
    <script>
      (function () {
        var sessionToken = ${safeToken};
        var scriptUrl = ${safeScriptUrl};
        var statusEl = document.getElementById('status');
        var errorEl = document.getElementById('error');
        var busy = false;
        function send(message) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
        function showError(message) {
          if (statusEl) statusEl.style.display = 'none';
          if (errorEl) { errorEl.style.display = 'block'; errorEl.textContent = message; }
          send({ type: 'fields-error', message: message });
        }
        window.__sfSubmit = function () {
          if (busy) return;
          if (!window.checkout || typeof window.checkout.submit !== 'function') { showError('The payment form is not ready.'); return; }
          busy = true;
          Promise.resolve(window.checkout.submit())
            .then(function (result) { busy = false; send({ type: 'fields-result', result: result || { type: 'failure', data: {} } }); })
            .catch(function (err) { busy = false; showError(err && err.message === 'Submit timeout' ? 'The payment is taking longer than expected. Please try again.' : (err && err.message) || 'The payment could not be submitted.'); });
        };
        var script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.onload = function () {
          if (!window.checkout || typeof window.checkout.mount !== 'function') { showError('North checkout API did not load correctly.'); return; }
          Promise.resolve(window.checkout.mount(sessionToken, 'fields-root'))
            .then(function () { if (statusEl) statusEl.style.display = 'none'; send({ type: 'fields-ready' }); })
            .catch(function (err) { showError(err && err.message ? err.message : 'Unable to open the payment form.'); });
        };
        script.onerror = function () { showError('Unable to load North checkout script.'); };
        document.head.appendChild(script);
      })();
    </script>
  </body>
</html>`;
}

export function parseFieldsWebViewMessage(raw: string): FieldsWebViewMessage | null {
  try {
    const data = JSON.parse(raw) as { type?: string; result?: FieldsSubmitResult; message?: string };
    if (data.type === 'fields-ready') return { type: 'fields-ready' };
    if (data.type === 'fields-result' && data.result) return { type: 'fields-result', result: data.result };
    if (data.type === 'fields-error') return { type: 'fields-error', message: data.message ?? 'Unable to open the payment form.' };
    return null;
  } catch {
    return null;
  }
}

// ---- Shared -------------------------------------------------------------------

export const NORTH_SANDBOX_TEST_CARDS: readonly { brand: string; number: string; result: string }[] = __DEV__
  ? [
      { brand: 'Visa', number: '4111 1111 1111 1111', result: 'Successful transaction' },
      { brand: 'Amex', number: '3700 000000 00002', result: 'Successful transaction' },
    ]
  : [];

export const NORTH_SANDBOX_TEST_DETAILS: readonly string[] = __DEV__
  ? ['Draft Mode uses North Sandbox automatically.', 'Expiration: any future date, e.g. 12/30', 'CVV: any 3 digits, or 4 digits for Amex', 'ZIP: any 5 digits, e.g. 12345']
  : [];

export function formatEmbeddedCheckoutError(error: unknown) {
  // (copy the existing function body from mobile/src/lib/northEmbeddedCheckout.ts verbatim)
}
```

For `formatEmbeddedCheckoutError`, paste the existing implementation from `mobile/src/lib/northEmbeddedCheckout.ts:47-92` unchanged.

- [ ] **Step 2: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: clean (the old file still exists and both compile; the `Window.checkout` global declaration must appear in only one of them — remove the `declare global` block from `invoice/embedded-checkout.web.tsx` and `customer/save-card.web.tsx` if tsc reports a conflicting declaration, or defer to Task 13 where those files are deleted; the simplest order is to do Task 11 and Task 13 in one commit if the conflict blocks the build).

- [ ] **Step 3: Commit**

```bash
git add mobile/src/lib/northFieldsCheckout.ts
git commit -m "Mobile: shared North Fields checkout library (script, mount, submit, WebView page, messages)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `useFieldsCheckout` hook and `FieldsCheckoutLayout`

**Files:**
- Create: `mobile/src/lib/useFieldsCheckout.ts`
- Create: `mobile/src/components/FieldsCheckoutLayout.tsx`

**Interfaces:**
- Consumes: `api` from `mobile/src/lib/api.ts`; types from Task 11; `Button, Card, Loading, Value` from `mobile/src/components/ui.tsx`; `colors, money` from `mobile/src/lib/theme.ts`.
- Produces:
  - `useFieldsCheckout({ flow: FieldsFlow; invoiceId?: string; customerId?: string })` returning
    `{ mode, setMode(mode), session: FieldsPaySession | FieldsStorageSession | null, paySession: FieldsPaySession | null, loading, error, setError, consent, setConsent, submitting, setSubmitting, done: FieldsConfirmResult | FieldsStoredMethod | null, startSession(), confirm(result: FieldsSubmitResult): Promise<void>, canSubmit: boolean, sessionKey: number }`
    Behaviour: creates a session on mount and whenever `mode` changes (`pay` flow: `/payments/north/fields/session { invoiceId, mode }`; `store` flow: `/payments/north/fields/storage-session { customerId }`), `confirm` posts to `/confirm` or `/storage-confirm`, a `failure` result sets `error` to `describeFieldsFailure` and restarts the session; `canSubmit` is false while loading/submitting/done or when `mode === 'bank'` without `consent`.
  - `FieldsCheckoutLayout` props: `{ flow: FieldsFlow; mode: FieldsPayMode; onModeChange(mode): void; paySession: FieldsPaySession | null; consent: boolean; onConsentChange(v: boolean): void; ready: boolean; loading: boolean; error: string | null; submitting: boolean; canSubmit: boolean; done: FieldsConfirmResult | FieldsStoredMethod | null; onSubmit(): void; onCancel(): void; onDone(): void; onRetry(): void; children: React.ReactNode }` — renders the header, tabs (bank tab hidden when `flow === 'store'`), breakdown, consent, the fields host (`children`), footer buttons, success panel, sandbox hints.

- [ ] **Step 1: Create the hook**

```ts
// mobile/src/lib/useFieldsCheckout.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import {
  describeFieldsFailure, formatEmbeddedCheckoutError,
  type FieldsConfirmResult, type FieldsFlow, type FieldsPayMode, type FieldsPaySession,
  type FieldsStorageSession, type FieldsStoredMethod, type FieldsSubmitResult,
} from './northFieldsCheckout';

export function useFieldsCheckout(params: { flow: FieldsFlow; invoiceId?: string; customerId?: string }) {
  const qc = useQueryClient();
  const [mode, setModeState] = useState<FieldsPayMode>('card');
  const [session, setSession] = useState<FieldsPaySession | FieldsStorageSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<FieldsConfirmResult | FieldsStoredMethod | null>(null);
  const [sessionKey, setSessionKey] = useState(0);
  const confirmingRef = useRef(false);

  const startSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSession(null);
    setConsent(false);
    confirmingRef.current = false;
    try {
      if (params.flow === 'pay') {
        if (!params.invoiceId) throw new Error('Invoice ID is missing.');
        const data = await api<FieldsPaySession>('/payments/north/fields/session', { method: 'POST', body: { invoiceId: params.invoiceId, mode } });
        setSession(data);
      } else {
        if (!params.customerId) throw new Error('Customer ID is missing.');
        const data = await api<FieldsStorageSession>('/payments/north/fields/storage-session', { method: 'POST', body: { customerId: params.customerId } });
        setSession(data);
      }
      setSessionKey((k) => k + 1);
    } catch (e) {
      setError(formatEmbeddedCheckoutError(e));
    } finally {
      setLoading(false);
    }
  }, [params.flow, params.invoiceId, params.customerId, mode]);

  useEffect(() => { void startSession(); }, [startSession]);

  const setMode = (next: FieldsPayMode) => {
    if (submitting || done) return;
    setModeState(next);
  };

  const confirm = async (result: FieldsSubmitResult) => {
    if (!session || confirmingRef.current) return;
    if (result.type !== 'success') {
      setSubmitting(false);
      setError(describeFieldsFailure(result));
      // A submitted session is spent — mount a fresh one for the retry.
      void startSession();
      return;
    }
    confirmingRef.current = true;
    setSubmitting(true);
    try {
      if (params.flow === 'pay') {
        const data = await api<FieldsConfirmResult>('/payments/north/fields/confirm', {
          method: 'POST',
          body: { invoiceId: params.invoiceId, mode, sessionToken: session.sessionToken, achConsent: mode === 'bank' ? consent : undefined },
        });
        setDone(data);
        void qc.invalidateQueries({ queryKey: ['invoice', params.invoiceId] });
        void qc.invalidateQueries({ queryKey: ['invoicePayments', params.invoiceId] });
        void qc.invalidateQueries({ queryKey: ['invoices'] });
      } else {
        const data = await api<FieldsStoredMethod>('/payments/north/fields/storage-confirm', {
          method: 'POST',
          body: { customerId: params.customerId, sessionToken: session.sessionToken, setDefault: true },
        });
        setDone(data);
      }
      void qc.invalidateQueries({ queryKey: ['paymentMethods'] });
    } catch (e) {
      confirmingRef.current = false;
      setError((e as Error).message || 'Unable to verify the payment.');
    } finally {
      setSubmitting(false);
    }
  };

  const paySession = params.flow === 'pay' ? (session as FieldsPaySession | null) : null;
  const canSubmit = !loading && !submitting && !done && !!session && (mode !== 'bank' || consent);

  return { mode, setMode, session, paySession, loading, error, setError, consent, setConsent, submitting, setSubmitting, done, startSession, confirm, canSubmit, sessionKey };
}
```

- [ ] **Step 2: Create the layout**

```tsx
// mobile/src/components/FieldsCheckoutLayout.tsx
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Loading, Value } from './ui';
import { colors, money } from '../lib/theme';
import {
  NORTH_SANDBOX_TEST_CARDS, NORTH_SANDBOX_TEST_DETAILS,
  type FieldsConfirmResult, type FieldsFlow, type FieldsPayMode, type FieldsPaySession, type FieldsStoredMethod,
} from '../lib/northFieldsCheckout';

interface Props {
  flow: FieldsFlow;
  mode: FieldsPayMode;
  onModeChange: (mode: FieldsPayMode) => void;
  paySession: FieldsPaySession | null;
  consent: boolean;
  onConsentChange: (value: boolean) => void;
  ready: boolean;
  loading: boolean;
  error: string | null;
  submitting: boolean;
  canSubmit: boolean;
  done: FieldsConfirmResult | FieldsStoredMethod | null;
  onSubmit: () => void;
  onCancel: () => void;
  onDone: () => void;
  onRetry: () => void;
  children: React.ReactNode;
}

function isConfirm(done: FieldsConfirmResult | FieldsStoredMethod): done is FieldsConfirmResult {
  return (done as FieldsConfirmResult).status === 'approved';
}

export function FieldsCheckoutLayout(p: Props) {
  const isPay = p.flow === 'pay';
  const b = p.paySession?.breakdown;
  const submitTitle = isPay ? `Pay ${p.paySession ? money(p.paySession.amount) : ''}`.trim() : 'Save Payment Method';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {isPay ? (
        <View style={styles.tabs}>
          {(['card', 'bank'] as FieldsPayMode[]).map((m) => (
            <Pressable key={m} onPress={() => p.onModeChange(m)} disabled={p.submitting || !!p.done}
              style={[styles.tab, p.mode === m && styles.tabActive]}>
              <Text style={[styles.tabText, p.mode === m && styles.tabTextActive]}>{m === 'card' ? 'Pay by Card' : 'Pay by Bank (ACH)'}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Card><Value style={styles.title}>Save a payment method on file (no charge)</Value>
          <Text style={styles.muted}>Details are tokenized by North; the number never touches our systems.</Text></Card>
      )}

      {isPay && b ? (
        <Card>
          {[['Subtotal', b.subtotal], ['Taxes & fees', b.tax], ['Total', b.total]].map(([label, v]) => (
            <View key={String(label)} style={styles.row}><Text style={styles.muted}>{label}</Text><Text>{money(v as number)}</Text></View>
          ))}
          {b.previouslyPaid > 0 ? <View style={styles.row}><Text style={styles.muted}>Previously paid</Text><Text>-{money(b.previouslyPaid)}</Text></View> : null}
          <View style={styles.row}><Value style={styles.due}>Amount due today</Value><Value style={styles.due}>{money(b.amountDue)}</Value></View>
        </Card>
      ) : null}

      {p.done ? (
        <Card style={styles.success}>
          {isConfirm(p.done) ? (
            <>
              <Value style={styles.successTitle}>{p.done.duplicate ? 'Payment already recorded' : 'Payment approved'}</Value>
              {p.done.amount != null ? <Value style={styles.amount}>{money(p.done.amount)}</Value> : null}
              {p.done.receipt?.receiptNumber ? <Text style={styles.muted}>Receipt {p.done.receipt.receiptNumber}</Text> : null}
              {p.done.savedMethod ? <Text style={styles.muted}>{p.done.savedMethod.brand}{p.done.savedMethod.last4 ? ` ••••${p.done.savedMethod.last4}` : ''} saved on file</Text> : null}
            </>
          ) : (
            <>
              <Value style={styles.successTitle}>{p.done.duplicate ? 'Already on file' : 'Saved on file'}</Value>
              <Text style={styles.muted}>{p.done.brand}{p.done.last4 ? ` ••••${p.done.last4}` : ''}</Text>
            </>
          )}
        </Card>
      ) : (
        <>
          {p.error ? (
            <Card style={styles.errorCard}><Value style={styles.errorTitle}>Something went wrong</Value><Text style={styles.muted}>{p.error}</Text>
              <Button title="Try Again" variant="outline" onPress={p.onRetry} /></Card>
          ) : null}
          <View style={styles.host}>{(p.loading || !p.ready) && !p.error ? <Loading /> : null}{p.children}</View>
          {isPay && p.mode === 'bank' && p.paySession?.achTerms ? (
            <Card style={styles.consentCard}>
              <Text style={styles.terms}>{p.paySession.achTerms.text}</Text>
              <Pressable onPress={() => p.onConsentChange(!p.consent)} style={styles.consentRow} accessibilityRole="checkbox" accessibilityState={{ checked: p.consent }}>
                <View style={[styles.checkbox, p.consent && styles.checkboxOn]}>{p.consent ? <Text style={styles.check}>✓</Text> : null}</View>
                <Text style={styles.consentText}>I have read the authorization above and authorize this one-time debit from my bank account.</Text>
              </Pressable>
            </Card>
          ) : null}
          {NORTH_SANDBOX_TEST_CARDS.length ? (
            <Card><Value style={styles.title}>Sandbox test cards</Value>
              {NORTH_SANDBOX_TEST_CARDS.map((c) => <Text key={c.number} style={styles.muted}>{c.brand}: {c.number} — {c.result}</Text>)}
              {NORTH_SANDBOX_TEST_DETAILS.map((d) => <Text key={d} style={styles.muted}>{d}</Text>)}
            </Card>
          ) : null}
        </>
      )}

      <View style={styles.footer}>
        {p.done ? (
          <Button title="Done" onPress={p.onDone} style={styles.grow} />
        ) : (
          <>
            <Button title="Cancel" variant="outline" onPress={p.onCancel} disabled={p.submitting} />
            <Button title={p.submitting ? 'Processing…' : submitTitle} onPress={p.onSubmit} loading={p.submitting} disabled={!p.canSubmit || !p.ready} style={styles.grow} />
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', alignItems: 'center' },
  tabActive: { borderColor: colors.primary, backgroundColor: '#EAF8F5' },
  tabText: { fontWeight: '700', color: colors.textMuted },
  tabTextActive: { color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  due: { fontWeight: '800' },
  title: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  muted: { color: colors.textMuted, marginBottom: 4 },
  host: { minHeight: 320, borderRadius: 18, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, padding: 8 },
  consentCard: { borderWidth: 1, borderColor: '#F0E3C4', backgroundColor: '#FDF8EC' },
  terms: { fontSize: 13, color: '#4A4A4A', marginBottom: 10 },
  consentRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  checkboxOn: { backgroundColor: colors.primary },
  check: { color: '#fff', fontWeight: '800' },
  consentText: { flex: 1, fontSize: 14 },
  success: { borderWidth: 1, borderColor: colors.primary, alignItems: 'center', gap: 4, paddingVertical: 24 },
  successTitle: { fontSize: 16, fontWeight: '800', color: colors.primary },
  amount: { fontSize: 30, fontWeight: '800', marginVertical: 6 },
  errorCard: { borderWidth: 1, borderColor: colors.danger },
  errorTitle: { fontWeight: '800', color: colors.danger, marginBottom: 4 },
  footer: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1 },
});
```

If `colors.text` does not exist in `theme.ts`, use `'#0D0D0D'`.

- [ ] **Step 3: Typecheck and commit**

Run: `cd mobile && npx tsc --noEmit` → clean.

```bash
git add mobile/src/lib/useFieldsCheckout.ts mobile/src/components/FieldsCheckoutLayout.tsx
git commit -m "Mobile: useFieldsCheckout hook and shared FieldsCheckoutLayout (card/bank tabs, breakdown, ACH consent)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Route screens, delete old screens, update navigation

**Files:**
- Create: `mobile/app/payments/fields-checkout.web.tsx`
- Create: `mobile/app/payments/fields-checkout.tsx`
- Delete: `mobile/app/invoice/embedded-checkout.tsx`, `mobile/app/invoice/embedded-checkout.web.tsx`, `mobile/app/customer/save-card.tsx`, `mobile/app/customer/save-card.web.tsx`, `mobile/src/lib/northEmbeddedCheckout.ts`
- Modify: `mobile/app/_layout.tsx:72`, `mobile/app/invoice/[id].tsx:29-36,190-203,~700`, `mobile/app/customer/[id].tsx:259,~700`

**Interfaces:**
- Consumes: Task 11 library, Task 12 hook and layout.
- Produces: route `/payments/fields-checkout?flow=pay&invoiceId=…` and `/payments/fields-checkout?flow=store&customerId=…`.

- [ ] **Step 1: Web screen**

```tsx
// mobile/app/payments/fields-checkout.web.tsx
import React, { useEffect, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { FieldsCheckoutLayout } from '../../src/components/FieldsCheckoutLayout';
import { useFieldsCheckout } from '../../src/lib/useFieldsCheckout';
import { ensureCheckoutScript, mountFields, submitFields, type FieldsFlow } from '../../src/lib/northFieldsCheckout';

const HOST_ID = 'north-fields-root';

export default function FieldsCheckoutWebScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ flow?: string; invoiceId?: string; customerId?: string }>();
  const flow: FieldsFlow = params.flow === 'store' ? 'store' : 'pay';
  const invoiceId = typeof params.invoiceId === 'string' ? params.invoiceId : undefined;
  const customerId = typeof params.customerId === 'string' ? params.customerId : undefined;
  const c = useFieldsCheckout({ flow, invoiceId, customerId });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!c.session) { setReady(false); return; }
    let disposed = false;
    setReady(false);
    ensureCheckoutScript(c.session.scriptUrl)
      .then(() => (disposed ? undefined : mountFields(c.session!.sessionToken, HOST_ID)))
      .then(() => { if (!disposed) setReady(true); })
      .catch((e) => { if (!disposed) c.setError(e instanceof Error ? e.message : 'Unable to open the payment form.'); });
    return () => {
      disposed = true;
      const host = document.getElementById(HOST_ID);
      if (host) host.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.sessionKey]);

  const onSubmit = async () => {
    if (!c.canSubmit || !ready) return;
    c.setSubmitting(true);
    try {
      const result = await submitFields();
      await c.confirm(result);
    } catch (e) {
      c.setSubmitting(false);
      c.setError(e instanceof Error ? e.message : 'The payment could not be submitted.');
    }
  };

  const leave = () => {
    if (router.canGoBack()) router.back();
    else if (invoiceId) router.replace(`/invoice/${invoiceId}`);
    else if (customerId) router.replace({ pathname: '/customer/[id]', params: { id: customerId, tab: 'Payment Methods' } });
    else router.replace('/');
  };

  return (
    <>
      <Stack.Screen options={{ title: flow === 'pay' ? 'Secure Checkout' : 'Save Payment Method' }} />
      <FieldsCheckoutLayout
        flow={flow} mode={c.mode} onModeChange={c.setMode} paySession={c.paySession}
        consent={c.consent} onConsentChange={c.setConsent}
        ready={ready} loading={c.loading} error={c.error} submitting={c.submitting} canSubmit={c.canSubmit} done={c.done}
        onSubmit={onSubmit} onCancel={leave} onDone={leave} onRetry={() => void c.startSession()}
      >
        <div id={HOST_ID} style={{ width: '100%', minHeight: 300, backgroundColor: '#fff' }} />
      </FieldsCheckoutLayout>
    </>
  );
}
```

- [ ] **Step 2: Native screen**

```tsx
// mobile/app/payments/fields-checkout.tsx
import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { WebViewMessageEvent } from 'react-native-webview';
import { FieldsCheckoutLayout } from '../../src/components/FieldsCheckoutLayout';
import { useFieldsCheckout } from '../../src/lib/useFieldsCheckout';
import { buildFieldsWebViewHtml, parseFieldsWebViewMessage, type FieldsFlow } from '../../src/lib/northFieldsCheckout';
import { Button, Card, Value } from '../../src/components/ui';
import { colors } from '../../src/lib/theme';

// react-native-webview needs the RNCWebView native module; load lazily so a
// stale binary shows a message instead of crashing the route tree.
let WebViewComponent: typeof import('react-native-webview').WebView | null = null;
let webViewLoadError: string | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebViewComponent = (require('react-native-webview') as typeof import('react-native-webview')).WebView;
} catch (e) {
  webViewLoadError = (e as Error).message;
}

export default function FieldsCheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ flow?: string; invoiceId?: string; customerId?: string }>();
  const flow: FieldsFlow = params.flow === 'store' ? 'store' : 'pay';
  const invoiceId = typeof params.invoiceId === 'string' ? params.invoiceId : undefined;
  const customerId = typeof params.customerId === 'string' ? params.customerId : undefined;
  const c = useFieldsCheckout({ flow, invoiceId, customerId });
  const [ready, setReady] = useState(false);
  const webViewRef = useRef<import('react-native-webview').WebView | null>(null);

  const html = useMemo(() => (c.session ? buildFieldsWebViewHtml(c.session.sessionToken, c.session.scriptUrl) : ''), [c.session]);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = parseFieldsWebViewMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'fields-ready') setReady(true);
    if (message.type === 'fields-error') { c.setSubmitting(false); c.setError(message.message); }
    if (message.type === 'fields-result') void c.confirm(message.result);
  };

  const onSubmit = () => {
    if (!c.canSubmit || !ready) return;
    c.setSubmitting(true);
    webViewRef.current?.injectJavaScript('window.__sfSubmit && window.__sfSubmit(); true;');
  };

  const leave = () => {
    if (router.canGoBack()) router.back();
    else if (invoiceId) router.replace(`/invoice/${invoiceId}`);
    else if (customerId) router.replace({ pathname: '/customer/[id]', params: { id: customerId, tab: 'Payment Methods' } });
    else router.replace('/');
  };

  if (!WebViewComponent) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: 'Secure Checkout' }} />
        <Card>
          <Value style={styles.errorTitle}>Payment form unavailable in this build</Value>
          <Text style={styles.muted}>This app build is missing the WebView component required for North Embedded Checkout. Rebuild the app (pod install + native rebuild).</Text>
          {webViewLoadError ? <Text style={styles.muted}>{webViewLoadError}</Text> : null}
          <Button title="Back" variant="outline" onPress={leave} />
        </Card>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: flow === 'pay' ? 'Secure Checkout' : 'Save Payment Method' }} />
      <FieldsCheckoutLayout
        flow={flow} mode={c.mode} onModeChange={c.setMode} paySession={c.paySession}
        consent={c.consent} onConsentChange={c.setConsent}
        ready={ready} loading={c.loading} error={c.error} submitting={c.submitting} canSubmit={c.canSubmit} done={c.done}
        onSubmit={onSubmit} onCancel={leave} onDone={leave} onRetry={() => { setReady(false); void c.startSession(); }}
      >
        {c.session ? (
          <WebViewComponent
            key={c.sessionKey}
            ref={webViewRef}
            source={{ html, baseUrl: 'https://checkout.north.com' }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            onMessage={onMessage}
            style={styles.webview}
          />
        ) : null}
      </FieldsCheckoutLayout>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  webview: { height: 320, backgroundColor: '#fff' },
  muted: { color: colors.textMuted, marginBottom: 6 },
  errorTitle: { fontWeight: '800', color: colors.danger, marginBottom: 6 },
});
```

Copy any additional `WebView` props (e.g. `mixedContentMode`, `setSupportMultipleWindows`) from the deleted `customer/save-card.tsx:14-20` so behaviour matches the previously working native screen.

- [ ] **Step 3: Delete the old screens and library, update navigation**

```bash
git rm mobile/app/invoice/embedded-checkout.tsx mobile/app/invoice/embedded-checkout.web.tsx mobile/app/customer/save-card.tsx mobile/app/customer/save-card.web.tsx mobile/src/lib/northEmbeddedCheckout.ts
```

`mobile/app/_layout.tsx:72` → `<Stack.Screen name="payments/fields-checkout" options={{ title: 'Secure Checkout' }} />`.

`mobile/app/invoice/[id].tsx`:

```ts
interface Method {
  id: string;
  methodType: 'card' | 'bank_account';
  brand: string;
  last4: string;
  expirationMonth: number;
  expirationYear: number;
  isDefault: boolean;
}

const openNorthEmbeddedCheckout = () => {
  router.push({ pathname: '/payments/fields-checkout', params: { flow: 'pay', invoiceId: id } });
};

const saveNewMethod = () => {
  router.push({ pathname: '/payments/fields-checkout', params: { flow: 'store', customerId: inv!.customerId } });
};
```

Where the invoice screen renders a method (the `Charge … to ${method.brand} ****` confirm text and the method list), show bank accounts as `Bank Account ••••1234 · ACH` and cards as `${brand} ••••1234 · Expires MM/YY` using `methodType === 'bank_account'`.

`mobile/app/customer/[id].tsx:259` → `router.push({ pathname: '/payments/fields-checkout', params: { flow: 'store', customerId: id } });` and in the method list replace the `m.brand === 'Bank Account'` checks with `m.methodType === 'bank_account'` (keep the old brand check as a fallback: `m.methodType === 'bank_account' || m.brand === 'Bank Account'`).

- [ ] **Step 4: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: clean; no remaining imports of `northEmbeddedCheckout`, `embedded-checkout`, or `save-card`:

```bash
grep -rn "northEmbeddedCheckout\|embedded-checkout\|save-card\|north/embedded" mobile/app mobile/src
```

Expected: no output.

- [ ] **Step 5: Run the web app and exercise both flows against the sandbox**

Run: `cd mobile && npx expo start --web`, open an invoice with a balance → **Pay with Embedded Checkout** → Card tab → `4111 1111 1111 1111`, `12/30`, `123`, `12345` → Pay. Expected: success panel with receipt number; `backend/logs/north-cert.log` shows `STORAGE session create`, `session status`, `TOKEN SALE (CIT)`. Then from the customer's Payment Methods tab → **Add** → Save → success; the method appears as a card. Then **Charge** the saved card from the invoice screen → `TOKEN SALE (CIT)`; **Refund** it → `REFUND` (and `REVERSAL` fallback if unsettled).

- [ ] **Step 6: Commit**

```bash
git add -A mobile
git commit -m "Mobile: single Fields checkout route (pay card/bank, store), remove Form-based screens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Cleanup, docs, deprecated aliases

**Files:**
- Modify: `backend/src/utils/northEmbedded.ts` (remove `waitForApprovedNorthSession`, `waitForNorthStorageResult`, `extractNorthCardOnFile`, `NorthStorageResult`, `NorthCardOnFile`, `pickNorthTransactionId`, `pickNorthApprovedAmount`, `parseNorthAmount`, `decodeNorthSessionToken` if unreferenced)
- Modify: `backend/src/config/index.ts` (remove `embeddedFields*` and `fieldsWebhookSecret`)
- Modify: `backend/src/services/northGatewayService.ts` (remove `embeddedConfigDiagnostics` fields that referenced removed config, if any)
- Modify: `COMMANDS.md` §6 grep patterns
- Modify: `docs/superpowers/specs/2026-09-05-north-fields-checkout-design.md` status line → `implemented`

- [ ] **Step 1: Remove dead code**

```bash
cd backend && grep -rn "waitForApprovedNorthSession\|waitForNorthStorageResult\|extractNorthCardOnFile\|pickNorthTransactionId\|pickNorthApprovedAmount\|decodeNorthSessionToken\|embeddedFields\|fieldsWebhookSecret" src
```

Delete every definition whose only hits are its own definition. `asRecord` may still be used by `agreementSigningService` — keep it if so.

- [ ] **Step 2: Update COMMANDS.md §6**

Replace the grep pattern in "Filter for embedded session + token sale/refund/reversal" with:

```zsh
grep -E "STORAGE session create|SALE session create|session status|TOKEN SALE|REFUND|REVERSAL|VOID" \
  ~/BoxerSolutions/backend/logs/north-cert.log | tail -120
```

Add a subsection "Extract certification samples for North":

```zsh
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" '
  awk "/^====/{block=\"\"} {block=block\"\n\"\$0} /STORAGE session create|TOKEN SALE|REFUND|REVERSAL|VOID|SALE session create/{keep=1} /^$/{if(keep){print block} keep=0}" \
  ~/BoxerSolutions/backend/logs/north-cert.log
' > north-cert-samples.txt
```

(If the awk one-liner proves fragile, `tail -c 200000 …/north-cert.log > north-cert-samples.txt` and trim by hand is acceptable.)

- [ ] **Step 3: Typecheck, test, commit**

Run: `cd backend && npx tsc --noEmit && npm test && cd ../mobile && npx tsc --noEmit`

```bash
git add -A
git commit -m "North Fields: remove Form-era helpers and deprecated config keys, update ops docs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Sandbox verification and certification samples

**Files:** none (verification only). Output: `north-cert-samples.txt` (not committed).

- [ ] **Step 1: Deploy to EC2**

Follow COMMANDS.md §4. Before restarting, on EC2 set in `~/BoxerSolutions/backend/.env`: `PAYMENT_PROVIDER=north`, and confirm `NORTH_EMBEDDED_CHECKOUT_ID` / `PROFILE_ID` / `PRIVATE_API_KEY` (or the `_FIELDS_` aliases) point at the Fields checkout with Pay by Bank enabled. Restart and confirm `/health` is 200.

- [ ] **Step 2: Run the certification scenarios (Draft Mode = sandbox)**

| # | Scenario | Where | Expected cert log labels |
|---|---|---|---|
| 1 | Save card only | Customer → Payment Methods → Add | `STORAGE session create`, `session status` |
| 2 | Pay invoice by card | Invoice → Pay with Embedded Checkout → Card | `STORAGE session create`, `session status`, `TOKEN SALE (CIT)` |
| 3 | Charge saved card (customer present) | Invoice → Charge | `TOKEN SALE (CIT)` |
| 4 | Recurring charge | Customer → Invoices → recurring plan → Charge | `TOKEN SALE (MIT)` with `aci_ext: "RB"` |
| 5 | Refund (settled) | Invoice → payment → Refund, next day | `REFUND` approved |
| 6 | Reversal (same day, full) | Invoice → payment → Refund, same day | `REFUND` declined then `REVERSAL` approved |
| 7 | Pay invoice by bank | Invoice → Pay → Bank tab → consent → Pay | `SALE session create`, `session status` (ACH), row in `ach_authorizations` |
| 8 | Agreement initial payment | Sign a test agreement link → Card | as #2 |
| 9 | Declined card | amount trigger per North "response code triggers" doc | client shows `auth_resp_text`; no payment row |

For #7, North's sandbox needs an ACH-approved test MID; if the Bank tab returns a session error, record the error text for the North ticket and continue.

- [ ] **Step 3: Collect samples**

Run the COMMANDS.md "Extract certification samples" command, open `north-cert-samples.txt`, confirm `Authorization` shows `Bearer ***REDACTED***` and no account numbers appear, and send it to North with the note that Storage, Token Sale (CIT and MIT), Refund, Reversal and ACH Sale are all via Embedded Checkout (no Server Post / CustomPay).

- [ ] **Step 4: Record outcomes**

Add a dated "Verification" section at the bottom of the spec listing each scenario with pass/fail and any North responses that need follow-up (STORAGE + ACH support, header placement for CheckoutId/ProfileId). Commit.
