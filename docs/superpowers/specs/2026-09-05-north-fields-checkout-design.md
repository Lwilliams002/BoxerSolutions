# North Embedded Checkout: Fields integration with Storage + Token Sale

Date: 2026-09-05
Status: approved design, awaiting implementation plan

## 1. Goal

Replace the North Embedded Checkout **Form** integration with the **Fields**
integration and make every payment path real and certifiable:

- Pay by card (Fields, `STORAGE` session, then server-side Token Sale).
- Pay by bank / ACH (Fields, `SALE` session, ACH consent captured by us).
- Store a card or bank account on file (Fields, `STORAGE` session).
- Charge a stored method (Token Sale via `POST /api/payments/token/sale`,
  `aci_ext: RB` when merchant-initiated).
- Refund / Reversal / Void of Embedded Checkout transactions.
- Produce the raw request/response samples North asked for (Storage, Token
  Sale, Refund, Reversal) in `logs/north-cert.log`.

## 2. Root causes being fixed

1. `epxEmbeddedPaymentsService` sends `token` / `transaction` / `tranNbr` in
   request bodies. North's Payments API requires `payment_method`
   (`credit` | `ach`), `orig_auth_guid`, `amount`, and `aci_ext` for
   merchant-initiated transactions. Every token sale, refund and reversal has
   therefore failed, which is why North has no samples and why the agreement
   page showed "payment failed".
2. `paymentProvider` is chosen once from `PAYMENT_PROVIDER`. With `mock`
   configured, the Charge button "succeeds" without contacting North, even
   for a card North tokenized.
3. Two checkouts (Form for SALE, Fields for STORAGE) with two credential
   sets, a three-step session-creation retry cascade, and five copies of the
   mount/submit code (invoice screen, save-card screen, both WebView
   variants, agreement page).

## 3. Non-goals

- Recurring Billing API (unavailable per North). The existing hourly
  in-process scheduler (`jobs/index.ts` → `processAutopay`,
  `recurringChargeService`) already performs the charges; it only needs the
  token sale to be real.
- Apple Pay / Google Pay.
- Webhook-driven fulfilment. The webhook keeps verifying and logging; the
  session status endpoint remains the source of truth.
- Legacy numeric North gateway ids (`chargepaymentmethod`, Gateway Functions
  refund/void). That code path stays as is for old rows.

## 4. Configuration

One Fields checkout with **Pay by Bank (ACH)** enabled in the Checkout
Designer. Config collapses to a single credential set:

| Variable | Meaning |
|---|---|
| `NORTH_EMBEDDED_CHECKOUT_ID` | Fields checkout id |
| `NORTH_EMBEDDED_PROFILE_ID` | Merchant profile id |
| `NORTH_EMBEDDED_PRIVATE_API_KEY` | Private API key (Bearer) |
| `NORTH_WEBHOOK_SECRET` | Webhook signing secret (`sec_…`) |
| `NORTH_EMBEDDED_BASE_URL` | default `https://checkout.north.com` |
| `NORTH_ACH_TERMS_VERSION` | optional, default `2026-09-05` |

Backward compatibility: `NORTH_EMBEDDED_FIELDS_CHECKOUT_ID`,
`NORTH_EMBEDDED_FIELDS_PROFILE_ID`, `NORTH_EMBEDDED_FIELDS_PRIVATE_API_KEY`
and `NORTH_EMBEDDED_FIELDS_WEBHOOK_SECRET` are read **first** when set, so an
existing deployment whose Fields credentials live in those variables keeps
working. `.env.example` documents only the canonical names and says the
`_FIELDS_` names are deprecated aliases. `embeddedCredentials(variant)` and
the `'storage'` variant disappear.

`EPX_*` Server Post variables are removed from `.env.example` (unused).

## 5. Backend design

### 5.1 `northGatewayService` (sessions)

- `createEmbeddedSession({ amount, transactionType: 'SALE' | 'STORAGE',
  orderId?, customerEmail?, products?, additionalFields? })` returns
  `{ sessionToken, sessionId }`.
