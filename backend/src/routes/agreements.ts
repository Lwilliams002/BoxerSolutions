import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler';
import { agreementSigningService } from '../services/agreementSigningService';

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
    ? ctx.agreement.coveredPests.map((p) => `<span style="display:inline-block;margin:0 8px 8px 0;padding:6px 10px;border-radius:999px;background:#EAF8F5;color:#0D0D0D;font-size:13px;">${htmlEscape(p)}</span>`).join('')
    : '<p style="color:#607D78;margin:0;">No covered pests were listed.</p>';

  const termMonths = ctx.agreement?.termMonths ?? 12;
  const initialTotal = ctx.agreement?.initialTotal != null ? money(ctx.agreement.initialTotal) : '—';
  const recurringTotal = ctx.agreement?.recurringTotal != null ? `${money(ctx.agreement.recurringTotal)}/service` : '—';
  const customerType = ctx.customerType ? `${ctx.customerType.slice(0, 1).toUpperCase()}${ctx.customerType.slice(1)} Account` : 'Account';

  return `
  <div style="border:1px solid #D5EDE9;border-radius:14px;padding:16px;background:#FFFFFF;box-shadow:0 3px 10px rgba(13,13,13,0.08);">
    <div style="background:#0D0D0D;border-radius:10px;padding:12px;">
      <div style="font-size:20px;font-weight:900;color:#FFFFFF;">Boxer Solutions Pest Control</div>
      <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:#2DC4A2;">PEST CONTROL</div>
    </div>
    <h3 style="text-align:center;font-size:20px;font-weight:900;letter-spacing:1px;margin:14px 0 10px 0;color:#0D0D0D;">SERVICE AGREEMENT</h3>
    ${ctx.alreadySigned ? '<p style="text-align:center;margin:0 0 10px 0;color:#2E7D32;font-weight:700;">Already signed</p>' : '<p style="text-align:center;margin:0 0 10px 0;color:#B26B00;font-weight:800;">Pending customer signature</p>'}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
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
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:2px solid #0D0D0D;">
          <th style="text-align:left;padding:6px 4px;color:#607D78;font-weight:800;font-size:11px;">Service</th>
          <th style="text-align:right;padding:6px 4px;color:#607D78;font-weight:800;font-size:11px;">Initial</th>
          <th style="text-align:right;padding:6px 4px;color:#607D78;font-weight:800;font-size:11px;">Regular</th>
        </tr>
      </thead>
      <tbody>${serviceRows}</tbody>
      <tfoot>
        <tr style="border-top:2px solid #0D0D0D;">
          <td style="padding:8px 4px;color:#0D0D0D;font-weight:900;">TOTAL</td>
          <td style="padding:8px 4px;color:#0D0D0D;text-align:right;font-weight:900;">${initialTotal}</td>
          <td style="padding:8px 4px;color:#0D0D0D;text-align:right;font-weight:900;">${recurringTotal}</td>
        </tr>
      </tfoot>
    </table>

    <h4 style="background:#2DC4A2;color:#0D0D0D;font-weight:800;font-size:12px;text-align:center;padding:4px;border-radius:4px;margin:14px 0 8px 0;">Covered Pests</h4>
    <div>${pests}</div>

    <h4 style="background:#2DC4A2;color:#0D0D0D;font-weight:800;font-size:12px;text-align:center;padding:4px;border-radius:4px;margin:14px 0 8px 0;">Terms & Conditions</h4>
    <p style="margin:0 0 8px 0;font-size:10.5px;color:#607D78;line-height:1.45;">
      This agreement is for an initial period of ${termMonths} month(s). You, the customer, may cancel this transaction any time prior to midnight of the third business day after the date of this transaction by giving written notice of cancellation to Boxer Solutions Pest Control. Upon completion of the initial service, the customer agrees to pay the full initial service charge. Recurring treatments continue at the agreed frequency until canceled by the customer. Boxer Solutions Pest Control will re-treat at no additional charge between scheduled visits if covered pest activity persists.
    </p>
    <p style="margin:0;font-size:10.5px;color:#607D78;line-height:1.45;">
      I have read and agree to the terms and conditions of this agreement, including any additional disclosures listed above. I confirm my contact information is entered correctly and agree to receive account notifications electronically.
    </p>
  </div>`;
}

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
      <p id="formError" style="color:#B3261E;font-size:14px;margin-top:10px;display:none;"></p>
      <script>
        (function() {
          const token = ${JSON.stringify(ctx.token)};
          const canvas = document.getElementById('signaturePad');
          const form = document.getElementById('sign-form');
          const clearBtn = document.getElementById('clearBtn');
          const errorEl = document.getElementById('formError');
          const signerInput = document.getElementById('signerName');
          const initialsInput = document.getElementById('initials');
          const acceptEl = document.getElementById('acceptTerms');
          const ctx2d = canvas.getContext('2d');
          if (!canvas || !ctx2d || !form || !clearBtn || !errorEl || !signerInput || !initialsInput || !acceptEl) return;
          let drawing = false;
          let hasStroke = false;
          let activePointerId = null;

          function sizeCanvas() {
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx2d.lineWidth = 2;
            ctx2d.lineCap = 'round';
            ctx2d.lineJoin = 'round';
            ctx2d.strokeStyle = '#0D0D0D';
            hasStroke = false;
          }
          sizeCanvas();
          window.addEventListener('resize', sizeCanvas);

          function point(e) {
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left);
            const y = (e.clientY - rect.top);
            return { x, y };
          }

          function startPointer(e) {
            if (activePointerId !== null && activePointerId !== e.pointerId) return;
            activePointerId = e.pointerId;
            drawing = true;
            const p = point(e);
            ctx2d.beginPath();
            ctx2d.moveTo(p.x, p.y);
            if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
          }
          function movePointer(e) {
            if (activePointerId !== e.pointerId) return;
            if (!drawing) return;
            const p = point(e);
            ctx2d.lineTo(p.x, p.y);
            ctx2d.stroke();
            hasStroke = true;
          }
          function endPointer(e) {
            if (activePointerId !== e.pointerId) return;
            drawing = false;
            activePointerId = null;
            if (canvas.releasePointerCapture) {
              try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
            }
          }

          canvas.addEventListener('pointerdown', startPointer);
          canvas.addEventListener('pointermove', movePointer);
          canvas.addEventListener('pointerup', endPointer);
          canvas.addEventListener('pointercancel', endPointer);
          canvas.addEventListener('pointerleave', endPointer);

          clearBtn.addEventListener('click', function() {
            ctx2d.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
            hasStroke = false;
          });

          form.addEventListener('submit', async function(e) {
            e.preventDefault();
            errorEl.style.display = 'none';
            const signerName = String(signerInput.value || '').trim();
            const initials = String(initialsInput.value || '').trim().toUpperCase();
            const acceptedTerms = !!acceptEl.checked;
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
              const signatureDataUrl = canvas.toDataURL('image/png');
              const response = await fetch('/api/v1/agreements/sign/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, signerName, initials, signatureDataUrl, acceptedTerms }),
              });
              const contentType = String(response.headers.get('content-type') || '');
              if (!response.ok && contentType.includes('application/json')) {
                const payload = await response.json();
                errorEl.textContent = payload.message || 'Failed to sign agreement.';
                errorEl.style.display = 'block';
                return;
              }
              const html = await response.text();
              document.open();
              document.write(html);
              document.close();
            } catch (err) {
              errorEl.textContent = 'Could not submit signature. Please try again.';
              errorEl.style.display = 'block';
            }
          });
        })();
      </script>`;
    res
      .status(200)
      .type('html')
      .send(`<!doctype html>
<html>
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title></head>
  <body style="font-family:Arial,sans-serif;background:#F5FAF8;padding:24px;">
    <div style="max-width:860px;margin:0 auto;background:#fff;border:1px solid #D5EDE9;border-radius:12px;padding:20px;">
      <h2 style="margin-top:0;color:#0D0D0D;">${title}</h2>
      <p style="color:#30433F;line-height:1.5;">${body}</p>
      ${renderAgreementDocument(ctx)}
      ${action}
    </div>
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
    }).parse(req.body);
    const result = await agreementSigningService.signFromToken(payload);
    const title = result.alreadySigned ? 'Agreement Already Signed' : 'Agreement Signed';
    const message = result.alreadySigned
      ? 'This agreement was already signed previously.'
      : 'Thank you. Your agreement has been signed successfully.';
    res
      .status(200)
      .type('html')
      .send(`<!doctype html>
<html>
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title></head>
  <body style="font-family:Arial,sans-serif;background:#F5FAF8;padding:24px;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #D5EDE9;border-radius:12px;padding:20px;">
      <h2 style="margin-top:0;color:#0D0D0D;">${title}</h2>
      <p style="color:#30433F;line-height:1.5;">${message}</p>
    </div>
  </body>
</html>`);
  }),
);

export default router;
