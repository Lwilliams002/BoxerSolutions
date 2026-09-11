import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, parseAddress, splitName } from '../src/services/publicRequestService';

test('names, phones and addresses are normalised for lead creation', () => {
  assert.deepEqual(splitName('Sofia Alvarez Ruiz'), { firstName: 'Sofia', lastName: 'Alvarez Ruiz' });
  assert.deepEqual(splitName('Madonna'), { firstName: 'Madonna', lastName: '(lead)' });
  assert.equal(normalizePhone('+1 (305) 555-0100'), '3055550100');
  assert.deepEqual(parseAddress('20560 NW 17th Ave, Miami Gardens, FL 33056'), { addressLine1: '20560 NW 17th Ave', city: 'Miami Gardens', state: 'FL', postalCode: '33056' });
  assert.deepEqual(parseAddress('8420 SW 72nd Ave, Miami'), { addressLine1: '8420 SW 72nd Ave', city: 'Miami', state: 'FL', postalCode: '' });
  assert.deepEqual(parseAddress('123 Main St, Hollywood FL 33020'), { addressLine1: '123 Main St', city: 'Hollywood', state: 'FL', postalCode: '33020' });
  assert.equal(parseAddress(''), null);
});
