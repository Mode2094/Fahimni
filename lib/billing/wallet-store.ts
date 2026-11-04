import { and, asc, desc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';

import { getDb } from '../../db';
import {
  creditGrantDebits,
  creditLedger,
  creditOperations,
  creditWallets,
  entitlements,
  semesterCreditGrants,
  users,
} from '../../db/schema';

export type CreditBucket = 'SEMESTER' | 'TOPUP';
export type CreditLedgerKind =
  | 'GRANT'
  | 'CONSUME'
  | 'REFUND'
  | 'TOPUP_PURCHASE'
  | 'ADMIN_ADJUSTMENT'
  | 'REVERSAL'
  | 'EXPIRE';

export type CreditWalletRecord = {
  userId: string;
  semesterBalance: number;
  topupBalance: number;
  semesterGrantedAt: Date | null;
  semesterExpiresAt: Date | null;
  updatedAt: Date;
};

export type CreditLedgerRecord = {
  id: string;
  userId: string;
  bucket: CreditBucket;
  kind: CreditLedgerKind;
  delta: number;
  balanceAfter: number;
  subjectId: string | null;
  semesterId: string | null;
  entitlementId: string | null;
  topupPurchaseId: string | null;
  requestId: string;
  reversesRequestId: string | null;
  note: string | null;
  actorId: string | null;
  createdAt: Date;
};

// A wallet view the rest of the app reads. `total` is the spendable sum.
// `nextSemesterActivationAt` is the nearest future semester grant start (or
// null), so the UI can explain reserved-but-not-yet-spendable credits.
export type WalletSnapshot = CreditWalletRecord & { total: number; nextSemesterActivationAt?: Date | null };

export type SpendRequest = {
  userId: string;
  entitlementId: string | null;
  subjectId: string;
  requestId: string;
  credits: number;
  // Freeze the semester grants past this instant (the entitlement expiry).
  spendableUntil?: Date | null;
};

export type SpendResult =
  | { ok: true; charged: boolean; duplicate: boolean; snapshot: WalletSnapshot }
  | { ok: false; reason: 'insufficient' | 'no_wallet'; snapshot: WalletSnapshot | null };

export type GrantResult = { granted: boolean; snapshot: WalletSnapshot };

export type CreditWalletStore = {
  getWallet(userId: string): Promise<CreditWalletRecord | null>;
  getSnapshot(userId: string): Promise<WalletSnapshot>;
  // Grants semester-included credits exactly once into an isolated grant row
  // keyed by `requestId`. A future semester's grant never overwrites another
  // grant's balance or expiry.
  grantSemesterCredits(input: {
    userId: string;
    credits: number;
    semesterId: string;
    entitlementId: string | null;
    purchaseId?: string | null;
    requestId: string;
    startsAt?: Date;
    expiresAt: Date;
  }): Promise<GrantResult>;
  // Adds purchased top-up credits exactly once, keyed by `requestId`.
  grantTopupCredits(input: {
    userId: string;
    credits: number;
    topupPurchaseId: string;
    requestId: string;
    note?: string | null;
  }): Promise<GrantResult>;
  // Spends credits: usable semester grants first (oldest expiry first), then
  // top-up. Atomic and idempotent; records per-grant debits for exact refunds.
  spend(input: SpendRequest): Promise<SpendResult>;
  // Refunds a prior spend exactly once, restoring the same grants it debited.
  refund(input: {
    userId: string;
    requestId: string;
    reversesRequestId: string;
    note?: string | null;
  }): Promise<{ ok: true; refunded: number } | { ok: false; reason: 'not_found' | 'already_refunded' }>;
  // Expires remaining credits of ONE semester's grants only. Purchased top-up
  // credits are never touched.
  expireSemesterCredits(input: {
    userId: string;
    semesterId: string;
    requestId: string;
    note?: string | null;
  }): Promise<WalletSnapshot>;
  // Authorised manual adjustment with a mandatory reason.
  adjust(input: {
    userId: string;
    bucket: CreditBucket;
    delta: number;
    actorId: string | null;
    reason: string;
    requestId: string;
    // REQUIRED when bucket is SEMESTER: the adjustment is applied to exactly
    // this semester's grants. Never defaulted to an arbitrary semester.
    semesterId?: string | null;
    expiresAt?: Date | null;
  }): Promise<WalletSnapshot>;
  // Per-semester grant rows for a user (active and expired), newest first.
  listSemesterGrants(userId: string): Promise<SemesterGrantView[]>;
  listLedger(userId: string, limit: number): Promise<CreditLedgerRecord[]>;
  findLedgerByRequestId(requestId: string): Promise<CreditLedgerRecord | null>;
};

export type SemesterGrantView = {
  id: string;
  semesterId: string;
  purchaseId: string | null;
  grantedCredits: number;
  remainingCredits: number;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  startsAt: Date;
  expiresAt: Date;
};

const walletColumns = {
  userId: creditWallets.userId,
  semesterBalance: creditWallets.semesterBalance,
  topupBalance: creditWallets.topupBalance,
  semesterGrantedAt: creditWallets.semesterGrantedAt,
  semesterExpiresAt: creditWallets.semesterExpiresAt,
  updatedAt: creditWallets.updatedAt,
};

const ledgerColumns = {
  id: creditLedger.id,
  userId: creditLedger.userId,
  bucket: creditLedger.bucket,
  kind: creditLedger.kind,
  delta: creditLedger.delta,
  balanceAfter: creditLedger.balanceAfter,
  subjectId: creditLedger.subjectId,
  semesterId: creditLedger.semesterId,
  entitlementId: creditLedger.entitlementId,
  topupPurchaseId: creditLedger.topupPurchaseId,
  requestId: creditLedger.requestId,
  reversesRequestId: creditLedger.reversesRequestId,
  note: creditLedger.note,
  actorId: creditLedger.actorId,
  createdAt: creditLedger.createdAt,
};

const grantColumns = {
  id: semesterCreditGrants.id,
  semesterId: semesterCreditGrants.semesterId,
  purchaseId: semesterCreditGrants.purchaseId,
  grantedCredits: semesterCreditGrants.grantedCredits,
  remainingCredits: semesterCreditGrants.remainingCredits,
  status: semesterCreditGrants.status,
  startsAt: semesterCreditGrants.startsAt,
  expiresAt: semesterCreditGrants.expiresAt,
};

function snapshotOf(wallet: CreditWalletRecord | null): WalletSnapshot {
  const base: CreditWalletRecord = wallet ?? {
    userId: '',
    semesterBalance: 0,
    topupBalance: 0,
    semesterGrantedAt: null,
    semesterExpiresAt: null,
    updatedAt: new Date(0),
  };
  return { ...base, total: base.semesterBalance + base.topupBalance };
}

const UNIQUE_VIOLATION = '23505';
const MAX_TX_RETRIES = 6;

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

// Serialisation/retry helper: runs the transaction, retrying on deadlock /
// serialization failures (40001, 40P01) and on our explicit 'wallet_conflict'.
async function inRetryingTransaction<T>(run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_TX_RETRIES; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code ?? '';
      const message = error instanceof Error ? error.message : '';
      const retriable = code === '40001' || code === '40P01' || message === 'wallet_conflict';
      if (retriable && attempt < MAX_TX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, 4 + attempt * 6));
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('wallet_conflict');
}

