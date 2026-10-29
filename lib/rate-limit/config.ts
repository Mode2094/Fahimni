export type AiOperation = 'tutor' | 'vision' | 'transcription' | 'speech';

// Central rate-limit configuration per AI operation (per user, short window).
export const RATE_LIMITS: Record<AiOperation, { limit: number; windowMs: number }> = {
  tutor: { limit: 20, windowMs: 5 * 60_000 },
  vision: { limit: 12, windowMs: 10 * 60_000 },
  transcription: { limit: 12, windowMs: 10 * 60_000 },
  speech: { limit: 120, windowMs: 5 * 60_000 },
};

// Trial-backed requests get stricter short-window caps on top of the standard
// per-operation limits, plus a burst guard against concurrent abuse.
export const TRIAL_RATE_LIMITS: Record<AiOperation, { limit: number; windowMs: number }> = {
  tutor: { limit: 12, windowMs: 5 * 60_000 },
  vision: { limit: 6, windowMs: 10 * 60_000 },
  transcription: { limit: 6, windowMs: 10 * 60_000 },
  speech: { limit: 60, windowMs: 5 * 60_000 },
};

export const TRIAL_BURST = { limit: 4, windowMs: 10_000 };
export const TRIAL_CLAIM_RATE = { limit: 10, windowMs: 60 * 60_000 };

export class RateLimitConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitConfigError';
  }
}

// Redis is mandatory for production AI rate limiting; the in-memory limiter is
// for development and tests only.
export function productionRateLimitingReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.REDIS_URL?.trim()) || env.NODE_ENV !== 'production';
}