- Body: `checkoutId`, `profileId`, `amount`, `transactionType`, plus optional
  `products`, `orderId`, `email`, `additionalFields`
  (`first_name`, `last_name`, `address`, `city`, `state`, `zip_code`,
  `industry_type: 'E'`, `invoice_nbr`, `order_nbr`).
- Exactly one retry: if the full payload is rejected, retry once with the
  minimal payload (`checkoutId`, `profileId`, `amount`, `transactionType`).
  The third "no amount" attempt and the Form/Fields fallback message go away.
- Headers include `User-Agent: ServiceFinance Embedded Checkout` (North
  requires the string "Embedded Checkout").
- `getEmbeddedSessionStatus(sessionToken)` unchanged except for the single
  credential set.

### 5.2 `epxEmbeddedPaymentsService` (payments API)

Rewritten to the published spec. All methods take `paymentMethod: 'credit' |
'ach'` derived from the stored method type.

| Method | HTTP | Body |
|---|---|---|
| `tokenSale` | `POST /api/payments/token/sale` | `payment_method`, `amount`, `orig_auth_guid`, `first_name`, `last_name`, `address`, `city`, `state`, `zip_code`, `industry_type: 'E'`, `invoice_nbr`, `order_nbr`, `tran_nbr`, `batch_id` (YYYYMMDD), `aci_ext: 'RB'` only when `mit === true`; for ach also `std_entry_class: 'WEB'`, `recv_name` |
| `refund` | `PUT /api/payments/refund` | `payment_method`, `amount`, `orig_auth_guid`, `tran_nbr`, `batch_id` |
| `reversal` | `PUT /api/payments/reversal` | `payment_method: 'credit'`, `orig_auth_guid`, `tran_nbr`, `batch_id` |
| `void` | `PUT /api/payments/void` | `payment_method`, `orig_auth_guid`, `tran_nbr`, `batch_id` |

- Headers: `Authorization: Bearer`, `Content-Type: application/json`,
  `CheckoutId`, `ProfileId`, `User-Agent: ServiceFinance Embedded Checkout`.
  The body contains only spec fields (no `checkoutId`/`profileId`).
  **Assumption to verify in sandbox:** if North rejects the header form, move
  the ids into the body; the cert log will show the 400.
- `tran_nbr` is numeric, ≤ 10 digits, unique per `batch_id`
  (`Date.now() % 1e10` is acceptable).
- Response parsing accepts both lowercase (`auth_resp`, `auth_guid`,
  `auth_resp_text`, `auth_code`, `auth_amount`) and uppercase keys, at the
  top level or under `data`. Approved iff `auth_resp === '00'`.
- Every request/response is appended to the cert log with labels
  `TOKEN SALE`, `REFUND`, `REVERSAL`, `VOID`.

### 5.3 Session result extraction (`utils/northEmbedded.ts`)

- `extractNorthPaymentResult(statusPayload)` returns
  `{ authGuid, amount, approved, methodType: 'card' | 'bank_account',
  brand, last4, expirationMonth, expirationYear, responseCode,
  responseText }`.
- Method type: `bank_account` when `payment_method === 'ach'`,
  `tran_type` starts with `ach`/`ck`, or `routing_nbr` / `account_type`
  is present; otherwise `card`. Brand for bank accounts is `Bank Account`.
- `waitForNorthSession(sessionToken, { timeoutMs })` polls immediately, then
  every 2 s up to 30 s (Fields' `submit()` resolves before the client calls
  us, so the 5 s pre-delay is dropped). Terminal statuses: `Approved`,
  `Declined`, `Expired`, `Cancelled`. Declined returns
  `auth_resp_text` to the client as a 402.

### 5.4 Payment method routing

- `payment_methods.method_type` (already exists: `card` | `bank_account`) is
  written by `addVaultedMethod`.
