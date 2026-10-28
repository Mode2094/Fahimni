import { Redis } from 'ioredis';

import { ammanDateKey, ammanDayStart } from '../billing/terms';
import { memoryBudgetSpent } from './budget';
import { aiRuntimeConfig } from './runtime-config';
import { memoryTrialSpent } from '../trial/budget';
import { trialStore } from '../trial/store';

export type BudgetLine = { limitUsd: number; spentUsd: number };
export type AiBudgetStatus = {
  dayKey: string;
  source: 'redis' | 'memory';
  resetsAt: string;
  global: BudgetLine;
  trial: BudgetLine;
};

async function redisSpent(url: string, keys: string[]): Promise<number[] | null> {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2_000 });
  try {
    await client.connect();
    const values = await Promise.all(keys.map((key) => client.get(key)));
    return values.map((value) => (value ? Number.parseInt(value, 10) || 0 : 0));
  } catch {
    return null;
  } finally {
    client.disconnect();
  }
}

// Next Asia/Amman midnight as a UTC instant — the documented reset boundary.
export function budgetResetsAt(now = new Date()): Date {
  const [year, month, day] = ammanDateKey(now).split('-').map(Number);
  const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
  return ammanDayStart(ammanDateKey(tomorrow));
}

// Read-only inspection for the admin dashboard. Never mutates counters.
export async function aiBudgetStatus(now = new Date()): Promise<AiBudgetStatus> {
  const config = await aiRuntimeConfig().catch(() => null);
  const trialSettings = await trialStore().getSettings().catch(() => null);
  const dayKey = ammanDateKey(now);
  const redisUrl = process.env.REDIS_URL?.trim();
  let globalSpent = memoryBudgetSpent('ai', now);
  let trialSpent = memoryTrialSpent(now);
  let source: 'redis' | 'memory' = 'memory';
  if (redisUrl) {
    const values = await redisSpent(redisUrl, [`ai:budget:${dayKey}`, `trial:budget:${dayKey}`]);
    if (values) {
      globalSpent = values[0];
      trialSpent = values[1];
      source = 'redis';
    }
  }
  return {
    dayKey,
    source,
    resetsAt: budgetResetsAt(now).toISOString(),
    global: { limitUsd: config?.dailyBudgetUsd ?? 0, spentUsd: Number((globalSpent / 1_000_000).toFixed(4)) },
    trial: { limitUsd: trialSettings?.dailyBudgetUsd ?? 0, spentUsd: Number((trialSpent / 1_000_000).toFixed(4)) },
  };
}
