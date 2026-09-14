import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { authenticate, authorize } from '../middleware/auth';
import { technicianScope, assertCustomerAccess } from '../middleware/scope';
import { applyNorthCheckoutPageHeaders } from '../utils/northCheckoutCsp';
import { paymentMethodLinkService, PAYMENT_METHOD_LINK_TTL_DAYS } from '../services/paymentMethodLinkService';
import { communicationService } from '../services/communicationService';
import { getCompanyInfo } from '../services/settingsService';
import { logger } from '../utils/logger';

const router = Router();

function htmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function apiBase(req: { header: (n: string) => string | undefined; protocol: string; get: (n: string) => string | undefined }) {
  const forwardedProto = req.header('x-forwarded-proto');
  const proto = (forwardedProto ? forwardedProto.split(',')[0] : req.protocol).trim();
  return `${proto}://${req.get('host')}`;
}

/** Staff: create a secure "add payment method" link and optionally email it. */
router.post(
  '/',
  authenticate,
  authorize('payments:collect_info', 'payments:collect', 'payments:write'),
  asyncHandler(async (req, res) => {
    const body = z.object({ customerId: z.string().uuid(), deliver: z.enum(['link', 'email']).default('link') }).parse(req.body ?? {});
    const scope = technicianScope(req, 'payments:collect');
    if (scope) await assertCustomerAccess(scope, body.customerId);
    const url = await paymentMethodLinkService.buildLink(body.customerId, apiBase(req));
    let emailed = false;
    if (body.deliver === 'email') {
      await communicationService.sendPaymentMethodRequest(body.customerId, url, PAYMENT_METHOD_LINK_TTL_DAYS, req.user!.id);
      emailed = true;
    }
    ok(res, { url, expiresInDays: PAYMENT_METHOD_LINK_TTL_DAYS, emailed }, emailed ? 'Secure link emailed to the customer' : 'Secure link created', 201);
  }),
);

router.get('/store/client.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.status(200).type('application/javascript').send(storeClientScript());
});

router.post('/store/session', asyncHandler(async (req, res) => {
  const body = z.object({ payToken: z.string().min(20) }).parse(req.body);
  ok(res, await paymentMethodLinkService.createSession(body.payToken), 'Secure form session created', 201);
}));

router.post('/store/confirm', asyncHandler(async (req, res) => {
  const body = z.object({
    payToken: z.string().min(20),
    sessionToken: z.string().min(10),
    achConsent: z.boolean().optional(),
    achAccountType: z.enum(['checking', 'savings']).optional(),
    completion: z.object({
      type: z.string().max(20).optional(),
      status: z.number().optional(),
      data: z.object({ auth_resp: z.string().max(10).optional(), auth_resp_text: z.string().max(120).optional() }).partial().optional(),
    }).optional(),
  }).parse(req.body);
  if (body.completion !== undefined) logger.info({ northCompletionPayload: body.completion }, 'payment link checkout.submit() result');
  const result = await paymentMethodLinkService.confirm(body.payToken, body.sessionToken, body.achConsent, body.achAccountType, { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null });
  if (result.status === 'needs_ach_consent') { ok(res, result, 'ACH authorization required'); return; }
  ok(res, result, result.duplicate ? 'Payment method already on file' : 'Payment method saved', 201);
}));

router.post('/store/status', asyncHandler(async (req, res) => {
  const body = z.object({ payToken: z.string().min(20), sessionToken: z.string().min(10) }).parse(req.body);
  ok(res, await paymentMethodLinkService.status(body.payToken, body.sessionToken), 'Session status');
}));

