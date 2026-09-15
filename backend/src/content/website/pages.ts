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
  { href: '/app/customer-portal', label: 'Customer Portal' },
];

const CSS = `
:root{--teal:#2DC4A2;--teal-dark:#1E9C81;--teal-soft:#E8F6F2;--ink:#0D0D0D;--ink-2:#1B2624;--muted:#5B6B68;--bg:#F6FBF9;--card:#fff;--line:#DCE8E4;--radius:18px;--shadow:0 14px 40px rgba(13,13,13,.08)}
*{box-sizing:border-box}html{scroll-behavior:smooth}html,body{overflow-x:hidden}img{max-width:100%;display:block}.grid>*{min-width:0}
body{margin:0;font:16px/1.6 "Manrope",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--teal-dark)}h1,h2,h3,h4{line-height:1.12;letter-spacing:-.01em;margin:0}
.wrap{max-width:1160px;margin:0 auto;padding:0 24px}
.kicker{text-transform:uppercase;letter-spacing:.28em;font-size:12px;font-weight:800;color:var(--teal-dark);margin:0 0 12px}
h2{font-size:38px;font-weight:800}.sub{color:var(--muted);font-size:18px;max-width:680px;margin:12px 0 0}
section{padding:80px 0}.sec-head{margin-bottom:36px}.sec-head.center{text-align:center}.sec-head.center .sub{margin-left:auto;margin-right:auto}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--teal);color:var(--ink);font-weight:800;padding:15px 24px;border-radius:14px;text-decoration:none;border:2px solid var(--teal);font-size:16px;line-height:1;transition:transform .12s,box-shadow .12s}.btn:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(45,196,162,.35)}
.btn.dark{background:var(--ink);border-color:var(--ink);color:#fff}.btn.ghost{background:transparent;border-color:#fff;color:#fff}.btn.outline{background:#fff;border-color:var(--line);color:var(--ink)}.btn.sm{padding:11px 16px;font-size:14px}
/* header */
header{position:sticky;top:0;z-index:50;background:rgba(13,13,13,.92);backdrop-filter:blur(10px);color:#fff;border-bottom:1px solid rgba(255,255,255,.06)}header .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px 20px;padding-top:12px;padding-bottom:12px;flex-wrap:wrap;max-width:1240px}
.brand{display:flex;align-items:center;gap:12px;color:#fff;text-decoration:none;font-weight:800;font-size:17px;flex:none;letter-spacing:-.01em}.brand img{width:42px;height:42px;flex:none;border-radius:10px}.brand small{display:block;font-size:10px;letter-spacing:.3em;color:var(--teal);font-weight:800}
nav{display:flex;flex-wrap:wrap;align-items:center;gap:6px 22px;margin-left:auto}nav a{color:#DDEBE7;text-decoration:none;font-weight:700;font-size:14px;white-space:nowrap;padding:4px 0}nav a:hover{color:#fff}
nav .actions{display:flex;align-items:center;gap:10px;margin-left:8px}nav a.cta,nav a.staff{display:inline-flex;align-items:center;height:40px;padding:0 18px;border-radius:999px;font-weight:800;font-size:14px;line-height:1}nav a.cta{background:var(--teal);color:var(--ink)}nav a.staff{border:2px solid rgba(255,255,255,.25);color:#fff}
@media(min-width:1100px){header .wrap{flex-wrap:nowrap}nav{flex-wrap:nowrap}}
/* hero */
.hero{position:relative;background:var(--ink) center 40%/cover no-repeat;color:#fff;padding:96px 0 88px;isolation:isolate;overflow:hidden}.hero:before{content:"";position:absolute;inset:0;background:linear-gradient(100deg,rgba(13,13,13,.92) 0%,rgba(13,13,13,.72) 45%,rgba(13,13,13,.35) 100%);z-index:-1}
.hero .wrap{display:grid;grid-template-columns:1.15fr .85fr;gap:48px;align-items:center}
.hero .kicker{color:var(--teal)}.hero h1{font-size:58px;font-weight:800;letter-spacing:-.02em;margin:0 0 18px}.hero h1 em{font-style:normal;color:var(--teal)}.hero p.lead{font-size:19px;color:#CFE8E1;max-width:560px;margin:0 0 28px}
.hero .cta-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}.hero .proof{display:flex;flex-wrap:wrap;gap:18px 28px;margin-top:34px;color:#B9D6CF;font-size:14px;font-weight:700}.hero .proof span:before{content:"✓";display:inline-block;margin-right:8px;color:var(--teal);font-weight:900}
.quick{background:#fff;color:var(--ink);border-radius:22px;padding:26px;box-shadow:0 30px 80px rgba(0,0,0,.45)}.quick h3{font-size:22px;margin:0 0 4px}.quick p{margin:0 0 14px;color:var(--muted);font-size:14px}.quick label{display:block;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:12px 0 5px}.quick input,.quick select{width:100%;border:1.5px solid var(--line);border-radius:12px;padding:12px 13px;font:15px inherit;background:#F8FCFB;color:var(--ink)}.quick button{margin-top:16px;width:100%;background:var(--teal);color:var(--ink);border:0;border-radius:14px;padding:15px;font:800 16px inherit;cursor:pointer}.quick .fine{font-size:12px;color:var(--muted);margin:10px 0 0}
/* trust strip */
.trust{background:var(--ink);color:#fff;border-top:1px solid rgba(255,255,255,.06);padding:22px 0}.trust .wrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:18px}.trust div{display:flex;gap:12px;align-items:center;font-size:14px;font-weight:700;color:#DDEBE7}.trust i{flex:none;width:38px;height:38px;border-radius:12px;background:rgba(45,196,162,.16);color:var(--teal);display:flex;align-items:center;justify-content:center;font-style:normal;font-size:18px}
/* cards */
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px}.card h3{font-size:20px;margin:0 0 8px}.card p{margin:0;color:var(--muted);font-size:15px;overflow-wrap:anywhere}
/* steps */
.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.step{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:28px;position:relative}.step .n{width:46px;height:46px;border-radius:14px;background:var(--ink);color:var(--teal);font-weight:900;font-size:20px;display:flex;align-items:center;justify-content:center;margin-bottom:18px}.step h3{font-size:22px;margin:0 0 8px}.step p{margin:0;color:var(--muted)}.step .when{display:inline-block;margin-top:14px;background:var(--teal-soft);color:var(--teal-dark);font-weight:800;font-size:12px;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:6px 12px}
.egg{display:grid;grid-template-columns:150px 1fr;gap:22px;align-items:center;background:var(--ink);color:#fff;border-radius:var(--radius);padding:28px;margin-top:24px}.egg .badge{text-align:center;background:#161F1D;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:14px 8px}.egg .badge b{display:block;font-size:44px;line-height:1;color:var(--teal)}.egg .badge small{display:block;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#B9D6CF;margin-top:6px}.egg p{margin:0;color:#CFE8E1}.egg h3{font-size:20px;margin:0 0 6px}
/* pests */
.pests{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr));gap:14px}.pest{background:#fff;border:1px solid var(--line);border-radius:var(--radius);min-width:0;transition:transform .15s,box-shadow .15s}.pest:hover{transform:translateY(-2px);box-shadow:var(--shadow)}.pest summary{list-style:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;padding:22px 12px 18px;text-align:center}.pest summary::-webkit-details-marker{display:none}.pest summary img{width:110px;height:110px;object-fit:contain;transition:transform .15s}.pest summary:hover img{transform:scale(1.06)}.pest summary b{font-size:15px;margin-top:12px;color:var(--ink)}.pest summary .more{font-size:12px;color:var(--teal-dark);font-weight:800;margin-top:4px}.pest[open]{grid-column:1/-1;border-color:var(--teal)}.pest[open] summary{flex-direction:row;gap:18px;text-align:left;padding:20px 24px}.pest[open] summary img{width:80px;height:80px}.pest[open] summary b{font-size:20px;margin:0}.pest .detail{padding:0 24px 24px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:18px}.pest .detail>*{min-width:0}.pest .detail h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.25em;color:var(--teal-dark)}.pest .detail p,.pest .detail li{margin:0;font-size:14px;color:#30433F}.pest .detail ul{margin:0;padding-left:16px}.tag{display:inline-block;font-size:10px;background:var(--teal-soft);color:var(--teal-dark);border-radius:999px;padding:2px 8px;margin:6px 0 0;font-weight:800;white-space:nowrap}
/* hotspots */
.hot{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.hot .card{padding:0;overflow:hidden;display:flex;flex-direction:column}.hot .top{background:var(--ink);padding:26px;display:flex;align-items:center;gap:16px}.hot .top img{width:74px;height:74px;object-fit:contain}.hot .top .kicker{color:var(--teal);margin:0 0 4px;font-size:10px;letter-spacing:.18em}.hot .top h3{color:#fff;font-size:20px;margin:0}.hot .body{padding:22px 26px 26px}.hot ol{margin:14px 0 0;padding-left:20px}.hot li{margin-bottom:8px;color:#30433F;font-size:15px}.hot li b{color:var(--ink)}.badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.badges span{background:var(--teal-soft);color:var(--teal-dark);border-radius:999px;padding:5px 11px;font-size:12px;font-weight:800}
/* truck / area */
.area{background:#fff}.area .wrap{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}.area img{border-radius:var(--radius);box-shadow:var(--shadow);width:100%}.area ul.counties{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:10px}.area ul.counties li{display:flex;gap:12px;align-items:center;font-weight:700}.area ul.counties li:before{content:"";width:10px;height:10px;border-radius:50%;background:var(--teal);flex:none}.cities{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.cities span{border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;color:var(--ink-2)}
/* plans */
.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:stretch}.plan{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:30px;display:flex;flex-direction:column;position:relative}.plan.hi{background:var(--ink);color:#fff;border-color:var(--ink)}.plan.hi .muted,.plan.hi p{color:#B9D6CF}.plan .flag{position:absolute;top:-14px;left:26px;background:var(--teal);color:var(--ink);font-size:11px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;border-radius:999px;padding:6px 12px}.plan h3{font-size:22px;margin:0 0 6px}.plan .price{font-size:40px;font-weight:800;letter-spacing:-.02em;margin:14px 0 2px}.plan .price small{font-size:15px;font-weight:700;color:var(--muted)}.plan.hi .price small{color:#B9D6CF}.plan .init{font-size:14px;color:var(--muted);margin-bottom:18px}.plan ul{list-style:none;padding:0;margin:0 0 22px;display:grid;gap:9px}.plan li{display:flex;gap:10px;font-size:15px}.plan li:before{content:"✓";color:var(--teal);font-weight:900;flex:none}.plan .btn{margin-top:auto}
details.sheet{background:#fff;border:1px solid var(--line);border-radius:var(--radius);margin-top:28px}details.sheet summary{cursor:pointer;padding:20px 26px;font-weight:800;font-size:17px;list-style:none;display:flex;justify-content:space-between;align-items:center}details.sheet summary::-webkit-details-marker{display:none}details.sheet summary:after{content:"+";font-size:26px;color:var(--teal-dark)}details.sheet[open] summary:after{content:"–"}details.sheet .inner{padding:0 26px 26px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}th,td{padding:11px 12px;text-align:left;border-bottom:1px solid var(--line);font-size:15px}th{background:var(--teal-soft);font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--teal-dark)}td.num,th.num{text-align:right;white-space:nowrap}
/* reviews */
.reviews{background:var(--ink);color:#fff}.reviews h2{color:#fff}.reviews .sub{color:#B9D6CF}.reviews .grid .card{background:#161F1D;border-color:rgba(255,255,255,.08);color:#fff}.reviews .card p{color:#DDEBE7;font-size:16px}.reviews .stars{color:#F5B301;letter-spacing:2px;margin-bottom:10px;font-size:18px}.reviews .who{margin-top:14px;font-size:13px;color:#B9D6CF;font-weight:700}
/* estimate */
.estimate{background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:28px;box-shadow:var(--shadow)}.estimate label{display:block;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:14px 0 5px}.estimate input,.estimate select,.estimate textarea{width:100%;border:1.5px solid var(--line);border-radius:12px;padding:12px 13px;font:15px inherit;background:#F8FCFB;color:var(--ink)}.estimate textarea{min-height:110px}.estimate button{margin-top:18px;width:100%;background:var(--teal);color:var(--ink);border:0;border-radius:14px;padding:15px;font:800 16px inherit;cursor:pointer}.notice{border-radius:12px;padding:12px 14px;margin-bottom:12px;font-weight:700}.notice.ok{background:var(--teal-soft);color:#0F5C4B}.notice.error{background:#FDECEC;color:#8A1C1C}
.legal{max-width:760px}.legal h1{font-size:36px;margin-bottom:8px}.legal h2{margin-top:32px;font-size:22px}.legal p,.legal li{color:#30433F}
/* cta band */
.band{background:linear-gradient(120deg,var(--teal) 0%,#1E9C81 100%);color:var(--ink);padding:56px 0}.band .wrap{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:20px}.band h2{font-size:32px}.band p{margin:6px 0 0;font-weight:600;color:#0F3A31}
footer{background:var(--ink);color:#B9C9C5;padding:56px 0 30px;font-size:14px}footer .cols{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:32px}footer .cols>div{min-width:0}footer a{color:#fff;text-decoration:none;overflow-wrap:anywhere}footer a:hover{color:var(--teal)}footer h4{color:#fff;margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.12em}footer .brand{margin-bottom:14px}footer .copy{border-top:1px solid rgba(255,255,255,.08);margin-top:36px;padding-top:20px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;font-size:13px;color:#8FA39E}
.note{background:#fff;border-left:4px solid var(--teal);padding:12px 14px;border-radius:8px;color:#30433F}
@media(max-width:960px){.hero .wrap{grid-template-columns:1fr}.hero h1{font-size:44px}.steps,.hot,.plans{grid-template-columns:1fr}.area .wrap{grid-template-columns:1fr}footer .cols{grid-template-columns:1fr 1fr}}
@media(max-width:640px){header .wrap{gap:10px}.brand{font-size:15px}nav{width:100%;gap:4px 14px;margin-left:0}nav a{font-size:14px}nav .actions{width:100%;margin:6px 0 0}nav a.cta,nav a.staff{flex:1;justify-content:center;height:42px}.hero{padding:56px 0 48px}.hero h1{font-size:36px}.hero p.lead{font-size:17px}section{padding:56px 0}h2{font-size:30px}.sub{font-size:16px}.egg{grid-template-columns:1fr}.pests{grid-template-columns:repeat(2,minmax(0,1fr))}.pest summary img{width:84px;height:84px}footer .cols{grid-template-columns:1fr}.band h2{font-size:26px}}
`;