function createDrizzleWalletStore(): CreditWalletStore {
  const db = () => getDb();
  const now = () => new Date();

  // Creates the wallet row if absent and locks it FOR UPDATE, so every balance
  // mutation on one wallet serialises instead of racing.
  async function lockWallet(userId: string, tx: ReturnType<typeof getDb>): Promise<CreditWalletRecord> {
    await tx
      .insert(creditWallets)
      .values({ userId, semesterBalance: 0, topupBalance: 0, updatedAt: now() })
      .onConflictDoNothing();
    const [row] = await tx
      .select(walletColumns)
      .from(creditWallets)
      .where(eq(creditWallets.userId, userId))
      .for('update')
      .limit(1);
    return row;
  }

  // Recomputes the aggregate semester cache from the grant rows inside the same
  // transaction, so the cache can never drift from the grants. Returns the sum.
  async function syncSemesterCache(userId: string, tx: ReturnType<typeof getDb>): Promise<{ semesterBalance: number; expiresAt: Date | null; grantedAt: Date | null }> {
    const [agg] = await tx
      .select({
        balance: sql<number>`coalesce(sum(case when ${semesterCreditGrants.status} = 'ACTIVE' and ${semesterCreditGrants.startsAt} <= now() and ${semesterCreditGrants.expiresAt} > now() then ${semesterCreditGrants.remainingCredits} else 0 end), 0)::int`,
        // Cast to timestamptz so the driver returns a Date, not a raw string.
        expiresAt: sql<string | null>`(max(case when ${semesterCreditGrants.status} = 'ACTIVE' then ${semesterCreditGrants.expiresAt} else null end))::timestamptz`,
        grantedAt: sql<string | null>`(max(case when ${semesterCreditGrants.status} = 'ACTIVE' then ${semesterCreditGrants.createdAt} else null end))::timestamptz`,
      })
      .from(semesterCreditGrants)
      .where(eq(semesterCreditGrants.userId, userId));
    const expiresAt = agg?.expiresAt ? new Date(agg.expiresAt) : null;
    const grantedAt = agg?.grantedAt ? new Date(agg.grantedAt) : null;
    const [updated] = await tx
      .update(creditWallets)
      .set({
        semesterBalance: agg?.balance ?? 0,
        semesterExpiresAt: expiresAt,
        semesterGrantedAt: grantedAt,
        updatedAt: now(),
      })
      .where(eq(creditWallets.userId, userId))
      .returning(walletColumns);
    void updated;
    return { semesterBalance: agg?.balance ?? 0, expiresAt, grantedAt };
  }

  return {
    async getWallet(userId) {
      const [row] = await db().select(walletColumns).from(creditWallets).where(eq(creditWallets.userId, userId)).limit(1);
      return row ?? null;
    },

    async getSnapshot(userId) {
      // Time-correct read: the persisted cache can be stale at a semester
      // boundary because a reserved (future) grant becomes spendable purely by
      // the passage of time, with no intervening mutation. Recompute the
      // spendable semester balance live from the grants in ONE bounded
      // aggregate query — no mutation of financial history.
      const dbc = db();
      const [wallet] = await dbc.select(walletColumns).from(creditWallets).where(eq(creditWallets.userId, userId)).limit(1);
      if (!wallet) return snapshotOf(null);
      const [agg] = await dbc
        .select({
          balance: sql<number>`coalesce(sum(case when ${semesterCreditGrants.status} = 'ACTIVE' and ${semesterCreditGrants.startsAt} <= now() and ${semesterCreditGrants.expiresAt} > now() then ${semesterCreditGrants.remainingCredits} else 0 end), 0)::int`,
          // The nearest future grant start, so the UI can show "activates on".
          nextStart: sql<string | null>`(min(case when ${semesterCreditGrants.status} = 'ACTIVE' and ${semesterCreditGrants.startsAt} > now() then ${semesterCreditGrants.startsAt} else null end))::timestamptz`,
        })
        .from(semesterCreditGrants)
        .where(eq(semesterCreditGrants.userId, userId));
      const liveSemester = agg?.balance ?? 0;
      const nextActivation = agg?.nextStart ? new Date(agg.nextStart) : null;
      return {
        ...wallet,
        semesterBalance: liveSemester,
        total: liveSemester + wallet.topupBalance,
        nextSemesterActivationAt: nextActivation,
      };
    },

    async grantSemesterCredits(input) {
      return inRetryingTransaction(() =>
        db().transaction(async (tx) => {
          await lockWallet(input.userId, tx);
          // Idempotency: one grant per request id (e.g. per purchase).
          const [existing] = await tx
            .select({ id: semesterCreditGrants.id })
            .from(semesterCreditGrants)
            .where(eq(semesterCreditGrants.grantRequestId, input.requestId))
            .limit(1);
          if (existing) {
            const wallet = await lockWallet(input.userId, tx);
            return { granted: false, snapshot: snapshotOf(wallet) };
          }
          // A grant without an explicit start is immediately usable. We use the
          // epoch (not JS `new Date()`) so it can never miss the SQL `now()`
          // boundary check by millisecond clock skew between app and database.
          const startsAt = input.startsAt ?? new Date(0);
          await tx.insert(semesterCreditGrants).values({
            id: crypto.randomUUID(),
            userId: input.userId,
            semesterId: input.semesterId,
            purchaseId: input.purchaseId ?? null,
            entitlementId: input.entitlementId,
            grantedCredits: input.credits,
            remainingCredits: input.credits,
            status: 'ACTIVE',
            startsAt,
            expiresAt: input.expiresAt,
            grantRequestId: input.requestId,
          });
          const agg = await syncSemesterCache(input.userId, tx);
          const wallet = await lockWallet(input.userId, tx);
          await tx.insert(creditLedger).values({
            id: crypto.randomUUID(),
            userId: input.userId,
            bucket: 'SEMESTER',
            kind: 'GRANT',
            delta: input.credits,
            balanceAfter: agg.semesterBalance,
            semesterId: input.semesterId,
            entitlementId: input.entitlementId,
            requestId: input.requestId,
            createdAt: now(),
          });
          return { granted: true, snapshot: snapshotOf(wallet) };
        }),
      );
    },

    async grantTopupCredits(input) {
      return inRetryingTransaction(() =>
        db().transaction(async (tx) => {
          const wallet = await lockWallet(input.userId, tx);
          const [existing] = await tx
            .select(ledgerColumns)
            .from(creditLedger)
            .where(eq(creditLedger.requestId, input.requestId))
            .limit(1);
          if (existing) {
            return { granted: false, snapshot: snapshotOf(wallet) };
          }
          const nextTopup = wallet.topupBalance + input.credits;
          const [updated] = await tx
            .update(creditWallets)
            .set({ topupBalance: nextTopup, updatedAt: now() })
            .where(eq(creditWallets.userId, input.userId))
            .returning(walletColumns);
          await tx.insert(creditLedger).values({
            id: crypto.randomUUID(),
            userId: input.userId,
            bucket: 'TOPUP',
            kind: 'TOPUP_PURCHASE',
            delta: input.credits,
            balanceAfter: nextTopup,
            topupPurchaseId: input.topupPurchaseId,
            requestId: input.requestId,
            note: input.note ?? null,
            createdAt: now(),
          });
          return { granted: true, snapshot: snapshotOf(updated) };
        }),
      );
    },

    async spend(input) {
      if (input.credits <= 0) {
        return { ok: true, charged: false, duplicate: false, snapshot: snapshotOf(await this.getWallet(input.userId)) };
      }
      try {
        return await inRetryingTransaction(() =>
          db().transaction(async (tx) => {
            const wallet = await lockWallet(input.userId, tx);
            // Canonical operation-level idempotency: the request id is the
            // primary key of credit_operations. This catches a replay whether
            // the charge was funded by semester credits, top-up credits, or
            // both — the top-up-only case previously had no bare-id ledger row.
            const [existingOperation] = await tx
              .select({ requestId: creditOperations.requestId })
              .from(creditOperations)
              .where(eq(creditOperations.requestId, input.requestId))
              .limit(1);
            if (existingOperation) {
              return { ok: true as const, charged: false, duplicate: true, snapshot: snapshotOf(wallet) };
            }

            const at = now();
            // Usable semester grants, oldest expiry first. A grant is usable
            // only when ACTIVE, started, and not expired; and never past the
            // caller's spendableUntil (the entitlement expiry).
            const usableGrants = await tx
              .select(grantColumns)
              .from(semesterCreditGrants)
              .where(
                and(
                  eq(semesterCreditGrants.userId, input.userId),
                  eq(semesterCreditGrants.status, 'ACTIVE'),
                  gt(semesterCreditGrants.remainingCredits, 0),
                  lte(semesterCreditGrants.startsAt, at),
                  gt(semesterCreditGrants.expiresAt, at),
                  input.spendableUntil ? lte(semesterCreditGrants.expiresAt, input.spendableUntil) : undefined,
                ),
              )
              .orderBy(asc(semesterCreditGrants.expiresAt), asc(semesterCreditGrants.createdAt));

            let remaining = input.credits;
            const debits: { grantId: string; amount: number }[] = [];
            for (const grant of usableGrants) {
              if (remaining <= 0) break;
              const take = Math.min(grant.remainingCredits, remaining);
              if (take <= 0) continue;
              const nextRemaining = grant.remainingCredits - take;
              await tx
                .update(semesterCreditGrants)
                .set({ remainingCredits: nextRemaining, updatedAt: at })
                .where(and(eq(semesterCreditGrants.id, grant.id), eq(semesterCreditGrants.remainingCredits, grant.remainingCredits)));
              await tx.insert(creditGrantDebits).values({
                id: crypto.randomUUID(),
                grantId: grant.id,
                requestId: input.requestId,
                amount: take,
              });
              debits.push({ grantId: grant.id, amount: take });
              remaining -= take;
            }

            const fromTopup = remaining;
            if (fromTopup > wallet.topupBalance) {
              // Not enough total credit: abort so nothing is debited.
              throw new Error('insufficient');
            }
            const nextTopup = wallet.topupBalance - fromTopup;
            await tx.update(creditWallets).set({ topupBalance: nextTopup, updatedAt: at }).where(eq(creditWallets.userId, input.userId));
            const agg = await syncSemesterCache(input.userId, tx);
            const [finalWallet] = await tx.select(walletColumns).from(creditWallets).where(eq(creditWallets.userId, input.userId)).limit(1);

            const semesterSpent = input.credits - fromTopup;
            // Record the canonical operation AFTER the balance mutations are
            // staged but inside the same transaction: a concurrent replay either
            // sees this row (duplicate) or its own insert violates the primary
            // key and retries into the duplicate branch.
            await tx.insert(creditOperations).values({
              requestId: input.requestId,
              userId: input.userId,
              kind: 'SPEND',
              credits: input.credits,
              semesterCredits: semesterSpent,
              topupCredits: fromTopup,
              subjectId: input.subjectId,
              entitlementId: input.entitlementId,
              createdAt: at,
            });
            if (semesterSpent > 0) {
              await tx.insert(creditLedger).values({
                id: crypto.randomUUID(),
                userId: input.userId,
                bucket: 'SEMESTER',
                kind: 'CONSUME',
                delta: -semesterSpent,
                balanceAfter: agg.semesterBalance,
                subjectId: input.subjectId,
                entitlementId: input.entitlementId,
                requestId: input.requestId,
                createdAt: at,
              });
            }
            if (fromTopup > 0) {
              await tx.insert(creditLedger).values({
                id: crypto.randomUUID(),
                userId: input.userId,
                bucket: 'TOPUP',
                kind: 'CONSUME',
                delta: -fromTopup,
                balanceAfter: nextTopup,
                subjectId: input.subjectId,
                entitlementId: input.entitlementId,
                requestId: `${input.requestId}:topup`,
                createdAt: at,
              });
            }
            return { ok: true as const, charged: true, duplicate: false, snapshot: snapshotOf(finalWallet) };
          }),
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          return { ok: true, charged: false, duplicate: true, snapshot: snapshotOf(await this.getWallet(input.userId)) };
        }
        if (error instanceof Error && error.message === 'insufficient') {
          return { ok: false, reason: 'insufficient', snapshot: snapshotOf(await this.getWallet(input.userId)) };
        }
        throw error;
      }
    },

    async refund(input) {
      return inRetryingTransaction(() =>
        db().transaction(async (tx) => {
          await lockWallet(input.userId, tx);
          // Canonical refund anchor: the operation row identified by the
          // original request id. Marking refunded_at is the exactly-once guard
          // and works whether the charge came from semester, top-up, or both.
          const [operation] = await tx
            .select({
              requestId: creditOperations.requestId,
              userId: creditOperations.userId,
              semesterCredits: creditOperations.semesterCredits,
              topupCredits: creditOperations.topupCredits,
              refundedAt: creditOperations.refundedAt,
            })
            .from(creditOperations)
            .where(eq(creditOperations.requestId, input.reversesRequestId))
            .for('update')
            .limit(1);

          // Backwards compatibility: a charge made before the operation table
          // existed has no row; fall back to the legacy per-bucket markers.
          if (!operation) {
            const [existingRefund] = await tx
              .select({ id: creditLedger.id })
              .from(creditLedger)
              .where(and(eq(creditLedger.kind, 'REFUND'), eq(creditLedger.reversesRequestId, input.reversesRequestId)))
              .limit(1);
            if (existingRefund) return { ok: false as const, reason: 'already_refunded' as const };
          } else {
            if (operation.refundedAt) return { ok: false as const, reason: 'already_refunded' as const };
            if (operation.userId !== input.userId) return { ok: false as const, reason: 'not_found' as const };
          }

          // Restore the exact grants this spend debited (via the per-grant debits).
          const grantDebits = await tx
            .select({
              id: creditGrantDebits.id,
              grantId: creditGrantDebits.grantId,
              amount: creditGrantDebits.amount,
              refundedAt: creditGrantDebits.refundedAt,
            })
            .from(creditGrantDebits)
            .where(and(eq(creditGrantDebits.requestId, input.reversesRequestId), isNull(creditGrantDebits.refundedAt)));
          let semesterRefund = 0;
          for (const debit of grantDebits) {
            await tx
              .update(semesterCreditGrants)
              .set({ remainingCredits: sql`${semesterCreditGrants.remainingCredits} + ${debit.amount}`, updatedAt: now() })
              .where(eq(semesterCreditGrants.id, debit.grantId));
            await tx.update(creditGrantDebits).set({ refundedAt: now() }).where(eq(creditGrantDebits.id, debit.id));
            semesterRefund += debit.amount;
          }

          // Restore the top-up portion if any was debited.
          const [topupDebit] = await tx
            .select(ledgerColumns)
            .from(creditLedger)
            .where(and(eq(creditLedger.requestId, `${input.reversesRequestId}:topup`), eq(creditLedger.kind, 'CONSUME')))
            .limit(1);
          const topupRefund = topupDebit ? -topupDebit.delta : 0;
          if (semesterRefund === 0 && topupRefund === 0) return { ok: false as const, reason: 'not_found' as const };

          const wallet = await lockWallet(input.userId, tx);
          const agg = await syncSemesterCache(input.userId, tx);
          const nextTopup = wallet.topupBalance + topupRefund;
          const [updated] = await tx
            .update(creditWallets)
            .set({ topupBalance: nextTopup, updatedAt: now() })
            .where(eq(creditWallets.userId, input.userId))
            .returning(walletColumns);

          // Mark the canonical operation refunded (exactly once).
          if (operation) {
            await tx.update(creditOperations).set({ refundedAt: now() }).where(eq(creditOperations.requestId, operation.requestId));
          }

          if (semesterRefund > 0) {
            await tx.insert(creditLedger).values({
              id: crypto.randomUUID(),
              userId: input.userId,
              bucket: 'SEMESTER',
              kind: 'REFUND',
              delta: semesterRefund,
              balanceAfter: agg.semesterBalance,
              requestId: input.requestId,
              reversesRequestId: input.reversesRequestId,
              note: input.note ?? null,
              createdAt: now(),
            });
          }
          if (topupRefund > 0) {
            await tx.insert(creditLedger).values({
              id: crypto.randomUUID(),
              userId: input.userId,
              bucket: 'TOPUP',
              kind: 'REFUND',
              delta: topupRefund,
              balanceAfter: nextTopup,
              requestId: semesterRefund > 0 ? `${input.requestId}:topup` : input.requestId,
              reversesRequestId: input.reversesRequestId,
              note: input.note ?? null,
              createdAt: now(),
            });
          }
          void updated;
          return { ok: true as const, refunded: semesterRefund + topupRefund };
        }),
      );
    },

    async expireSemesterCredits(input) {
      return inRetryingTransaction(() =>
        db().transaction(async (tx) => {
          const wallet = await lockWallet(input.userId, tx);
          // Expire only this semester's grants that still hold credits.
          const grants = await tx
            .select(grantColumns)
            .from(semesterCreditGrants)
            .where(
              and(
                eq(semesterCreditGrants.userId, input.userId),
                eq(semesterCreditGrants.semesterId, input.semesterId),
                eq(semesterCreditGrants.status, 'ACTIVE'),
              ),
            );
          let expiredCredits = 0;
          for (const grant of grants) {
            if (grant.remainingCredits > 0) {
              expiredCredits += grant.remainingCredits;
              await tx
                .update(semesterCreditGrants)
                .set({ remainingCredits: 0, status: 'EXPIRED', updatedAt: now() })
                .where(eq(semesterCreditGrants.id, grant.id));
            } else {
              await tx.update(semesterCreditGrants).set({ status: 'EXPIRED', updatedAt: now() }).where(eq(semesterCreditGrants.id, grant.id));
            }
          }
          const agg = await syncSemesterCache(input.userId, tx);
          const [updated] = await tx.select(walletColumns).from(creditWallets).where(eq(creditWallets.userId, input.userId)).limit(1);
          if (expiredCredits > 0) {
            await tx.insert(creditLedger).values({
              id: crypto.randomUUID(),
              userId: input.userId,
              bucket: 'SEMESTER',
              kind: 'EXPIRE',
              delta: -expiredCredits,
              balanceAfter: agg.semesterBalance,
              semesterId: input.semesterId,
              requestId: input.requestId,
              note: input.note ?? null,
              createdAt: now(),
            });
          }
          return snapshotOf(updated ?? wallet);
        }),
      );
    },

    async adjust(input) {
      return inRetryingTransaction(() =>
        db().transaction(async (tx) => {
          const wallet = await lockWallet(input.userId, tx);
          const [existing] = await tx
            .select({ id: creditLedger.id })
            .from(creditLedger)
            .where(eq(creditLedger.requestId, input.requestId))
            .limit(1);
          if (existing) return snapshotOf(wallet);

          if (input.bucket === 'SEMESTER') {
            // A semester adjustment requires an explicit semester context; we
            // never silently pick an arbitrary semester.
            if (!input.semesterId) throw new Error('semester_required');
            const at = now();

            if (input.delta < 0) {
              // Deduct from this semester's ACTIVE grants only, deterministically:
              // newest expiry first (most-recently usable), then oldest created.
              let toRemove = -input.delta;
              // Deduct from this semester's ACTIVE grants only, deterministically:
              // soonest-expiring first, then oldest created. Only grants of the
              // explicitly selected semester are touched.
              const grants = await tx
                .select(grantColumns)
                .from(semesterCreditGrants)
                .where(
                  and(
                    eq(semesterCreditGrants.userId, input.userId),
                    eq(semesterCreditGrants.semesterId, input.semesterId),
                    eq(semesterCreditGrants.status, 'ACTIVE'),
                    gt(semesterCreditGrants.remainingCredits, 0),
                  ),
                )
                .orderBy(asc(semesterCreditGrants.expiresAt), asc(semesterCreditGrants.createdAt))
                .for('update');
              const available = grants.reduce((sum, grant) => sum + grant.remainingCredits, 0);
              if (available < toRemove) throw new Error('insufficient_semester_credits');
              for (const grant of grants) {
                if (toRemove <= 0) break;
                const take = Math.min(grant.remainingCredits, toRemove);
                if (take <= 0) continue;
                await tx
                  .update(semesterCreditGrants)
                  .set({ remainingCredits: grant.remainingCredits - take, updatedAt: at })
                  .where(and(eq(semesterCreditGrants.id, grant.id), eq(semesterCreditGrants.remainingCredits, grant.remainingCredits)));
                await tx.insert(creditGrantDebits).values({
                  id: crypto.randomUUID(),
                  grantId: grant.id,
                  requestId: `${input.requestId}:adjust`,
                  amount: take,
                });
                toRemove -= take;
              }
            } else {
              // Positive adjustment: a dedicated admin grant within this semester,
              // immediately usable, clamped to the semester's own expiry.
              await tx.insert(semesterCreditGrants).values({
                id: crypto.randomUUID(),
                userId: input.userId,
                semesterId: input.semesterId,
                purchaseId: null,
                entitlementId: null,
                grantedCredits: input.delta,
                remainingCredits: input.delta,
                status: 'ACTIVE',
                startsAt: new Date(0),
                expiresAt: input.expiresAt ?? new Date('2100-01-01T00:00:00Z'),
                grantRequestId: input.requestId,
              });
            }

            const agg = await syncSemesterCache(input.userId, tx);
            const [updated] = await tx.select(walletColumns).from(creditWallets).where(eq(creditWallets.userId, input.userId)).limit(1);
            await tx.insert(creditLedger).values({
              id: crypto.randomUUID(),
              userId: input.userId,
              bucket: 'SEMESTER',
              kind: 'ADMIN_ADJUSTMENT',
              delta: input.delta,
              balanceAfter: agg.semesterBalance,
              semesterId: input.semesterId,
              requestId: input.requestId,
              note: input.reason,
              actorId: input.actorId,
              createdAt: at,
            });
            return snapshotOf(updated ?? wallet);
          }

          const next = wallet.topupBalance + input.delta;
          if (next < 0) throw new Error('negative_balance');
          const [updated] = await tx
            .update(creditWallets)
            .set({ topupBalance: next, updatedAt: now() })
            .where(eq(creditWallets.userId, input.userId))
            .returning(walletColumns);
          await tx.insert(creditLedger).values({
            id: crypto.randomUUID(),
            userId: input.userId,
            bucket: 'TOPUP',
            kind: 'ADMIN_ADJUSTMENT',
            delta: input.delta,
            balanceAfter: next,
            requestId: input.requestId,
            note: input.reason,
            actorId: input.actorId,
            createdAt: now(),
          });
          return snapshotOf(updated);
        }),
      );
    },

    async listSemesterGrants(userId) {
      const rows = await db()
        .select(grantColumns)
        .from(semesterCreditGrants)
        .where(eq(semesterCreditGrants.userId, userId))
        .orderBy(desc(semesterCreditGrants.createdAt));
      return rows;
    },

    async listLedger(userId, limit) {
      return db()
        .select(ledgerColumns)
        .from(creditLedger)
        .where(eq(creditLedger.userId, userId))
        .orderBy(desc(creditLedger.createdAt))
        .limit(limit);
    },

    async findLedgerByRequestId(requestId) {
      const [row] = await db().select(ledgerColumns).from(creditLedger).where(eq(creditLedger.requestId, requestId)).limit(1);
      return row ?? null;
    },
  };
}

