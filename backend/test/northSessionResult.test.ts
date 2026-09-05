import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNorthSessionResult } from '../src/utils/northSessionResult';

const approvedCard = {
  status: 'Approved',
  body: { auth_guid: '09LNEUTYG4AWN6EYX3R', auth_masked_account_nbr: '************1111', auth_card_type: 'V', auth_code: '008262', auth_amount: '0.00', auth_resp: '00', auth_resp_text: 'APPROVED', exp_date: '1230' },
};

test('approved card storage session', () => {
  const r = extractNorthSessionResult(approvedCard);
  assert.equal(r.approved, true);
  assert.equal(r.terminal, true);
  assert.equal(r.authGuid, '09LNEUTYG4AWN6EYX3R');
  assert.equal(r.methodType, 'card');
  assert.equal(r.brand, 'Visa');
  assert.equal(r.last4, '1111');
  assert.equal(r.expirationMonth, 12);
  assert.equal(r.expirationYear, 2030);
  assert.equal(r.amount, 0);
});

test('payload wrapped in data and body under transaction.fullResponse', () => {
  const r = extractNorthSessionResult({ data: { status: 'approved', transaction: { fullResponse: { auth_guid: 'G2', auth_card_type: 'M', auth_amount: '45.10' } } } });
  assert.equal(r.approved, true);
  assert.equal(r.authGuid, 'G2');
  assert.equal(r.brand, 'Mastercard');
  assert.equal(r.amount, 45.1);
});

test('ACH sale detected from explicit fields', () => {
  const r = extractNorthSessionResult({ status: 'Approved', body: { auth_guid: 'ACH1', payment_method: 'ach', auth_masked_account_nbr: '*****6789', auth_amount: '120.00' } });
  assert.equal(r.methodType, 'bank_account');
  assert.equal(r.brand, 'Bank Account');
  assert.equal(r.last4, '6789');
  assert.equal(r.expirationMonth, null);
});

test('expected type is used when payload does not say', () => {
  const r = extractNorthSessionResult({ status: 'Approved', body: { auth_guid: 'X', auth_amount: '10.00' } }, 'bank_account');
  assert.equal(r.methodType, 'bank_account');
  const c = extractNorthSessionResult({ status: 'Approved', body: { auth_guid: 'X' } });
  assert.equal(c.methodType, 'card');
  assert.equal(c.brand, 'Card');
});

test('declined and open statuses', () => {
  const d = extractNorthSessionResult({ status: 'Declined', body: { auth_resp: '05', auth_resp_text: 'DO NOT HONOR' } });
  assert.equal(d.declined, true);
  assert.equal(d.terminal, true);
  assert.equal(d.responseText, 'DO NOT HONOR');
  const o = extractNorthSessionResult({ status: 'Open' });
  assert.equal(o.terminal, false);
  assert.equal(o.approved, false);
  assert.equal(o.authGuid, null);
});

test('Approved status with a non-00 auth_resp is terminal but not approved', () => {
  const r = extractNorthSessionResult({
    status: 'Approved',
    body: { auth_guid: 'G9', auth_card_type: 'V', auth_resp: '05', auth_resp_text: 'DO NOT HONOR', auth_amount: '25.00' },
  });
  assert.equal(r.approved, false);
  assert.equal(r.declined, false);
  assert.equal(r.terminal, true);
  assert.equal(r.responseCode, '05');
  assert.equal(r.responseText, 'DO NOT HONOR');
});

test('Approved status without an auth_resp stays approved', () => {
  const r = extractNorthSessionResult({ status: 'Approved', body: { auth_guid: 'G10', auth_amount: '5.00' } });
  assert.equal(r.responseCode, null);
  assert.equal(r.approved, true);
  assert.equal(r.terminal, true);
});

test('MM/YY expiry and Amex code', () => {
  const r = extractNorthSessionResult({ status: 'Approved', body: { auth_guid: 'A', auth_card_type: 'X', exp_date: '03/29' } });
  assert.equal(r.brand, 'American Express');
  assert.equal(r.expirationMonth, 3);
  assert.equal(r.expirationYear, 2029);
});
