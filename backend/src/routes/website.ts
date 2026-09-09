import express, { Request, Response, NextFunction, Router } from 'express';
import path from 'path';
import { config } from '../config';
import { asyncHandler } from '../utils/asyncHandler';
import { getCompanyInfo } from '../services/settingsService';
import { SITE_PAGES, renderSitemap } from '../content/website/pages';

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
  router.get('/robots.txt', (_req, res) => { res.type('text/plain').send('User-agent: *\nAllow: /\nSitemap: https://boxersolutionspestcontrol.com/sitemap.xml\n'); });
  router.get('/sitemap.xml', (_req, res) => { res.type('application/xml').send(renderSitemap('https://boxersolutionspestcontrol.com')); });
  return router;
}

/** Route marketing hostnames to the website; everything else falls through to the API. */
export function websiteVhost(router: Router) {
  return (req: Request, res: Response, next: NextFunction) => (isWebsiteHost(req.hostname) ? router(req, res, next) : next());
}
