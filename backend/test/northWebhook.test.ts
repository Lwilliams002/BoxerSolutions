import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { extractNorthWebhookCardUpdate, parseWebhookExpiry, verifyNorthWebhookSignature } from '../src/utils/northWebhook';

const body = JSON.stringify({ transaction: { authGuid: 'ABC123', fullRequest: { EXP_DATE: '1228', ACCOUNT_NBR: '****1111' } } });
const hmac = (key: string, msg: string) => crypto.createHmac('sha256', key).update(msg).digest('hex');

test('transaction webhook: v1=<hex> over <timestamp>.<body> with the private API key', () => {
  const ts = '1757000000000';
  const headers = { 'x-yourapp-signature-256': `v1=${hmac('api-key', `${ts}.${body}`)}`, 'x-yourapp-timestamp': ts };
  assert.equal(verifyNorthWebhookSignature({ rawBody: body, headers, keys: ['sec_other', 'api-key'] }), true);
  assert.equal(verifyNorthWebhookSignature({ rawBody: body, headers, keys: ['wrong'] }), false);
  assert.equal(verifyNorthWebhookSignature({ rawBody: body + ' ', headers, keys: ['api-key'] }), false);
});

test('signup webhook: t=..,v1=.. with the sec_ secret', () => {
  const ts = '1688000000000';
  const headers = { 'x-webhook-signature': `t=${ts},v1=${hmac('sec_abc', `${ts}.${body}`)}` };
  assert.equal(verifyNorthWebhookSignature({ rawBody: body, headers, keys: ['sec_abc'] }), true);
});

test('legacy bare hex over the raw body still verifies; missing header or keys never do', () => {
  assert.equal(verifyNorthWebhookSignature({ rawBody: body, headers: { 'x-signature': hmac('k', body) }, keys: ['k'] }), true);
  assert.equal(verifyNorthWebhookSignature({ rawBody: body, headers: {}, keys: ['k'] }), false);
  assert.equal(verifyNorthWebhookSignature({ rawBody: body, headers: { 'x-signature': 'abc' }, keys: [] }), false);
});

test('expiry parsing: MMYY from the form echo, YYMM from EPX, MM/YY', () => {
  assert.deepEqual(parseWebhookExpiry('1228'), { month: 12, year: 2028 });
  assert.deepEqual(parseWebhookExpiry('2904'), { month: 4, year: 2029 });
  assert.deepEqual(parseWebhookExpiry('12/30'), { month: 12, year: 2030 });
  assert.deepEqual(parseWebhookExpiry(null), { month: null, year: null });
  assert.deepEqual(parseWebhookExpiry('9'), { month: null, year: null });
});

test('extracts token, expiry and last4 from a transaction webhook', () => {
  const update = extractNorthWebhookCardUpdate(JSON.parse(body));
  assert.deepEqual(update, { authGuid: 'ABC123', expirationMonth: 12, expirationYear: 2028, last4: '1111' });
  assert.equal(extractNorthWebhookCardUpdate({ transaction: { tranType: 'sale' } }), null);
  assert.equal(extractNorthWebhookCardUpdate('nope'), null);
  const nested = extractNorthWebhookCardUpdate({ transaction: { fullResponse: { auth_guid: 'G2', auth_masked_account_nbr: '****4242' } } });
  assert.deepEqual(nested, { authGuid: 'G2', expirationMonth: null, expirationYear: null, last4: '4242' });
});
