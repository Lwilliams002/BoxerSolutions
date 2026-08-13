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
