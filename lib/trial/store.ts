import { and, count, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';

import { getDb } from '../../db';
import { aiUsageEvents, freeTrials, systemSettings, users } from '../../db/schema';
import { TRIAL_DEFAULTS, TRIAL_LIMITS, TRIAL_SETTING_KEYS, microUsdToUsd, usdToMicroUsd } from './config';

export type TrialStatus = 'CLAIMED' | 'ACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'REVOKED';

export type FreeTrialRecord = {
  id: string;
  userId: string;
  browserIdentityHash: string;
  status: TrialStatus;
  totalCredits: number;
  remainingCredits: number;
  claimedAt: Date;
  startedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TrialClaimOutcome =
  | { kind: 'created' | 'existing'; trial: FreeTrialRecord }
  | { kind: 'browser_conflict' };

export type TrialChargeResult =
  | { ok: true; balance: number; duplicate: boolean }
  | { ok: false; reason: 'insufficient' | 'not_found' };

export type TrialRefundResult = { ok: true; refunded: number } | { ok: false; reason: 'not_found' | 'already_refunded' };

export type TrialSettings = {
  enabled: boolean;
  creditAllowance: number;
  durationHours: number;
  dailyBudgetUsd: number;
};

export type TrialMetrics = {
  claimed: number;
  started: number;
  expired: number;
  exhausted: number;
  revoked: number;
  creditsConsumed: number;
  estimatedCostMicroUsd: number;
};

export type AdminTrialRow = FreeTrialRecord & { userEmail: string; userName: string | null };

export type TrialStore = {
  findByUserId(userId: string): Promise<FreeTrialRecord | null>;
  findByBrowserHash(hash: string): Promise<FreeTrialRecord | null>;
  claim(input: {
    id: string;
    userId: string;
    browserIdentityHash: string;
    totalCredits: number;
    claimedAt: Date;
  }): Promise<TrialClaimOutcome>;
  start(id: string, now: Date, expiresAt: Date): Promise<FreeTrialRecord | null>;
  setStatus(id: string, status: TrialStatus): Promise<void>;
  chargeTrialCredits(input: {
    trialId: string;
    userId: string;
    subjectId: string;
    operation: string;
    credits: number;
    requestId: string;
    estimatedCostMicroUsd: number;
  }): Promise<TrialChargeResult>;
  refundTrialCredits(requestId: string, now?: Date): Promise<TrialRefundResult>;
  // Most recent subject the trial actually used (real usage ledger only).
  latestUsageSubjectId(trialId: string): Promise<string | null>;
  getSettings(): Promise<TrialSettings>;
  setSettings(settings: TrialSettings): Promise<void>;
  metrics(): Promise<TrialMetrics>;
  listTrials(limit: number): Promise<AdminTrialRow[]>;
};

const trialColumns = {
  id: freeTrials.id,
  userId: freeTrials.userId,
  browserIdentityHash: freeTrials.browserIdentityHash,
  status: freeTrials.status,
  totalCredits: freeTrials.totalCredits,
  remainingCredits: freeTrials.remainingCredits,
  claimedAt: freeTrials.claimedAt,
  startedAt: freeTrials.startedAt,
  expiresAt: freeTrials.expiresAt,
  createdAt: freeTrials.createdAt,
  updatedAt: freeTrials.updatedAt,
};

function errorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    current = typeof current === 'object' && 'cause' in current ? (current as { cause?: unknown }).cause : null;
  }
  return null;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function parseSettings(rows: { key: string; value: string }[], env: NodeJS.ProcessEnv): TrialSettings {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const enabledRaw = byKey.get(TRIAL_SETTING_KEYS.enabled);
  const envBudget = Number.parseFloat(env.TRIAL_DAILY_AI_BUDGET_USD ?? '');
  const budgetRaw = Number.parseFloat(byKey.get(TRIAL_SETTING_KEYS.dailyBudgetUsd) ?? '');
  return {
    enabled: enabledRaw === undefined ? TRIAL_DEFAULTS.enabled : enabledRaw !== 'false',
    creditAllowance: clampInt(
      Number.parseInt(byKey.get(TRIAL_SETTING_KEYS.creditAllowance) ?? '', 10),
      1,
      TRIAL_LIMITS.maxCreditAllowance,
      TRIAL_DEFAULTS.creditAllowance,
    ),
    durationHours: clampInt(
      Number.parseInt(byKey.get(TRIAL_SETTING_KEYS.durationHours) ?? '', 10),
      TRIAL_LIMITS.minDurationHours,
      TRIAL_LIMITS.maxDurationHours,
      TRIAL_DEFAULTS.durationHours,
    ),
    dailyBudgetUsd: Math.min(
      TRIAL_LIMITS.maxDailyBudgetUsd,
      Math.max(0, Number.isFinite(budgetRaw) ? budgetRaw : Number.isFinite(envBudget) && envBudget > 0 ? envBudget : TRIAL_DEFAULTS.dailyBudgetUsd),
    ),
  };
}

function createDrizzleTrialStore(): TrialStore {
  const db = () => getDb();
  const now = () => new Date();

  const findByUserId = async (userId: string): Promise<FreeTrialRecord | null> => {
    const [row] = await db().select(trialColumns).from(freeTrials).where(eq(freeTrials.userId, userId)).limit(1);
    return row ?? null;
  };

  const findByBrowserHash = async (hash: string): Promise<FreeTrialRecord | null> => {
    const [row] = await db().select(trialColumns).from(freeTrials).where(eq(freeTrials.browserIdentityHash, hash)).limit(1);
    return row ?? null;
  };

  return {
    findByUserId,
    findByBrowserHash,

    // Atomic claim: unique constraints on user_id and browser_identity_hash are
    // the concurrency guard; a losing racer re-reads and resolves to the winner.
    async claim(input) {
      const existing = await findByUserId(input.userId);
      if (existing) return { kind: 'existing', trial: existing };
      const browserTrial = await findByBrowserHash(input.browserIdentityHash);
      if (browserTrial) {
        return browserTrial.userId === input.userId ? { kind: 'existing', trial: browserTrial } : { kind: 'browser_conflict' };
      }
      const stamp = now();
      try {
        const [row] = await db()
          .insert(freeTrials)
          .values({
            id: input.id,
            userId: input.userId,
            browserIdentityHash: input.browserIdentityHash,
            status: 'CLAIMED',
            totalCredits: input.totalCredits,
            remainingCredits: input.totalCredits,
            claimedAt: input.claimedAt,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .returning(trialColumns);
        return { kind: 'created', trial: row };
      } catch (error) {
        if (errorCode(error) === '23505') {
          const afterUser = await findByUserId(input.userId);
          if (afterUser) return { kind: 'existing', trial: afterUser };
          const afterBrowser = await findByBrowserHash(input.browserIdentityHash);
          if (afterBrowser && afterBrowser.userId === input.userId) return { kind: 'existing', trial: afterBrowser };
          return { kind: 'browser_conflict' };
        }
        throw error;
      }
    },

    async start(id, nowDate, expiresAt) {
      const [row] = await db()
        .update(freeTrials)
        .set({ status: 'ACTIVE', startedAt: nowDate, expiresAt, updatedAt: nowDate })
        .where(and(eq(freeTrials.id, id), eq(freeTrials.status, 'CLAIMED')))
        .returning(trialColumns);
      return row ?? null;
    },

    async setStatus(id, status) {
      await db().update(freeTrials).set({ status, updatedAt: now() }).where(eq(freeTrials.id, id));
    },

    // Single transaction: conditional decrement + usage row. requestId unique
    // makes retries idempotent; the WHERE guard makes negative balances
    // impossible under concurrency. One shared wallet across all subjects.
    async chargeTrialCredits(input) {
      try {
        return await db().transaction(async (tx) => {
          const [charged] = await tx
            .update(freeTrials)
            .set({ remainingCredits: sql`${freeTrials.remainingCredits} - ${input.credits}`, updatedAt: now() })
            .where(
              and(
                eq(freeTrials.id, input.trialId),
                eq(freeTrials.userId, input.userId),
                eq(freeTrials.status, 'ACTIVE'),
                gte(freeTrials.remainingCredits, input.credits),
              ),
            )
            .returning({ remainingCredits: freeTrials.remainingCredits });

          if (!charged) {
            const [existing] = await tx
              .select({ id: aiUsageEvents.id })
              .from(aiUsageEvents)
              .where(eq(aiUsageEvents.requestId, input.requestId))
              .limit(1);
            if (existing) {
              const [trial] = await tx
                .select({ remainingCredits: freeTrials.remainingCredits })
                .from(freeTrials)
                .where(eq(freeTrials.id, input.trialId))
                .limit(1);
              return { ok: true, balance: trial?.remainingCredits ?? 0, duplicate: true } as TrialChargeResult;
            }
            const [trial] = await tx
              .select({ id: freeTrials.id })
              .from(freeTrials)
              .where(eq(freeTrials.id, input.trialId))
              .limit(1);
            return { ok: false, reason: trial ? 'insufficient' : 'not_found' } as TrialChargeResult;
          }

          await tx.insert(aiUsageEvents).values({
            id: crypto.randomUUID(),
            userId: input.userId,
            subjectId: input.subjectId,
            entitlementId: null,
            trialId: input.trialId,
            operation: input.operation,
            creditsCharged: input.credits,
            estimatedCostMicroUsd: input.estimatedCostMicroUsd,
            requestId: input.requestId,
            createdAt: now(),
          });
          if (charged.remainingCredits === 0) {
            await tx
              .update(freeTrials)
              .set({ status: 'EXHAUSTED', updatedAt: now() })
              .where(and(eq(freeTrials.id, input.trialId), eq(freeTrials.status, 'ACTIVE')));
          }
          return { ok: true, balance: charged.remainingCredits, duplicate: false } as TrialChargeResult;
        });
      } catch (error) {
        if (errorCode(error) === '23505') {
          const trial = await findByUserId(input.userId);
          return { ok: true, balance: trial?.remainingCredits ?? 0, duplicate: true };
        }
        throw error;
      }
    },

    // Refunds once: the conditional update on refundedAt is atomic. A refund
    // that brings credits back to an exhausted (but unexpired) trial reopens it.
    async refundTrialCredits(requestId, nowDate = new Date()) {
      return db().transaction(async (tx) => {
        const [event] = await tx
          .update(aiUsageEvents)
          .set({ refundedAt: nowDate })
          .where(and(eq(aiUsageEvents.requestId, requestId), isNull(aiUsageEvents.refundedAt)))
          .returning({ trialId: aiUsageEvents.trialId, creditsCharged: aiUsageEvents.creditsCharged });

        if (!event) {
          const [existing] = await tx
            .select({ id: aiUsageEvents.id })
            .from(aiUsageEvents)
            .where(eq(aiUsageEvents.requestId, requestId))
            .limit(1);
          return (existing ? { ok: false, reason: 'already_refunded' } : { ok: false, reason: 'not_found' }) as TrialRefundResult;
        }

        if (event.trialId) {
          const [trial] = await tx
            .update(freeTrials)
            .set({ remainingCredits: sql`${freeTrials.remainingCredits} + ${event.creditsCharged}`, updatedAt: nowDate })
            .where(eq(freeTrials.id, event.trialId))
            .returning({ status: freeTrials.status, expiresAt: freeTrials.expiresAt });
          if (trial && trial.status === 'EXHAUSTED' && (!trial.expiresAt || trial.expiresAt.getTime() > nowDate.getTime())) {
            await tx.update(freeTrials).set({ status: 'ACTIVE', updatedAt: nowDate }).where(eq(freeTrials.id, event.trialId));
          }
        }
        return { ok: true, refunded: event.creditsCharged } as TrialRefundResult;
      });
    },

    async latestUsageSubjectId(trialId) {
      const [row] = await db()
        .select({ subjectId: aiUsageEvents.subjectId })
        .from(aiUsageEvents)
        .where(eq(aiUsageEvents.trialId, trialId))
        .orderBy(desc(aiUsageEvents.createdAt))
        .limit(1);
      return row?.subjectId ?? null;
    },

    async getSettings() {
      const rows = await db()
        .select({ key: systemSettings.key, value: systemSettings.value })
        .from(systemSettings)
        .where(sql`${systemSettings.key} in (${TRIAL_SETTING_KEYS.enabled}, ${TRIAL_SETTING_KEYS.creditAllowance}, ${TRIAL_SETTING_KEYS.durationHours}, ${TRIAL_SETTING_KEYS.dailyBudgetUsd})`);
      return parseSettings(rows, process.env);
    },

    async setSettings(settings) {
      const stamp = now();
      const entries: [string, string][] = [
        [TRIAL_SETTING_KEYS.enabled, settings.enabled ? 'true' : 'false'],
        [TRIAL_SETTING_KEYS.creditAllowance, String(settings.creditAllowance)],
        [TRIAL_SETTING_KEYS.durationHours, String(settings.durationHours)],
        [TRIAL_SETTING_KEYS.dailyBudgetUsd, String(settings.dailyBudgetUsd)],
      ];
      for (const [key, value] of entries) {
        await db()
          .insert(systemSettings)
          .values({ key, value, updatedAt: stamp })
          .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt: stamp } });
      }
    },

    async metrics() {
      const rows = await db()
        .select({ status: freeTrials.status, value: count() })
        .from(freeTrials)
        .groupBy(freeTrials.status);
      const byStatus = new Map(rows.map((row) => [row.status, Number(row.value)]));
      const claimed = rows.reduce((sum, row) => sum + Number(row.value), 0);
      const startedRows = await db()
        .select({ value: count() })
        .from(freeTrials)
        .where(isNotNull(freeTrials.startedAt));
      const [creditsRow] = await db()
        .select({ value: sql<number>`coalesce(sum(${freeTrials.totalCredits} - ${freeTrials.remainingCredits}), 0)::int` })
        .from(freeTrials);
      const [costRow] = await db()
        .select({ value: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostMicroUsd}), 0)::int` })
        .from(aiUsageEvents)
        .where(and(isNotNull(aiUsageEvents.trialId), isNull(aiUsageEvents.refundedAt)));
      return {
        claimed,
        started: Number(startedRows[0]?.value ?? 0),
        expired: byStatus.get('EXPIRED') ?? 0,
        exhausted: byStatus.get('EXHAUSTED') ?? 0,
        revoked: byStatus.get('REVOKED') ?? 0,
        creditsConsumed: Number(creditsRow?.value ?? 0),
        estimatedCostMicroUsd: Number(costRow?.value ?? 0),
      };
    },

    async listTrials(limit) {
      return db()
        .select({ ...trialColumns, userEmail: users.email, userName: users.name })
        .from(freeTrials)
        .innerJoin(users, eq(users.id, freeTrials.userId))
        .orderBy(desc(freeTrials.claimedAt))
        .limit(limit);
    },
  };
}

let override: TrialStore | null = null;

export function setTrialStoreForTests(store: TrialStore | null): void {
  override = store;
}

export function trialStore(): TrialStore {
  return override ?? createDrizzleTrialStore();
}

export { microUsdToUsd, usdToMicroUsd };
