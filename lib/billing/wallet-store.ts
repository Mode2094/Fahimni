import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { getDb } from '../../db';
import { creditLedger, creditWallets, entitlements, users } from '../../db/schema';

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
export type WalletSnapshot = CreditWalletRecord & { total: number };

export type SpendRequest = {
  userId: string;
  entitlementId: string | null;
  subjectId: string;
  requestId: string;
  credits: number;
  // Freeze the semester bucket past this instant (the entitlement expiry).
  spendableUntil?: Date | null;
};

export type SpendResult =
  | { ok: true; charged: boolean; duplicate: boolean; snapshot: WalletSnapshot }
  | { ok: false; reason: 'insufficient' | 'no_wallet'; snapshot: WalletSnapshot | null };

export type GrantResult = { granted: boolean; snapshot: WalletSnapshot };

export type CreditWalletStore = {
  getWallet(userId: string): Promise<CreditWalletRecord | null>;
  getSnapshot(userId: string): Promise<WalletSnapshot>;
  // Grants semester-included credits exactly once, keyed by `requestId`.
  grantSemesterCredits(input: {
    userId: string;
    credits: number;
    semesterId: string;
    entitlementId: string | null;
    requestId: string;
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
  // Spends credits: semester bucket first, then top-up. Atomic and idempotent.
  spend(input: SpendRequest): Promise<SpendResult>;
  // Refunds a prior spend exactly once, restoring the same buckets it debited.
  refund(input: {
    userId: string;
    requestId: string;
    reversesRequestId: string;
    note?: string | null;
  }): Promise<{ ok: true; refunded: number } | { ok: false; reason: 'not_found' | 'already_refunded' }>;
  // Expires remaining semester credits (semester ended). Ledger-recorded.
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
    actorId: string;
    reason: string;
    requestId: string;
  }): Promise<WalletSnapshot>;
  listLedger(userId: string, limit: number): Promise<CreditLedgerRecord[]>;
  // Ledger rows for one original spend plus its refund, used to decide refunds.
  findLedgerByRequestId(requestId: string): Promise<CreditLedgerRecord | null>;
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

// Postgres unique-violation code — used to make idempotent writes safe under
// concurrency: the second concurrent writer observes the first's row.
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === UNIQUE_VIOLATION;
}

