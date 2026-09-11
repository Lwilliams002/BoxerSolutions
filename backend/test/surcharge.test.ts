import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDiscount, discountLabel } from '../src/utils/surcharge';

test('cash/ACH discount is a cents-rounded percentage, never negative', () => {
  assert.equal(computeDiscount(340, 4), 13.6);
  assert.equal(computeDiscount(139, 3), 4.17);
  assert.equal(computeDiscount(10.01, 4), 0.4);
  assert.equal(computeDiscount(0, 4), 0);
  assert.equal(computeDiscount(100, 0), 0);
  assert.equal(discountLabel(4, 'bank'), 'Bank payment discount (4%)');
  assert.equal(discountLabel(4, 'cash'), 'Cash payment discount (4%)');
});