/** Customer-facing hosted page. */
router.get('/store', asyncHandler(async (req, res) => {
  const query = z.object({ token: z.string().min(20) }).parse(req.query);
  const ctx = await paymentMethodLinkService.context(query.token);
  const company = await getCompanyInfo();
  applyNorthCheckoutPageHeaders(res);
  res.status(200).setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.type('html').send(`<!doctype html>
<html>
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Add payment method · ${htmlEscape(company.name)}</title><style>
    #checkout-root { height: 560px; }
    #checkout-root iframe { width: 100% !important; height: 100% !important; border: 0; display: block; }
    @media (max-width: 640px) { #checkout-root { height: 820px; } }
  </style></head>
  <body style="font-family:Arial,sans-serif;background:#F5FAF8;padding:24px;">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #D5EDE9;border-radius:12px;padding:20px;">
      <div style="background:#0D0D0D;border-radius:10px;padding:12px;margin-bottom:14px;">
        <img src="/api/v1/agreements/assets/logo-mark.png?v=3" alt="" style="width:40px;height:40px;object-fit:contain;vertical-align:middle;margin-right:10px;" />
        <span style="font-size:18px;font-weight:900;color:#FFFFFF;vertical-align:middle;">${htmlEscape(company.name)}</span>
      </div>
      <h2 style="margin:0 0 6px 0;color:#0D0D0D;">Add your payment method${ctx.firstName ? `, ${htmlEscape(ctx.firstName)}` : ''}</h2>
      <p style="margin:0 0 10px 0;color:#30433F;font-size:14px;line-height:1.5;">
        Enter a card or bank account below. Your details are tokenized by our payment processor and never touch our systems. It will be saved on file as your default method for your service charges.${ctx.methodsOnFile > 0 ? ' You already have a method on file; adding another replaces it as the default.' : ''}
      </p>
      <input id="payToken" type="hidden" value="${htmlEscape(query.token)}" />
      <p id="payStatus" style="color:#607D78;font-size:14px;margin:10px 0;">Loading secure form…</p>
      <p id="payError" style="color:#B3261E;font-size:14px;margin:10px 0;display:none;"></p>
      <button type="button" id="payRetry" style="display:none;margin:0 0 12px 0;padding:8px 12px;border:1px solid #CBD7D4;border-radius:8px;background:#fff;cursor:pointer;">Try Again</button>
      <div id="checkoutWrap" style="border:1px solid #D5EDE9;border-radius:14px;background:#fff;padding:12px;">
        <div id="checkout-root" style="width:100%;background:#FFFFFF;"></div>
      </div>
      <div id="achConsentWrap" style="display:none;margin-top:12px;border:1px solid #F0E3C4;background:#FDF8EC;border-radius:10px;padding:12px;">
        <h4 id="achConsentTitle" style="margin:0 0 6px 0;color:#0D0D0D;font-size:15px;">Authorize your bank account</h4>
        <p style="margin:0 0 10px 0;color:#30433F;font-size:13px;">Your bank account has been securely stored. Confirm the account type and authorize future debits for your service charges.</p>
        <div style="display:flex;gap:16px;margin:0 0 10px 0;font-size:14px;color:#0D0D0D;">
          <span style="font-weight:600;">Account type:</span>
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="radio" name="achAccountType" value="checking" checked /> Checking</label>
          <label style="display:flex;gap:6px;align-items:center;cursor:pointer;"><input type="radio" name="achAccountType" value="savings" /> Savings</label>
        </div>
        <pre id="achTermsText" style="white-space:pre-wrap;font-family:inherit;font-size:13px;color:#4A4A4A;margin:0 0 10px 0;"></pre>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:14px;color:#0D0D0D;cursor:pointer;">
          <input id="achConsent" type="checkbox" style="margin-top:3px;" />
          <span>I have read the ACH authorization above and authorize ${htmlEscape(company.name)} to debit my bank account for amounts due for my services as described in those terms.</span>
        </label>
      </div>
      <button type="button" id="payNow" disabled style="display:inline-block;margin-top:12px;padding:12px 18px;background:#2DC4A2;color:#0D0D0D;border:none;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;">Save payment method</button>
      <div id="paySuccess" style="display:none;border:1px solid #BFE8DF;background:#EAF8F5;border-radius:10px;padding:14px;margin-top:12px;">
        <h3 style="margin:0 0 6px 0;color:#0D0D0D;font-size:15px;">Payment method saved — thank you!</h3>
        <p style="margin:0;color:#30433F;font-size:13px;">It is now on file as your default method for your ${htmlEscape(company.name)} service charges. You can close this page.</p>
        <p id="paySuccessDetail" style="margin:8px 0 0 0;color:#30433F;font-size:13px;"></p>
      </div>
      <p style="margin:16px 0 0 0;color:#607D78;font-size:12px;">Questions? Call ${htmlEscape(company.phone)} or reply to the email that sent you here.</p>
    </div>
    <script src="/api/v1/payment-links/store/client.js?v=1"></script>
  </body>
</html>`);
}));

