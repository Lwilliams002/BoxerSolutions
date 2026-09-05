import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTokenSaleBody, buildRefundBody, buildReversalBody, buildVoidBody,
  parseEpxResponse, epxBatchId, epxTranNbr, sanitizeEpxText,
} from '../src/services/epx/epxPayloads';

test('token sale body uses spec field names and omits aci_ext for CIT', () => {
  const body = buildTokenSaleBody({
    authGuid: '0V7017HDJXK00PNZKBE', amount: 12.5, paymentMethod: 'credit', mit: false,
    customer: { firstName: 'John', lastName: 'Doe', address: '1234 My St', city: 'Phoenix', state: 'az', zipCode: '12345' },
    invoiceNumber: 'INV-1001', tranNbr: '123', batchId: '20260905',
  });
  assert.deepEqual(body, {
    payment_method: 'credit', amount: 12.5, orig_auth_guid: '0V7017HDJXK00PNZKBE', industry_type: 'E',
    tran_nbr: '123', batch_id: '20260905', first_name: 'John', last_name: 'Doe', address: '1234 My St',
    city: 'Phoenix', state: 'AZ', zip_code: '12345', invoice_nbr: 'INV-1001',
  });
  assert.equal('token' in body, false);
  assert.equal('checkoutId' in body, false);
});

test('token sale MIT adds aci_ext RB; ach adds recv_name', () => {
  const body = buildTokenSaleBody({ authGuid: 'ABC', amount: 5, paymentMethod: 'ach', mit: true, customer: { firstName: 'Jane', lastName: 'Smith' }, tranNbr: '1', batchId: '2' });
  assert.equal(body.aci_ext, 'RB');
  assert.equal(body.payment_method, 'ach');
  assert.equal(body.recv_name, 'Jane Smith');
});

test('token sale rejects amounts below one cent', () => {
  assert.throws(() => buildTokenSaleBody({ authGuid: 'ABC', amount: 0, paymentMethod: 'credit', mit: false }), /0\.01/);
});

test('refund rejects amounts below one cent', () => {
  assert.throws(() => buildRefundBody({ authGuid: 'G1', amount: 0, paymentMethod: 'credit', tranNbr: '1', batchId: '2' }), /0\.01/);
  assert.throws(() => buildRefundBody({ authGuid: 'G1', amount: 0.004, paymentMethod: 'credit', tranNbr: '1', batchId: '2' }), /0\.01/);
});

test('refund, reversal and void bodies', () => {
  assert.deepEqual(buildRefundBody({ authGuid: 'G1', amount: 3.25, paymentMethod: 'ach', tranNbr: '7', batchId: '8' }),
    { payment_method: 'ach', amount: 3.25, orig_auth_guid: 'G1', tran_nbr: '7', batch_id: '8' });
  assert.deepEqual(buildReversalBody({ authGuid: 'G1', tranNbr: '7', batchId: '8' }),
    { payment_method: 'credit', orig_auth_guid: 'G1', tran_nbr: '7', batch_id: '8' });
  assert.deepEqual(buildVoidBody({ authGuid: 'G1', paymentMethod: 'ach', tranNbr: '7', batchId: '8' }),
    { payment_method: 'ach', orig_auth_guid: 'G1', tran_nbr: '7', batch_id: '8' });
});

test('tran_nbr and batch_id are numeric and within 10 digits', () => {
  assert.match(epxTranNbr(1_757_000_000_123), /^\d{1,10}$/);
  assert.equal(epxBatchId(new Date(2026, 8, 5)), '20260905');
  const auto = buildTokenSaleBody({ authGuid: 'G', amount: 1, paymentMethod: 'credit', mit: false });
  assert.match(String(auto.tran_nbr), /^\d{1,10}$/);
  assert.match(String(auto.batch_id), /^\d{8}$/);
});

test('sanitizeEpxText strips disallowed characters and truncates', () => {
  assert.equal(sanitizeEpxText("O'Brien & Sons <script>", 25), "O'Brien & Sons script");
  assert.equal(sanitizeEpxText('x'.repeat(40), 25)?.length, 25);
  assert.equal(sanitizeEpxText('   ', 25), undefined);
  assert.equal(sanitizeEpxText(null, 25), undefined);
});

test('parseEpxResponse reads lowercase, uppercase and nested keys', () => {
  const ok = parseEpxResponse({ auth_resp: '00', auth_guid: 'NEWGUID', auth_resp_text: 'APPROVED', auth_code: '008262', auth_amount: '12.55' });
  assert.equal(ok.approved, true);
  assert.equal(ok.authGuid, 'NEWGUID');
  assert.equal(ok.amount, 12.55);
  const upper = parseEpxResponse({ data: { AUTH_RESP: '05', AUTH_RESP_TEXT: 'DECLINE' } });
  assert.equal(upper.approved, false);
  assert.equal(upper.responseCode, '05');
  assert.equal(upper.responseText, 'DECLINE');
  const nested = parseEpxResponse({ transaction: { fullResponse: { auth_resp: '00', auth_guid: 'X' } } });
  assert.equal(nested.approved, true);
  assert.equal(nested.authGuid, 'X');
  const empty = parseEpxResponse(null);
  assert.equal(empty.approved, false);
  assert.equal(empty.responseCode, null);
});
