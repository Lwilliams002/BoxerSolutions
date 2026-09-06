import type { Response } from 'express';
import { config } from '../config';

/**
 * Content-Security-Policy for pages served by this API that embed North
 * Embedded Checkout (the agreement payment page and the mobile WebView host
 * page). North's checkout.js mounts a cross-origin iframe and pulls further
 * dependencies (fingerprint/fraud check, metrics, the /form iframe). Helmet's
 * strict default CSP blocks those and silently breaks the payment form, so
 * these pages allow any https source for the relevant directives.
 */
export function northCheckoutCspHeader(): string {
  const northOrigin = new URL(config.north.embeddedBaseUrl).origin;
  return [
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
  ].join(';');
}

/**
 * Headers for a page served by this API that embeds North's hosted fields.
 * Helmet's defaults send `Referrer-Policy: no-referrer` and
 * `Cross-Origin-Opener-Policy: same-origin`; North's iframe needs to see the
 * parent origin (its domain restriction and session checks key on it), and
 * the wallet flows open popups that a same-origin opener policy severs.
 */
export function applyNorthCheckoutPageHeaders(res: Response): void {
  res.setHeader('Content-Security-Policy', northCheckoutCspHeader());
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
}
