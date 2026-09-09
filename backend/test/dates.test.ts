import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIsoDateLocal, toIsoDate, todayIso } from '../src/utils/dates';

test('todayIso uses the local calendar day, not UTC', () => {
  // 23:30 local on Sep 9 is Sep 10 in UTC when TZ is west of UTC; local wins.
  const local = new Date(2026, 8, 9, 23, 30);
  assert.equal(todayIso(local), '2026-09-09');
});

test('toIsoDate accepts strings, timestamps and Date objects', () => {
  assert.equal(toIsoDate('2026-09-09'), '2026-09-09');
  assert.equal(toIsoDate('2026-09-09T00:00:00.000Z'), '2026-09-09');
  assert.equal(toIsoDate(new Date(2026, 8, 9, 1)), '2026-09-09');
  assert.equal(toIsoDate(null), null);
  assert.equal(toIsoDate('nope'), null);
});

test('parseIsoDateLocal formats as the same day in the local zone', () => {
  assert.equal(parseIsoDateLocal('2026-09-09').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 'Sep 9, 2026');
});
