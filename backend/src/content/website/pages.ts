import { CompanyInfo } from '../../services/settingsService';
import { escapeHtml } from '../serviceNotificationEmail';
import { ADDONS, HOME_SIZES, ODD_JOBS, STANDARD_PESTS, TERM_MONTHS, WEB_REMOVAL, YARD_ANT_TIERS } from './pricing';
import { FEATURED_PROGRAMS, PEST_PROGRAMS, SERVICE_CITIES } from './pests';

/**
 * Public company website (home, services & pricing, contact, privacy, terms,
 * refund & cancellation policy). Rendered from Company Settings so the
 * address, license, phone and email stay in sync with the app.
 */
export interface SitePage { path: string; title: string; description: string; render: (ctx: SiteContext) => string }
export interface SiteContext {
  company: CompanyInfo;
  base: string;
  year: number;
  /** Estimate form feedback after a POST (thank-you or validation error). */
  notice?: { kind: 'ok' | 'error'; text: string } | null;
  /** Previously submitted form values to re-fill after a validation error. */
  form?: Record<string, string> | null;
}

const money = (n: number) => `$${n.toFixed(0)}`;
const e = escapeHtml;

const NAV: { href: string; label: string }[] = [
  { href: '/', label: 'Home' },
  { href: '/#pests', label: 'Pests' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#estimate', label: 'Free Estimate' },
  { href: '/contact', label: 'Contact' },
];

const CSS = `
:root{--teal:#2DC4A2;--teal-dark:#1E9C81;--ink:#0D0D0D;--muted:#5B6B68;--bg:#F0FAF8;--card:#fff;--line:#D9E6E2}
*{box-sizing:border-box}html,body{overflow-x:hidden}img{max-width:100%}.grid>*{min-width:0}body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--teal-dark)}.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
header{background:var(--ink);color:#fff}header .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px 16px;padding-top:12px;padding-bottom:12px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px;color:#fff;text-decoration:none;font-weight:800;font-size:18px}.brand img{width:40px;height:40px;flex:none}
nav{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px}nav a{color:#fff;text-decoration:none;font-weight:600;font-size:15px;white-space:nowrap;padding:4px 0}nav a.cta{background:var(--teal);color:var(--ink);padding:8px 14px;border-radius:999px}
.hero{position:relative;background:#0D0D0D center/cover no-repeat;color:#fff;padding:96px 0 72px;isolation:isolate}.hero:before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(13,13,13,.35) 0%,rgba(13,13,13,.78) 70%,#0D0D0D 100%);z-index:-1}.hero .kicker{text-transform:uppercase;letter-spacing:.35em;font-size:12px;font-weight:700;color:var(--teal);margin:0 0 10px}.hero h1{font-size:40px;line-height:1.15;margin:0 0 12px}.hero p{font-size:18px;color:#CFE8E1;max-width:640px;margin:0 0 22px}
.btn{display:inline-block;background:var(--teal);color:var(--ink);font-weight:800;padding:12px 20px;border-radius:12px;text-decoration:none}.btn.alt{background:#fff}
section{padding:48px 0}h2{font-size:28px;margin:0 0 6px}.sub{color:var(--muted);margin:0 0 22px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}.card h3{margin:0 0 6px;font-size:18px}.card p{margin:0;color:var(--muted);font-size:15px;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);font-size:15px}th{background:#E8F6F2;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}td.num,th.num{text-align:right;white-space:nowrap}
.pills{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.pill{background:#E8F6F2;border-radius:999px;padding:5px 11px;font-size:13px;font-weight:600}
.steps{counter-reset:s}.steps .card{position:relative;padding-left:58px}.steps .card:before{counter-increment:s;content:counter(s);position:absolute;left:16px;top:16px;width:30px;height:30px;border-radius:50%;background:var(--teal);color:var(--ink);font-weight:900;display:flex;align-items:center;justify-content:center}
.cities{display:flex;flex-wrap:wrap;gap:8px}.cities span{border:1px solid var(--line);background:#fff;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.feature{display:grid;grid-template-columns:120px 1fr;gap:22px;align-items:start;background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px;margin-bottom:16px}.feature img{width:120px;height:120px;object-fit:contain}.feature .kicker{text-transform:uppercase;letter-spacing:.3em;font-size:11px;font-weight:800;color:var(--teal-dark);margin:0 0 6px}.feature h3{margin:0 0 8px;font-size:24px}.feature p{margin:0 0 12px;color:#30433F}.feature ol{margin:0 0 12px;padding-left:20px}.feature li{margin-bottom:6px;color:#30433F}.feature li b{color:var(--ink)}.badges{display:flex;flex-wrap:wrap;gap:6px}.badges span{background:#E8F6F2;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700}
.pests{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(150px,100%),1fr));gap:10px}.pest{background:#fff;border:1px solid var(--line);border-radius:12px;min-width:0}.pest summary{list-style:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;padding:14px 8px 10px;text-align:center}.pest summary::-webkit-details-marker{display:none}.pest summary img{width:78px;height:78px;object-fit:contain;transition:transform .15s}.pest summary:hover img{transform:scale(1.06)}.pest summary b{font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-top:6px;color:var(--muted);max-width:100%}.pest[open]{grid-column:1/-1;border-color:var(--teal)}.pest[open] summary{flex-direction:row;gap:14px;text-align:left;padding:16px}.pest[open] summary b{font-size:16px;text-transform:none;letter-spacing:0;color:var(--ink)}.pest .detail{padding:0 16px 16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:14px}.pest .detail>*{min-width:0}.pest .detail h4{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.25em;color:var(--teal-dark)}.pest .detail p,.pest .detail li{margin:0;font-size:14px;color:#30433F}.pest .detail ul{margin:0;padding-left:16px}.tag{display:inline-block;font-size:10px;background:#E8F6F2;border-radius:999px;padding:2px 8px;margin:4px 0 0;font-weight:700;white-space:nowrap}
.estimate{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px}.estimate label{display:block;font-size:13px;font-weight:700;margin:12px 0 4px}.estimate input,.estimate select,.estimate textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:11px 12px;font:15px inherit;background:#F8FCFB;color:var(--ink)}.estimate textarea{min-height:110px}.estimate button{margin-top:16px;width:100%;background:var(--teal);color:var(--ink);border:0;border-radius:12px;padding:13px;font:800 16px inherit;cursor:pointer}.notice{border-radius:10px;padding:12px 14px;margin-bottom:12px;font-weight:600}.notice.ok{background:#E8F6F2;color:#0F5C4B}.notice.error{background:#FDECEC;color:#8A1C1C}
.legal{max-width:760px}.legal h2{margin-top:32px;font-size:22px}.legal p,.legal li{color:#30433F}
footer{background:var(--ink);color:#B9C9C5;padding:36px 0;font-size:14px}footer .wrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px}footer .wrap>div{min-width:0}footer a{color:#fff;text-decoration:none;overflow-wrap:anywhere}footer h4{color:#fff;margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.06em}
.note{background:#fff;border-left:4px solid var(--teal);padding:12px 14px;border-radius:8px;color:#30433F}
@media(max-width:640px){header .wrap{gap:10px}.brand{font-size:16px}nav{width:100%;gap:4px 14px}nav a{font-size:14px}nav a.cta{width:100%;text-align:center;margin-top:4px;padding:10px 14px}.hero{padding:56px 0 48px}.hero h1{font-size:30px}.hero p{font-size:16px}.feature{grid-template-columns:1fr}.feature img{width:90px;height:90px}.feature h3{font-size:21px}h2{font-size:24px}.pests{grid-template-columns:repeat(3,minmax(0,1fr))}.pest summary img{width:64px;height:64px}.pest summary{padding:10px 4px 8px}}
`;

function layout(ctx: SiteContext, page: { title: string; description: string; path: string }, body: string) {
  const c = ctx.company;
  const b = ctx.base;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(page.title)} · ${e(c.name)}</title>
<meta name="description" content="${e(page.description)}">
<link rel="icon" href="${b}/assets/logo-mark.png"><link rel="canonical" href="https://boxersolutionspestcontrol.com${page.path === '/' ? '/' : page.path}">
<style>${CSS}</style></head>
<body>
<header><div class="wrap">
  <a class="brand" href="${b}/"><img src="${b}/assets/logo-mark.png" alt="">${e(c.name)}</a>
  <nav>${NAV.map((n) => `<a href="${b}${n.href}">${e(n.label)}</a>`).join('')}<a class="cta" href="tel:${e(c.phone.replace(/\D/g, ''))}">Call ${e(c.phone)}</a></nav>
</div></header>
${body}
<footer><div class="wrap">
  <div><h4>${e(c.name)}</h4>${c.addressLines.map((l) => `<div>${e(l)}</div>`).join('')}<div>${e(c.license)}</div></div>
  <div><h4>Customer Service</h4><div><a href="tel:${e(c.phone.replace(/\D/g, ''))}">${e(c.phone)}</a></div><div><a href="mailto:${e(c.email)}">${e(c.email)}</a></div><div>Mon–Fri 8am–6pm · Sat 9am–2pm</div></div>
  <div><h4>Policies</h4><div><a href="${b}/privacy">Privacy Policy</a></div><div><a href="${b}/terms">Terms of Service</a></div><div><a href="${b}/refund-policy">Refund &amp; Cancellation Policy</a></div><div><a href="${b}/recurring-billing">Recurring Billing Terms</a></div><div><a href="${b}/contact">Contact Us</a></div></div>
  <div><h4>Payments</h4><div>We accept Visa, Mastercard, American Express, Discover and bank (ACH) payments through our secure mobile app and emailed payment links. Card details are entered only in our payment processor's secure form and are never stored on our systems.</div><div style="margin-top:10px">© ${ctx.year} ${e(c.name)}. All rights reserved.</div></div>
</div></footer>
</body></html>`;
}

function home(ctx: SiteContext) {
  const c = ctx.company;
  const b = ctx.base;
  const body = `
<section class="hero" style="background-image:url('${b}/assets/hero-miami.jpg')"><div class="wrap">
  <p class="kicker">South Florida · Miami-Dade, Broward &amp; Palm Beach</p>
  <h1>South Florida pest control, built for the coast.</h1>
  <p>${e(c.name)} is a licensed, local pest control company. We start with an initial flush-out treatment, then keep your home protected with regular service on the schedule you choose — weekly, every two weeks, monthly or every two months.</p>
  <a class="btn" href="tel:${e(c.phone.replace(/\D/g, ''))}">Call ${e(c.phone)}</a> &nbsp; <a class="btn alt" href="${b}/#estimate">Free estimate</a>
</div></section>

<section><div class="wrap">
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start">
    <div>
      <p class="hero-kicker" style="text-transform:uppercase;letter-spacing:.3em;font-size:12px;font-weight:800;color:var(--teal-dark);margin:0 0 8px">From the 305 to the 561</p>
      <h2>Built for the whole coast.</h2>
      <p class="sub" style="font-size:17px">From South Beach high-rises and Brickell condos to Fort Lauderdale canals, Boca estates and Palm Beach pools — our program is engineered around humidity, ocean air and the pests that thrive in both. Ants, roaches, spiders, centipedes, millipedes, fleas, termites and rodents — handled.</p>
      <a class="btn" href="${b}/#estimate">Book South Florida service</a>
    </div>
    <div>
      <p style="text-transform:uppercase;letter-spacing:.3em;font-size:12px;font-weight:800;color:var(--teal-dark);margin:0 0 10px">Cities served</p>
      <div class="cities">${SERVICE_CITIES.map((city) => `<span>${e(city)}</span>`).join('')}</div>
    </div>
  </div>
</div></section>

<section style="background:#fff"><div class="wrap">
  <h2>This season's hotspots</h2><p class="sub">The three calls we get most in South Florida, and exactly how we handle each one.</p>
  ${FEATURED_PROGRAMS.map((f) => `
  <div class="feature">
    <img src="${b}/assets/pests/${f.img}" alt="" loading="lazy">
    <div>
      <p class="kicker">${e(f.kicker)}</p>
      <h3>${e(f.headline)}</h3>
      <p>${e(f.body)}</p>
      <ol>${f.steps.map((st) => `<li><b>${e(st.label)}.</b> ${e(st.body)}</li>`).join('')}</ol>
      <div class="badges">${f.badges.map((bd) => `<span>${e(bd)}</span>`).join('')}</div>
    </div>
  </div>`).join('')}
</div></section>

<section id="pests"><div class="wrap">
  <h2>South Florida pest programs</h2><p class="sub">Tap a pest to see what it is, the signs you have it, why it matters and how we treat it. ${PEST_PROGRAMS.length} programs.</p>
  <div class="pests">
    ${PEST_PROGRAMS.map((p) => `
    <details class="pest" id="pest-${p.slug}">
      <summary><img src="${b}/assets/pests/${p.img}" alt="" loading="lazy"><b>${e(p.short)}${p.southFloridaOnly ? '<span class="tag">South Florida</span>' : ''}</b></summary>
      <div class="detail">
        <div style="grid-column:1/-1"><h3 style="margin:0;font-size:20px">${e(p.name)}</h3></div>
        <div><h4>What it is</h4><p>${e(p.about)}</p></div>
        <div><h4>Signs you have them</h4><ul>${p.signs.map((sg) => `<li>${e(sg)}</li>`).join('')}</ul></div>
        <div><h4>Why it matters</h4><p>${e(p.risk)}</p></div>
        <div><h4>Our approach</h4><p>${e(p.approach)}</p></div>
      </div>
    </details>`).join('')}
  </div>
</div></section>

<section id="services" style="background:#fff"><div class="wrap">
  <h2>Service plans</h2><p class="sub">Every plan includes free re-treatment between scheduled visits if covered pests come back.</p>
  <div class="grid">
    <div class="card"><h3>Standard Four Point Service</h3><p>Interior and exterior treatment of your home's foundation, entry points, eaves and yard perimeter. Priced by home size.</p><div class="pills">${STANDARD_PESTS.map((p) => `<span class="pill">${e(p)}</span>`).join('')}</div></div>
    <div class="card"><h3>All Yard Ants</h3><p>Whole-yard treatment for fire ants, carpenter ants and other yard ants, priced by lot size.</p><div class="pills"><span class="pill">Yard Ants</span><span class="pill">Fire Ants</span><span class="pill">Carpenter Ants</span></div></div>
    <div class="card"><h3>Add-Ons</h3><p>Outdoor pet protection for fleas and ticks, and black widow / brown recluse coverage, added to your regular service.</p></div>
    <div class="card"><h3>Web Removal &amp; Prevention</h3><p>Spider web removal around the whole structure with a prevention barrier. ${e(`$${WEB_REMOVAL.perSqft.toFixed(2)}`)} per sq ft, ${money(WEB_REMOVAL.minimum)} minimum.</p></div>
    <div class="card"><h3>Single-Pest Treatments</h3><p>Targeted programs for wasps and hornets, millipedes, silverfish and earwigs, sold as a fixed number of treatments.</p></div>
    <div class="card"><h3>Commercial Accounts</h3><p>Recurring service for offices, restaurants and multi-unit properties. Call for a site visit and quote.</p></div>
  </div>
</div></section>

<section id="pricing"><div class="wrap">
  <h2>Pricing</h2><p class="sub">Initial service is a one-time charge at the first visit. Regular service is charged per treatment at your chosen frequency. Prices are before any applicable tax.</p>
  <div class="grid" style="align-items:start">
    <div><h3>Standard Four Point Service</h3><table><tr><th>Home size</th><th class="num">Initial</th><th class="num">Regular</th></tr>${HOME_SIZES.map((t) => `<tr><td>${e(t.label)}</td><td class="num">${money(t.initial)}</td><td class="num">${money(t.regular)}</td></tr>`).join('')}</table></div>
    <div><h3>All Yard Ants</h3><table><tr><th>Lot size</th><th class="num">Initial</th><th class="num">Regular</th></tr>${YARD_ANT_TIERS.map((t) => `<tr><td>${e(t.label)}</td><td class="num">${money(t.initial)}</td><td class="num">${money(t.regular)}</td></tr>`).join('')}</table>
      <h3 style="margin-top:22px">Add-Ons (per regular service)</h3><table>${ADDONS.map((a) => `<tr><td>${e(a.label)}</td><td class="num">+${money(a.addRegular)}</td></tr>`).join('')}</table>
      <h3 style="margin-top:22px">Single-Pest Treatments</h3><table>${ODD_JOBS.map((o) => `<tr><td>${e(o.label)} <span style="color:var(--muted)">· ${o.treatments} treatment${o.treatments > 1 ? 's' : ''}</span></td><td class="num">${money(o.total)}</td></tr>`).join('')}</table></div>
  </div>
</div></section>

<section><div class="wrap">
  <h2>How it works</h2><p class="sub">Simple, in writing, and billed only for the service you receive.</p>
  <div class="grid steps">
    <div class="card"><h3>Agreement</h3><p>Your technician builds your plan on site and you sign a ${TERM_MONTHS}-month service agreement showing every price and your charge schedule. You may cancel within three business days of signing.</p></div>
    <div class="card"><h3>Initial service</h3><p>The initial flush-out treatment breaks existing pest cycles. Your first regular treatment follows within 30–45 days.</p></div>
    <div class="card"><h3>Regular service</h3><p>We return on your chosen schedule and re-treat at no charge between visits if covered pests persist.</p></div>
    <div class="card"><h3>Billing</h3><p>Pay by card or bank account in our secure app, by emailed payment link, or by check. You receive an itemized service notification and receipt by email after every visit.</p></div>
  </div>
  <p class="note" style="margin-top:22px">Payments are processed by North, a PCI-compliant payment processor. Card and bank details are entered only in the processor's secure form and are never stored on ${e(c.name)} systems.</p>
</div></section>

${estimateSection(ctx)}`;
  return layout(ctx, { title: 'Pest Control in South Florida', description: `${c.name}: licensed residential and commercial pest control with year-round protection plans.`, path: '/' }, body);
}

const PEST_CHOICES = ['Ants', 'Roaches', 'Spiders', 'Mosquitoes', 'Fleas / Ticks', 'Termites', 'Rodents', 'Wasps / Hornets', 'Centipedes / Millipedes', 'Silverfish / Earwigs', 'Other / Not sure'];

/** Free-estimate form. Posts back to the site; the office gets an email. */
export function estimateSection(ctx: SiteContext) {
  const c = ctx.company;
  const f = ctx.form ?? {};
  const v = (k: string) => e(f[k] ?? '');
  return `
<section id="estimate" style="background:#fff"><div class="wrap">
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start">
    <div>
      <p style="text-transform:uppercase;letter-spacing:.3em;font-size:12px;font-weight:800;color:var(--teal-dark);margin:0 0 8px">Free South Florida estimate</p>
      <h2>Tell us about the pest.</h2>
      <p class="sub" style="font-size:17px">Miami to West Palm — we will come out, look closer than anyone else has, and write a plan that actually works for the coast. Prefer to talk? Call <a href="tel:${e(c.phone.replace(/\D/g, ''))}">${e(c.phone)}</a>.</p>
    </div>
    <form class="estimate" method="post" action="${ctx.base}/estimate">
      ${ctx.notice ? `<div class="notice ${ctx.notice.kind}">${e(ctx.notice.text)}</div>` : ''}
      <input type="text" name="company" value="" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
      <label for="est-name">Name</label><input id="est-name" name="name" required maxlength="100" value="${v('name')}">
      <label for="est-phone">Phone</label><input id="est-phone" name="phone" type="tel" required maxlength="30" value="${v('phone')}">
      <label for="est-email">Email</label><input id="est-email" name="email" type="email" maxlength="200" value="${v('email')}">
      <label for="est-address">Service address</label><input id="est-address" name="address" maxlength="200" value="${v('address')}" placeholder="Street, city">
      <label for="est-pest">What are you seeing?</label>
      <select id="est-pest" name="pest">${PEST_CHOICES.map((p) => `<option${(f.pest ?? '') === p ? ' selected' : ''}>${e(p)}</option>`).join('')}</select>
      <label for="est-message">Tell us more</label><textarea id="est-message" name="message" maxlength="1000" placeholder="Where you're seeing activity, home size, how long it's been going on…">${v('message')}</textarea>
      <button type="submit">Request my free estimate</button>
      <p style="font-size:12px;color:var(--muted);margin:10px 0 0">By submitting you agree to be contacted about your request. See our <a href="${ctx.base}/privacy">Privacy Policy</a>.</p>
    </form>
  </div>
</div></section>`;
}

function contact(ctx: SiteContext) {
  const c = ctx.company;
  const body = `
<section><div class="wrap legal">
  <h1>Contact us</h1>
  <div class="grid">
    <div class="card"><h3>Call or text</h3><p><a href="tel:${e(c.phone.replace(/\D/g, ''))}">${e(c.phone)}</a></p><p>Mon–Fri 8am–6pm · Sat 9am–2pm</p></div>
    <div class="card"><h3>Email</h3><p><a href="mailto:${e(c.email)}">${e(c.email)}</a></p><p>We reply within one business day.</p></div>
    <div class="card"><h3>Office</h3>${c.addressLines.length ? c.addressLines.map((l) => `<p>${e(l)}</p>`).join('') : '<p>Serving Miami-Dade and Broward counties</p>'}<p>${e(c.license)}</p></div>
  </div>
  <h2>Request a quote</h2>
  <p>Use the form below, or call or email us with your address, approximate home size and the pests you are seeing. A technician will confirm pricing from the <a href="${ctx.base}/#pricing">price sheet</a> and schedule your initial service.</p>
</div></section>
${estimateSection(ctx)}
<section><div class="wrap legal">
  <h2>Billing questions</h2>
  <p>For questions about an invoice, a receipt, a payment method on file or a refund, email <a href="mailto:${e(c.email)}">${e(c.email)}</a> with your invoice number, or call ${e(c.phone)}. See our <a href="${ctx.base}/refund-policy">Refund &amp; Cancellation Policy</a>.</p>
</div></section>`;
  return layout(ctx, { title: 'Contact', description: `Contact ${c.name} for quotes, scheduling and billing.`, path: '/contact' }, body);
}

function privacy(ctx: SiteContext) {
  const c = ctx.company;
  const body = `
<section><div class="wrap legal">
  <h1>Privacy Policy</h1><p class="sub">Effective ${ctx.year}-01-01</p>
  <h2>What we collect</h2>
  <p>To provide pest control service we collect your name, service and billing address, phone number, email address, details about your property and the pests treated, and notes and photos from service visits.</p>
  <h2>Payments</h2>
  <p>Card and bank account details are entered directly into a secure form hosted by our payment processor, North. We receive and store only a payment token, the card brand or bank name, the last four digits and the expiration date. We never see, store or transmit full card numbers or security codes.</p>
  <h2>How we use your information</h2>
  <ul><li>To schedule and perform service, and to send appointment confirmations and reminders.</li><li>To invoice you, process payments you authorize, and send receipts and service notifications.</li><li>To keep a record of the treatments performed at your property, as required by state pesticide regulations.</li><li>To respond to your questions and requests.</li></ul>
  <h2>Sharing</h2>
  <p>We do not sell or rent your information. We share it only with service providers that help us operate, such as our payment processor, email delivery provider and cloud hosting provider, and when required by law.</p>
  <h2>Communications</h2>
  <p>By providing your phone number and email you agree to receive service-related texts and emails. Reply STOP to any text or contact us to opt out of non-essential messages.</p>
  <h2>Retention and security</h2>
  <p>Service and billing records are retained as required by Florida law and for as long as needed to serve your account. Data is transmitted over encrypted connections and stored on access-controlled systems.</p>
  <h2>Your choices</h2>
  <p>You may request a copy of, correction to, or deletion of your personal information by contacting <a href="mailto:${e(c.email)}">${e(c.email)}</a> or ${e(c.phone)}.</p>
</div></section>`;
  return layout(ctx, { title: 'Privacy Policy', description: `How ${c.name} collects, uses and protects customer information.`, path: '/privacy' }, body);
}

function terms(ctx: SiteContext) {
  const c = ctx.company;
  const body = `
<section><div class="wrap legal">
  <h1>Terms of Service</h1><p class="sub">These terms apply to all residential and commercial services provided by ${e(c.name)}.</p>
  <h2>Service agreement</h2>
  <p>Recurring service is provided under a written service agreement signed by the customer, either in our mobile app or through an emailed signing link. The agreement lists each service, the initial service price, the regular service price, the service frequency and the ${TERM_MONTHS}-month term.</p>
  <h2>Right to cancel</h2>
  <p>You may cancel a service agreement at any time before midnight of the third business day after the date you signed it by giving written notice to ${e(c.name)}. See our <a href="${ctx.base}/refund-policy">Refund &amp; Cancellation Policy</a>.</p>
  <h2>Pricing and payment</h2>
  <p>Prices are stated on your agreement and on our published price sheet. The initial service is due upon completion of the initial treatment. Regular service is due at each scheduled treatment. Invoices are payable by card or bank (ACH) in our app, by emailed payment link, or by check. By saving a payment method or signing an ACH authorization you authorize us to charge the amounts due under your agreement.</p>
  <h2>Recurring billing</h2>
  <p>Regular service under an agreement is billed per treatment at the frequency you chose. The full terms, including amounts, timing, authorization and how to cancel, are in our <a href="${ctx.base}/recurring-billing">Recurring Billing Terms</a>.</p>
  <h2>Re-treatment guarantee</h2>
  <p>If covered pest activity persists between scheduled visits, we will re-treat at no additional charge. Call ${e(c.phone)} to schedule.</p>
  <h2>Access and safety</h2>
  <p>Please provide access to the areas to be treated, keep children and pets away from treated areas until materials have dried, and follow any instructions given by your technician. All materials used are registered with the U.S. Environmental Protection Agency.</p>
  <h2>Early termination</h2>
  <p>If an agreement is terminated before the end of its term, any initial service discount applied under the agreement becomes repayable as stated on the agreement.</p>
  <h2>Contact</h2>
  <p>${e(c.name)} · ${e(c.phone)} · <a href="mailto:${e(c.email)}">${e(c.email)}</a>${c.addressLines.length ? ` · ${e(c.addressLines.join(', '))}` : ''} · ${e(c.license)}</p>
</div></section>`;
  return layout(ctx, { title: 'Terms of Service', description: `Terms of service for ${c.name} pest control agreements.`, path: '/terms' }, body);
}

function refunds(ctx: SiteContext) {
  const c = ctx.company;
  const body = `
<section><div class="wrap legal">
  <h1>Refund &amp; Cancellation Policy</h1>
  <h2>Cancelling a new agreement</h2>
  <p>You may cancel a service agreement for a full refund of any amount paid, provided no service has been performed, by notifying us in writing before midnight of the third business day after signing. Email <a href="mailto:${e(c.email)}">${e(c.email)}</a> or call ${e(c.phone)}.</p>
  <h2>Cancelling recurring service</h2>
  <p>Recurring charges are governed by our <a href="${ctx.base}/recurring-billing">Recurring Billing Terms</a>. You may stop recurring service at any time by contacting us. You will not be charged for treatments after your cancellation date. Treatments already performed are not refundable. If your agreement included an initial service discount and is cancelled before the end of its term, the discount is repayable as stated on the agreement.</p>
  <h2>Service problems</h2>
  <p>If you are not satisfied with a treatment, tell us within 30 days and we will re-treat at no charge. If we cannot resolve the problem, we will refund the charge for that treatment.</p>
  <h2>Billing errors and duplicate charges</h2>
  <p>Contact us with your invoice or receipt number. Confirmed errors and duplicate charges are refunded in full to the original payment method within 5–10 business days.</p>
  <h2>How refunds are issued</h2>
  <p>Refunds go back to the card or bank account that was charged. Same-day charges may be reversed instead of refunded. Refunds for payments made by check are issued by check.</p>
  <h2>Questions</h2>
  <p>${e(c.name)} · ${e(c.phone)} · <a href="mailto:${e(c.email)}">${e(c.email)}</a></p>
</div></section>`;
  return layout(ctx, { title: 'Refund & Cancellation Policy', description: `Refund and cancellation terms for ${c.name} services.`, path: '/refund-policy' }, body);
}

function recurringBilling(ctx: SiteContext) {
  const c = ctx.company;
  const body = `
<section><div class="wrap legal">
  <h1>Recurring Billing Terms</h1>
  <p class="sub">These terms apply to customers who sign a service agreement with ${e(c.name)} for regular pest control service.</p>
  <h2>What is billed</h2>
  <p>Your service agreement lists two prices: a one-time <b>initial service</b> charge, and a <b>regular service</b> charge billed each time we perform a scheduled treatment. Both amounts, and the service frequency you selected (weekly, every two weeks, monthly, or every two months), are printed on the agreement together with a schedule of the charges across the ${TERM_MONTHS}-month term. Published starting prices are on our <a href="${ctx.base}/#pricing">price sheet</a>.</p>
  <h2>When you are charged</h2>
  <p>The initial service charge is due when the initial treatment is completed. Each regular service charge is due when that treatment is completed; it is never charged in advance. If a visit is skipped or cancelled, you are not charged for it. Prices do not change during the term of your agreement.</p>
  <h2>How you authorize recurring charges</h2>
  <p>By signing the agreement and saving a card or bank account through our secure payment form, or by signing the ACH authorization, you authorize ${e(c.name)} to charge that payment method for the amounts due under your agreement after each completed service. You will receive an itemized service notification and receipt by email for every charge. Card and bank details are entered only in our payment processor's secure form and are never stored on our systems.</p>
  <h2>How to cancel</h2>
  <p>You may cancel recurring service at any time by calling ${e(c.phone)} or emailing <a href="mailto:${e(c.email)}">${e(c.email)}</a>. Cancellation takes effect immediately for future visits; you will not be charged for treatments after your cancellation date. Treatments already performed are not refundable. If your agreement included an initial service discount and is cancelled before the end of its term, that discount is repayable as stated on the agreement. You may also cancel a new agreement in full within three business days of signing as described in our <a href="${ctx.base}/refund-policy">Refund &amp; Cancellation Policy</a>.</p>
  <h2>Declined or failed payments</h2>
  <p>If a recurring charge is declined, we will notify you by email and may retry the charge or ask you for another payment method. Service may be paused until the balance is paid.</p>
  <h2>Changes to these terms</h2>
  <p>We will notify you by email at least 30 days before any change to these terms or to your recurring price takes effect.</p>
  <h2>Contact</h2>
  <p>${e(c.name)}${c.addressLines.length ? ` · ${e(c.addressLines.join(', '))}` : ''} · ${e(c.phone)} · <a href="mailto:${e(c.email)}">${e(c.email)}</a></p>
</div></section>`;
  return layout(ctx, { title: 'Recurring Billing Terms', description: `How ${c.name} bills recurring pest control service and how to cancel.`, path: '/recurring-billing' }, body);
}

export const SITE_PAGES: SitePage[] = [
  { path: '/', title: 'Home', description: 'Pest control in South Florida', render: home },
  { path: '/contact', title: 'Contact', description: 'Contact us', render: contact },
  { path: '/privacy', title: 'Privacy Policy', description: 'Privacy policy', render: privacy },
  { path: '/terms', title: 'Terms of Service', description: 'Terms of service', render: terms },
  { path: '/refund-policy', title: 'Refund & Cancellation Policy', description: 'Refund policy', render: refunds },
  { path: '/recurring-billing', title: 'Recurring Billing Terms', description: 'Recurring billing terms', render: recurringBilling },
];

export function renderSitemap(origin: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${SITE_PAGES.map((p) => `<url><loc>${origin}${p.path}</loc></url>`).join('')}</urlset>`;
}