function layout(ctx: SiteContext, page: { title: string; description: string; path: string }, body: string) {
  const c = ctx.company;
  const b = ctx.base;
  const tel = `tel:${e(c.phone.replace(/\D/g, ''))}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(page.title)} · ${e(c.name)}</title>
<meta name="description" content="${e(page.description)}">
<meta property="og:title" content="${e(page.title)} · ${e(c.name)}"><meta property="og:description" content="${e(page.description)}"><meta property="og:image" content="https://boxersolutionspestcontrol.com/assets/truck.jpg">
<link rel="icon" href="${b}/assets/logo-mark.png"><link rel="canonical" href="https://boxersolutionspestcontrol.com${page.path === '/' ? '/' : page.path}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body>
<header><div class="wrap">
  <a class="brand" href="${b}/"><img src="${b}/assets/logo-mark.png" alt=""><span>${e(c.name.replace(/ Pest Control$/i, ''))}<small>PEST CONTROL</small></span></a>
  <nav>${NAV.map((n) => `<a href="${n.href.startsWith('/app') ? n.href : b + n.href}">${e(n.label)}</a>`).join('')}<span class="actions"><a class="cta" href="${tel}">Call ${e(c.phone)}</a><a class="staff" href="/app/login">Staff Login</a></span></nav>
</div></header>
${body}
<footer><div class="wrap">
  <div class="cols">
    <div><a class="brand" href="${b}/"><img src="${b}/assets/logo-mark.png" alt=""><span>${e(c.name.replace(/ Pest Control$/i, ''))}<small>PEST CONTROL</small></span></a>${c.addressLines.map((l) => `<div>${e(l)}</div>`).join('')}<div>${e(c.license)}</div><div style="margin-top:12px">Mon–Fri 8am–6pm · Sat 9am–2pm</div></div>
    <div><h4>Services</h4><div><a href="${b}/#plans">Standard Four Point Service</a></div><div><a href="${b}/#plans">All Yard Ants</a></div><div><a href="${b}/#pests">Pest programs</a></div><div><a href="${b}/#pricing">Pricing</a></div><div><a href="${b}/#estimate">Free estimate</a></div></div>
    <div><h4>Customers</h4><div><a href="/app/customer-portal">Customer Portal</a></div><div><a href="/app/request-service-public">Request Service</a></div><div><a href="${tel}">${e(c.phone)}</a></div><div><a href="mailto:${e(c.email)}">${e(c.email)}</a></div><div><a href="${b}/contact">Contact Us</a></div></div>
    <div><h4>Policies</h4><div><a href="${b}/privacy">Privacy Policy</a></div><div><a href="${b}/terms">Terms of Service</a></div><div><a href="${b}/refund-policy">Refund &amp; Cancellation</a></div><div><a href="${b}/recurring-billing">Recurring Billing Terms</a></div><div><a href="/app/login">Staff Login</a></div></div>
  </div>
  <div class="copy"><span>© ${ctx.year} ${e(c.name)}. All rights reserved.</span><span>Visa · Mastercard · Amex · Discover · Bank (ACH). Card details are entered only in our payment processor's secure form and never stored on our systems.</span></div>
</div></footer>
</body></html>`;
}

