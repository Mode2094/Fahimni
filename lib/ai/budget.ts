import { redisClient } from '../redis/client';

import { ammanDateKey } from '../billing/terms';
import { RateLimitConfigError } from '../rate-limit/config';
import type { TrialBudget } from '../trial/budget';

// Global daily AI spending budget covering every request (paid and trial).
// Same reserve/release semantics as the trial budget but under its own key
// namespace so trial and global accounting never mix. The day boundary is
// Asia/Amman midnight (the platform's operating timezone).
export type DailyBudget = TrialBudget;

const REQUEST_TTL_SECONDS = 2 * 24 * 60 * 60;
const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;

// Memory-mode registry so the admin status card can inspect the same counters
// the limiter uses in development (Redis is the production source of truth).
const memoryDays = new Map<string, Map<string, number>>();

export function memoryBudgetSpent(prefix: string, now = new Date()): number {
  return memoryDays.get(prefix)?.get(`${prefix}:budget:${ammanDateKey(now)}`) ?? 0;
}

function dayKey(prefix: string, now: Date): string {
  return `${prefix}:budget:${ammanDateKey(now)}`;
}

function requestKey(prefix: string, requestId: string): string {
  return `${prefix}:budget:req:${requestId}`;
}

export function createMemoryDailyBudget(prefix: string): DailyBudget {
  const days = new Map<string, number>();
  memoryDays.set(prefix, days);
  const requests = new Map<string, { day: string; amount: number }>();
  return {
    async reserve({ requestId, amountMicroUsd, budgetMicroUsd, now = new Date() }) {
      if (requests.has(requestId)) return { ok: true, spentMicroUsd: days.get(dayKey(prefix, now)) ?? 0 };
      const day = dayKey(prefix, now);
      const next = (days.get(day) ?? 0) + amountMicroUsd;
      if (next > budgetMicroUsd) return { ok: false, spentMicroUsd: days.get(day) ?? 0 };
      days.set(day, next);
      requests.set(requestId, { day, amount: amountMicroUsd });
      return { ok: true, spentMicroUsd: next };
    },
    async release(requestId) {
      const entry = requests.get(requestId);
      if (!entry) return;
      requests.delete(requestId);
      days.set(entry.day, Math.max(0, (days.get(entry.day) ?? 0) - entry.amount));
    },
  };
}

export function createRedisDailyBudget(url: string, prefix: string): DailyBudget {
  return {
    async reserve({ requestId, amountMicroUsd, budgetMicroUsd, now = new Date() }) {
      const connection = redisClient(url);
      const reqKey = requestKey(prefix, requestId);
      const existing = await connection.get(reqKey);
      const day = dayKey(prefix, now);
      if (existing !== null) {
        const total = Number.parseInt((await connection.get(day)) ?? '0', 10);
        return { ok: true, spentMicroUsd: Number.isFinite(total) ? total : 0 };
      }
      const total = await connection.incrby(day, amountMicroUsd);
      await connection.expire(day, DAY_TTL_SECONDS);
      if (total > budgetMicroUsd) {
        await connection.decrby(day, amountMicroUsd);
        return { ok: false, spentMicroUsd: Math.max(0, total - amountMicroUsd) };
      }
      await connection.set(reqKey, `${amountMicroUsd}:${day}`, 'EX', REQUEST_TTL_SECONDS);
      return { ok: true, spentMicroUsd: total };
    },
    async release(requestId) {
      const connection = redisClient(url);
      const raw = await connection.get(requestKey(prefix, requestId));
      if (raw === null) return;
      const [amountRaw, day] = raw.split(':');
      const amount = Number.parseInt(amountRaw, 10);
      if (Number.isFinite(amount) && amount > 0 && day) await connection.decrby(day, amount);
      await connection.del(requestKey(prefix, requestId));
    },
  };
}

let override: DailyBudget | null = null;
let cached: DailyBudget | null = null;
let cachedUrl: string | null = null;

export function setAiBudgetForTests(budget: DailyBudget | null): void {
  override = budget;
}

export function aiBudget(env: NodeJS.ProcessEnv = process.env): DailyBudget {
  if (override) return override;
  const url = env.REDIS_URL?.trim();
  if (url) {
    if (!cached || cachedUrl !== url) {
      cached = createRedisDailyBudget(url, 'ai');
      cachedUrl = url;
    }
    return cached;
  }
  if (env.NODE_ENV === 'production') throw new RateLimitConfigError('REDIS_URL is required in production.');
  cached ??= createMemoryDailyBudget('ai');
  return cached;
}