export default router;

function storeClientScript() {
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
  var consentTitle = document.getElementById('achConsentTitle');
  var termsEl = document.getElementById('achTermsText');
  if (!payTokenEl || !statusEl || !errorEl || !checkoutWrap || !successEl || !payBtn) return;

  var payToken = String(payTokenEl.value || '');
  var payLabel = payBtn.textContent;
  var session = null;
  var busy = false;
  var scriptPromise = null;
  // One STORAGE session; the customer picks card or bank inside North's form.
  // If North stored a bank account, the server answers needs_ach_consent and
  // we confirm the SAME session again once the customer authorizes it. If a
  // confirm fails after submit, the same session is re-verified — never a new
  // one, which could charge twice.
  var pendingResult = null;
  var pendingConsent = null;
  var needsVerification = false;

  function money(n) { return '$' + Number(n).toFixed(2); }
  function selectedAccountType() {
    var checked = document.querySelector('input[name="achAccountType"]:checked');
    return checked && checked.value === 'savings' ? 'savings' : 'checking';
  }
  function setStatus(message) { statusEl.textContent = message || ''; statusEl.style.display = message ? 'block' : 'none'; }
  function clearError() { errorEl.style.display = 'none'; if (retryBtn) retryBtn.style.display = 'none'; }
  function showError(message) {
    setStatus(''); busy = false; updatePayButton();
    errorEl.textContent = message || 'Unable to save the payment method.'; errorEl.style.display = 'block';
    if (retryBtn) {
      retryBtn.textContent = needsVerification ? 'Retry verification' : 'Try Again';
      retryBtn.style.display = 'inline-block';
    }
  }
  function updatePayButton() {
    if (pendingConsent) {
      payBtn.textContent = 'Authorize and save bank account';
      payBtn.disabled = busy || !(consentBox && consentBox.checked);
      return;
    }
    payBtn.textContent = payLabel;
    payBtn.disabled = busy || !session || needsVerification;
  }
  function renderBreakdown(b) {
    if (!breakdownEl || !b) return;
    var rows = [['Subtotal', b.subtotal], ['Taxes & fees', b.tax], ['Total', b.total]];
    if (b.previouslyPaid > 0) rows.push(['Previously paid', -b.previouslyPaid]);
    rows.push(['Amount due today', b.amountDue]);
    breakdownEl.innerHTML = rows.map(function (r) {
      var strong = r[0] === 'Amount due today';
      var amount = r[1] < 0 ? '-' + money(-r[1]) : money(r[1]);
      return '<div style="display:flex;justify-content:space-between;padding:2px 0;' + (strong ? 'font-weight:700;' : '') + '"><span>' + r[0] + '</span><span>' + amount + '</span></div>';
    }).join('');
  }
  function showConsentStep(info) {
    pendingConsent = info;
    checkoutWrap.style.display = 'none';
    if (consentWrap) {
      consentWrap.style.display = 'block';
      if (consentTitle) consentTitle.textContent = 'Authorize bank account' + (info.last4 ? ' \\u2022\\u2022\\u2022\\u2022' + info.last4 : '');
      if (termsEl && info.achTerms) termsEl.textContent = info.achTerms.text;
      if (consentBox) consentBox.checked = false;
    }
    setStatus('');
    updatePayButton();
  }
  function showSuccess(result) {
    setStatus(''); clearError();
    checkoutWrap.style.display = 'none'; payBtn.style.display = 'none';
    if (consentWrap) consentWrap.style.display = 'none';
    successEl.style.display = 'block';
    if (successDetailEl) {
      var parts = [];
      if (result && result.last4) parts.push('Saved on file: ' + (result.brand || (result.methodType === 'bank_account' ? 'Bank account' : 'Card')) + ' ending in ' + result.last4);
      successDetailEl.textContent = parts.join('  \\u00b7  ');
    }
  }
  function summarizeCompletion(result) {
    if (!result || typeof result !== 'object') return undefined;
    var data = result.data && typeof result.data === 'object' ? result.data : {};
    var out = {};
    if (typeof result.type === 'string') out.type = result.type.slice(0, 20);
    if (typeof result.status === 'number') out.status = result.status;
    var inner = {};
    var has = false;
    if (typeof data.auth_resp === 'string') { inner.auth_resp = data.auth_resp.slice(0, 10); has = true; }
    if (typeof data.auth_resp_text === 'string') { inner.auth_resp_text = data.auth_resp_text.slice(0, 120); has = true; }
    if (has) out.data = inner;
    return out;
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

  async function startCheckout(keepError) {
    if (needsVerification || pendingConsent) return;
    if (!keepError) clearError();
    session = null; pendingResult = null; busy = true; updatePayButton();
    checkoutWrap.style.display = 'block';
    if (consentWrap) consentWrap.style.display = 'none';
    setStatus('Loading secure payment form\\u2026');
    try {
      var created = await postJson('/api/v1/payment-links/store/session', { payToken: payToken });
      renderBreakdown(created.breakdown);
      await loadCheckoutScript(created.scriptUrl);
      if (!window.checkout || typeof window.checkout.mount !== 'function' || typeof window.checkout.submit !== 'function') {
        throw new Error('The payment form did not load correctly.');
      }
      var rootEl = document.getElementById('checkout-root');
      if (rootEl) rootEl.innerHTML = '';
      await Promise.resolve(window.checkout.mount(created.sessionToken, 'checkout-root'));
      session = created; busy = false; setStatus(''); updatePayButton();
    } catch (err) {
      showError(err && err.message ? err.message : 'Unable to start the secure form.');
    }
  }

  async function confirmPayment(withConsent) {
    if (!session) return;
    busy = true; clearError(); updatePayButton();
    setStatus(withConsent ? 'Saving your bank account\\u2026' : 'Saving your payment method\\u2026 This can take a few seconds.');
    try {
      var body = { payToken: payToken, sessionToken: session.sessionToken, completion: summarizeCompletion(pendingResult) };
      if (withConsent) { body.achConsent = true; body.achAccountType = selectedAccountType(); }
      var confirmed = await postJson('/api/v1/payment-links/store/confirm', body);
      if (confirmed && confirmed.status === 'needs_ach_consent') {
        busy = false;
        showConsentStep(confirmed);
        return;
      }
      needsVerification = false; pendingResult = null; pendingConsent = null;
      showSuccess(confirmed);
    } catch (err) {
      // The submit already went through: keep this session and verify it again.
      needsVerification = true;
      showError((err && err.message ? err.message : 'We could not save the payment method.') + ' It may already be saved \\u2014 please retry verification instead of entering it again.');
    }
  }

  async function submitPayment() {
    if (busy || !session || needsVerification) return;
    if (pendingConsent) {
      if (!(consentBox && consentBox.checked)) { showError('Please accept the ACH authorization to continue.'); return; }
      await confirmPayment(true);
      return;
    }
    busy = true; clearError(); updatePayButton();
    setStatus('Securing your payment details\\u2026');
    var result;
    try {
      result = await window.checkout.submit();
    } catch (err) {
      showError(err && err.message === 'Submit timeout' ? 'This is taking longer than expected. Please try again.' : (err && err.message) || 'The form could not be submitted.');
      return;
    }
    if (!result || result.type !== 'success') {
      var data = result && result.data ? result.data : {};
      showError(data.auth_resp_text || data.message || 'The details were not accepted. Please check them and try again.');
      // Nothing moved and a submitted session cannot be reused \\u2014 mount a fresh
      // one for the retry, but keep the decline message visible.
      startCheckout(true);
      return;
    }
    pendingResult = result;
    await confirmPayment(false);
  }

  if (consentBox) consentBox.addEventListener('change', updatePayButton);
  payBtn.addEventListener('click', submitPayment);
  if (retryBtn) retryBtn.addEventListener('click', function () {
    if (busy) return;
    if (needsVerification) { confirmPayment(!!pendingConsent); return; }
    startCheckout();
  });

  startCheckout();
})();`;
}
