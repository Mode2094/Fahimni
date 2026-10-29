import { sql } from 'drizzle-orm';

import { getDb } from '../db';

export type HealthReport = {
  status: 'ok' | 'degraded';
  checks: {
    app: 'ok';
    database: 'ok' | 'down';
    redis: 'ok' | 'down' | 'not_configured';
  };
};

type HealthDeps = {
  checkDatabase?: () => Promise<void>;
  checkRedis?: () => Promise<'ok' | 'down' | 'not_configured'>;
};

async function defaultDatabaseCheck(): Promise<void> {
  await getDb().execute(sql`select 1`);
}

async function defaultRedisCheck(): Promise<'ok' | 'down' | 'not_configured'> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return 'not_configured';
  const { Redis } = await import('ioredis');
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  try {
    await client.connect();
    await client.ping();
    return 'ok';
  } catch {
    return 'down';
  } finally {
    client.disconnect();
  }
}

// Safe status only: no credentials, paths or error details ever leave here.
export async function checkHealth(deps: HealthDeps = {}): Promise<HealthReport> {
  const database = await (deps.checkDatabase ?? defaultDatabaseCheck)()
    .then(() => 'ok' as const)
    .catch(() => 'down' as const);
  const redis = await (deps.checkRedis ?? defaultRedisCheck)().catch(() => 'down' as const);
  const healthy = database === 'ok' && redis !== 'down';
  return { status: healthy ? 'ok' : 'degraded', checks: { app: 'ok', database, redis } };
}
