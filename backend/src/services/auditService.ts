import { Queryable, pool } from '../config/db';

interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
}

export async function recordAudit(entry: AuditEntry, db: Queryable = pool) {
  await db.query(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, previous_value, new_value, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.userId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.previousValue != null ? JSON.stringify(entry.previousValue) : null,
      entry.newValue != null ? JSON.stringify(entry.newValue) : null,
      entry.ipAddress ?? null,
    ],
  );
}