function home(ctx: SiteContext) {
  const c = ctx.company;
  const b = ctx.base;
  const tel = `tel:${e(c.phone.replace(/\D/g, ''))}`;
  const f = ctx.form ?? {};
  const v = (k: string) => e(f[k] ?? '');
  const town = HOME_SIZES[0];
  const yard = YARD_ANT_TIERS[0];
  const body = `
<section class="hero" style="background-image:url('${b}/assets/hero-miami.jpg?v=2')"><div class="wrap">
  <div>
    <p class="kicker">Miami-Dade · Broward · Palm Beach</p>
    <h1>Pest control that <em>actually sticks.</em></h1>
    <p class="lead">${e(c.name)} starts every home with an initial flush-out, comes back in 30 days to break the egg cycle, then keeps you protected on the schedule you choose. Licensed, insured, and local to Miami Gardens.</p>
    <div class="cta-row"><a class="btn" href="${b}/#estimate">Get a free estimate</a><a class="btn ghost" href="${tel}">Call ${e(c.phone)}</a></div>
    <div class="proof"><span>Free re-treats between visits</span><span>Same-week scheduling</span><span>Pet &amp; kid conscious products</span></div>
  </div>
  <form class="quick" method="post" action="${b}/estimate">
    <h3>Request service</h3><p>Tell us what you're seeing. We'll call you back today.</p>
    ${ctx.notice ? `<div class="notice ${ctx.notice.kind}">${e(ctx.notice.text)}</div>` : ''}
    <input type="text" name="company" value="" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
    <label for="q-name">Name</label><input id="q-name" name="name" required maxlength="100" value="${v('name')}" placeholder="Your name">
    <label for="q-phone">Phone</label><input id="q-phone" name="phone" type="tel" required maxlength="30" value="${v('phone')}" placeholder="(305) 555-0100">
    <label for="q-address">Service address</label><input id="q-address" name="address" maxlength="200" value="${v('address')}" placeholder="Street, city">
    <label for="q-pest">What are you seeing?</label><select id="q-pest" name="pest">${PEST_CHOICES.map((p) => `<option${(f.pest ?? '') === p ? ' selected' : ''}>${e(p)}</option>`).join('')}</select>
    <button type="submit">Request my free estimate</button>
    <p class="fine">No obligation. By submitting you agree to be contacted about your request.</p>
  </form>
</div></section>

<div class="trust"><div class="wrap">
  <div><i>✔</i>Licensed &amp; insured in Florida</div>
  <div><i>⌂</i>Locally owned · Miami Gardens</div>
  <div><i>↻</i>Free re-treatment between visits</div>
  <div><i>⚡</i>Same-week initial service</div>
  <div><i>▣</i>Secure card &amp; bank payments</div>
</div></div>

<section id="how"><div class="wrap">
  <div class="sec-head center"><p class="kicker">How it works</p><h2>Three visits in, the problem is gone. Then we keep it that way.</h2><p class="sub">Most companies spray once and leave. Our program is built around the pest life cycle, so it holds.</p></div>
  <div class="steps">
    <div class="step"><div class="n">1</div><h3>Initial flush-out</h3><p>A heavy first treatment inside and out: foundation, entry points, eaves, yard perimeter, kitchens and baths. It knocks down the existing population.</p><span class="when">Day 1</span></div>
    <div class="step"><div class="n">2</div><h3>Egg-cycle follow-up</h3><p>Insects are immune inside their eggs. We come back 30 days later so the product is active exactly when the next generation hatches.</p><span class="when">Day 30</span></div>
    <div class="step"><div class="n">3</div><h3>Regular protection</h3><p>Weekly, every two weeks, monthly, every two or three months. Your choice. If covered pests show up between visits, we re-treat free.</p><span class="when">Your schedule</span></div>
  </div>
  <div class="egg"><div class="badge"><b>30</b><small>Day follow-up</small></div><div><h3>Why the follow-up matters</h3><p>You may see a little more activity right after the first visit as colonies are disrupted. Within a few weeks it drops sharply, and with regular service it keeps falling. See more than the occasional pest? Call ${e(c.phone)} for a complimentary re-treat.</p></div></div>
</div></section>

<section id="plans" style="background:#fff"><div class="wrap">
  <div class="sec-head center"><p class="kicker">Plans</p><h2>Straightforward plans, published prices.</h2><p class="sub">Every plan is a ${TERM_MONTHS}-month agreement you sign on your technician's phone, with every price and every visit date printed on it.</p></div>
  <div class="plans">
    <div class="plan hi"><span class="flag">Most popular</span><h3>Standard Four Point Service</h3><p class="muted">Interior and exterior protection for the whole home, priced by size.</p><div class="price">${money(town.regular)}<small>/visit from</small></div><div class="init">Initial flush-out from ${money(town.initial)}</div><ul>${STANDARD_PESTS.map((p) => `<li>${e(p)}</li>`).join('')}</ul><a class="btn" href="${b}/#estimate">Start with a free estimate</a></div>
    <div class="plan"><h3>All Yard Ants</h3><p class="muted">Whole-yard treatment for fire ants, carpenter ants and other yard ants, priced by lot size.</p><div class="price">${money(yard.regular)}<small>/visit from</small></div><div class="init">Initial treatment from ${money(yard.initial)}</div><ul><li>Fire ants</li><li>Carpenter ants</li><li>All other yard ants</li><li>Add to any Four Point plan</li></ul><a class="btn outline" href="${b}/#estimate">Get a quote</a></div>
    <div class="plan"><h3>Add-ons &amp; single-pest jobs</h3><p class="muted">Bolt on to your plan, or book a one-time targeted treatment.</p><div class="price">${money(ADDONS[0].addRegular)}<small>/visit add-on</small></div><div class="init">Outdoor pet protection (fleas &amp; ticks)</div><ul><li>Black widow / brown recluse</li><li>Spider web removal &amp; prevention</li>${ODD_JOBS.map((o) => `<li>${e(o.label)} · ${money(o.total)}</li>`).join('')}</ul><a class="btn outline" href="${b}/#pricing">See all prices</a></div>
  </div>
</div></section>

<section id="pests"><div class="wrap">
  <div class="sec-head"><p class="kicker">What we handle</p><h2>South Florida pest programs.</h2><p class="sub">Tap a pest to see the signs, why it matters here, and how we treat it.</p></div>
  <div class="pests">
    ${PEST_PROGRAMS.map((p) => `
    <details class="pest" id="pest-${p.slug}">
      <summary><img src="${b}/assets/pests/${p.img}" alt=""><b>${e(p.short)}</b>${p.southFloridaOnly ? '<span class="tag">South Florida</span>' : ''}<span class="more">Details</span></summary>
      <div class="detail">
        <div><h4>What it is</h4><p>${e(p.about)}</p></div>
        <div><h4>Signs you have them</h4><ul>${p.signs.map((sg) => `<li>${e(sg)}</li>`).join('')}</ul></div>
        <div><h4>Why it matters</h4><p>${e(p.risk)}</p></div>
        <div><h4>Our approach</h4><p>${e(p.approach)}</p></div>
      </div>
    </details>`).join('')}
  </div>
</div></section>

<section class="area"><div class="wrap">
  <div>
    <p class="kicker">Service area</p><h2>From the 305 to the 561.</h2>
    <p class="sub">South Beach high-rises, Brickell condos, Fort Lauderdale canals, Boca estates, Palm Beach pools. Our program is built around humidity, ocean air and the pests that thrive in both.</p>
    <ul class="counties"><li>Miami-Dade County</li><li>Broward County</li><li>Palm Beach County</li></ul>
    <div class="cities">${SERVICE_CITIES.map((city) => `<span>${e(city)}</span>`).join('')}</div>
    <p style="margin-top:22px"><a class="btn" href="${b}/#estimate">Check your address</a></p>
  </div>
  <img src="${b}/assets/truck.jpg" alt="${e(c.name)} service truck">
</div></section>

<section id="hotspots" style="background:#fff"><div class="wrap">
  <div class="sec-head"><p class="kicker">This season</p><h2>The three calls we get most.</h2><p class="sub">And exactly how we handle each one.</p></div>
  <div class="hot">
    ${FEATURED_PROGRAMS.map((fp) => `
    <div class="card">
      <div class="top"><img src="${b}/assets/pests/${fp.img}" alt="" loading="lazy"><div><p class="kicker">${e(fp.kicker)}</p><h3>${e(fp.headline)}</h3></div></div>
      <div class="body"><p>${e(fp.body)}</p><ol>${fp.steps.map((st) => `<li><b>${e(st.label)}.</b> ${e(st.body)}</li>`).join('')}</ol><div class="badges">${fp.badges.map((bd) => `<span>${e(bd)}</span>`).join('')}</div></div>
    </div>`).join('')}
  </div>
</div></section>

<section id="pricing"><div class="wrap">
  <div class="sec-head"><p class="kicker">Price sheet</p><h2>No surprises.</h2><p class="sub">Initial service is a one-time charge at the first visit. Regular service is charged per treatment at your chosen frequency. Prices are before any applicable tax.</p></div>
  <div class="grid" style="align-items:start">
    <div><h3 style="margin-bottom:10px">Standard Four Point Service</h3><table><tr><th>Home size</th><th class="num">Initial</th><th class="num">Regular</th></tr>${HOME_SIZES.map((t) => `<tr><td>${e(t.label)}</td><td class="num">${money(t.initial)}</td><td class="num">${money(t.regular)}</td></tr>`).join('')}</table></div>
    <div><h3 style="margin-bottom:10px">All Yard Ants</h3><table><tr><th>Lot size</th><th class="num">Initial</th><th class="num">Regular</th></tr>${YARD_ANT_TIERS.map((t) => `<tr><td>${e(t.label)}</td><td class="num">${money(t.initial)}</td><td class="num">${money(t.regular)}</td></tr>`).join('')}</table>
      <h3 style="margin:22px 0 10px">Add-ons (per regular service)</h3><table>${ADDONS.map((a) => `<tr><td>${e(a.label)}</td><td class="num">+${money(a.addRegular)}</td></tr>`).join('')}<tr><td>Web removal &amp; prevention</td><td class="num">$${WEB_REMOVAL.perSqft.toFixed(2)}/sq ft · ${money(WEB_REMOVAL.minimum)} min</td></tr></table>
      <h3 style="margin:22px 0 10px">Single-pest treatments</h3><table>${ODD_JOBS.map((o) => `<tr><td>${e(o.label)} <span style="color:var(--muted)">· ${o.treatments} treatment${o.treatments > 1 ? 's' : ''}</span></td><td class="num">${money(o.total)}</td></tr>`).join('')}</table></div>
  </div>
  <p class="note" style="margin-top:22px">Pay by card or bank account in our secure app or through an emailed payment link. ${c.cardSurchargePercent > 0 ? `Credit card payments carry a ${e(String(c.cardSurchargePercent))}% processing surcharge; bank, cash and check payments have none.` : ''} Card details are entered only in our payment processor's secure form and never stored on ${e(c.name)} systems.</p>
</div></section>

${REVIEWS.length ? `
<section class="reviews"><div class="wrap">
  <div class="sec-head center"><p class="kicker">Reviews</p><h2>What neighbors say.</h2></div>
  <div class="grid">${REVIEWS.map((r) => `<div class="card"><div class="stars">★★★★★</div><p>“${e(r.text)}”</p><div class="who">${e(r.name)} · ${e(r.city)}</div></div>`).join('')}</div>
</div></section>` : ''}

<div class="band"><div class="wrap">
  <div><h2>Ready when you are.</h2><p>Same-week initial service across Miami-Dade, Broward and Palm Beach.</p></div>
  <div style="display:flex;gap:12px;flex-wrap:wrap"><a class="btn dark" href="${b}/#estimate">Get a free estimate</a><a class="btn outline" href="${tel}">Call ${e(c.phone)}</a></div>
</div></div>

${estimateSection(ctx)}`;
  return layout(ctx, { title: 'Pest Control in South Florida', description: `${c.name}: licensed residential and commercial pest control with an initial flush-out, a 30-day follow-up and year-round protection plans.`, path: '/' }, body);
}

/** Customer reviews shown on the home page. Add real ones here; the section stays hidden while empty. */
const REVIEWS: { name: string; city: string; text: string }[] = [];

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
  <h2>Card processing surcharge</h2>
  <p>${c.cardSurchargePercent > 0 ? `A ${e(String(c.cardSurchargePercent))}% surcharge is added to payments made by credit card to offset processing costs. It is shown before you pay and on your receipt. There is no surcharge for bank (ACH), cash or check payments.` : 'We do not add a surcharge to card payments.'}</p>
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
  <h2>Card surcharge</h2>
  <p>${c.cardSurchargePercent > 0 ? `Payments made by credit card carry a ${e(String(c.cardSurchargePercent))}% processing surcharge, itemized on each receipt. Paying by bank account (ACH) avoids the surcharge.` : 'No surcharge applies to card payments.'}</p>
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
