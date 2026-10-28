import type { AiOperation } from '../rate-limit/config';

// Central trial configuration. Admin settings (system_settings) override these
// defaults for NEW claims only; existing trials are never modified.
export const TRIAL_DEFAULTS = {
  enabled: true,
  creditAllowance: 15,
  durationHours: 48,
  dailyBudgetUsd: 5,
} as const;

export const TRIAL_LIMITS = {
  maxCreditAllowance: 200,
  minDurationHours: 1,
  maxDurationHours: 24 * 30,
  maxDailyBudgetUsd: 1000,
} as const;

export const TRIAL_SETTING_KEYS = {
  enabled: 'trialEnabled',
  creditAllowance: 'trialCreditAllowance',
  durationHours: 'trialDurationHours',
  dailyBudgetUsd: 'trialDailyAiBudgetUsd',
} as const;

// Conservative pre-call reservations in micro-USD (1 USD = 1,000,000 µUSD).
// These bound worst-case spend BEFORE the provider call; the real cost may be
// lower, so the budget is intentionally conservative.
export const TRIAL_COST_MICRO_USD: Record<AiOperation, number> = {
  tutor: 30_000,
  vision: 20_000,
  transcription: 10_000,
  speech: 10_000,
};

export function usdToMicroUsd(value: number): number {
  return Math.max(0, Math.round(value * 1_000_000));
}

export function microUsdToUsd(value: number): number {
  return value / 1_000_000;
}
