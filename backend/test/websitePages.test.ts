import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_PAGES } from '../src/content/website/pages';

const company = { name: 'Boxer Solutions Pest Control', phone: '(305) 713-5011', email: 'service@boxersolutionspestcontrol.com', addressLines: ['20560 NW 17th Ave', 'Miami Gardens, FL 33056'], license: 'License #: JB500216', licenseNumber: 'JB500216' };
const ctx = { company, base: '', year: 2026 };

test('every page carries the underwriting essentials', () => {
  for (const page of SITE_PAGES) {
    const html = page.render(ctx);
    for (const needle of ['Boxer Solutions Pest Control', '(305) 713-5011', 'service@boxersolutionspestcontrol.com', '20560 NW 17th Ave', 'License #: JB500216', '/privacy', '/terms', '/refund-policy', '/contact']) {
      assert.ok(html.includes(needle), `${page.path} missing ${needle}`);
    }
    assert.ok(!html.includes('<script'), `${page.path} must not need scripts`);
  }
});

test('home page lists services and prices; policies state cancellation and refunds', () => {
  const home = SITE_PAGES.find((p) => p.path === '/')!.render(ctx);
  assert.ok(home.includes('Standard Four Point Service') && home.includes('$340') && home.includes('$139'));
  assert.ok(home.includes('never stored'));
  for (const section of ['Cities served', 'Miami Gardens', "This season's hotspots", 'Mosquito season is here.', 'South Florida pest programs', 'Termite Control', 'Signs you have them', 'Tell us about the pest.', 'action="/estimate"']) {
    assert.ok(home.includes(section), `home missing ${section}`);
  }
  const refunds = SITE_PAGES.find((p) => p.path === '/refund-policy')!.render(ctx);
  assert.match(refunds, /third business day/);
  assert.match(refunds, /original payment method/);
});

test('estimate form re-fills values and shows notices', () => {
  const html = SITE_PAGES.find((p) => p.path === '/')!.render({ ...ctx, notice: { kind: 'error', text: 'Please enter your name' }, form: { name: 'Jane <b>', phone: '3055550100', pest: 'Termites' } });
  assert.ok(html.includes('class="notice error"'));
  assert.ok(html.includes('value="Jane &lt;b&gt;"'));
  assert.ok(html.includes('<option selected>Termites</option>'));
});

test('preview base prefixes links when served under /site', () => {
  const html = SITE_PAGES.find((p) => p.path === '/')!.render({ ...ctx, base: '/site' });
  assert.ok(html.includes('href="/site/privacy"'));
  assert.ok(html.includes('src="/site/assets/logo-mark.png"'));
  assert.ok(html.includes('action="/site/estimate"'));
  assert.ok(html.includes("url('/site/assets/hero-miami.jpg')"));
});
