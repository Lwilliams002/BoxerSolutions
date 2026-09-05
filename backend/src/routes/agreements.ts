import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/http';
import { config } from '../config';
import { agreementSigningService } from '../services/agreementSigningService';
import { logger } from '../utils/logger';

const router = Router();

function htmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

const ASSET_FILES: Record<string, string> = {
  'logo-mark.png': '../../../mobile/assets/logo-mark.png',
  'general.png': '../../../mobile/pests/general.png',
  'ant.png': '../../../mobile/pests/ant.png',
  'centipede.png': '../../../mobile/pests/centipede.png',
  'cricket.png': '../../../mobile/pests/cricket.png',
  'cockroach.png': '../../../mobile/pests/cockroach.png',
  'flea.png': '../../../mobile/pests/flea.png',
  'millepede.png': '../../../mobile/pests/millepede.png',
  'sliverfish.png': '../../../mobile/pests/sliverfish.png',
  'spider.png': '../../../mobile/pests/spider.png',
  'hornet.png': '../../../mobile/pests/hornet.png',
  'mosquito.png': '../../../mobile/pests/mosquito.png',
  'termite.png': '../../../mobile/pests/termite.png',
  'rodent.png': '../../../mobile/pests/rodent.png',
  'scorpion.png': '../../../mobile/pests/scorpion.png',
  'wasp.png': '../../../mobile/pests/wasp.png',
  'bee.png': '../../../mobile/pests/bee.png',
  'wildlife.png': '../../../mobile/pests/wildlife.png',
  'packrat.png': '../../../mobile/pests/packrat.png',
  'pigeon.png': '../../../mobile/pests/pigeon.png',
  'noseeum.png': '../../../mobile/pests/noseeum.png',
  'kissingbug.png': '../../../mobile/pests/kissingbug.png',
  'iguana.png': '../../../mobile/pests/iguana.png',
  'commercial.png': '../../../mobile/pests/commercial.png',
  'earwig.png': '../../../mobile/pests/earwig.png',
};

function pestAssetForName(name: string) {
  const key = name.trim().toLowerCase();
  const map: Record<string, string> = {
    'box elder bugs': 'general.png',
    'asian beetles': 'general.png',
    centipedes: 'centipede.png',
    clovermites: 'general.png',
    crickets: 'cricket.png',
    'sow / pill bug': 'general.png',
    spiders: 'spider.png',
    'household ants': 'ant.png',
    'palmetto bugs': 'cockroach.png',
    'yard ants': 'ant.png',
    'fire ants': 'ant.png',
    'carpenter ants': 'ant.png',
    fleas: 'flea.png',
    ticks: 'flea.png',
    'black widow': 'spider.png',
    'brown recluse': 'spider.png',
    'spider web removal': 'spider.png',
    'wasps / hornets': 'hornet.png',
    millipedes: 'millepede.png',
    silverfish: 'sliverfish.png',
    earwigs: 'earwig.png',
    mosquitoes: 'mosquito.png',
    mosquito: 'mosquito.png',
    termites: 'termite.png',
    termite: 'termite.png',
    rodents: 'rodent.png',
    rodent: 'rodent.png',
    scorpions: 'scorpion.png',
    scorpion: 'scorpion.png',
    wasps: 'wasp.png',
    hornets: 'hornet.png',
    bees: 'bee.png',
    bee: 'bee.png',
    wildlife: 'wildlife.png',
    'pack rats': 'packrat.png',
    packrat: 'packrat.png',
    pigeons: 'pigeon.png',
    pigeon: 'pigeon.png',
    noseeums: 'noseeum.png',
    noseeum: 'noseeum.png',
    'kissing bugs': 'kissingbug.png',
    'kissing bug': 'kissingbug.png',
    iguanas: 'iguana.png',
    iguana: 'iguana.png',
    commercial: 'commercial.png',
  };
  return map[key] ?? 'general.png';
}