function createDrizzleWalletStore(): CreditWalletStore {
  const db = () => getDb();
  const now = () => new Date();

  async function ensureWalletRow(userId: string, tx: ReturnType<typeof getDb>): Promise<CreditWalletRecord> {
    await tx
      .insert(creditWallets)
      .values({ userId, semesterBalance: 0, topupBalance: 0, updatedAt: now() })
      .onConflictDoNothing();
    const [row] = await tx.select(walletColumns).from(creditWallets).where(eq(creditWallets.userId, userId)).limit(1);
    return row;
  }

  // Serialises concurrent balance mutations on one wallet: the row is locked
  // FOR UPDATE for the duration of the transaction, so parallel spends queue
  // instead of racing on a guarded update and failing with a conflict.
  async function lockWalletRow(userId: string, tx: ReturnType<typeof getDb>): Promise<CreditWalletRecord> {
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

  return {
    async getWallet(userId) {
      const [row] = await db().select(walletColumns).from(creditWallets).where(eq(creditWallets.userId, userId)).limit(1);
      return row ?? null;
    },

    async getSnapshot(userId) {
      return snapshotOf(await this.getWallet(userId));
    },

    async grantSemesterCredits(input) {
      return db().transaction(async (tx) => {
        // Idempotency: if this grant requestId was already applied, return current.
        const existing = await tx
          .select(ledgerColumns)
          .from(creditLedger)
          .where(eq(creditLedger.requestId, input.requestId))
          .limit(1);
        if (existing.length) {
          return { granted: false, snapshot: snapshotOf(await ensureWalletRow(input.userId, tx)) };
        }
        const wallet = await ensureWalletRow(input.userId, tx);
        const nextSemester = wallet.semesterBalance + input.credits;
        const [updated] = await tx
          .update(creditWallets)
          .set({
            semesterBalance: nextSemester,
            semesterGrantedAt: now(),
            semesterExpiresAt: input.expiresAt,
            updatedAt: now(),
          })
          .where(eq(creditWallets.userId, input.userId))
          .returning(walletColumns);
        await tx.insert(creditLedger).values({
          id: crypto.randomUUID(),
          userId: input.userId,
          bucket: 'SEMESTER',
          kind: 'GRANT',
          delta: input.credits,
          balanceAfter: nextSemester,
          semesterId: input.semesterId,
          entitlementId: input.entitlementId,
          requestId: input.requestId,
          createdAt: now(),
        });
        return { granted: true, snapshot: snapshotOf(updated) };
      });
    },

    async grantTopupCredits(input) {
      return db().transaction(async (tx) => {
        const existing = await tx
          .select(ledgerColumns)
          .from(creditLedger)
          .where(eq(creditLedger.requestId, input.requestId))
          .limit(1);
        if (existing.length) {
          return { granted: false, snapshot: snapshotOf(await ensureWalletRow(input.userId, tx)) };
        }
        const wallet = await ensureWalletRow(input.userId, tx);
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
      });
    },

    async spend(input) {
      if (input.credits <= 0) {
        return { ok: true, charged: false, duplicate: false, snapshot: snapshotOf(await this.getWallet(input.userId)) };
      }
      const attempt = async () =>
        db().transaction(async (tx) => {
          const wallet = await lockWalletRow(input.userId, tx);
          // Duplicate detection: a ledger row with this requestId already exists.
          const [dup] = await tx
            .select(ledgerColumns)
            .from(creditLedger)
            .where(eq(creditLedger.requestId, input.requestId))
            .limit(1);
          if (dup) {
            return { ok: true as const, charged: false, duplicate: true, snapshot: snapshotOf(wallet) };
          }
          const semesterUsable =
            wallet.semesterBalance > 0 &&
            (input.spendableUntil == null || wallet.semesterExpiresAt == null || wallet.semesterExpiresAt.getTime() > now().getTime());
          const totalUsable = (semesterUsable ? wallet.semesterBalance : 0) + wallet.topupBalance;
          if (totalUsable < input.credits) {
            return { ok: false as const, reason: 'insufficient' as const, snapshot: snapshotOf(wallet) };
          }
          const fromSemester = semesterUsable ? Math.min(wallet.semesterBalance, input.credits) : 0;
          const fromTopup = input.credits - fromSemester;
          const nextSemester = wallet.semesterBalance - fromSemester;
          const nextTopup = wallet.topupBalance - fromTopup;
          // The row is locked FOR UPDATE, so a plain guarded update is safe.
          const updatedRows = await tx
            .update(creditWallets)
            .set({ semesterBalance: nextSemester, topupBalance: nextTopup, updatedAt: now() })
            .where(eq(creditWallets.userId, input.userId))
            .returning(walletColumns);
          if (!updatedRows.length) throw new Error('wallet_conflict');
          const updated = updatedRows[0];
          if (fromSemester > 0) {
            await tx.insert(creditLedger).values({
              id: crypto.randomUUID(),
              userId: input.userId,
              bucket: 'SEMESTER',
              kind: 'CONSUME',
              delta: -fromSemester,
              balanceAfter: nextSemester,
              subjectId: input.subjectId,
              entitlementId: input.entitlementId,
              requestId: input.requestId,
              createdAt: now(),
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
              requestId: `${input.requestId}:topup`,
              subjectId: input.subjectId,
              entitlementId: input.entitlementId,
              createdAt: now(),
            });
          }
          return { ok: true as const, charged: true, duplicate: false, snapshot: snapshotOf(updated) };
        });

      // Bounded retry for optimistic-concurrency conflicts.
      for (let tryIndex = 0; tryIndex < 6; tryIndex += 1) {
        try {
          return await attempt();
        } catch (error) {
          if (isUniqueViolation(error)) {
            return { ok: true, charged: false, duplicate: true, snapshot: snapshotOf(await this.getWallet(input.userId)) };
          }
          const message = error instanceof Error ? error.message : '';
          if (message === 'wallet_conflict' && tryIndex < 5) {
            await new Promise((resolve) => setTimeout(resolve, 5 + tryIndex * 5));
            continue;
          }
          throw error;
        }
      }
      throw new Error('wallet_conflict');
    },

    async refund(input) {
      return db().transaction(async (tx) => {
        // Already refunded? A refund ledger row referencing the same original
        // spend exists (a fresh refund requestId is used each attempt).
        const [existingRefund] = await tx
          .select(ledgerColumns)
          .from(creditLedger)
          .where(and(eq(creditLedger.kind, 'REFUND'), eq(creditLedger.reversesRequestId, input.reversesRequestId)))
          .limit(1);
        if (existingRefund) return { ok: false, reason: 'already_refunded' };

        const debits = await tx
          .select(ledgerColumns)
          .from(creditLedger)
          .where(
            and(
              eq(creditLedger.userId, input.userId),
              eq(creditLedger.kind, 'CONSUME'),
              // Both the primary and the derived ':topup' rows share the prefix.
              sql`${creditLedger.requestId} = ${input.reversesRequestId} OR ${creditLedger.requestId} = ${`${input.reversesRequestId}:topup`}`,
            ),
          );
        if (!debits.length) return { ok: false, reason: 'not_found' };

        const wallet = await ensureWalletRow(input.userId, tx);
        let semesterRefund = 0;
        let topupRefund = 0;
        for (const debit of debits) {
          if (debit.bucket === 'SEMESTER') semesterRefund += -debit.delta;
          else topupRefund += -debit.delta;
        }
        const nextSemester = wallet.semesterBalance + semesterRefund;
        const nextTopup = wallet.topupBalance + topupRefund;
        const [updated] = await tx
          .update(creditWallets)
          .set({ semesterBalance: nextSemester, topupBalance: nextTopup, updatedAt: now() })
          .where(eq(creditWallets.userId, input.userId))
          .returning(walletColumns);
        if (semesterRefund > 0) {
          await tx.insert(creditLedger).values({
            id: crypto.randomUUID(),
            userId: input.userId,
            bucket: 'SEMESTER',
            kind: 'REFUND',
            delta: semesterRefund,
            balanceAfter: nextSemester,
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
        return { ok: true, refunded: semesterRefund + topupRefund };
      });
    },

    async expireSemesterCredits(input) {
      return db().transaction(async (tx) => {
        const [existing] = await tx
          .select(ledgerColumns)
          .from(creditLedger)
          .where(eq(creditLedger.requestId, input.requestId))
          .limit(1);
        if (existing) return snapshotOf(await ensureWalletRow(input.userId, tx));
        const wallet = await ensureWalletRow(input.userId, tx);
        if (wallet.semesterBalance <= 0) return snapshotOf(wallet);
        const [updated] = await tx
          .update(creditWallets)
          .set({ semesterBalance: 0, semesterExpiresAt: now(), updatedAt: now() })
          .where(eq(creditWallets.userId, input.userId))
          .returning(walletColumns);
        await tx.insert(creditLedger).values({
          id: crypto.randomUUID(),
          userId: input.userId,
          bucket: 'SEMESTER',
          kind: 'EXPIRE',
          delta: -wallet.semesterBalance,
          balanceAfter: 0,
          semesterId: input.semesterId,
          requestId: input.requestId,
          note: input.note ?? null,
          createdAt: now(),
        });
        return snapshotOf(updated);
      });
    },

    async adjust(input) {
      return db().transaction(async (tx) => {
        const wallet = await ensureWalletRow(input.userId, tx);
        const current = input.bucket === 'SEMESTER' ? wallet.semesterBalance : wallet.topupBalance;
        const next = current + input.delta;
        if (next < 0) throw new Error('negative_balance');
        const patch =
          input.bucket === 'SEMESTER'
            ? { semesterBalance: next, updatedAt: now() }
            : { topupBalance: next, updatedAt: now() };
        const [updated] = await tx
          .update(creditWallets)
          .set(patch)
          .where(eq(creditWallets.userId, input.userId))
          .returning(walletColumns);
        await tx.insert(creditLedger).values({
          id: crypto.randomUUID(),
          userId: input.userId,
          bucket: input.bucket,
          kind: 'ADMIN_ADJUSTMENT',
          delta: input.delta,
          balanceAfter: next,
          requestId: input.requestId,
          note: input.reason,
          actorId: input.actorId,
          createdAt: now(),
        });
        return snapshotOf(updated);
      });
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

// Convenience re-exports used by tests and admin reports.
export { entitlements, users, creditWallets, creditLedger, isNull, gt };
