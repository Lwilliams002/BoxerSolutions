import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSurcharge, surchargeLabel } from '../src/utils/surcharge';

test('surcharge is a cents-rounded percentage and never applies to zero or negative', () => {
  assert.equal(computeSurcharge(340, 4), 13.6);
  assert.equal(computeSurcharge(139, 3), 4.17);
  assert.equal(computeSurcharge(10.01, 4), 0.4);
  assert.equal(computeSurcharge(0, 4), 0);
  assert.equal(computeSurcharge(100, 0), 0);
  assert.equal(surchargeLabel(4), 'Card processing surcharge (4%)');
  assert.equal(surchargeLabel(3.5), 'Card processing surcharge (3.5%)');
});
