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

router.get(
  '/sign',
  asyncHandler(async (req, res) => {
    const query = z.object({ token: z.string().min(20) }).parse(req.query);
    const ctx = await agreementSigningService.getSigningContext(query.token);
    const title = ctx.alreadySigned ? 'Agreement Already Signed' : 'Review and Sign Agreement';
    const body = ctx.alreadySigned
      ? `The agreement for ${htmlEscape(ctx.customerName)} is already signed.`
      : `Please confirm to sign the agreement for ${htmlEscape(ctx.customerName)}.`;
    const action = ctx.alreadySigned
      ? ''
      : `
      <form id="sign-form" style="margin-top:16px;">
        <label style="display:block;margin-bottom:8px;color:#0D0D0D;font-weight:600;">Full Name</label>
        <input id="signerName" type="text" maxlength="120" style="width:100%;padding:10px;border:1px solid #CBD7D4;border-radius:8px;margin-bottom:12px;" />
        <label style="display:block;margin-bottom:8px;color:#0D0D0D;font-weight:600;">Initials (1-4 letters)</label>
        <input id="initials" type="text" maxlength="4" style="width:120px;padding:10px;border:1px solid #CBD7D4;border-radius:8px;margin-bottom:12px;text-transform:uppercase;" />
        <label style="display:block;margin-bottom:8px;color:#0D0D0D;font-weight:600;">Draw Signature</label>
        <canvas id="signaturePad" width="460" height="180" style="width:100%;max-width:460px;border:1px solid #CBD7D4;border-radius:8px;background:#fff;"></canvas>
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
          let drawing = false;
          let hasStroke = false;

          function point(e) {
            const rect = canvas.getBoundingClientRect();
            const x = ((e.clientX || (e.touches && e.touches[0].clientX)) - rect.left) * (canvas.width / rect.width);
            const y = ((e.clientY || (e.touches && e.touches[0].clientY)) - rect.top) * (canvas.height / rect.height);
            return { x, y };
          }

          function start(e) {
            e.preventDefault();
            drawing = true;
            const p = point(e);
            ctx2d.beginPath();
            ctx2d.moveTo(p.x, p.y);
          }
          function move(e) {
            if (!drawing) return;
            e.preventDefault();
            const p = point(e);
            ctx2d.lineTo(p.x, p.y);
            ctx2d.strokeStyle = '#0D0D0D';
            ctx2d.lineWidth = 2;
            ctx2d.lineCap = 'round';
            ctx2d.lineJoin = 'round';
            ctx2d.stroke();
            hasStroke = true;
          }
          function end() { drawing = false; }

          canvas.addEventListener('mousedown', start);
          canvas.addEventListener('mousemove', move);
          window.addEventListener('mouseup', end);
          canvas.addEventListener('touchstart', start, { passive: false });
          canvas.addEventListener('touchmove', move, { passive: false });
          window.addEventListener('touchend', end);

          clearBtn.addEventListener('click', function() {
            ctx2d.clearRect(0, 0, canvas.width, canvas.height);
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
            const signatureDataUrl = canvas.toDataURL('image/png');
            const response = await fetch('/api/v1/agreements/sign/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, signerName, initials, signatureDataUrl, acceptedTerms }),
            });
            const html = await response.text();
            document.open();
            document.write(html);
            document.close();
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
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #D5EDE9;border-radius:12px;padding:20px;">
      <h2 style="margin-top:0;color:#0D0D0D;">${title}</h2>
      <p style="color:#30433F;line-height:1.5;">${body}</p>
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
