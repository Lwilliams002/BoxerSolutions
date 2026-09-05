import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderName } from '../src/integrations/payments/resolveProvider';

test('north-stored methods always resolve to north', () => {
  assert.equal(resolveProviderName('north', 'mock'), 'north');
  assert.equal(resolveProviderName('north_embedded', 'mock'), 'north');
  assert.equal(resolveProviderName('NORTH', 'mock'), 'north');
});

test('mock-stored methods resolve to mock even when north is configured', () => {
  assert.equal(resolveProviderName('mock', 'north'), 'mock');
});

test('unknown or missing stored provider falls back to the configured one', () => {
  assert.equal(resolveProviderName(null, 'north'), 'north');
  assert.equal(resolveProviderName(undefined, 'mock'), 'mock');
  assert.equal(resolveProviderName('stripe', 'north'), 'north');
  assert.equal(resolveProviderName(null, 'bogus'), 'mock');
});
