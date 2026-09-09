import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRawMimeEmail } from '../src/integrations/notifications/index';

test('raw MIME email carries text, html and a base64 attachment', () => {
  const raw = buildRawMimeEmail({
    from: 'service@example.com', to: 'jane@example.com', replyTo: 'service@example.com',
    subject: 'Your signed agreement — copy', text: 'Hi Jane', html: '<p>Hi Jane</p>',
    attachments: [{ filename: 'service-agreement-signed.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 test') }],
  }).toString('utf8');
  assert.match(raw, /^From: service@example.com\r\nTo: jane@example.com\r\nReply-To: service@example.com\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(raw, /Content-Type: multipart\/mixed; boundary="mixed-/);
  assert.match(raw, /Content-Type: multipart\/alternative; boundary="alt-/);
  assert.match(raw, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(raw, /Content-Type: text\/html; charset=UTF-8/);
  assert.match(raw, /Content-Disposition: attachment; filename="service-agreement-signed.pdf"/);
  assert.ok(raw.includes(Buffer.from('%PDF-1.4 test').toString('base64')));
  assert.ok(raw.trimEnd().endsWith('--'), 'closes the mixed boundary');
});

test('plain ASCII subjects are not encoded and unsafe filenames are sanitised', () => {
  const raw = buildRawMimeEmail({
    from: 'a@x.com', to: 'b@x.com', subject: 'Plain subject', text: 'x',
    attachments: [{ filename: 'bad"name\r\n.png', contentType: 'image/png', content: Buffer.from('png') }],
  }).toString('utf8');
  assert.match(raw, /Subject: Plain subject\r\n/);
  assert.match(raw, /filename="bad_name__.png"/);
});
