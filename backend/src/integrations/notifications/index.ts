import { pool } from '../../config/db';
import { logger } from '../../utils/logger';

/**
 * Notification provider abstraction. In development, notifications are
 * persisted to the notifications table and logged; production adapters
 * (Expo Push, Twilio SMS, SES email) implement the same interface.
 */
export interface NotificationPayload {
  userId?: string | null;
  customerId?: string | null;
  channel: 'push' | 'sms' | 'email';
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<void>;
}

export interface OutboundMessagePayload {
  communicationId: string;
  channel: 'sms' | 'email' | 'push';
  to?: string | null;
  subject?: string | null;
  body: string;
  templateKey: string;
}

export interface OutboundMessageProvider {
  name: string;
  send(payload: OutboundMessagePayload): Promise<void>;
}

class DatabaseNotificationProvider implements NotificationProvider {
  async send(payload: NotificationPayload): Promise<void> {
    await pool.query(
      `INSERT INTO notifications (user_id, customer_id, channel, notification_type, title, body, data, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent', now())`,
      [
        payload.userId ?? null,
        payload.customerId ?? null,
        payload.channel,
        payload.type,
        payload.title,
        payload.body ?? null,
        payload.data ? JSON.stringify(payload.data) : null,
      ],
    );
    logger.debug({ type: payload.type, title: payload.title }, 'notification sent');
  }
}

class MockSmsProvider implements OutboundMessageProvider {
  name = 'mock-sms';

  async send(payload: OutboundMessagePayload): Promise<void> {
    logger.info(
      { communicationId: payload.communicationId, to: payload.to, templateKey: payload.templateKey, body: payload.body },
      'mock sms sent',
    );
  }
}

class MockEmailProvider implements OutboundMessageProvider {
  name = 'mock-email';

  async send(payload: OutboundMessagePayload): Promise<void> {
    logger.info(
      {
        communicationId: payload.communicationId,
        to: payload.to,
        templateKey: payload.templateKey,
        subject: payload.subject,
        body: payload.body,
      },
      'mock email sent',
    );
  }
}

class MockPushProvider implements OutboundMessageProvider {
  name = 'mock-push';

  async send(payload: OutboundMessagePayload): Promise<void> {
    logger.info(
      { communicationId: payload.communicationId, to: payload.to, templateKey: payload.templateKey, body: payload.body },
      'mock push sent',
    );
  }
}

export function getOutboundMessageProvider(channel: 'sms' | 'email' | 'push'): OutboundMessageProvider {
  switch (channel) {
    case 'sms':
      return new MockSmsProvider();
    case 'email':
      return new MockEmailProvider();
    case 'push':
      return new MockPushProvider();
  }
}

export const notifications: NotificationProvider = new DatabaseNotificationProvider();
