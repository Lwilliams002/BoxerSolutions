import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLateFee, lateFeeDescription, lateFeePolicyText } from '../src/utils/lateFee';

const policy = { dailyFee: 25, graceDays: 7 };

test('no late fee inside the grace week, then $25 for every day after it', () => {
  assert.deepEqual(computeLateFee('2026-09-01', '2026-09-01', policy), { days: 0, amount: 0 });
  assert.deepEqual(computeLateFee('2026-09-01', '2026-09-08', policy), { days: 0, amount: 0 }); // day 7: still grace
  assert.deepEqual(computeLateFee('2026-09-01', '2026-09-09', policy), { days: 1, amount: 25 });
  assert.deepEqual(computeLateFee('2026-09-01', '2026-09-18', policy), { days: 10, amount: 250 });
  assert.deepEqual(computeLateFee('2026-09-10', '2026-09-01', policy), { days: 0, amount: 0 }); // not due yet
});

test('a zero daily fee disables the policy', () => {
  assert.deepEqual(computeLateFee('2026-09-01', '2026-10-01', { dailyFee: 0, graceDays: 7 }), { days: 0, amount: 0 });
  assert.equal(lateFeePolicyText({ dailyFee: 0, graceDays: 7 }), '');
});

test('wording on the invoice', () => {
  assert.equal(lateFeeDescription(3, policy), 'Late fee — $25.00/day after 7-day grace period (3 days)');
  assert.match(lateFeePolicyText(policy), /unpaid 7 days after the due date accrue a \$25\.00 late fee/);
});
