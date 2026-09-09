import express, { Request, Response, NextFunction, Router } from 'express';
import path from 'path';
import { config } from '../config';
import { asyncHandler } from '../utils/asyncHandler';
import { getCompanyInfo } from '../services/settingsService';
import { SITE_PAGES, SiteContext, renderSitemap } from '../content/website/pages';
import { getOutboundMessageProvider, notifications } from '../integrations/notifications';
import { logger } from '../utils/logger';

/**
 * Public company website. Served for the marketing hostnames (apex + www)
 * and also under /site on the API host so it can be previewed before DNS
 * points at this server.
 */
const SITE_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function siteHeaders(res: Response) {
  res.setHeader('Content-Security-Policy', SITE_CSP);
  res.setHeader('Cache-Control', 'public, max-age=300');
}

export function isWebsiteHost(hostname: string) {
  return config.website.hosts.includes(hostname.toLowerCase());
}

export function createWebsiteRouter(): Router {
  const router = Router();
  router.use('/assets', express.static(path.resolve(process.cwd(), 'public/website'), { maxAge: '1d' }));

  for (const page of SITE_PAGES) {
    router.get(page.path, asyncHandler(async (req, res) => {
      const company = await getCompanyInfo();
      const base = isWebsiteHost(req.hostname) ? '' : req.baseUrl;
      siteHeaders(res);
      res.type('html').send(page.render({ company, base, year: new Date().getFullYear() }));
    }));
  }
  // Free-estimate form: emails the office and drops an in-app notification.
  router.post('/estimate', express.urlencoded({ extended: false, limit: '20kb' }), asyncHandler(async (req, res) => {
    const company = await getCompanyInfo();
    const base = isWebsiteHost(req.hostname) ? '' : req.baseUrl;
    const body = (req.body ?? {}) as Record<string, string>;
    const field = (k: string, max: number) => String(body[k] ?? '').trim().slice(0, max);
    const form = { name: field('name', 100), phone: field('phone', 30), email: field('email', 200), address: field('address', 200), pest: field('pest', 60), message: field('message', 1000) };
    const render = (notice: SiteContext['notice'], keep: boolean) => {
      const page = SITE_PAGES.find((p) => p.path === '/')!;
      siteHeaders(res);
      res.setHeader('Cache-Control', 'no-store');
      res.status(notice?.kind === 'error' ? 400 : 200).type('html').send(page.render({ company, base, year: new Date().getFullYear(), notice, form: keep ? form : null }));
    };
    // Honeypot: bots fill the hidden "company" field; people never see it.
    if (field('company', 10)) return render({ kind: 'ok', text: 'Thanks! We will be in touch shortly.' }, false);
    if (!form.name || !form.phone) return render({ kind: 'error', text: 'Please enter your name and a phone number so we can reach you.' }, true);
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return render({ kind: 'error', text: 'That email address does not look right.' }, true);

    const subject = `Estimate request — ${form.name}${form.pest ? ` (${form.pest})` : ''}`;
    const text = [
      'New free-estimate request from the website',
      '',
      `Name: ${form.name}`,
      `Phone: ${form.phone}`,
      `Email: ${form.email || 'not provided'}`,
      `Service address: ${form.address || 'not provided'}`,
      `Pest: ${form.pest || 'not specified'}`,
      '',
      form.message || '(no additional details)',
      '',
      `Submitted ${new Date().toLocaleString('en-US', { timeZone: config.timezone })}`,
    ].join('\n');
    try {
      await getOutboundMessageProvider('email').send({ communicationId: 'website-estimate', channel: 'email', to: company.email, subject, body: text, templateKey: 'website_estimate' });
      await notifications.send({ userId: null, channel: 'push', type: 'website_estimate', title: `Estimate request: ${form.name}`, body: `${form.phone}${form.pest ? ` · ${form.pest}` : ''}${form.address ? ` · ${form.address}` : ''}`, data: { phone: form.phone, email: form.email, pest: form.pest, address: form.address } });
    } catch (err) {
      logger.error({ err }, 'website estimate request could not be delivered');
      return render({ kind: 'error', text: `Something went wrong sending your request. Please call ${company.phone}.` }, true);
    }
    return render({ kind: 'ok', text: `Thanks, ${form.name}! We received your request and will call ${form.phone} shortly.` }, false);
  }));

  router.get('/robots.txt', (_req, res) => { res.type('text/plain').send('User-agent: *\nAllow: /\nSitemap: https://boxersolutionspestcontrol.com/sitemap.xml\n'); });
  router.get('/sitemap.xml', (_req, res) => { res.type('application/xml').send(renderSitemap('https://boxersolutionspestcontrol.com')); });
  return router;
}

/** Route marketing hostnames to the website; everything else falls through to the API. */
export function websiteVhost(router: Router) {
  return (req: Request, res: Response, next: NextFunction) => (isWebsiteHost(req.hostname) ? router(req, res, next) : next());
}
