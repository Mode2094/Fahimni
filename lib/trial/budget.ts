import { redisClient } from '../redis/client';

import { ammanDateKey } from '../billing/terms';
import { RateLimitConfigError } from '../rate-limit/config';

export type TrialBudgetReservation = { ok: true; spentMicroUsd: number } | { ok: false; spentMicroUsd: number };

// Daily global trial spending budget, in micro-USD. Reservations happen BEFORE
// the provider call and are keyed by requestId so retries never double-count.
// The atomic INCR is the concurrency guard across parallel requests. The day
// boundary is Asia/Amman midnight, matching the platform's operating timezone.
export type TrialBudget = {
  reserve(input: {
    requestId: string;
    amountMicroUsd: number;
    budgetMicroUsd: number;
    now?: Date;
  }): Promise<TrialBudgetReservation>;
  release(requestId: string): Promise<void>;
};

const REQUEST_TTL_SECONDS = 2 * 24 * 60 * 60;
const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;

// Memory-mode registry so the admin status card can inspect the same counters
// the limiter uses in development (Redis is the production source of truth).
const memoryDays = new Map<string, Map<string, number>>();

export function memoryTrialSpent(now = new Date()): number {
  return memoryDays.get('trial')?.get(`trial:budget:${ammanDateKey(now)}`) ?? 0;
}

function dayKey(now: Date): string {
  return `trial:budget:${ammanDateKey(now)}`;
}

function requestKey(requestId: string): string {
  return `trial:budget:req:${requestId}`;
}

export function createMemoryTrialBudget(): TrialBudget {
  const days = new Map<string, number>();
  memoryDays.set('trial', days);
  const requests = new Map<string, { day: string; amount: number }>();
  return {
    async reserve({ requestId, amountMicroUsd, budgetMicroUsd, now = new Date() }) {
      if (requests.has(requestId)) return { ok: true, spentMicroUsd: days.get(dayKey(now)) ?? 0 };
      const day = dayKey(now);
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
      const current = days.get(entry.day) ?? 0;
      days.set(entry.day, Math.max(0, current - entry.amount));
    },
  };
}

export function createRedisTrialBudget(url: string): TrialBudget {
  return {
    async reserve({ requestId, amountMicroUsd, budgetMicroUsd, now = new Date() }) {
      const connection = redisClient(url);
      const day = dayKey(now);
      const marker = await connection.set(
        requestKey(requestId),
        `${amountMicroUsd}:${day}`,
        'EX',
        REQUEST_TTL_SECONDS,
        'NX',
      );
      if (marker === null) {
        const spent = Number.parseInt((await connection.get(day)) ?? '0', 10);
        return { ok: true, spentMicroUsd: Number.isFinite(spent) ? spent : 0 };
      }
      const total = await connection.incrby(day, amountMicroUsd);
      if (total === amountMicroUsd) await connection.expire(day, DAY_TTL_SECONDS);
      if (total > budgetMicroUsd) {
        await connection.decrby(day, amountMicroUsd);
        await connection.del(requestKey(requestId));
        return { ok: false, spentMicroUsd: Math.max(0, total - amountMicroUsd) };
      }
      return { ok: true, spentMicroUsd: total };
    },
    async release(requestId) {
      const connection = redisClient(url);
      const raw = await connection.get(requestKey(requestId));
      if (raw === null) return;
      const [amountRaw, day] = raw.split(':');
      const amount = Number.parseInt(amountRaw, 10);
      if (Number.isFinite(amount) && amount > 0 && day) {
        await connection.decrby(day, amount);
      }
      await connection.del(requestKey(requestId));
    },
  };
}

let override: TrialBudget | null = null;
let cached: TrialBudget | null = null;
let cachedUrl: string | null = null;

export function setTrialBudgetForTests(budget: TrialBudget | null): void {
  override = budget;
}

export function trialBudget(env: NodeJS.ProcessEnv = process.env): TrialBudget {
  if (override) return override;
  const url = env.REDIS_URL?.trim();
  if (url) {
    if (!cached || cachedUrl !== url) {
      cached = createRedisTrialBudget(url);
      cachedUrl = url;
    }
    return cached;
  }
  if (env.NODE_ENV === 'production') throw new RateLimitConfigError('REDIS_URL is required in production.');
  cached ??= createMemoryTrialBudget();
  return cached;
}
