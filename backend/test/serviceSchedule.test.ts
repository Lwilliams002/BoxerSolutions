import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addServiceInterval, advanceDueDate, buildChargeSchedule, parseServiceFrequency } from '../src/utils/serviceSchedule';

test('parseServiceFrequency accepts labels and keys', () => {
  assert.equal(parseServiceFrequency('Every 2 weeks'), 'biweekly');
  assert.equal(parseServiceFrequency('bi-weekly'), 'biweekly');
  assert.equal(parseServiceFrequency('Monthly'), 'monthly');
  assert.equal(parseServiceFrequency('every two months'), 'bimonthly');
  assert.equal(parseServiceFrequency('weekly'), 'weekly');
  assert.equal(parseServiceFrequency('quarterly'), null);
  assert.equal(parseServiceFrequency(undefined), null);
});

test('addServiceInterval clamps month ends and counts weeks exactly', () => {
  assert.equal(addServiceInterval('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(addServiceInterval('2026-12-31', 'bimonthly'), '2027-02-28');
  assert.equal(addServiceInterval('2026-09-08', 'weekly'), '2026-09-15');
  assert.equal(addServiceInterval('2026-09-08', 'biweekly'), '2026-09-22');
});

test('advanceDueDate keeps cadence and always lands after today', () => {
  // charged early: cadence anchored to the due date, not to today
  assert.equal(advanceDueDate('2026-09-22', 'biweekly', '2026-09-08'), '2026-10-06');
  // charged on time
  assert.equal(advanceDueDate('2026-09-08', 'monthly', '2026-09-08'), '2026-10-08');
  // badly overdue: skips past dates
  assert.equal(advanceDueDate('2026-05-01', 'monthly', '2026-09-08'), '2026-10-01');
  // never scheduled
  assert.equal(advanceDueDate(null, 'weekly', '2026-09-08'), '2026-09-15');
});

test('buildChargeSchedule covers the term at the chosen cadence', () => {
  const monthly = buildChargeSchedule({ startDate: '2026-09-08', frequency: 'monthly', termMonths: 12, initialAmount: 600, recurringAmount: 250 });
  assert.equal(monthly.length, 12);
  assert.deepEqual(monthly[0], { date: '2026-09-08', amount: 600, kind: 'initial' });
  assert.deepEqual(monthly[1], { date: '2026-10-08', amount: 250, kind: 'regular' });
  assert.equal(monthly[11].date, '2027-08-08');

  const biweekly = buildChargeSchedule({ startDate: '2026-09-08', frequency: 'biweekly', termMonths: 12, initialAmount: 100, recurringAmount: 40 });
  assert.equal(biweekly.length, 27);
  assert.ok(biweekly.every((c, i) => i === 0 || c.kind === 'regular'));

  const bimonthly = buildChargeSchedule({ startDate: '2026-09-08', frequency: 'bimonthly', termMonths: 12, initialAmount: 100, recurringAmount: 40 });
  assert.equal(bimonthly.length, 6);
});

test('buildChargeSchedule honours an existing next due date for updates', () => {
  const s = buildChargeSchedule({ startDate: '2026-09-08', frequency: 'monthly', termMonths: 12, initialAmount: 32, recurringAmount: 121, firstRegularDate: '2026-09-20' });
  assert.equal(s[1].date, '2026-09-20');
  assert.equal(s[2].date, '2026-10-20');
});
