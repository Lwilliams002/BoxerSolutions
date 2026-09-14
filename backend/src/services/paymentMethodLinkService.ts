import jwt from 'jsonwebtoken';
import { config } from '../config';
import { pool } from '../config/db';
import { ApiError } from '../utils/errors';
import { northFieldsPaymentService, type ConsentMeta } from './northFieldsPaymentService';
import { northGatewayService } from './northGatewayService';

/**
 * "Add your payment method" links: the office copies the link or emails it,
 * and the customer enters a card or bank account on a hosted page that uses
 * North's embedded fields. Card data never touches our servers; the stored
 * token becomes the customer's default payment method.
 */
export const PAYMENT_METHOD_LINK_TTL_DAYS = 14;

interface LinkPayload { type: 'payment_method_link'; customerId: string }

function issueToken(customerId: string) {
  return jwt.sign({ type: 'payment_method_link', customerId } satisfies LinkPayload, config.jwt.secret, {
    expiresIn: PAYMENT_METHOD_LINK_TTL_DAYS * 24 * 60 * 60,
  });
}

function parseToken(token: string): LinkPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch {
    throw ApiError.badRequest('This payment link is invalid or has expired. Ask us for a new one.');
  }
  const parsed = decoded as Partial<LinkPayload> | null;
  if (!parsed || parsed.type !== 'payment_method_link' || !parsed.customerId) throw ApiError.badRequest('This payment link is invalid.');
  return parsed as LinkPayload;
}

async function ownerUserId() {
  const { rows } = await pool.query(
    `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.code = 'OWNER' AND u.deleted_at IS NULL ORDER BY u.created_at LIMIT 1`,
  );
  return rows[0]?.id as string | undefined;
}

export const paymentMethodLinkService = {
  async buildLink(customerId: string, apiBaseUrl: string) {
    const { rows } = await pool.query('SELECT id FROM customers WHERE id = $1 AND deleted_at IS NULL', [customerId]);
    if (!rows[0]) throw ApiError.notFound('Customer not found');
    return `${apiBaseUrl}/api/v1/payment-links/store?token=${encodeURIComponent(issueToken(customerId))}`;
  },

  /** Customer-facing page context: who the link is for and whether they already have a method. */
  async context(token: string) {
    const { customerId } = parseToken(token);
    const { rows } = await pool.query(
      `SELECT c.first_name, c.last_name, c.company,
              (SELECT count(*)::int FROM payment_methods pm WHERE pm.customer_id = c.id AND pm.deleted_at IS NULL) AS methods
       FROM customers c WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [customerId],
    );
    if (!rows[0]) throw ApiError.badRequest('This payment link is no longer valid.');
    return { customerId, firstName: String(rows[0].first_name ?? ''), methodsOnFile: Number(rows[0].methods ?? 0) };
  },

  async createSession(token: string) {
    const { customerId } = parseToken(token);
    return northFieldsPaymentService.createStorageSession({ customerId });
  },

  async confirm(token: string, sessionToken: string, achConsent: boolean | undefined, achAccountType: 'checking' | 'savings' | undefined, consentMeta: ConsentMeta) {
    const { customerId } = parseToken(token);
    const actor = await ownerUserId();
    if (!actor) throw ApiError.badRequest('Owner account not available to record the payment method.');
    return northFieldsPaymentService.confirmStorage({ customerId, sessionToken, setDefault: true, actorUserId: actor, achConsent, achAccountType, consentMeta });
  },

  async status(token: string, sessionToken: string) {
    parseToken(token);
    const s = await northGatewayService.getEmbeddedSessionStatus(sessionToken);
    const data = (s.data && typeof s.data === 'object' ? s.data : s) as Record<string, unknown>;
    return { status: String(data.status ?? 'unknown') };
  },
};
