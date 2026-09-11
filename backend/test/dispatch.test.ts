import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScore, freeWindows, rankTechnicians, withinWorkHours } from '../src/services/dispatchService';

const square = [{ latitude: 25.9, longitude: -80.3 }, { latitude: 26.0, longitude: -80.3 }, { latitude: 26.0, longitude: -80.2 }, { latitude: 25.9, longitude: -80.2 }];
const techs = [
  { employeeId: 'a', name: 'Anthony', workStart: '08:00', workEnd: '17:00' },
  { employeeId: 'w', name: 'William', workStart: '08:00', workEnd: '17:00' },
  { employeeId: 'n', name: 'Night', workStart: '14:00', workEnd: '22:00' },
];
const visit = { id: 'v', customerId: 'c', customerName: 'X', assignedTechnicianId: null, point: { latitude: 25.95, longitude: -80.25 }, date: '2026-10-09', windowStart: '09:00', windowEnd: '10:00' };

test('free windows respect working hours and a minimum gap', () => {
  assert.deepEqual(freeWindows([{ start: '09:00', end: '10:00' }, { start: '13:00', end: '15:00' }], '08:00', '17:00'),
    [{ start: '08:00', end: '09:00' }, { start: '10:00', end: '13:00' }, { start: '15:00', end: '17:00' }]);
  assert.deepEqual(freeWindows([{ start: '08:00', end: '16:45' }], '08:00', '17:00'), []);
  assert.equal(withinWorkHours(techs[2], '09:00', '10:00'), false);
});

test('best fit: own tech, then territory, then lightest day; off-hours techs excluded', () => {
  const ranked = rankTechnicians(visit, techs, { a: 5, w: 1 }, [{ technicianId: 'a', polygon: square }]);
  assert.deepEqual(ranked.map((r) => r.tech.employeeId), ['a', 'w']);
  assert.equal(fitScore({ ...visit, assignedTechnicianId: 'w' }, 'w', []), 0);
  const noTerritory = rankTechnicians(visit, techs, { a: 5, w: 1 }, []);
  assert.equal(noTerritory[0].tech.employeeId, 'w', 'lightest day wins when nobody has a fit');
});