- `paymentService.chargeInvoice` and `refundPayment` pick the provider from
  the stored row: `payment_methods.payment_provider === 'north'` (or
  `payments.payment_provider in ('north', 'north_embedded')`) → North
  provider; `mock` → mock. `PAYMENT_PROVIDER` only decides which provider
  `addMethod` (legacy raw-token path) uses. `integrations/payments/index.ts`
  exports `providerFor(name)`.
- `NorthPaymentProvider.charge(methodId, amountCents, ..., { mit,
  paymentMethod, customer, invoiceNumber })` → token sale.
  `refund(transactionId, amountCents, { paymentMethod, fullAmount })` →
  refund, then reversal (card) / void (ach) fallback when the refund is
  rejected and the full amount is being returned.
- `recordExternalInvoicePayment` gains an optional `paymentMethodId` so ACH
  SALE payments link to the vaulted bank method (refunds need the method
  type).

### 5.5 API surface

Staff app (authenticated):

| Endpoint | Purpose |
|---|---|
| `POST /payments/north/fields/session` `{ invoiceId, mode: 'card' \| 'bank' }` | Card → `STORAGE` session; bank → `SALE` session for the invoice balance. Returns `{ sessionToken, scriptUrl, amount, breakdown: { subtotal, tax, total }, achTerms: { version, text } }`. |
| `POST /payments/north/fields/confirm` `{ invoiceId, sessionToken, mode, achConsent? }` | Card: verify Approved storage, vault, token sale (CIT), record payment. Bank: require `achConsent`, verify Approved sale, record payment, vault bank token, write `ach_authorizations`. Idempotent per `sessionToken`/`auth_guid`. |
| `POST /payments/north/fields/storage-session` `{ customerId }` | `STORAGE` session for save-only. |
| `POST /payments/north/fields/storage-confirm` `{ customerId, sessionToken, setDefault }` | Verify, vault (card or bank). |

The existing `/north/embedded/*` routes are removed; mobile is updated in the
same change.

Agreement page (public, token-gated): `/agreements/sign/pay/session`,
`/sign/pay/confirm` accept the same `mode` and `achConsent` fields and call
the same service functions as the staff endpoints
(`agreementSigningService` delegates to a shared `northFieldsPaymentService`).

### 5.6 Shared service: `northFieldsPaymentService`

One module used by both the staff routes and the agreement service:

- `createPaySession({ invoiceId, mode, customer })`
- `confirmPay({ invoiceId, mode, sessionToken, actorUserId, employeeId,
  achConsent })`
- `createStorageSession({ customerId })`
- `confirmStorage({ customerId, sessionToken, setDefault, actorUserId })`

`confirmPay` for card: vault → `chargeInvoice(invoiceId, methodId, null,
actor, employee, { mit: false })`. For bank: `recordExternalInvoicePayment`
with provider `north`, transaction id `auth_guid`, then `addVaultedMethod`
with `method_type: 'bank_account'`, then insert `ach_authorizations`.

### 5.7 ACH consent

- Migration `021_ach_authorizations.sql`:
  `ach_authorizations(id, customer_id, invoice_id, payment_id, amount,
  terms_version, consented_at, ip_address, user_agent, created_at)`.
- Terms text lives in `backend/src/content/achAuthorizationTerms.ts`
  (`ACH_TERMS_TEXT`, `ACH_TERMS_VERSION`). Placeholder text is clearly
  marked; the owner pastes the real terms.
- Bank confirm rejects (400) when `achConsent !== true`.

### 5.8 Webhook

Verify against the single `NORTH_WEBHOOK_SECRET` (plus the deprecated alias
if set). Behaviour otherwise unchanged (log only).

### 5.9 Cert log

`northCertLog` unchanged. Labels: `STORAGE session create`, `SALE session
create`, `session status`, `TOKEN SALE`, `REFUND`, `REVERSAL`, `VOID`.
Redaction of `Authorization` and account numbers stays.

## 6. Client design

### 6.1 Shared library `mobile/src/lib/northFieldsCheckout.ts`

