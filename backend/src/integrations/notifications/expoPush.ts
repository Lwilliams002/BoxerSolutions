import { pool } from '../../config/db';
import { config } from '../../config';
import { logger } from '../../utils/logger';

/**
 * Expo push service client. Tokens come from expo-notifications on a native
 * build (`ExponentPushToken[...]`); Expo relays to APNs/FCM using the
 * credentials stored in the EAS project.
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export function isExpoPushToken(token: unknown): token is string {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

/** Split messages into Expo-sized batches (pure, for tests). */
export function chunkMessages<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Tokens whose ticket says the device is gone; they should be deleted. */
export function deadTokensFromTickets(messages: ExpoPushMessage[], tickets: ExpoTicket[]): string[] {
  const dead: string[] = [];
  tickets.forEach((ticket, index) => {
    if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' && messages[index]) {
      dead.push(messages[index].to);
    }
  });
  return dead;
}

export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const batch of chunkMessages(messages)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(config.push.expoAccessToken ? { Authorization: `Bearer ${config.push.expoAccessToken}` } : {}),
        },
        body: JSON.stringify(batch.map((m) => ({ ...m, sound: 'default', priority: 'high', channelId: 'default' }))),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: ExpoTicket[]; errors?: unknown };
      if (!res.ok || !Array.isArray(json.data)) {
        failed += batch.length;
        logger.warn({ status: res.status, errors: json.errors }, 'expo push request rejected');
        continue;
      }
      const dead = deadTokensFromTickets(batch, json.data);
      if (dead.length) {
        await pool.query('DELETE FROM push_tokens WHERE token = ANY($1)', [dead]);
        logger.info({ count: dead.length }, 'removed unregistered push tokens');
      }
      json.data.forEach((ticket) => (ticket.status === 'ok' ? sent++ : failed++));
    } catch (err) {
      failed += batch.length;
      logger.error({ err }, 'expo push request failed');
    }
  }
  return { sent, failed };
}

/** Push a notification to every registered device of the given users. */
export async function pushToUsers(userIds: string[], message: Omit<ExpoPushMessage, 'to'>) {
  if (!userIds.length) return { sent: 0, failed: 0 };
  const { rows } = await pool.query('SELECT token FROM push_tokens WHERE user_id = ANY($1)', [userIds]);
  const tokens = rows.map((r) => String(r.token)).filter(isExpoPushToken);
  if (!tokens.length) return { sent: 0, failed: 0 };
  return sendExpoPush(tokens.map((to) => ({ to, ...message })));
}
