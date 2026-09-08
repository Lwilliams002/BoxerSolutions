/**
 * North certification samples.
 *
 * Runs one fresh transaction of every orig_auth_guid-based type against the
 * stored (BRIC) payment methods of the most recently used customer, then
 * assembles the raw request/response blocks from the certification log into a
 * single text file for North's certification team.
 *
 *   npx tsx src/scripts/northCertSamples.ts [--customer <uuid>] [--card <id prefix>] [--bank <id prefix>] [--out <file>] [--assemble-only]
 *
 * Every request is built by epxPayloads.ts and contains only the token
 * (orig_auth_guid), amount, payment_method, references, and cardholder name /
 * address (plus account_type for ACH). No card or bank account numbers.
 */
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';
import { config } from '../config';
import { epxEmbeddedPaymentsService } from '../services/epxEmbeddedPaymentsService';
import { EpxAccountType } from '../services/epx/epxPayloads';

type Method = {
  id: string; customer_id: string; deleted_at: Date | null; provider_payment_method_id: string; method_type: 'card' | 'bank_account';
  bank_account_type: EpxAccountType | null; brand: string | null; last4: string | null;
  first_name: string; last_name: string; address: string | null; city: string | null; state: string | null; zip: string | null;
};

const SAMPLE_LABELS: { label: string; title: string }[] = [
  { label: 'Embedded Checkout — STORAGE session create', title: 'Storage (STORAGE session create)' },
  { label: 'Embedded Checkout — session status', title: 'Storage result (session status → auth_guid / BRIC)' },
  { label: 'Embedded Checkout Payments — TOKEN SALE (CIT) [credit]', title: 'Token Credit Sale (customer-initiated)' },
  { label: 'Embedded Checkout Payments — TOKEN SALE (MIT) [credit]', title: 'Token Credit Sale (merchant-initiated, aci_ext=RB)' },
  { label: 'Embedded Checkout Payments — TOKEN SALE (CIT) [ach]', title: 'Token ACH Sale' },
  { label: 'Embedded Checkout Payments — REFUND [credit]', title: 'Credit Refund' },
  { label: 'Embedded Checkout Payments — REFUND [ach]', title: 'ACH Refund' },
  { label: 'Embedded Checkout Payments — REVERSAL [credit]', title: 'Reversal (credit)' },
  { label: 'Embedded Checkout Payments — VOID [ach]', title: 'Void (ACH)' },
];

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadMethods(customerId?: string, cardId?: string, bankId?: string): Promise<{ card: Method; bank: Method }> {
  const { rows } = await pool.query<Method>(
    `SELECT pm.id, pm.customer_id, pm.deleted_at, pm.provider_payment_method_id, pm.method_type, pm.bank_account_type, pm.brand, pm.last4,
            c.first_name, c.last_name, c.billing_address_line1 AS address, c.billing_city AS city, c.billing_state AS state, c.billing_postal_code AS zip
     FROM payment_methods pm JOIN customers c ON c.id = pm.customer_id
     WHERE pm.payment_provider IN ('north','north_embedded')
       ${customerId ? 'AND pm.customer_id = $1' : ''}
     ORDER BY (pm.deleted_at IS NULL) DESC, pm.created_at DESC`,
    customerId ? [customerId] : [],
  );
  const byId = (id: string | undefined, type: Method['method_type']) => (id ? rows.find((r) => r.method_type === type && r.id.startsWith(id)) : undefined);
  const card = byId(cardId, 'card') ?? rows.find((r) => r.method_type === 'card');
  const bank = byId(bankId, 'bank_account')
    ?? rows.find((r) => r.method_type === 'bank_account' && (!card || r.customer_id === card.customer_id))
    ?? rows.find((r) => r.method_type === 'bank_account');
  // Tokens (BRICs) stay valid at North after a method is removed in the app, so a
  // removed method is still fine for sandbox certification runs.
  for (const m of [card, bank]) if (m?.deleted_at) console.warn(`Note: using a ${m.method_type} that was removed in the app on ${m.deleted_at.toISOString().slice(0, 10)}; its North token is still valid.`);
  if (!card || !bank) throw new Error(`Need one stored card and one stored bank account (found card=${!!card}, bank=${!!bank}). Store them through the app first.`);
  return { card, bank };
}