function signPageStyles() {
  return `<style>
  body { font-family: Arial, sans-serif; background: #F5FAF8; padding: 24px; margin: 0; }
  .page-card { max-width: 860px; margin: 0 auto; background: #fff; border: 1px solid #D5EDE9; border-radius: 12px; padding: 20px; }
  .agreement-doc { border:1px solid #D5EDE9; border-radius:14px; padding:16px; background:#FFF; box-shadow:0 3px 10px rgba(13,13,13,.08); }
  .agreement-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; }
  .pricing-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .pricing-table { width:100%; min-width: 520px; border-collapse:collapse; table-layout: auto; }
  .pricing-table th, .pricing-table td { vertical-align: top; }
  .pest-pill { display:inline-flex; align-items:center; gap:6px; margin:0 8px 8px 0; padding:6px 10px; border-radius:999px; background:#EAF8F5; color:#0D0D0D; font-size:13px; }
  .pest-pill img { width:14px; height:14px; object-fit:contain; }
  @media (max-width: 640px) {
    body { padding: 10px; }
    .page-card { padding: 14px; }
    .agreement-doc { padding: 12px; }
    .agreement-grid { grid-template-columns: 1fr; }
    .pricing-table { min-width: 520px; }
    .pricing-table th { font-size: 11px !important; padding: 6px 4px !important; }
    .pricing-table td { font-size: 11px !important; padding: 6px 4px !important; }
  }
  </style>`;
}

