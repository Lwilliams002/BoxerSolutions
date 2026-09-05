import { test } from 'node:test';
import assert from 'node:assert/strict';

test('harness runs TypeScript tests', () => {
  const value: number = 1 + 1;
  assert.equal(value, 2);
});