function customerOf(m: Method) {
  return { firstName: m.first_name, lastName: m.last_name, address: m.address, city: m.city, state: m.state, zipCode: m.zip };
}

async function run() {
  if (!epxEmbeddedPaymentsService.isConfigured()) throw new Error('North Embedded Checkout credentials are not configured.');
  const { card, bank } = await loadMethods(arg('customer'), arg('card'), arg('bank'));
  console.log(`Card ${card.brand ?? ''} ••••${card.last4 ?? ''}  Bank ••••${bank.last4 ?? ''} (${bank.bank_account_type ?? 'checking'})  customer ${card.first_name} ${card.last_name}`);
  const inv = (n: number) => `CERT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${n}`;
  const results: Record<string, unknown> = {};

  // 1. Token credit sale (CIT) → credit refund
  const creditSale = await epxEmbeddedPaymentsService.tokenSale({ authGuid: card.provider_payment_method_id, amount: 21.5, paymentMethod: 'credit', mit: false, customer: customerOf(card), invoiceNumber: inv(1) });
  results.creditSale = creditSale;
  if (!creditSale.approved || !creditSale.authGuid) throw new Error(`Credit token sale declined: ${JSON.stringify(creditSale)}`);
  results.creditRefund = await epxEmbeddedPaymentsService.refund({ authGuid: creditSale.authGuid, amount: 21.5, paymentMethod: 'credit' });

  // 2. Token credit sale (MIT / recurring) → reversal
  const mitSale = await epxEmbeddedPaymentsService.tokenSale({ authGuid: card.provider_payment_method_id, amount: 22.75, paymentMethod: 'credit', mit: true, customer: customerOf(card), invoiceNumber: inv(2) });
  results.mitSale = mitSale;
  if (!mitSale.approved || !mitSale.authGuid) throw new Error(`Credit MIT token sale declined: ${JSON.stringify(mitSale)}`);
  results.reversal = await epxEmbeddedPaymentsService.reversal({ authGuid: mitSale.authGuid });

  // 3. Token ACH sale → ACH refund
  const achType = bank.bank_account_type ?? 'checking';
  const achSale = await epxEmbeddedPaymentsService.tokenSale({ authGuid: bank.provider_payment_method_id, amount: 23.25, paymentMethod: 'ach', mit: false, accountType: achType, customer: customerOf(bank), invoiceNumber: inv(3) });
  results.achSale = achSale;
  if (!achSale.approved || !achSale.authGuid) throw new Error(`ACH token sale declined: ${JSON.stringify(achSale)}`);
  results.achRefund = await epxEmbeddedPaymentsService.refund({ authGuid: achSale.authGuid, amount: 23.25, paymentMethod: 'ach', accountType: achType });

  // 4. Token ACH sale → void
  const achSale2 = await epxEmbeddedPaymentsService.tokenSale({ authGuid: bank.provider_payment_method_id, amount: 24, paymentMethod: 'ach', mit: false, accountType: achType, customer: customerOf(bank), invoiceNumber: inv(4) });
  results.achSale2 = achSale2;
  if (!achSale2.approved || !achSale2.authGuid) throw new Error(`ACH token sale (2) declined: ${JSON.stringify(achSale2)}`);
  results.achVoid = await epxEmbeddedPaymentsService.voidTransaction({ authGuid: achSale2.authGuid, paymentMethod: 'ach', accountType: achType });

  for (const [k, v] of Object.entries(results)) {
    const r = v as { approved?: boolean; responseCode?: string | null; responseText?: string | null; authGuid?: string | null };
    console.log(`${k.padEnd(13)} approved=${r.approved} resp=${r.responseCode ?? ''} ${r.responseText ?? ''} guid=${r.authGuid ?? ''}`);
  }
  return results;
}

