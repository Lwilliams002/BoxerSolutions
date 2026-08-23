import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { pool } from '../config/db';
import { config } from '../config';
import { ApiError } from '../utils/errors';
import { recordAudit } from './auditService';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const CUSTOMER_PORTAL_CODE_TTL_MS = 10 * 60 * 1000;
const CUSTOMER_PORTAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TEST_CUSTOMER_EMAIL = 'portal.test@antserve.dev';
const customerPortalCodes = new Map<string, { codeHash: string; expiresAt: number; customerId: string }>();
const customerPortalSessions = new Map<string, { customerId: string; email: string; expiresAt: number }>();

async function loadUserAuthContext(userId: string) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active,
            e.id AS employee_id,
            COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles,
            COALESCE(array_agg(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
     FROM users u
     LEFT JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = $1 AND u.deleted_at IS NULL
     GROUP BY u.id, e.id`,
    [userId],
  );
  return rows[0] ?? null;
}

function issueTokens(user: {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  employee_id: string | null;
}): { accessToken: string; expiresIn: number } {
  const accessToken = jwt.sign(
    {
      type: 'access',
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
      employeeId: user.employee_id,
    },
    config.jwt.secret,
    { subject: user.id, expiresIn: config.jwt.accessTtlSeconds } as SignOptions,
  );
  return { accessToken, expiresIn: config.jwt.accessTtlSeconds };
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function issueCustomerPortalSession(customerId: string, email: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  customerPortalSessions.set(token, {
    customerId,
    email,
    expiresAt: Date.now() + CUSTOMER_PORTAL_SESSION_TTL_MS,
  });
  return { portalSessionToken: token, expiresIn: Math.floor(CUSTOMER_PORTAL_SESSION_TTL_MS / 1000) };
}

async function createRefreshToken(userId: string, deviceName?: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + config.jwt.refreshTtlSeconds * 1000);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_name, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(token), deviceName ?? null, expiresAt],
  );
  return token;
}

export const authService = {
  async login(email: string, password: string, deviceName?: string): Promise<TokenPair & { user: unknown }> {
    const { rows } = await pool.query(
      'SELECT id, password_hash, is_active FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL',
      [email],
    );
    const row = rows[0];
    const valid = row && (await bcrypt.compare(password, row.password_hash));
    if (!valid || !row.is_active) throw ApiError.unauthorized('Invalid email or password');

    const ctx = await loadUserAuthContext(row.id);
    const { accessToken, expiresIn } = issueTokens(ctx);
    const refreshToken = await createRefreshToken(row.id, deviceName);
    await recordAudit({ userId: row.id, action: 'login', entityType: 'user', entityId: row.id });

    return {
      accessToken,
      refreshToken,
      expiresIn,
      user: {
        id: ctx.id,
        email: ctx.email,
        firstName: ctx.first_name,
        lastName: ctx.last_name,
        roles: ctx.roles,
        permissions: ctx.permissions,
        employeeId: ctx.employee_id,
      },
    };
  },

  async refresh(refreshToken: string): Promise<TokenPair> {
    const { rows } = await pool.query(
      `SELECT id, user_id FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hashToken(refreshToken)],
    );
    const row = rows[0];
    if (!row) throw ApiError.unauthorized('Invalid refresh token');

    // Rotate: revoke old token, issue a new one.
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
    const ctx = await loadUserAuthContext(row.user_id);
    if (!ctx || !ctx.is_active) throw ApiError.unauthorized('Account disabled');
    const { accessToken, expiresIn } = issueTokens(ctx);
    const newRefresh = await createRefreshToken(row.user_id);
    return { accessToken, refreshToken: newRefresh, expiresIn };
  },

  async logout(refreshToken: string): Promise<void> {
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [
      hashToken(refreshToken),
    ]);
  },

  async revokeAllSessions(userId: string): Promise<void> {
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
      userId,
    ]);
  },

  async listSessions(userId: string) {
    const { rows } = await pool.query(
      `SELECT id, device_name, created_at, expires_at FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  },

  async requestPasswordReset(email: string): Promise<string | null> {
    const { rows } = await pool.query(
      'SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL',
      [email],
    );
    if (!rows[0]) return null; // do not reveal whether the account exists
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
      [rows[0].id, hashToken(token)],
    );
    // In production this token is emailed via the notification integration.
    return token;
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const { rows } = await pool.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [hashToken(token)],
    );
    const row = rows[0];
    if (!row) throw ApiError.badRequest('Invalid or expired reset token');
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, row.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
    await this.revokeAllSessions(row.user_id);
  },

  async requestCustomerPortalCode(email: string): Promise<{ debugCode?: string }> {
    const normalizedEmail = normalizeEmail(email);
    const { rows } = await pool.query(
      `SELECT id
       FROM customers
       WHERE lower(email) = lower($1)
         AND deleted_at IS NULL
       LIMIT 1`,
      [normalizedEmail],
    );
    const customer = rows[0] as { id: string } | undefined;
    if (!customer) return {};

    const code = `${Math.floor(100000 + Math.random() * 900000)}`;
    const codeHash = hashToken(code);
    customerPortalCodes.set(normalizedEmail, {
      codeHash,
      expiresAt: Date.now() + CUSTOMER_PORTAL_CODE_TTL_MS,
      customerId: customer.id,
    });

    if (config.env !== 'production') {
      return { debugCode: code };
    }
    return {};
  },

  async verifyCustomerPortalCode(email: string, code: string) {
    const normalizedEmail = normalizeEmail(email);
    const entry = customerPortalCodes.get(normalizedEmail);
    if (!entry) throw ApiError.unauthorized('Invalid or expired code');
    if (entry.expiresAt < Date.now()) {
      customerPortalCodes.delete(normalizedEmail);
      throw ApiError.unauthorized('Invalid or expired code');
    }
    if (hashToken(code) !== entry.codeHash) throw ApiError.unauthorized('Invalid or expired code');
    customerPortalCodes.delete(normalizedEmail);
    const session = issueCustomerPortalSession(entry.customerId, normalizedEmail);

    return {
      customerId: entry.customerId,
      email: normalizedEmail,
      cognitoRequired: true,
      ...session,
    };
  },

  async testCustomerPortalLogin(email?: string) {
    if (config.env === 'production') throw ApiError.forbidden('Test portal login is disabled in production');
    const normalizedEmail = normalizeEmail(email ?? DEFAULT_TEST_CUSTOMER_EMAIL);
    const existing = await pool.query(
      `SELECT id, first_name, last_name, email
       FROM customers
       WHERE lower(email) = lower($1)
         AND deleted_at IS NULL
       LIMIT 1`,
      [normalizedEmail],
    );
    if (existing.rows[0]) {
      const session = issueCustomerPortalSession(existing.rows[0].id, existing.rows[0].email);
      return {
        customerId: existing.rows[0].id,
        email: existing.rows[0].email,
        firstName: existing.rows[0].first_name,
        lastName: existing.rows[0].last_name,
        isTestAccount: true,
        ...session,
      };
    }

    const owner = await pool.query(
      `SELECT id
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    );
    const created = await pool.query(
      `INSERT INTO customers (first_name, last_name, email, customer_type, status, created_by)
       VALUES ('Portal', 'Tester', $1, 'residential', 'active', $2)
       RETURNING id, first_name, last_name, email`,
      [normalizedEmail, owner.rows[0]?.id ?? null],
    );

    const session = issueCustomerPortalSession(created.rows[0].id, created.rows[0].email);
    return {
      customerId: created.rows[0].id,
      email: created.rows[0].email,
      firstName: created.rows[0].first_name,
      lastName: created.rows[0].last_name,
      isTestAccount: true,
      ...session,
    };
  },

  getCustomerPortalSession(token: string) {
    const session = customerPortalSessions.get(token);
    if (!session) throw ApiError.unauthorized('Invalid portal session');
    if (session.expiresAt < Date.now()) {
      customerPortalSessions.delete(token);
      throw ApiError.unauthorized('Portal session expired');
    }
    return session;
  },

  async me(userId: string) {
    const ctx = await loadUserAuthContext(userId);
    if (!ctx) throw ApiError.notFound('User not found');
    return {
      id: ctx.id,
      email: ctx.email,
      firstName: ctx.first_name,
      lastName: ctx.last_name,
      roles: ctx.roles,
      permissions: ctx.permissions,
      employeeId: ctx.employee_id,
    };
  },
};
