import { redisClient } from '../redis/client';
import { RateLimitConfigError } from './config';

export type RateLimitResult = { ok: boolean; remaining: number };
export type RateLimiter = {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
};

export function createMemoryLimiter(): RateLimiter {
  const buckets = new Map<string, { count: number; reset: number }>();
  return {
    async consume(key, limit, windowMs) {
      const now = Date.now();
      if (buckets.size > 2000) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.reset < now) buckets.delete(bucketKey);
        }
      }
      const bucket = buckets.get(key);
      if (!bucket || bucket.reset < now) {
        buckets.set(key, { count: 1, reset: now + windowMs });
        return { ok: true, remaining: limit - 1 };
      }
      bucket.count += 1;
      return { ok: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count) };
    },
  };
}

export function createRedisLimiter(url: string): RateLimiter {
  return {
    async consume(key, limit, windowMs) {
      const connection = redisClient(url);
      const count = await connection.incr(key);
      if (count === 1) await connection.pexpire(key, windowMs);
      return { ok: count <= limit, remaining: Math.max(0, limit - count) };
    },
  };
}

let override: RateLimiter | null = null;
let cached: RateLimiter | null = null;
let cachedUrl: string | null = null;

export function setRateLimiterForTests(limiter: RateLimiter | null): void {
  override = limiter;
}

export function rateLimiter(env: NodeJS.ProcessEnv = process.env): RateLimiter {
  if (override) return override;
  const url = env.REDIS_URL?.trim();
  if (url) {
    if (!cached || cachedUrl !== url) {
      cached = createRedisLimiter(url);
      cachedUrl = url;
    }
    return cached;
  }
  if (env.NODE_ENV === 'production') throw new RateLimitConfigError('REDIS_URL is required in production.');
  cached ??= createMemoryLimiter();
  return cached;
}
