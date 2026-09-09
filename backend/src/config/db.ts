import { Pool, PoolClient, types } from 'pg';
import { config } from './index';

// DATE columns (OID 1082) come back as plain 'YYYY-MM-DD' strings instead of a
// JS Date at UTC midnight, which clients west of UTC rendered as the day before.
types.setTypeParser(1082, (value: string) => value);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  // Session timezone at connect time so CURRENT_DATE / now()::date inside SQL
  // mean the business's calendar day, not UTC's.
  options: `-c timezone=${config.timezone}`,
});

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export type Queryable = Pool | PoolClient;
