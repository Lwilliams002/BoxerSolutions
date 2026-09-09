import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAddress, parseCensusResponse, parseNominatimResponse } from '../src/services/geocodingService';
import { deriveStage, STAGE_COLORS } from '../src/utils/customerStage';

test('formatAddress joins the parts that exist', () => {
  assert.equal(formatAddress({ addressLine1: '20560 NW 17th Ave', city: 'Miami Gardens', state: 'FL', postalCode: '33056' }), '20560 NW 17th Ave, Miami Gardens, FL 33056');
  assert.equal(formatAddress({ addressLine1: ' 1 Main St ', city: null, state: 'FL', postalCode: null }), '1 Main St, FL');
});

test('census and nominatim responses parse to lat/lng or null', () => {
  assert.deepEqual(parseCensusResponse({ result: { addressMatches: [{ coordinates: { x: -80.24, y: 25.94 } }] } }), { latitude: 25.94, longitude: -80.24 });
  assert.equal(parseCensusResponse({ result: { addressMatches: [] } }), null);
  assert.deepEqual(parseNominatimResponse([{ lat: '25.94', lon: '-80.24' }]), { latitude: 25.94, longitude: -80.24 });
  assert.equal(parseNominatimResponse([]), null);
  assert.equal(parseNominatimResponse({ error: 'x' }), null);
});

test('stage: serviced beats signed beats lead', () => {
  assert.equal(deriveStage({ hasSignedAgreement: false, hasCompletedService: false }), 'lead');
  assert.equal(deriveStage({ hasSignedAgreement: true, hasCompletedService: false }), 'signed');
  assert.equal(deriveStage({ hasSignedAgreement: true, hasCompletedService: true }), 'serviced');
  assert.equal(deriveStage({ hasSignedAgreement: false, hasCompletedService: true }), 'serviced');
  assert.ok(STAGE_COLORS.lead && STAGE_COLORS.signed && STAGE_COLORS.serviced);
});