function renderAgreementDocument(ctx: Awaited<ReturnType<typeof agreementSigningService.getSigningContext>>) {
  const serviceRows = ctx.agreement?.lineItems?.length
    ? ctx.agreement.lineItems.map((item) => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #E5EEEC;color:#0D0D0D;">${htmlEscape(item.label)}</td>
        <td style="padding:10px;border-bottom:1px solid #E5EEEC;color:#0D0D0D;text-align:right;">${money(item.initial)}</td>
        <td style="padding:10px;border-bottom:1px solid #E5EEEC;color:#0D0D0D;text-align:right;">${money(item.regular)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="3" style="padding:12px;color:#607D78;">No service pricing details were found for this agreement.</td></tr>`;

  const pests = ctx.agreement?.coveredPests?.length
    ? ctx.agreement.coveredPests.map((p) => `<span class="pest-pill"><img src="/api/v1/agreements/assets/${encodeURIComponent(pestAssetForName(p))}?v=3" alt="" loading="lazy" />${htmlEscape(p)}</span>`).join('')
    : '<p style="color:#607D78;margin:0;">No covered pests were listed.</p>';

  const termMonths = ctx.agreement?.termMonths ?? 12;
  const initialDiscount =
    ctx.agreement?.initialDiscount != null ? Math.max(0, ctx.agreement.initialDiscount) : 0;
  const initialTotal = ctx.agreement?.initialTotal != null ? money(ctx.agreement.initialTotal) : '—';
  const recurringTotal = ctx.agreement?.recurringTotal != null ? `${money(ctx.agreement.recurringTotal)}/service` : '—';
  const initialSubtotal =
    ctx.agreement?.initialTotal != null ? money(ctx.agreement.initialTotal + initialDiscount) : '—';
  const pricingFoot = initialDiscount > 0
    ? `
        <tr style="border-top:2px solid #0D0D0D;">
          <td style="padding:8px 4px;color:#0D0D0D;font-weight:900;">SUBTOTAL</td>
          <td style="padding:8px 4px;color:#0D0D0D;text-align:right;font-weight:900;">${initialSubtotal}</td>
          <td style="padding:8px 4px;color:#0D0D0D;text-align:right;font-weight:900;">${recurringTotal}</td>
        </tr>
        <tr>
          <td style="padding:8px 4px;color:#B3261E;font-weight:800;">Initial Discount</td>
          <td style="padding:8px 4px;color:#B3261E;text-align:right;font-weight:800;">-${money(initialDiscount)}</td>
          <td style="padding:8px 4px;color:#607D78;text-align:right;font-weight:700;">—</td>
        </tr>
        <tr style="border-top:2px solid #0D0D0D;">
          <td style="padding:8px 4px;color:#0D0D0D;font-weight:900;">TOTAL</td>
          <td style="padding:8px 4px;color:#0D0D0D;text-align:right;font-weight:900;">${initialTotal}</td>
          <td style="padding:8px 4px;color:#0D0D0D;text-align:right;font-weight:900;">${recurringTotal}</td>
        </tr>
      `
    : `
        <tr style="border-top:2px solid #0D0D0D;">
          <td style="padding:8px 4px;color:#0D0D0D;font-weight:900;">TOTAL</td>
          <td style="padding:8px 4px;color:#0D0D0D;text-align:right;font-weight:900;">${initialTotal}</td>
          <td style="padding:8px 4px;color:#0D0D0D;text-align:right;font-weight:900;">${recurringTotal}</td>
        </tr>
      `;
  const customerType = ctx.customerType ? `${ctx.customerType.slice(0, 1).toUpperCase()}${ctx.customerType.slice(1)} Account` : 'Account';

  return `
  <div class="agreement-doc">
    <div style="background:#0D0D0D;border-radius:10px;padding:12px;">
      <img src="/api/v1/agreements/assets/logo-mark.png?v=3" alt="Boxer Solutions" style="width:44px;height:44px;object-fit:contain;vertical-align:middle;margin-right:10px;" />
      <div style="font-size:20px;font-weight:900;color:#FFFFFF;">Boxer Solutions Pest Control</div>
      <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:#2DC4A2;">PEST CONTROL</div>
    </div>
    <h3 style="text-align:center;font-size:20px;font-weight:900;letter-spacing:1px;margin:14px 0 10px 0;color:#0D0D0D;">SERVICE AGREEMENT</h3>
    ${ctx.alreadySigned ? '<p style="text-align:center;margin:0 0 10px 0;color:#2E7D32;font-weight:700;">Already signed</p>' : '<p style="text-align:center;margin:0 0 10px 0;color:#B26B00;font-weight:800;">Pending customer signature</p>'}

    <div class="agreement-grid">
      <div>
        <div style="background:#2DC4A2;color:#0D0D0D;font-weight:800;font-size:12px;text-align:center;padding:4px;border-radius:4px;margin-bottom:6px;">Service Address</div>
        <div style="font-size:12px;color:#0D0D0D;line-height:1.45;">${ctx.serviceAddress ? htmlEscape(ctx.serviceAddress) : 'Not provided'}</div>
      </div>
      <div>
        <div style="background:#2DC4A2;color:#0D0D0D;font-weight:800;font-size:12px;text-align:center;padding:4px;border-radius:4px;margin-bottom:6px;">Customer Information</div>
        <div style="font-size:12px;color:#0D0D0D;line-height:1.45;">${ctx.customerEmail ? htmlEscape(ctx.customerEmail) : 'No email on file'}</div>
        <div style="font-size:12px;color:#0D0D0D;line-height:1.45;">${ctx.customerPhone ? htmlEscape(ctx.customerPhone) : 'No phone on file'}</div>
        <div style="font-size:12px;color:#0D0D0D;line-height:1.45;">${htmlEscape(customerType)}</div>
      </div>
    </div>

    <h4 style="background:#2DC4A2;color:#0D0D0D;font-weight:800;font-size:12px;text-align:center;padding:4px;border-radius:4px;margin:14px 0 8px 0;">Services & Pricing</h4>
    <div class="pricing-table-wrap">
    <table class="pricing-table">
      <thead>
        <tr style="border-bottom:2px solid #0D0D0D;">
          <th style="text-align:left;padding:6px 4px;color:#607D78;font-weight:800;font-size:11px;">Service</th>
          <th style="text-align:right;padding:6px 4px;color:#607D78;font-weight:800;font-size:11px;">Initial</th>
          <th style="text-align:right;padding:6px 4px;color:#607D78;font-weight:800;font-size:11px;">Regular</th>
        </tr>
      </thead>
      <tbody>${serviceRows}</tbody>
      <tfoot>${pricingFoot}</tfoot>
    </table>
    </div>

    <h4 style="background:#2DC4A2;color:#0D0D0D;font-weight:800;font-size:12px;text-align:center;padding:4px;border-radius:4px;margin:14px 0 8px 0;">Covered Pests</h4>
    <div>${pests}</div>

    <h4 style="background:#2DC4A2;color:#0D0D0D;font-weight:800;font-size:12px;text-align:center;padding:4px;border-radius:4px;margin:14px 0 8px 0;">Terms & Conditions</h4>
    <p style="margin:0 0 8px 0;font-size:10.5px;color:#607D78;line-height:1.45;">
      This agreement is for an initial period of ${termMonths} month(s). You, the customer, may cancel this transaction any time prior to midnight of the third business day after the date of this transaction by giving written notice of cancellation to Boxer Solutions Pest Control. Upon completion of the initial service, the customer agrees to pay the full initial service charge. Recurring treatments continue at the agreed frequency until canceled by the customer. Boxer Solutions Pest Control will re-treat at no additional charge between scheduled visits if covered pest activity persists. If this agreement is terminated before the end of the ${termMonths}-month term, the customer agrees to repay any initial service discount applied under this agreement.
    </p>
    <p style="margin:0;font-size:10.5px;color:#607D78;line-height:1.45;">
      I have read and agree to the terms and conditions of this agreement, including any additional disclosures listed above. I confirm my contact information is entered correctly and agree to receive account notifications electronically.
    </p>
  </div>`;
}

function signingClientScript() {
  return `'use strict';
(function () {
  var canvas = document.getElementById('signaturePad');
  var form = document.getElementById('sign-form');
  var clearBtn = document.getElementById('clearBtn');
  var errorEl = document.getElementById('formError');
  var signerInput = document.getElementById('signerName');
  var initialsInput = document.getElementById('initials');
  var acceptEl = document.getElementById('acceptTerms');
  var tokenEl = document.getElementById('signToken');
  if (!canvas || !form || !clearBtn || !errorEl || !signerInput || !initialsInput || !acceptEl || !tokenEl) return;

  var ctx2d = canvas.getContext('2d');
  if (!ctx2d) return;

  var drawing = false;
  var hasStroke = false;
  var dpr = 1;
  var activePointerId = null;

  function sizeCanvas() {
    var rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.scale(dpr, dpr);
    ctx2d.lineWidth = 2;
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';
    ctx2d.strokeStyle = '#0D0D0D';
    hasStroke = false;
  }

  function point(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startAt(clientX, clientY) {
    drawing = true;
    var p = point(clientX, clientY);
    ctx2d.beginPath();
    ctx2d.moveTo(p.x, p.y);
  }

  function moveAt(clientX, clientY) {
    if (!drawing) return;
    var p = point(clientX, clientY);
    ctx2d.lineTo(p.x, p.y);
    ctx2d.stroke();
    hasStroke = true;
  }

  function endStroke() {
    drawing = false;
  }

  function startPointer(e) {
    if (activePointerId !== null && activePointerId !== e.pointerId) return;
    activePointerId = e.pointerId;
    e.preventDefault();
    startAt(e.clientX, e.clientY);
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  }

  function movePointer(e) {
    if (activePointerId !== e.pointerId) return;
    e.preventDefault();
    moveAt(e.clientX, e.clientY);
  }

  function endPointer(e) {
    if (activePointerId !== e.pointerId) return;
    e.preventDefault();
    endStroke();
    activePointerId = null;
    if (canvas.releasePointerCapture) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  }

  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);

  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', startPointer);
    canvas.addEventListener('pointermove', movePointer);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
  }

  canvas.addEventListener('mousedown', function (e) {
    if (window.PointerEvent) return;
    e.preventDefault();
    startAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('mousemove', function (e) {
    if (window.PointerEvent) return;
    e.preventDefault();
    moveAt(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', function () {
    if (window.PointerEvent) return;
    endStroke();
  });

  canvas.addEventListener('touchstart', function (e) {
    if (window.PointerEvent) return;
    e.preventDefault();
    if (!e.touches || !e.touches[0]) return;
    startAt(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('touchmove', function (e) {
    if (window.PointerEvent) return;
    e.preventDefault();
    if (!e.touches || !e.touches[0]) return;
    moveAt(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  canvas.addEventListener('touchend', function (e) {
    if (window.PointerEvent) return;
    e.preventDefault();
    endStroke();
  }, { passive: false });
  canvas.addEventListener('touchcancel', function (e) {
    if (window.PointerEvent) return;
    e.preventDefault();
    endStroke();
  }, { passive: false });

  clearBtn.addEventListener('click', function () {
    ctx2d.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    hasStroke = false;
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    errorEl.style.display = 'none';

    var signerName = String(signerInput.value || '').trim();
    var initials = String(initialsInput.value || '').trim().toUpperCase();
    var acceptedTerms = !!acceptEl.checked;
    var token = String(tokenEl.value || '');

    if (!signerName) {
      errorEl.textContent = 'Full name is required.';
      errorEl.style.display = 'block';
      return;
    }
    if (!/^[A-Za-z]{1,4}$/.test(initials)) {
      errorEl.textContent = 'Initials must be 1-4 letters.';
      errorEl.style.display = 'block';
      return;
    }
    if (!hasStroke) {
      errorEl.textContent = 'Please draw your signature.';
      errorEl.style.display = 'block';
      return;
    }
    if (!acceptedTerms) {
      errorEl.textContent = 'You must accept the terms before signing.';
      errorEl.style.display = 'block';
      return;
    }

    try {
      var signatureDataUrl = canvas.toDataURL('image/png');
      var response = await fetch('/api/v1/agreements/sign/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          signerName: signerName,
          initials: initials,
          signatureDataUrl: signatureDataUrl,
          acceptedTerms: acceptedTerms,
          signedAtIso: new Date().toISOString(),
          signerTimeZone: (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone || undefined
        })
      });
      var contentType = String(response.headers.get('content-type') || '');
      if (!response.ok && contentType.includes('application/json')) {
        var payload = await response.json();
        errorEl.textContent = payload.message || 'Failed to sign agreement.';
        errorEl.style.display = 'block';
        return;
      }
      var html = await response.text();
      document.open();
      document.write(html);
      document.close();
    } catch (err) {
      errorEl.textContent = 'Could not submit signature. Please try again.';
      errorEl.style.display = 'block';
    }
  });
})();`;
}

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
  // Bank (ACH) money moves inside checkout.submit(). If our confirm call then
  // fails, the session token stays valid and the ONLY safe recovery is to
  // verify that same session again — starting a new one would debit twice.
  var pendingResult = null;
  var needsVerification = false;

  function money(n) { return '$' + Number(n).toFixed(2); }
  function setStatus(message) { statusEl.textContent = message || ''; statusEl.style.display = message ? 'block' : 'none'; }
  function clearError() { errorEl.style.display = 'none'; if (retryBtn) retryBtn.style.display = 'none'; }
  function setModesDisabled(disabled) { modeButtons.forEach(function (b) { b.disabled = !!disabled; }); }
  function showError(message) {
    setStatus(''); busy = false; updatePayButton();
    errorEl.textContent = message || 'Unable to process the payment.'; errorEl.style.display = 'block';
    if (retryBtn) {
      retryBtn.textContent = needsVerification ? 'Retry verification' : 'Try Again';
      retryBtn.style.display = 'inline-block';
    }
  }
  function updatePayButton() {
    var consentOk = mode !== 'bank' || (consentBox && consentBox.checked);
    payBtn.disabled = busy || !session || !consentOk || needsVerification;
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

  async function startCheckout(keepError) {
    if (needsVerification) return;
    if (!keepError) clearError();
    session = null; pendingResult = null; busy = true; updatePayButton();
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

  async function confirmPayment() {
    if (!session || !pendingResult) return;
    busy = true; clearError(); updatePayButton();
    setStatus('Processing your payment… This can take a few seconds.');
    try {
      var confirmed = await postJson('/api/v1/agreements/sign/pay/confirm', {
        payToken: payToken, mode: mode, sessionToken: session.sessionToken,
        achConsent: mode === 'bank' ? true : undefined, completion: summarizeCompletion(pendingResult)
      });
      needsVerification = false; pendingResult = null;
      setModesDisabled(false);
      showSuccess(confirmed);
    } catch (err) {
      // The submit already went through: keep this session and verify it again.
      needsVerification = true;
      setModesDisabled(true);
      showError((err && err.message ? err.message : 'We could not record the payment.') + ' Your payment may already have gone through — please retry verification instead of paying again.');
    }
  }

  async function submitPayment() {
    if (busy || !session || needsVerification) return;
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
      // Nothing moved and a submitted session cannot be reused — mount a fresh
      // one for the retry, but keep the decline message visible. This is the
      // only path allowed to start a new session after a submit.
      startCheckout(true);
      return;
    }
    pendingResult = result;
    await confirmPayment();
  }

  modeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      if (busy || needsVerification) return;
      var next = button.getAttribute('data-mode') === 'bank' ? 'bank' : 'card';
      if (next === mode && session) return;
      mode = next;
      modeButtons.forEach(function (b) { b.classList.toggle('pay-mode-active', b === button); });
      startCheckout();
    });
  });
  if (consentBox) consentBox.addEventListener('change', updatePayButton);
  payBtn.addEventListener('click', submitPayment);
  if (retryBtn) retryBtn.addEventListener('click', function () {
    if (busy) return;
    if (needsVerification) { confirmPayment(); return; }
    startCheckout();
  });

  startCheckout();
})();`;
}

router.get('/sign/pay/client.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.status(200).type('application/javascript').send(payClientScript());
});

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
      // Diagnostics only, and never free-form: the client sends just these
      // fields so an arbitrary client-supplied object cannot reach the logs.
      completion: z.object({
        type: z.string().max(20).optional(),
        status: z.number().optional(),
        data: z.object({
          auth_resp: z.string().max(10).optional(),
          auth_resp_text: z.string().max(120).optional(),
        }).partial().optional(),
      }).optional(),
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

router.post(
  '/sign/pay/status',
  asyncHandler(async (req, res) => {
    const body = z.object({
      payToken: z.string().min(20),
      sessionToken: z.string().min(10),
    }).parse(req.body);
    const status = await agreementSigningService.getInitialPaymentStatus(body.payToken, body.sessionToken);
    ok(res, status, 'Checkout session status');
  }),
);

router.get('/sign/client.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.status(200).type('application/javascript').send(signingClientScript());
});

router.get(
  '/assets/:name',
  asyncHandler(async (req, res) => {
    const parsed = z.object({ name: z.string().min(1).max(64) }).parse(req.params);
    const rel = ASSET_FILES[parsed.name];
    if (!rel) {
      res.status(404).end();
      return;
    }
    const filePath = path.resolve(__dirname, rel);
    const data = await fs.readFile(filePath);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.status(200).type('image/png').send(data);
  }),
);

router.get(
  '/sign',
  asyncHandler(async (req, res) => {
    const query = z.object({ token: z.string().min(20) }).parse(req.query);
    const ctx = await agreementSigningService.getSigningContext(query.token);
    const title = ctx.alreadySigned ? 'Agreement Already Signed' : 'Review and Sign Agreement';
    const body = ctx.alreadySigned
      ? `The agreement for ${htmlEscape(ctx.customerName)} is already signed.`
      : `Please review the full agreement below before signing for ${htmlEscape(ctx.customerName)}.`;
    const action = ctx.alreadySigned
      ? ''
      : `
      <form id="sign-form" style="margin-top:16px;border-top:1px solid #D5EDE9;padding-top:14px;">
        <input id="signToken" type="hidden" value="${htmlEscape(ctx.token)}" />
        <h4 style="margin:0 0 12px 0;color:#0D0D0D;">Customer Signature</h4>
        <label style="display:block;margin-bottom:8px;color:#0D0D0D;font-weight:600;">Full Name</label>
        <input id="signerName" type="text" maxlength="120" style="width:100%;padding:10px;border:1px solid #CBD7D4;border-radius:8px;margin-bottom:12px;" />
        <label style="display:block;margin-bottom:8px;color:#0D0D0D;font-weight:600;">Initials (1-4 letters)</label>
        <input id="initials" type="text" maxlength="4" style="width:120px;padding:10px;border:1px solid #CBD7D4;border-radius:8px;margin-bottom:12px;text-transform:uppercase;" />
        <label style="display:block;margin-bottom:8px;color:#0D0D0D;font-weight:600;">Draw Signature</label>
        <p style="margin:0 0 6px 0;color:#607D78;font-size:12px;">Use your finger or mouse to sign in the box.</p>
        <canvas id="signaturePad" width="460" height="180" style="width:100%;max-width:560px;height:180px;border:1.5px dashed #2DC4A2;border-radius:10px;background:#fff;touch-action:none;"></canvas>
        <div style="margin-top:8px;">
          <button type="button" id="clearBtn" style="padding:8px 12px;border:1px solid #CBD7D4;border-radius:8px;background:#fff;cursor:pointer;">Clear Signature</button>
        </div>
        <label style="display:flex;align-items:flex-start;gap:8px;margin-top:14px;color:#30433F;">
          <input id="acceptTerms" type="checkbox" style="margin-top:2px;" />
          <span>I reviewed this service agreement and consent to sign electronically.</span>
        </label>
        <button type="submit" style="display:inline-block;margin-top:16px;padding:10px 14px;background:#2DC4A2;color:#0D0D0D;border:none;border-radius:8px;font-weight:700;cursor:pointer;">Sign Agreement</button>
      </form>
      <p id="formError" style="color:#B3261E;font-size:14px;margin-top:10px;display:none;"></p>`;
    res
      .status(200)
      .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
      .type('html')
      .send(`<!doctype html>
<html>
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title>${signPageStyles()}</head>
  <body>
    <div class="page-card">
      <h2 style="margin-top:0;color:#0D0D0D;">${title}</h2>
      <p style="color:#30433F;line-height:1.5;">${body}</p>
      ${renderAgreementDocument(ctx)}
      ${action}
    </div>
    ${ctx.alreadySigned ? '' : '<script src="/api/v1/agreements/sign/client.js?v=4"></script>'}
  </body>
</html>`);
  }),
);

router.post(
  '/sign/confirm',
  asyncHandler(async (req, res) => {
    const payload = z.object({
      token: z.string().min(20),
      signerName: z.string().max(120),
      initials: z.string().min(1).max(4),
      signatureDataUrl: z.string().min(30),
      acceptedTerms: z.boolean(),
      signedAtIso: z.string().datetime().optional(),
      signerTimeZone: z.string().min(1).max(100).optional(),
    }).parse(req.body);
    const result = await agreementSigningService.signFromToken(payload);
    const title = result.alreadySigned ? 'Agreement Already Signed' : 'Agreement Signed';
    const message = result.alreadySigned
      ? 'This agreement was already signed previously.'
      : 'Thank you. Your agreement has been signed successfully.';

    const paymentToken = !result.alreadySigned ? (result.initialPaymentToken ?? null) : null;
    const amountDue = !result.alreadySigned ? (result.initialAmountDue ?? null) : null;
    const receipt = !result.alreadySigned && result.initialInvoiceCharged
      ? (result.initialReceipt as { receiptNumber?: string; amount?: number; brand?: string | null; last4?: string | null } | null)
      : null;

    let paymentSection = '';
    if (receipt) {
      const detailParts = [
        receipt.amount != null ? `Amount paid: ${money(Number(receipt.amount))}` : null,
        receipt.receiptNumber ? `Receipt: ${htmlEscape(receipt.receiptNumber)}` : null,
        receipt.brand && receipt.last4 ? `${htmlEscape(String(receipt.brand))} ending in ${htmlEscape(String(receipt.last4))}` : null,
      ].filter(Boolean).join('  ·  ');
      paymentSection = `
      <div style="margin-top:16px;border:1px solid #BFE8DF;background:#EAF8F5;border-radius:10px;padding:14px;">
        <h3 style="margin:0 0 6px 0;color:#0D0D0D;font-size:15px;">Initial payment received</h3>
        <p style="margin:0;color:#30433F;font-size:13px;">Your initial service charge was paid with your saved payment method. A copy of the invoice and receipt is available in your account.</p>
        ${detailParts ? `<p style="margin:8px 0 0 0;color:#30433F;font-size:13px;">${detailParts}</p>` : ''}
      </div>`;
    } else if (paymentToken) {
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
            <span>I have read the ACH authorization above and authorize Boxer Solutions Pest Control to debit my bank account for this payment and, where I have recurring services, for future amounts due as described in those terms.</span>
          </label>
        </div>
        <button type="button" id="payNow" disabled style="display:inline-block;margin-top:12px;padding:12px 18px;background:#2DC4A2;color:#0D0D0D;border:none;border-radius:8px;font-weight:700;font-size:15px;cursor:pointer;">Pay ${amountDue != null ? money(Number(amountDue)) : 'Now'}</button>
        <div id="paySuccess" style="display:none;border:1px solid #BFE8DF;background:#EAF8F5;border-radius:10px;padding:14px;margin-top:12px;">
          <h3 style="margin:0 0 6px 0;color:#0D0D0D;font-size:15px;">Payment received — thank you!</h3>
          <p style="margin:0;color:#30433F;font-size:13px;">Your initial service charge has been paid and your payment method was securely saved on file for future service charges. A copy of the invoice and receipt is available in your account.</p>
          <p id="paySuccessDetail" style="margin:8px 0 0 0;color:#30433F;font-size:13px;"></p>
        </div>
      </div>`;
    } else if (!result.alreadySigned && result.initialInvoiceId) {
      paymentSection = `
      <div style="margin-top:16px;border:1px solid #F0E3C4;background:#FDF8EC;border-radius:10px;padding:14px;">
        <p style="margin:0;color:#7A5C00;font-size:13px;">Your initial service invoice has been created and added to your account. Our team will follow up to collect payment.</p>
      </div>`;
    }

    res
      .status(200)
      .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    if (paymentToken) {
      // The North embedded checkout loads a cross-origin script and mounts an
      // iframe, and its script pulls further dependencies (fingerprint/fraud
      // check from fpnpmcdn.net, metrics.north.com, the /form iframe). Helmet's
      // default CSP blocks those, silently failing the payment, so this
      // transient payment page allows any https source for those directives.
      const northOrigin = new URL(config.north.embeddedBaseUrl).origin;
      res.setHeader(
        'Content-Security-Policy',
        [
          `default-src 'self'`,
          `script-src 'self' https: 'unsafe-inline'`,
          `frame-src https:`,
          `connect-src 'self' https: wss:`,
          `img-src 'self' data: https:`,
          `style-src 'self' 'unsafe-inline' https:`,
          `font-src 'self' data: https:`,
          `worker-src 'self' blob:`,
          `base-uri 'self'`,
          `form-action 'self' ${northOrigin}`,
          `object-src 'none'`,
        ].join(';'),
      );
    }
    res
      .type('html')
      .send(`<!doctype html>
<html>
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title><style>
    #checkout-root iframe { width: 100% !important; min-height: 520px; border: 0; display: block; }
    .pay-mode-active { border-color:#2DC4A2 !important; background:#EAF8F5 !important; }
  </style></head>
  <body style="font-family:Arial,sans-serif;background:#F5FAF8;padding:24px;">
    <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #D5EDE9;border-radius:12px;padding:20px;">
      <h2 style="margin-top:0;color:#0D0D0D;">${title}</h2>
      <p style="color:#30433F;line-height:1.5;">${message}</p>
      ${paymentSection}
    </div>
    ${paymentToken ? '<script src="/api/v1/agreements/sign/pay/client.js?v=9"></script>' : ''}
  </body>
</html>`);
  }),
);

export default router;
