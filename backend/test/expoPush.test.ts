import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkMessages, deadTokensFromTickets, isExpoPushToken } from '../src/integrations/notifications/expoPush';

test('recognises Expo push tokens only', () => {
  assert.equal(isExpoPushToken('ExponentPushToken[abc123]'), true);
  assert.equal(isExpoPushToken('ExpoPushToken[abc123]'), true);
  assert.equal(isExpoPushToken('apns-raw-token'), false);
  assert.equal(isExpoPushToken(null), false);
});

test('chunks messages into batches of 100', () => {
  const items = Array.from({ length: 205 }, (_, i) => i);
  const chunks = chunkMessages(items);
  assert.deepEqual(chunks.map((c) => c.length), [100, 100, 5]);
});

test('collects tokens Expo reports as unregistered', () => {
  const messages = [{ to: 'ExponentPushToken[a]', title: 'x' }, { to: 'ExponentPushToken[b]', title: 'x' }];
  const dead = deadTokensFromTickets(messages, [
    { status: 'ok', id: '1' },
    { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
  ]);
  assert.deepEqual(dead, ['ExponentPushToken[b]']);
});
