import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ServiceNotificationContext, bannerFor, statementFor, renderServiceNotificationHtml, renderServiceNotificationText,
} from '../src/content/serviceNotificationEmail';

function sample(overrides: Partial<ServiceNotificationContext> = {}): ServiceNotificationContext {
  return {
    kind: 'payment_received',
    company: { name: 'Boxer Solutions Pest Control', phone: '(305) 713-5011', email: 'service@boxersolutionspestcontrol.com', addressLines: ['20560 NW 17th Ave', 'Miami Gardens, FL 33056'], license: 'License #: ---------' },
    eventAmount: 340,
    customer: { name: 'Lesly Williams', firstName: 'Lesly', email: 'lesly@example.com', phone: '(305) 555-0100', billingAddress: ['324 Surfside Blvd', 'Surfside, FL 33154'] },
    invoice: {
      number: 'INV-1145', date: '2026-09-08', dueDate: '2026-09-08', subtotal: 340, discount: 0, taxRate: 0, taxAmount: 0, total: 340, amountPaid: 340,
      notes: null, items: [{ description: 'Standard Four Point Service · Medium', quantity: 1, unitPrice: 340, lineTotal: 340 }],
    },
    serviceAddress: ['324 Surfside Blvd', 'Surfside, FL 33154'],
    appointment: { date: '2026-09-08', technician: 'Anthony Arechiga', services: ['BTH'], window: '12:30 PM - 2:30 PM', timeIn: '12:30 PM', timeOut: '2:30 PM', comments: 'Treated perimeter <crack & crevice>.' },
    payments: [{ amount: 340, date: '2026-09-08', method: 'Visa ····1111', receiptNumber: 'R-5001' }],
    previousBalance: 0,
    ...overrides,
  };
}

test('statement nets payments and previous balance into amount due', () => {
  assert.deepEqual(statementFor(sample()), { serviceTotal: 340, previousBalance: 0, payments: 340, amountDue: 0 });
  const open = statementFor(sample({ kind: 'invoice_created', payments: [], invoice: { ...sample().invoice, amountPaid: 0 }, previousBalance: 25 }));
  assert.equal(open.amountDue, 365);
});

test('banner reflects the event', () => {
  assert.match(bannerFor(sample()).title, /Payment received — \$340\.00/);
  assert.match(bannerFor(sample({ kind: 'payment_failed', eventReason: 'Card declined' })).detail, /Card declined/);
  assert.match(bannerFor(sample({ kind: 'invoice_created', eventAmount: null })).title, /INV-1145 is ready/);
});

test('html carries the document sections and escapes user text', () => {
  const html = renderServiceNotificationHtml(sample());
  for (const section of ['Service Notification', 'Customer Information', 'Service Information', 'Technician Comments', 'Invoice Items', 'BILLING INFORMATION', 'ACCOUNT STATEMENT', 'Total Due', 'Poison Control']) {
    assert.ok(html.includes(section), `missing ${section}`);
  }
  assert.ok(html.includes('&lt;crack &amp; crevice&gt;'));
  assert.ok(!html.includes('<crack'));
  assert.ok(html.includes('Anthony Arechiga'));
  assert.ok(html.includes('Paid in full'));
  assert.ok(html.includes('License #: ---------'));
  assert.ok(html.includes('20560 NW 17th Ave'));
});

test('plain text twin lists items and totals', () => {
  const text = renderServiceNotificationText(sample());
  assert.match(text, /Invoice #: INV-1145/);
  assert.match(text, /Standard Four Point Service · Medium  \$340\.00/);
  assert.match(text, /Amount Due \$0\.00/);
});

test('products used table and service report without invoice', () => {
  const ctx = sample({ kind: 'service_completed', eventAmount: null, payments: [], invoice: { ...sample().invoice, items: [], total: 0, subtotal: 0, amountPaid: 0 } });
  ctx.appointment = { ...ctx.appointment!, products: [{ name: 'Suspend SC', quantity: 2, unit: 'oz', applicationMethod: 'Crack & Crevice', targetPests: 'Roaches' }] };
  const html = renderServiceNotificationHtml(ctx);
  assert.ok(html.includes('Products Used'));
  assert.ok(html.includes('Suspend SC'));
  assert.ok(html.includes('Crack &amp; Crevice'));
  assert.ok(!html.includes('Invoice Items'), 'no invoice section when the visit produced no invoice');
  assert.match(bannerFor(ctx).title, /Service completed/);
  const text = renderServiceNotificationText(ctx);
  assert.match(text, /Products Used:\n  Suspend SC — 2 oz · Crack & Crevice/);
});
