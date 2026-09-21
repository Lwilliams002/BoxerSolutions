import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addServiceInterval, advanceDueDate, buildChargeSchedule, parseServiceFrequency, scheduleByMonth } from '../src/utils/serviceSchedule';

test('parseServiceFrequency accepts labels and keys', () => {
  assert.equal(parseServiceFrequency('Every 2 weeks'), 'biweekly');
  assert.equal(parseServiceFrequency('bi-weekly'), 'biweekly');
  assert.equal(parseServiceFrequency('Monthly'), 'monthly');
  assert.equal(parseServiceFrequency('every two months'), 'bimonthly');
  assert.equal(parseServiceFrequency('weekly'), 'weekly');
  assert.equal(parseServiceFrequency('quarterly'), 'quarterly');
  assert.equal(parseServiceFrequency('Every 3 months'), 'quarterly');
  assert.equal(parseServiceFrequency('yearly'), null);
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

  // Every cadence starts with the 30-day egg-cycle follow-up, then its own interval.
  const biweekly = buildChargeSchedule({ startDate: '2026-09-08', frequency: 'biweekly', termMonths: 12, initialAmount: 100, recurringAmount: 40 });
  assert.equal(biweekly.length, 25);
  assert.equal(biweekly[1].date, '2026-10-08');
  assert.ok(biweekly.every((c, i) => i === 0 || c.kind === 'regular'));

  const bimonthly = buildChargeSchedule({ startDate: '2026-09-08', frequency: 'bimonthly', termMonths: 12, initialAmount: 100, recurringAmount: 40 });
  assert.equal(bimonthly.length, 7);
  const quarterly = buildChargeSchedule({ startDate: '2026-09-08', frequency: 'quarterly', termMonths: 12, initialAmount: 100, recurringAmount: 40 });
  assert.deepEqual(quarterly.map((c) => c.date), ['2026-09-08', '2026-10-08', '2027-01-08', '2027-04-08', '2027-07-08']);
});

test('buildChargeSchedule honours an existing next due date for updates', () => {
  const s = buildChargeSchedule({ startDate: '2026-09-08', frequency: 'monthly', termMonths: 12, initialAmount: 32, recurringAmount: 121, firstRegularDate: '2026-09-20' });
  assert.equal(s[1].date, '2026-09-20');
  assert.equal(s[2].date, '2026-10-20');
});

test('buildChargeSchedule without the egg-cycle follow-up starts the cadence one interval after the initial', () => {
  const withFollowUp = buildChargeSchedule({ startDate: '2026-09-21', frequency: 'quarterly', termMonths: 12, initialAmount: 150, recurringAmount: 90 });
  const without = buildChargeSchedule({ startDate: '2026-09-21', frequency: 'quarterly', termMonths: 12, initialAmount: 150, recurringAmount: 90, eggCycleFollowUp: false });
  assert.equal(withFollowUp[1].date, '2026-10-21');
  assert.equal(without[1].date, '2026-12-21');
  assert.deepEqual(without.map((c) => c.date), ['2026-09-21', '2026-12-21', '2027-03-21', '2027-06-21']);
});

test('scheduleByMonth prints twelve calendar months and leaves uncharged months empty', () => {
  const entries = buildChargeSchedule({ startDate: '2026-09-21', frequency: 'quarterly', termMonths: 24, initialAmount: 150, recurringAmount: 90 });
  const { months, truncated } = scheduleByMonth(entries, '2026-09-21');
  assert.equal(months.length, 12);
  assert.equal(months[0].label, "Sep '26");
  assert.equal(months[11].label, "Aug '27");
  assert.equal(months[0].entries[0].kind, 'initial');
  assert.equal(months[1].entries.length, 1); // 30-day follow-up in October
  assert.equal(months[2].entries.length, 0); // November: nothing due
  assert.equal(months[4].entries.length, 1); // January
  assert.equal(truncated, true);
  const oneYear = scheduleByMonth(buildChargeSchedule({ startDate: '2026-09-21', frequency: 'monthly', termMonths: 12, initialAmount: 150, recurringAmount: 90 }), '2026-09-21');
  assert.equal(oneYear.truncated, false);
  assert.ok(oneYear.months.every((m) => m.entries.length === 1));
});

test('scheduleByMonth stacks several charges in one month for week cadences', () => {
  const entries = buildChargeSchedule({ startDate: '2026-09-01', frequency: 'weekly', termMonths: 12, initialAmount: 100, recurringAmount: 40 });
  const { months } = scheduleByMonth(entries, '2026-09-01');
  assert.equal(months[0].entries.length, 1); // initial only: first regular is Oct 1
  assert.ok(months[1].entries.length >= 4);
});
