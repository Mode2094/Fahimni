import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

let pool: Pool | null = null;
let database: NodePgDatabase<typeof schema> | null = null;

// The pool is created lazily so importing this module during a build never
// opens a connection, and connection strings never reach the client bundle.
export function getDb(): NodePgDatabase<typeof schema> {
  if (database) return database;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is not configured.');
  pool = new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  database = drizzle(pool, { schema });
  return database;
}

export async function closeDb(): Promise<void> {
  const current = pool;
  pool = null;
  database = null;
  if (current) await current.end();
}
