import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRecurringVisits, technicianForPoint, addMinutes, RecurringPlanRow } from '../src/jobs/recurringVisits';
import { pointInPolygon } from '../src/utils/geo';

const square = [{ latitude: 25.9, longitude: -80.3 }, { latitude: 26.0, longitude: -80.3 }, { latitude: 26.0, longitude: -80.2 }, { latitude: 25.9, longitude: -80.2 }];

function plan(over: Partial<RecurringPlanRow>): RecurringPlanRow {
  return { id: 'rc1', customerId: 'c1', nextDueDate: '2026-09-12', frequency: 'monthly', assignedTechnicianId: null, locationId: 'loc1', latitude: 25.95, longitude: -80.25, lastVisitStart: null, hasVisitForDueDate: false, ...over };
}

test('point in polygon', () => {
  assert.equal(pointInPolygon({ latitude: 25.95, longitude: -80.25 }, square), true);
  assert.equal(pointInPolygon({ latitude: 26.5, longitude: -80.25 }, square), false);
  assert.equal(pointInPolygon({ latitude: 25.95, longitude: -80.25 }, []), false);
});

test('visits are created only for due plans without one, inside the horizon', () => {
  const today = '2026-09-09';
  const visits = planRecurringVisits([
    plan({}),
    plan({ id: 'far', nextDueDate: '2026-10-20' }),
    plan({ id: 'done', hasVisitForDueDate: true }),
    plan({ id: 'noloc', locationId: null }),
    plan({ id: 'overdue', nextDueDate: '2026-09-01', frequency: 'biweekly' }),
  ], [{ technicianId: 'tech-territory', polygon: square }], today);
  assert.deepEqual(visits.map((v) => v.recurringChargeId), ['rc1', 'overdue']);
  assert.equal(visits[0].technicianId, 'tech-territory');
  assert.equal(visits[0].scheduledDate, '2026-09-12');
  assert.equal(visits[0].windowStart, '09:00');
  assert.equal(visits[0].windowEnd, '10:00');
  assert.equal(visits[0].notes, 'Recurring service · Monthly');
  assert.equal(visits[1].scheduledDate, today, 'overdue plans are scheduled today');
  assert.equal(visits[1].notes, 'Recurring service · Every 2 weeks');
});

test('assigned technician wins over territory; last visit time is reused', () => {
  const [v] = planRecurringVisits([plan({ assignedTechnicianId: 'tech-assigned', lastVisitStart: '13:30:00' })], [{ technicianId: 'tech-territory', polygon: square }], '2026-09-09');
  assert.equal(v.technicianId, 'tech-assigned');
  assert.equal(v.windowStart, '13:30');
  assert.equal(v.windowEnd, '14:30');
  assert.equal(technicianForPoint(null, [{ technicianId: 't', polygon: square }]), null);
  assert.equal(addMinutes('23:30', 60), '23:59');
});
