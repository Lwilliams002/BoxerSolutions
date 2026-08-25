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
      : `<a href="/api/v1/agreements/sign/confirm?token=${encodeURIComponent(ctx.token)}" style="display:inline-block;margin-top:16px;padding:10px 14px;background:#2DC4A2;color:#0D0D0D;text-decoration:none;border-radius:8px;font-weight:700;">Sign Agreement</a>`;
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

router.get(
  '/sign/confirm',
  asyncHandler(async (req, res) => {
    const query = z.object({ token: z.string().min(20), signerName: z.string().max(200).optional() }).parse(req.query);
    const result = await agreementSigningService.signFromToken(query.token, query.signerName);
    const title = result.alreadySigned ? 'Agreement Already Signed' : 'Agreement Signed';
    const body = result.alreadySigned
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
      <p style="color:#30433F;line-height:1.5;">${body}</p>
    </div>
  </body>
</html>`);
  }),
);

export default router;
