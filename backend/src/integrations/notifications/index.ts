import { pool } from '../../config/db';
import { config } from '../../config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { logger } from '../../utils/logger';
import { pushToUsers } from './expoPush';

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
  /** Optional rich version; email providers send both parts. */
  html?: string | null;
  /** Files to attach (email only). */
  attachments?: EmailAttachment[] | null;
  templateKey: string;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

/** Build an RFC 2822 message with text + html alternatives and attachments (pure, for tests). */
export function buildRawMimeEmail(input: {
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  html?: string | null;
  attachments: EmailAttachment[];
}): Buffer {
  const boundaryMixed = `mixed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const boundaryAlt = `alt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`);
  const wrap76 = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');
  const lines: string[] = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundaryMixed}"`,
    '',
    `--${boundaryMixed}`,
    `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
    '',
    `--${boundaryAlt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(input.text, 'utf8').toString('base64')),
    ...(input.html
      ? [`--${boundaryAlt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(input.html, 'utf8').toString('base64'))]
      : []),
    `--${boundaryAlt}--`,
  ];
  for (const file of input.attachments) {
    const safeName = file.filename.replace(/["\r\n]/g, '_');
    lines.push(
      `--${boundaryMixed}`,
      `Content-Type: ${file.contentType}; name="${safeName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${safeName}"`,
      '',
      wrap76(file.content.toString('base64')),
    );
  }
  lines.push(`--${boundaryMixed}--`, '');
  return Buffer.from(lines.join('\r\n'), 'utf8');
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
    // Push channel: also deliver to the user's registered devices so the
    // alert arrives with the app closed. The row above stays as in-app history.
    if (payload.channel === 'push' && payload.userId) {
      try {
        const result = await pushToUsers([payload.userId], { title: payload.title, body: payload.body, data: { ...(payload.data ?? {}), type: payload.type } });
        if (result.failed) logger.warn({ userId: payload.userId, ...result }, 'some push deliveries failed');
      } catch (err) {
        logger.error({ err, userId: payload.userId }, 'push delivery failed');
      }
    }
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
        html: payload.html ? `${payload.html.length} chars` : null,
        attachments: payload.attachments?.map((f) => `${f.filename} (${f.content.length} bytes)`) ?? [],
      },
      'mock email sent',
    );
  }
}

class SesEmailProvider implements OutboundMessageProvider {
  name = 'aws-ses';
  private client: SESv2Client;

  constructor() {
    this.client = new SESv2Client({
      region: config.email.sesRegion,
      ...(config.email.sesAccessKeyId && config.email.sesSecretAccessKey
        ? {
            credentials: {
              accessKeyId: config.email.sesAccessKeyId,
              secretAccessKey: config.email.sesSecretAccessKey,
            },
          }
        : {}),
    });
  }

  async send(payload: OutboundMessagePayload): Promise<void> {
    if (!payload.to) throw new Error('Missing recipient email address for SES send');
    if (!config.email.from) throw new Error('Missing EMAIL_FROM configuration for SES send');
    if (payload.attachments?.length) {
      const raw = buildRawMimeEmail({
        from: config.email.from,
        to: payload.to,
        replyTo: config.email.replyTo || null,
        subject: payload.subject ?? 'Service Update',
        text: payload.body,
        html: payload.html ?? null,
        attachments: payload.attachments,
      });
      await this.client.send(new SendEmailCommand({
        FromEmailAddress: config.email.from,
        Destination: { ToAddresses: [payload.to] },
        Content: { Raw: { Data: raw } },
      }));
      return;
    }
    const command = new SendEmailCommand({
      FromEmailAddress: config.email.from,
      ReplyToAddresses: config.email.replyTo ? [config.email.replyTo] : undefined,
      Destination: { ToAddresses: [payload.to] },
      Content: {
        Simple: {
          Subject: { Data: payload.subject ?? 'Service Update' },
          Body: {
            Text: { Data: payload.body },
            ...(payload.html ? { Html: { Data: payload.html } } : {}),
          },
        },
      },
    });
    await this.client.send(command);
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

const mockSmsProvider = new MockSmsProvider();
const mockEmailProvider = new MockEmailProvider();
const mockPushProvider = new MockPushProvider();
const sesEmailProvider = new SesEmailProvider();

export function getOutboundMessageProvider(channel: 'sms' | 'email' | 'push'): OutboundMessageProvider {
  switch (channel) {
    case 'sms':
      return mockSmsProvider;
    case 'email':
      return config.email.provider === 'ses' ? sesEmailProvider : mockEmailProvider;
    case 'push':
      return mockPushProvider;
  }
}

export const notifications: NotificationProvider = new DatabaseNotificationProvider();