/** Split the cert log into blocks and tag each with its label plus the payment_method in the request body. */
function readBlocks(logPath: string) {
  const text = fs.readFileSync(logPath, 'utf8');
  return text.split(/^=+\n/m).map((b) => b.trim()).filter(Boolean).map((block) => {
    const header = block.split('\n')[0] ?? '';
    const m = header.match(/^\[([^\]]+)\] (.+)$/);
    const [request = '', response = ''] = block.split('--- RESPONSE ---');
    const pm = request.match(/"payment_method":\s*"(credit|ach)"/)?.[1];
    const approved = /"auth_resp":\s*"00"/.test(response) || /HTTP 2\d\d/.test(response) && !/"auth_resp"/.test(response);
    return { at: m?.[1] ?? '', label: `${m?.[2] ?? header}${pm ? ` [${pm}]` : ''}`, block, approved };
  });
}

function assemble(outPath: string, since: string) {
  const logPath = path.isAbsolute(config.north.certLogPath) ? config.north.certLogPath : path.resolve(process.cwd(), config.north.certLogPath);
  const blocks = readBlocks(logPath);
  const sections: string[] = [];
  const missing: string[] = [];
  for (const { label, title } of SAMPLE_LABELS) {
    const matching = blocks.filter((b) => b.label === label);
    const fresh = matching.filter((b) => b.at >= since && b.approved);
    const pick = (fresh.length ? fresh : matching.filter((b) => b.approved)).slice(-1)[0] ?? matching.slice(-1)[0];
    if (!pick) { missing.push(title); continue; }
    sections.push(`\n${'#'.repeat(80)}\n# ${title}\n${'#'.repeat(80)}\n${pick.block}\n`);
  }
  const cover = [
    'NORTH EMBEDDED CHECKOUT (FIELDS) — CERTIFICATION SAMPLES',
    `Merchant: Boxer Solutions Pest Control    Generated: ${new Date().toISOString()}`,
    `CheckoutId: ${config.north.embeddedCheckoutId ?? ''}    ProfileId: ${config.north.embeddedProfileId ?? ''}`,
    '',
    'Integration summary',
    '  • Card and bank entry happen only inside North Embedded Checkout Fields (STORAGE session).',
    '  • Our server reads the session status and stores only the returned auth_guid (BRIC), brand and last four.',
    '  • Every sale, refund, reversal and void is sent to checkout.north.com/api/payments/* with orig_auth_guid.',
    '  • Request bodies never contain account_nbr, routing_nbr, exp_date or cvv2. account_type (checking|savings)',
    '    is sent for ACH as required. Recurring (merchant-initiated) sales add aci_ext=RB.',
    '  • Secrets (Authorization, session tokens) are redacted below. Values in the RESPONSE blocks are North\'s own',
    '    echo of the processed transaction (auth_masked_account_nbr, routing_nbr) and are masked by our logger; they',
    '    are never persisted.',
    '',
    'Contents',
    ...SAMPLE_LABELS.map((s, i) => `  ${i + 1}. ${s.title}`),
    ...(missing.length ? ['', `Not available in the log: ${missing.join(', ')}`] : []),
    '',
  ].join('\n');
  fs.writeFileSync(outPath, `${cover}${sections.join('')}`);
  return { outPath, missing, sections: sections.length };
}

async function main() {
  const since = new Date().toISOString();
  const outPath = arg('out') ?? path.resolve(process.cwd(), `logs/north-cert-samples-${since.slice(0, 10)}.txt`);
  if (process.argv.includes('--assemble-only')) {
    // Build the file from the approved transactions already in the log.
    await pool.end().catch(() => undefined);
  } else {
    try {
      await run();
    } finally {
      await pool.end().catch(() => undefined);
    }
  }
  const summary = assemble(outPath, since);
  console.log(`\nWrote ${summary.sections} sections to ${summary.outPath}${summary.missing.length ? `; missing: ${summary.missing.join(', ')}` : ''}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
