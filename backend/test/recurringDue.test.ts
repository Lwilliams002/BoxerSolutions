import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDueNotification, RECURRING_DUE_NOTIFY_ROLES } from '../src/jobs/recurringDue';

test('due notification names the customer, cadence, amount and date', () => {
  const n = buildDueNotification({
    id: 'rc1', customerId: 'c1', customerName: 'Jane Doe', amount: 89, frequency: 'biweekly', nextDueDate: '2026-09-08',
  });
  assert.equal(n.type, 'recurring_service_due');
  assert.equal(n.title, 'Service due: Jane Doe');
  assert.match(n.body, /\$89\.00 every 2 weeks service was due Sep 8, 2026/);
  assert.deepEqual(n.data, { recurringChargeId: 'rc1', customerId: 'c1', dueDate: '2026-09-08', amount: 89 });
});

test('office roles receive due notifications', () => {
  assert.deepEqual([...RECURRING_DUE_NOTIFY_ROLES], ['OWNER', 'ADMIN', 'OFFICE_MANAGER']);
});
