import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderScheduleEmailHtml, renderScheduleEmailText, ScheduleEmailInput } from '../src/content/scheduleEmail';

const input: ScheduleEmailInput = {
  company: { name: 'Boxer Solutions Pest Control', phone: '(305) 713-5011', email: 'service@boxersolutionspestcontrol.com', addressLines: ['20560 NW 17th Ave', 'Miami Gardens, FL 33056'], license: 'License #: JB500216' },
  heading: 'Your service schedule',
  intro: 'Hi Jane, your service schedule is set.',
  address: '7100 SW 61st Ct, South Miami, FL',
  visits: [
    { date: 'Monday, October 5, 2026', window: '9:00 AM – 10:00 AM', technician: 'William McCoy', note: 'Initial service' },
    { date: 'Wednesday, November 4, 2026', window: '9:00 AM – 10:00 AM', technician: null },
  ],
  moreNote: 'Plus 10 more visits through Monday, October 4, 2027, on the same schedule.',
  closing: 'Need a different day or time? Reply to this email.',
  portalUrl: 'https://boxersolutionspestcontrol.com/app/customer-portal',
};

test('schedule email lists each visit with its window and technician', () => {
  const html = renderScheduleEmailHtml(input);
  assert.match(html, /Your service schedule/);
  assert.match(html, /Monday, October 5, 2026/);
  assert.match(html, /Initial service/);
  assert.match(html, /William McCoy/);
  assert.match(html, /To be assigned/); // visit without a technician yet
  assert.match(html, /Plus 10 more visits/);
  assert.match(html, /href="https:\/\/boxersolutionspestcontrol\.com\/app\/customer-portal"/);
  const text = renderScheduleEmailText(input);
  assert.match(text, /- Monday, October 5, 2026, 9:00 AM – 10:00 AM · William McCoy \(Initial service\)/);
  assert.match(text, /Service address: 7100 SW 61st Ct/);
});

test('schedule email escapes customer-supplied text', () => {
  const html = renderScheduleEmailHtml({ ...input, intro: 'Hi <b>Jane</b>', address: '1 "Main" St' });
  assert.ok(html.includes('Hi &lt;b&gt;Jane&lt;/b&gt;'));
  assert.ok(!html.includes('Hi <b>Jane</b>'));
});
