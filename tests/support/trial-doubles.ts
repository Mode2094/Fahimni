import { createMemoryTrialBudget, setTrialBudgetForTests, type TrialBudget } from '../../lib/trial/budget';
import { TRIAL_DEFAULTS } from '../../lib/trial/config';
import {
  setTrialStoreForTests,
  type AdminTrialRow,
  type FreeTrialRecord,
  type TrialChargeResult,
  type TrialClaimOutcome,
  type TrialMetrics,
  type TrialRefundResult,
  type TrialSettings,
  type TrialStatus,
  type TrialStore,
} from '../../lib/trial/store';

export type FakeTrialHarness = {
  store: TrialStore;
  trials: Map<string, FreeTrialRecord>;
  usage: Map<string, { trialId: string | null; subjectId: string | null; creditsCharged: number; refundedAt: Date | null; estimatedCostMicroUsd: number | null }>;
  settings: TrialSettings;
};

export function createFakeTrialStore(initialSettings?: Partial<TrialSettings>): FakeTrialHarness {
  const trials = new Map<string, FreeTrialRecord>();
  const usage = new Map<string, { trialId: string | null; subjectId: string | null; creditsCharged: number; refundedAt: Date | null; estimatedCostMicroUsd: number | null }>();
  const settings: TrialSettings = {
    enabled: TRIAL_DEFAULTS.enabled,
    creditAllowance: TRIAL_DEFAULTS.creditAllowance,
    durationHours: TRIAL_DEFAULTS.durationHours,
    dailyBudgetUsd: TRIAL_DEFAULTS.dailyBudgetUsd,
    ...initialSettings,
  };

  const byUser = (userId: string) => [...trials.values()].find((trial) => trial.userId === userId) ?? null;
  const byHash = (hash: string) => [...trials.values()].find((trial) => trial.browserIdentityHash === hash) ?? null;

  const store: TrialStore = {
    async findByUserId(userId) {
      return byUser(userId);
    },
    async findByBrowserHash(hash) {
      return byHash(hash);
    },
    // Synchronous check+insert (no awaits in between) mirrors the unique
    // constraints of the real store for parallel callers in one event loop.
    async claim(input): Promise<TrialClaimOutcome> {
      const existing = byUser(input.userId);
      if (existing) return { kind: 'existing', trial: existing };
      const browser = byHash(input.browserIdentityHash);
      if (browser) {
        return browser.userId === input.userId ? { kind: 'existing', trial: browser } : { kind: 'browser_conflict' };
      }
      const now = new Date();
      const row: FreeTrialRecord = {
        id: input.id,
        userId: input.userId,
        browserIdentityHash: input.browserIdentityHash,
        status: 'CLAIMED',
        totalCredits: input.totalCredits,
        remainingCredits: input.totalCredits,
        claimedAt: input.claimedAt,
        startedAt: null,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      };
      trials.set(row.id, row);
      return { kind: 'created', trial: row };
    },
    async start(id, now, expiresAt) {
      const trial = trials.get(id);
      if (!trial || trial.status !== 'CLAIMED') return null;
      const row: FreeTrialRecord = { ...trial, status: 'ACTIVE', startedAt: now, expiresAt, updatedAt: now };
      trials.set(id, row);
      return row;
    },
    async setStatus(id, status: TrialStatus) {
      const trial = trials.get(id);
      if (trial) trials.set(id, { ...trial, status, updatedAt: new Date() });
    },
    async chargeTrialCredits(input): Promise<TrialChargeResult> {
      const existing = usage.get(input.requestId);
      const trial = trials.get(input.trialId);
      if (existing) return { ok: true, balance: trial?.remainingCredits ?? 0, duplicate: true };
      if (!trial) return { ok: false, reason: 'not_found' };
      if (trial.userId !== input.userId || trial.status !== 'ACTIVE' || trial.remainingCredits < input.credits) {
        return { ok: false, reason: 'insufficient' };
      }
      const remaining = trial.remainingCredits - input.credits;
      trials.set(trial.id, {
        ...trial,
        remainingCredits: remaining,
        status: remaining === 0 ? 'EXHAUSTED' : trial.status,
        updatedAt: new Date(),
      });
      usage.set(input.requestId, {
        trialId: trial.id,
        subjectId: input.subjectId,
        creditsCharged: input.credits,
        refundedAt: null,
        estimatedCostMicroUsd: input.estimatedCostMicroUsd,
      });
      return { ok: true, balance: remaining, duplicate: false };
    },
    async refundTrialCredits(requestId, now = new Date()): Promise<TrialRefundResult> {
      const event = usage.get(requestId);
      if (!event) return { ok: false, reason: 'not_found' };
      if (event.refundedAt) return { ok: false, reason: 'already_refunded' };
      event.refundedAt = now;
      if (event.trialId) {
        const trial = trials.get(event.trialId);
        if (trial) {
          const remaining = trial.remainingCredits + event.creditsCharged;
          const reopen = trial.status === 'EXHAUSTED' && (!trial.expiresAt || trial.expiresAt.getTime() > now.getTime());
          trials.set(trial.id, { ...trial, remainingCredits: remaining, status: reopen ? 'ACTIVE' : trial.status, updatedAt: now });
        }
      }
      return { ok: true, refunded: event.creditsCharged };
    },
    async latestUsageSubjectId(trialId) {
      for (const [, event] of [...usage.entries()].reverse()) {
        if (event.trialId === trialId && event.subjectId) return event.subjectId;
      }
      return null;
    },
    async getSettings() {
      return { ...settings };
    },
    async setSettings(next) {
      Object.assign(settings, next);
    },
    async metrics(): Promise<TrialMetrics> {
      const rows = [...trials.values()];
      const activeUsage = [...usage.values()].filter((event) => event.trialId && !event.refundedAt);
      return {
        claimed: rows.length,
        started: rows.filter((trial) => trial.startedAt).length,
        expired: rows.filter((trial) => trial.status === 'EXPIRED').length,
        exhausted: rows.filter((trial) => trial.status === 'EXHAUSTED').length,
        revoked: rows.filter((trial) => trial.status === 'REVOKED').length,
        creditsConsumed: rows.reduce((sum, trial) => sum + (trial.totalCredits - trial.remainingCredits), 0),
        estimatedCostMicroUsd: activeUsage.reduce((sum, event) => sum + (event.estimatedCostMicroUsd ?? 0), 0),
      };
    },
    async listTrials(limit): Promise<AdminTrialRow[]> {
      return [...trials.values()].slice(0, limit).map((trial) => ({ ...trial, userEmail: `${trial.userId}@test`, userName: null }));
    },
  };

  return { store, trials, usage, settings };
}

// Installs fresh trial store + budget doubles. Returns handles for assertions.
export function setTrialTestDoubles(initialSettings?: Partial<TrialSettings>): FakeTrialHarness & { budget: TrialBudget } {
  const harness = createFakeTrialStore(initialSettings);
  const budget = createMemoryTrialBudget();
  setTrialStoreForTests(harness.store);
  setTrialBudgetForTests(budget);
  return { ...harness, budget };
}

export function resetTrialTestDoubles(): void {
  setTrialStoreForTests(null);
  setTrialBudgetForTests(null);
}