- `ensureCheckoutScript(scriptUrl)`, `mountFields(sessionToken,
  containerId)`, `submitFields()` (wraps `checkout.submit()`, 10 s timeout,
  returns `{ type: 'success' | 'failure', status, data }`),
  `buildFieldsWebViewHtml({ sessionToken, scriptUrl })` for native, and
  `parseWebViewMessage`.
- WebView HTML posts `fields-ready`, `fields-result`, `fields-error`
  messages and listens for a `submit` message from React Native
  (`webViewRef.injectJavaScript('window.__sfSubmit()')`).

### 6.2 `FieldsCheckoutScreen`

One screen component (`mobile/app/payments/fields-checkout.tsx` plus a
`.web.tsx` twin) with params `mode=pay|store`, `invoiceId?`, `customerId?`:

- Our own **Card / Bank** segmented control shown before mounting (bank tab
  hidden in `store` mode until North confirms STORAGE supports ACH; see §9).
- `pay` mode shows the itemized breakdown (subtotal, tax, total). Bank tab
  adds the ACH terms text and a consent checkbox; Pay is disabled until it
  is checked.
- Pay / Save button → `submitFields()` → on `success` call confirm; on
  `failure` show North's message and re-enable.
- Replaces `invoice/embedded-checkout(.web).tsx` and
  `customer/save-card(.web).tsx`; navigation in `invoice/[id].tsx` and
  `customer/[id].tsx` points at the new route. Payment-method lists show
  "Bank Account ••••1234 · ACH" using `methodType`.

### 6.3 Agreement page

`payClientScript()` gets the same Card / Bank control, breakdown, consent
checkbox, and `checkout.submit()` result handling; it calls
`/sign/pay/session` and `/sign/pay/confirm` with `mode` and `achConsent`.

## 7. Error handling

- North `failure` result from `submit()` → show `data.message` or a generic
  decline, keep the fields mounted, allow retry with a **new** session
  (sessions are single-use once submitted).
- Status `Declined` on confirm → 402 with `auth_resp_text`.
- Token sale decline after a successful STORAGE → card is left on file,
  payment recorded as `failed` with the reason, client shows the reason and
  offers retry with the saved card.
- Session timeout/expiry → 409, client restarts the flow.
- Missing ACH consent → 400 before any North call.
- Idempotency: re-confirming the same session returns the existing payment
  (`duplicate: true`).

## 8. Testing

- Add `node --test` via `tsx` (`npm test` in backend). Unit tests for:
  token sale / refund / reversal body builders (field names, `aci_ext`
  presence, `tran_nbr` shape), response parser (lowercase/uppercase,
  approved detection), `extractNorthPaymentResult` (card vs ACH, brand map,
  expiry parsing), provider routing by stored method, ACH consent guard.
- Manual Draft Mode run with North test cards for: STORAGE → token sale
  (CIT), stored card MIT charge via recurring "Charge now", refund, reversal,
  ACH SALE (if the sandbox MID supports ACH). Collect the cert log entries
  for North.
- `npx tsc --noEmit` in `backend` and `mobile` must pass.

## 9. Open questions for North (do not block implementation)

1. Does a `STORAGE` session accept a bank account (Pay by Bank) or is it
   card-only? Until answered, bank accounts are tokenized via ACH `SALE`
   and the Bank tab is hidden in save-only mode.
2. Does the Payments API expect `CheckoutId`/`ProfileId` as headers, body
   fields, or neither (Bearer key only)?
3. Confirm `tran_nbr`/`batch_id` uniqueness expectations for token sales.

## 10. Owner follow-ups

- Paste the real ACH authorization terms into
  `backend/src/content/achAuthorizationTerms.ts`.
- Confirm `PAYMENT_PROVIDER` on EC2 (mock vs north) and set the canonical
  `NORTH_EMBEDDED_*` variables to the Fields checkout credentials.
- Enable Pay by Bank in the Checkout Designer and confirm the MID is
  ACH-approved (FNBO).