let override: CreditWalletStore | null = null;

export function setCreditWalletStoreForTests(store: CreditWalletStore | null): void {
  override = store;
}

export function creditWalletStore(): CreditWalletStore {
  return override ?? createDrizzleWalletStore();
}

// The single server-side rule for "is a paid semester currently active for this
// user", used to decide whether top-up credits may be spent. Reuses the
// entitlements table so historical subscriptions keep working.
export async function hasActiveSemesterEntitlement(userId: string, at = new Date()): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: entitlements.id })
    .from(entitlements)
    .where(
      and(
        eq(entitlements.userId, userId),
        eq(entitlements.status, 'ACTIVE'),
        sql`(${entitlements.startsAt} IS NULL OR ${entitlements.startsAt} <= ${at})`,
        sql`(${entitlements.expiresAt} IS NULL OR ${entitlements.expiresAt} > ${at})`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// Read-only ledger vs wallet reconciliation. Never mutates anything.
export type WalletReconciliation = {
  userId: string;
  walletSemesterBalance: number;
  grantsSemesterBalance: number;
  walletTopupBalance: number;
  ledgerTopupBalance: number;
  mismatches: string[];
};

export async function reconcileWallet(userId: string): Promise<WalletReconciliation> {
  const db = getDb();
  const [wallet] = await db.select(walletColumns).from(creditWallets).where(eq(creditWallets.userId, userId)).limit(1);
  const [grantAgg] = await db
    .select({ sum: sql<number>`coalesce(sum(case when ${semesterCreditGrants.status} = 'ACTIVE' and ${semesterCreditGrants.startsAt} <= now() and ${semesterCreditGrants.expiresAt} > now() then ${semesterCreditGrants.remainingCredits} else 0 end), 0)::int` })
    .from(semesterCreditGrants)
    .where(eq(semesterCreditGrants.userId, userId));
  const [ledgerAgg] = await db
    .select({ sum: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), eq(creditLedger.bucket, 'TOPUP')));
  const walletSemester = wallet?.semesterBalance ?? 0;
  const walletTopup = wallet?.topupBalance ?? 0;
  const grantsSemester = grantAgg?.sum ?? 0;
  const ledgerTopup = ledgerAgg?.sum ?? 0;
  const mismatches: string[] = [];
  if (walletSemester !== grantsSemester) mismatches.push(`semester cache ${walletSemester} != grants ${grantsSemester}`);
  if (walletTopup !== ledgerTopup) mismatches.push(`topup cache ${walletTopup} != ledger ${ledgerTopup}`);
  return { userId, walletSemesterBalance: walletSemester, grantsSemesterBalance: grantsSemester, walletTopupBalance: walletTopup, ledgerTopupBalance: ledgerTopup, mismatches };
}

export { entitlements, users, creditWallets, creditLedger, semesterCreditGrants, creditGrantDebits, isNull, gt, or, and };
