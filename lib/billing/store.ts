import { and, asc, desc, eq, gt, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';

import { getDb } from '../../db';
import { academicTerms, aiUsageEvents, bundleSubjects, entitlementSubjects, entitlements, subjectPlans, subscriptionOffers, users, webhookEvents } from '../../db/schema';

export type PlanType = 'MONTHLY' | 'SEMESTER';
export type EntitlementStatus = 'ACTIVE' | 'CANCELED' | 'EXPIRED' | 'REFUNDED' | 'PENDING';
export type OfferKind = 'SUBJECT' | 'BUNDLE';

export type SubjectPlanRecord = {
  id: string;
  subjectId: string;
  type: PlanType;
  freemiusPlanId: string | null;
  priceMinor: number | null;
  monthlyCreditAllowance: number;
  currency: string;
  isActive: boolean;
};

export type SubjectPlanInput = {
  subjectId: string;
  type: PlanType;
  freemiusPlanId: string | null;
  priceMinor: number | null;
  monthlyCreditAllowance: number;
  currency: string;
  isActive: boolean;
};

export type AcademicTermRecord = {
  id: string;
  name: string;
  academicYear: string;
  gradeId: string;
  academicFieldId: string | null;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AcademicTermInput = Omit<AcademicTermRecord, 'createdAt' | 'updatedAt'>;

export type SubscriptionOfferRecord = {
  id: string;
  dedupeKey: string;
  kind: OfferKind;
  type: PlanType;
  subjectId: string | null;
  gradeId: string | null;
  academicFieldId: string | null;
  academicTermId: string | null;
  freemiusPlanId: string | null;
  priceMinor: number | null;
  monthlyCreditAllowance: number;
  currency: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SubscriptionOfferInput = Omit<SubscriptionOfferRecord, 'createdAt' | 'updatedAt'>;

// A single combination (kind + subject/grade-field + type + term) can only
// ever exist once; the key is derived server-side, never trusted from a form.
export function subjectOfferDedupeKey(subjectId: string, type: PlanType, termId: string | null): string {
  return `SUBJECT:${subjectId}:${type}:${termId ?? '-'}`;
}

export function bundleOfferDedupeKey(
  gradeId: string,
  fieldId: string | null,
  type: PlanType,
  termId: string | null,
): string {
  return `BUNDLE:${gradeId}:${fieldId ?? '-'}:${type}:${termId ?? '-'}`;
}

export type EntitlementRecord = {
  id: string;
  userId: string;
  subjectId: string | null;
  subjectPlanId: string | null;
  offerId: string | null;
  academicTermId: string | null;
  freemiusLicenseId: string | null;
  freemiusSubscriptionId: string | null;
  status: EntitlementStatus;
  renewalCanceled: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  creditBalance: number;
  creditPeriodStartedAt: Date | null;
  creditPeriodEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EntitlementUpsert = Omit<EntitlementRecord, 'createdAt' | 'updatedAt'>;

export type AdminEntitlementRow = EntitlementRecord & { userEmail: string; userName: string | null };

export type ChargeInput = {
  entitlementId: string;
  userId: string;
  subjectId: string;
  operation: string;
  credits: number;
  requestId: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  audioSeconds?: number | null;
};

export type ChargeResult =
  | { ok: true; balance: number; duplicate: boolean }
  | { ok: false; reason: 'insufficient' | 'not_found' };

export type RefundResult = { ok: true; refunded: number } | { ok: false; reason: 'not_found' | 'already_refunded' };

export type UsageEventRecord = {
  id: string;
  entitlementId: string | null;
  creditsCharged: number;
  refundedAt: Date | null;
};

export type BillingStore = {
  listSubjectPlans(subjectId: string): Promise<SubjectPlanRecord[]>;
  findSubjectPlanById(id: string): Promise<SubjectPlanRecord | null>;
  findSubjectPlanByFreemiusPlanId(freemiusPlanId: string): Promise<SubjectPlanRecord | null>;
  findSubjectPlanBySubjectAndType(subjectId: string, type: PlanType): Promise<SubjectPlanRecord | null>;
  upsertSubjectPlan(input: SubjectPlanInput): Promise<SubjectPlanRecord>;
  // Academic terms (semester calendar)
  listAcademicTerms(): Promise<AcademicTermRecord[]>;
  findAcademicTermById(id: string): Promise<AcademicTermRecord | null>;
  upsertAcademicTerm(input: AcademicTermInput): Promise<AcademicTermRecord>;
  setAcademicTermActive(id: string, isActive: boolean): Promise<void>;
  countSoldEntitlementsForTerm(termId: string): Promise<number>;
  // Unified offers (SUBJECT/BUNDLE × MONTHLY/SEMESTER)
  listSubscriptionOffers(): Promise<SubscriptionOfferRecord[]>;
  findSubscriptionOfferById(id: string): Promise<SubscriptionOfferRecord | null>;
  findSubscriptionOfferByFreemiusPlanId(freemiusPlanId: string): Promise<SubscriptionOfferRecord | null>;
  upsertSubscriptionOffer(input: SubscriptionOfferInput): Promise<SubscriptionOfferRecord>;
  setSubscriptionOfferActive(id: string, isActive: boolean): Promise<void>;
  // Declared bundle scope (admin-managed)
  listBundleSubjectIds(offerId: string): Promise<string[]>;
  setBundleSubjects(offerId: string, subjectIds: string[]): Promise<void>;
  // Frozen per-purchase scope
  listEntitlementSubjectIds(entitlementId: string): Promise<string[]>;
  ensureEntitlementSubjects(entitlementId: string, subjectIds: string[]): Promise<void>;
  replaceEntitlementSubjects(entitlementId: string, subjectIds: string[]): Promise<void>;
  findEntitlementByLicenseId(licenseId: string): Promise<EntitlementRecord | null>;
  findEntitlementById(id: string): Promise<EntitlementRecord | null>;
  upsertEntitlement(record: EntitlementUpsert): Promise<void>;
  updateCreditPeriod(id: string, balance: number, startedAt: Date, endsAt: Date): Promise<void>;
  deleteEntitlementByLicenseId(licenseId: string): Promise<void>;
  findActiveEntitlement(userId: string, subjectId: string, now: Date): Promise<EntitlementRecord | null>;
  // Subject access through either a direct subject entitlement or a bundle
  // entitlement whose frozen scope covers the subject. Deterministic wallet
  // policy: most-specific (subject) first, then soonest-expiring bundle.
  findAccessibleEntitlement(userId: string, subjectId: string, now: Date): Promise<EntitlementRecord | null>;
  listEntitlementsForUser(userId: string): Promise<EntitlementRecord[]>;
  listEntitlementsWithUsers(limit: number, search?: string | null): Promise<AdminEntitlementRow[]>;
  chargeCredits(input: ChargeInput): Promise<ChargeResult>;
  refundCredits(requestId: string, now?: Date): Promise<RefundResult>;
  findUsageEventByRequestId(requestId: string): Promise<UsageEventRecord | null>;
  hasWebhookEvent(externalEventId: string): Promise<boolean>;
  recordWebhookEvent(externalEventId: string, type: string): Promise<void>;
};

const planColumns = {
  id: subjectPlans.id,
  subjectId: subjectPlans.subjectId,
  type: subjectPlans.type,
  freemiusPlanId: subjectPlans.freemiusPlanId,
  priceMinor: subjectPlans.priceMinor,
  monthlyCreditAllowance: subjectPlans.monthlyCreditAllowance,
  currency: subjectPlans.currency,
  isActive: subjectPlans.isActive,
};

const entitlementColumns = {
  id: entitlements.id,
  userId: entitlements.userId,
  subjectId: entitlements.subjectId,
  subjectPlanId: entitlements.subjectPlanId,
  offerId: entitlements.offerId,
  academicTermId: entitlements.academicTermId,
  freemiusLicenseId: entitlements.freemiusLicenseId,
  freemiusSubscriptionId: entitlements.freemiusSubscriptionId,
  status: entitlements.status,
  renewalCanceled: entitlements.renewalCanceled,
  startsAt: entitlements.startsAt,
  expiresAt: entitlements.expiresAt,
  creditBalance: entitlements.creditBalance,
  creditPeriodStartedAt: entitlements.creditPeriodStartedAt,
  creditPeriodEndsAt: entitlements.creditPeriodEndsAt,
  createdAt: entitlements.createdAt,
  updatedAt: entitlements.updatedAt,
};

const termColumns = {
  id: academicTerms.id,
  name: academicTerms.name,
  academicYear: academicTerms.academicYear,
  gradeId: academicTerms.gradeId,
  academicFieldId: academicTerms.academicFieldId,
  startsAt: academicTerms.startsAt,
  endsAt: academicTerms.endsAt,
  isActive: academicTerms.isActive,
  createdAt: academicTerms.createdAt,
  updatedAt: academicTerms.updatedAt,
};

const offerColumns = {
  id: subscriptionOffers.id,
  dedupeKey: subscriptionOffers.dedupeKey,
  kind: subscriptionOffers.kind,
  type: subscriptionOffers.type,
  subjectId: subscriptionOffers.subjectId,
  gradeId: subscriptionOffers.gradeId,
  academicFieldId: subscriptionOffers.academicFieldId,
  academicTermId: subscriptionOffers.academicTermId,
  freemiusPlanId: subscriptionOffers.freemiusPlanId,
  priceMinor: subscriptionOffers.priceMinor,
  monthlyCreditAllowance: subscriptionOffers.monthlyCreditAllowance,
  currency: subscriptionOffers.currency,
  isActive: subscriptionOffers.isActive,
  createdAt: subscriptionOffers.createdAt,
  updatedAt: subscriptionOffers.updatedAt,
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

function createDrizzleBillingStore(): BillingStore {
  const db = () => getDb();
  const now = () => new Date();

  return {
    async listSubjectPlans(subjectId) {
      return db().select(planColumns).from(subjectPlans).where(eq(subjectPlans.subjectId, subjectId));
    },

    async findSubjectPlanById(id) {
      const [row] = await db().select(planColumns).from(subjectPlans).where(eq(subjectPlans.id, id)).limit(1);
      return row ?? null;
    },

    async findSubjectPlanByFreemiusPlanId(freemiusPlanId) {
      const [row] = await db()
        .select(planColumns)
        .from(subjectPlans)
        .where(eq(subjectPlans.freemiusPlanId, freemiusPlanId))
        .limit(1);
      return row ?? null;
    },

    async findSubjectPlanBySubjectAndType(subjectId, type) {
      const [row] = await db()
        .select(planColumns)
        .from(subjectPlans)
        .where(and(eq(subjectPlans.subjectId, subjectId), eq(subjectPlans.type, type)))
        .limit(1);
      return row ?? null;
    },

    async upsertSubjectPlan(input) {
      const stamp = now();
      const [row] = await db()
        .insert(subjectPlans)
        .values({ id: crypto.randomUUID(), ...input, createdAt: stamp, updatedAt: stamp })
        .onConflictDoUpdate({
          target: [subjectPlans.subjectId, subjectPlans.type],
          set: {
            freemiusPlanId: input.freemiusPlanId,
            priceMinor: input.priceMinor,
            monthlyCreditAllowance: input.monthlyCreditAllowance,
            currency: input.currency,
            isActive: input.isActive,
            updatedAt: stamp,
          },
        })
        .returning(planColumns);
      return row;
    },

    async listAcademicTerms() {
      return db().select(termColumns).from(academicTerms).orderBy(desc(academicTerms.startsAt));
    },

    async findAcademicTermById(id) {
      const [row] = await db().select(termColumns).from(academicTerms).where(eq(academicTerms.id, id)).limit(1);
      return row ?? null;
    },

    async upsertAcademicTerm(input) {
      const stamp = now();
      const [row] = await db()
        .insert(academicTerms)
        .values({ ...input, createdAt: stamp, updatedAt: stamp })
        .onConflictDoUpdate({
          target: academicTerms.id,
          set: {
            name: input.name,
            academicYear: input.academicYear,
            gradeId: input.gradeId,
            academicFieldId: input.academicFieldId,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            isActive: input.isActive,
            updatedAt: stamp,
          },
        })
        .returning(termColumns);
      return row;
    },

    async setAcademicTermActive(id, isActive) {
      await db().update(academicTerms).set({ isActive, updatedAt: now() }).where(eq(academicTerms.id, id));
    },

    async countSoldEntitlementsForTerm(termId) {
      const [row] = await db()
        .select({ count: sql<number>`count(*)::int` })
        .from(entitlements)
        .where(eq(entitlements.academicTermId, termId));
      return row?.count ?? 0;
    },

    async listSubscriptionOffers() {
      return db().select(offerColumns).from(subscriptionOffers).orderBy(asc(subscriptionOffers.kind), asc(subscriptionOffers.createdAt));
    },

    async findSubscriptionOfferById(id) {
      const [row] = await db().select(offerColumns).from(subscriptionOffers).where(eq(subscriptionOffers.id, id)).limit(1);
      return row ?? null;
    },

    async findSubscriptionOfferByFreemiusPlanId(freemiusPlanId) {
      const [row] = await db()
        .select(offerColumns)
        .from(subscriptionOffers)
        .where(eq(subscriptionOffers.freemiusPlanId, freemiusPlanId))
        .limit(1);
      return row ?? null;
    },

    async upsertSubscriptionOffer(input) {
      const stamp = now();
      const [row] = await db()
        .insert(subscriptionOffers)
        .values({ ...input, createdAt: stamp, updatedAt: stamp })
        .onConflictDoUpdate({
          target: subscriptionOffers.dedupeKey,
          set: {
            kind: input.kind,
            type: input.type,
            subjectId: input.subjectId,
            gradeId: input.gradeId,
            academicFieldId: input.academicFieldId,
            academicTermId: input.academicTermId,
            freemiusPlanId: input.freemiusPlanId,
            priceMinor: input.priceMinor,
            monthlyCreditAllowance: input.monthlyCreditAllowance,
            currency: input.currency,
            isActive: input.isActive,
            updatedAt: stamp,
          },
        })
        .returning(offerColumns);
      return row;
    },

    async setSubscriptionOfferActive(id, isActive) {
      await db().update(subscriptionOffers).set({ isActive, updatedAt: now() }).where(eq(subscriptionOffers.id, id));
    },

    async listBundleSubjectIds(offerId) {
      const rows = await db()
        .select({ subjectId: bundleSubjects.subjectId })
        .from(bundleSubjects)
        .where(eq(bundleSubjects.offerId, offerId));
      return rows.map((row) => row.subjectId);
    },

    async setBundleSubjects(offerId, subjectIds) {
      await db().transaction(async (tx) => {
        await tx.delete(bundleSubjects).where(eq(bundleSubjects.offerId, offerId));
        if (subjectIds.length) {
          await tx.insert(bundleSubjects).values(subjectIds.map((subjectId) => ({ offerId, subjectId }))).onConflictDoNothing();
        }
      });
    },

    async listEntitlementSubjectIds(entitlementId) {
      const rows = await db()
        .select({ subjectId: entitlementSubjects.subjectId })
        .from(entitlementSubjects)
        .where(eq(entitlementSubjects.entitlementId, entitlementId));
      return rows.map((row) => row.subjectId);
    },

    // Freeze policy: the first verified grant snapshots the covered set and it
    // is never widened afterwards.
    async ensureEntitlementSubjects(entitlementId, subjectIds) {
      if (!subjectIds.length) return;
      await db().transaction(async (tx) => {
        const [existing] = await tx
          .select({ subjectId: entitlementSubjects.subjectId })
          .from(entitlementSubjects)
          .where(eq(entitlementSubjects.entitlementId, entitlementId))
          .limit(1);
        if (existing) return;
        await tx
          .insert(entitlementSubjects)
          .values(subjectIds.map((subjectId) => ({ entitlementId, subjectId })))
          .onConflictDoNothing();
      });
    },

    // Deliberate plan-change policy: an explicit verified plan change replaces
    // the frozen scope with the new offer's declared scope.
    async replaceEntitlementSubjects(entitlementId, subjectIds) {
      await db().transaction(async (tx) => {
        await tx.delete(entitlementSubjects).where(eq(entitlementSubjects.entitlementId, entitlementId));
        if (subjectIds.length) {
          await tx
            .insert(entitlementSubjects)
            .values(subjectIds.map((subjectId) => ({ entitlementId, subjectId })))
            .onConflictDoNothing();
        }
      });
    },

    async findEntitlementByLicenseId(licenseId) {
      const [row] = await db()
        .select(entitlementColumns)
        .from(entitlements)
        .where(eq(entitlements.freemiusLicenseId, licenseId))
        .limit(1);
      return row ?? null;
    },

    async findEntitlementById(id) {
      const [row] = await db().select(entitlementColumns).from(entitlements).where(eq(entitlements.id, id)).limit(1);
      return row ?? null;
    },

    async upsertEntitlement(record) {
      const stamp = now();
      await db()
        .insert(entitlements)
        .values({ ...record, createdAt: stamp, updatedAt: stamp })
        .onConflictDoUpdate({
          target: entitlements.freemiusLicenseId,
          set: {
            userId: record.userId,
            subjectId: record.subjectId,
            subjectPlanId: record.subjectPlanId,
            offerId: record.offerId,
            academicTermId: record.academicTermId,
            freemiusSubscriptionId: record.freemiusSubscriptionId,
            status: record.status,
            renewalCanceled: record.renewalCanceled,
            startsAt: record.startsAt,
            expiresAt: record.expiresAt,
            creditBalance: record.creditBalance,
            creditPeriodStartedAt: record.creditPeriodStartedAt,
            creditPeriodEndsAt: record.creditPeriodEndsAt,
            updatedAt: stamp,
          },
        });
    },

    async updateCreditPeriod(id, balance, startedAt, endsAt) {
      await db()
        .update(entitlements)
        .set({ creditBalance: balance, creditPeriodStartedAt: startedAt, creditPeriodEndsAt: endsAt, updatedAt: now() })
        .where(eq(entitlements.id, id));
    },

    async deleteEntitlementByLicenseId(licenseId) {
      await db().delete(entitlements).where(eq(entitlements.freemiusLicenseId, licenseId));
    },

    async findActiveEntitlement(userId, subjectId, nowDate) {
      const [row] = await db()
        .select(entitlementColumns)
        .from(entitlements)
        .where(
          and(
            eq(entitlements.userId, userId),
            eq(entitlements.subjectId, subjectId),
            eq(entitlements.status, 'ACTIVE'),
            or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, nowDate)),
          ),
        )
        .orderBy(desc(entitlements.expiresAt))
        .limit(1);
      return row ?? null;
    },

    // Access = a direct subject entitlement OR a bundle entitlement whose
    // frozen scope covers this subject. Wallet selection is deterministic:
    // the subject-specific wallet wins over any bundle; among bundles the
    // soonest-expiring one is consumed first, then the oldest.
    async findAccessibleEntitlement(userId, subjectId, nowDate) {
      const [row] = await db()
        .select(entitlementColumns)
        .from(entitlements)
        .where(
          and(
            eq(entitlements.userId, userId),
            eq(entitlements.status, 'ACTIVE'),
            or(isNull(entitlements.startsAt), lte(entitlements.startsAt, nowDate)),
            or(isNull(entitlements.expiresAt), gt(entitlements.expiresAt, nowDate)),
            or(
              eq(entitlements.subjectId, subjectId),
              sql`exists (select 1 from ${entitlementSubjects} where ${entitlementSubjects.entitlementId} = ${entitlements.id} and ${entitlementSubjects.subjectId} = ${subjectId})`,
            ),
          ),
        )
        .orderBy(
          sql`case when ${entitlements.subjectId} = ${subjectId} then 0 else 1 end`,
          sql`${entitlements.expiresAt} asc nulls last`,
          asc(entitlements.createdAt),
        )
        .limit(1);
      return row ?? null;
    },

    async listEntitlementsForUser(userId) {
      return db()
        .select(entitlementColumns)
        .from(entitlements)
        .where(eq(entitlements.userId, userId))
        .orderBy(desc(entitlements.createdAt));
    },

    async listEntitlementsWithUsers(limit, search) {
      const needle = search?.trim();
      const base = db()
        .select({ ...entitlementColumns, userEmail: users.email, userName: users.name })
        .from(entitlements)
        .innerJoin(users, eq(users.id, entitlements.userId));
      const filtered = needle
        ? base.where(or(ilike(users.email, `%${needle}%`), ilike(users.name, `%${needle}%`)))
        : base;
      return filtered.orderBy(desc(entitlements.createdAt)).limit(limit);
    },

    // Single transaction: conditional balance decrement + usage row. The unique
    // requestId makes retries idempotent; the WHERE guard makes balances
    // impossible to go negative under concurrency.
    async chargeCredits(input) {
      try {
        return await db().transaction(async (tx) => {
          const [charged] = await tx
            .update(entitlements)
            .set({ creditBalance: sql`${entitlements.creditBalance} - ${input.credits}`, updatedAt: now() })
            .where(
              and(
                eq(entitlements.id, input.entitlementId),
                eq(entitlements.userId, input.userId),
                eq(entitlements.status, 'ACTIVE'),
                gte(entitlements.creditBalance, input.credits),
              ),
            )
            .returning({ creditBalance: entitlements.creditBalance });

          if (!charged) {
            const [existing] = await tx
              .select({ id: aiUsageEvents.id })
              .from(aiUsageEvents)
              .where(eq(aiUsageEvents.requestId, input.requestId))
              .limit(1);
            if (existing) {
              const [entitlement] = await tx
                .select({ creditBalance: entitlements.creditBalance })
                .from(entitlements)
                .where(eq(entitlements.id, input.entitlementId))
                .limit(1);
              return { ok: true, balance: entitlement?.creditBalance ?? 0, duplicate: true } as ChargeResult;
            }
            return { ok: false, reason: 'insufficient' } as ChargeResult;
          }

          await tx.insert(aiUsageEvents).values({
            id: crypto.randomUUID(),
            userId: input.userId,
            subjectId: input.subjectId,
            entitlementId: input.entitlementId,
            operation: input.operation,
            creditsCharged: input.credits,
            requestId: input.requestId,
            inputTokens: input.inputTokens ?? null,
            outputTokens: input.outputTokens ?? null,
            audioSeconds: input.audioSeconds ?? null,
            createdAt: now(),
          });
          return { ok: true, balance: charged.creditBalance, duplicate: false } as ChargeResult;
        });
      } catch (error) {
        if (errorCode(error) === '23505') {
          const entitlement = await this.findEntitlementById(input.entitlementId);
          return { ok: true, balance: entitlement?.creditBalance ?? 0, duplicate: true };
        }
        throw error;
      }
    },

    // Refunds at most once: the conditional update on refundedAt is atomic.
    async refundCredits(requestId, nowDate = new Date()) {
      return db().transaction(async (tx) => {
        const [event] = await tx
          .update(aiUsageEvents)
          .set({ refundedAt: nowDate })
          .where(and(eq(aiUsageEvents.requestId, requestId), isNull(aiUsageEvents.refundedAt)))
          .returning({ entitlementId: aiUsageEvents.entitlementId, creditsCharged: aiUsageEvents.creditsCharged });

        if (!event) {
          const [existing] = await tx
            .select({ id: aiUsageEvents.id })
            .from(aiUsageEvents)
            .where(eq(aiUsageEvents.requestId, requestId))
            .limit(1);
          return (existing ? { ok: false, reason: 'already_refunded' } : { ok: false, reason: 'not_found' }) as RefundResult;
        }

        if (event.entitlementId) {
          await tx
            .update(entitlements)
            .set({ creditBalance: sql`${entitlements.creditBalance} + ${event.creditsCharged}`, updatedAt: nowDate })
            .where(eq(entitlements.id, event.entitlementId));
        }
        return { ok: true, refunded: event.creditsCharged } as RefundResult;
      });
    },

    async findUsageEventByRequestId(requestId) {
      const [row] = await db()
        .select({
          id: aiUsageEvents.id,
          entitlementId: aiUsageEvents.entitlementId,
          creditsCharged: aiUsageEvents.creditsCharged,
          refundedAt: aiUsageEvents.refundedAt,
        })
        .from(aiUsageEvents)
        .where(eq(aiUsageEvents.requestId, requestId))
        .limit(1);
      return row ?? null;
    },

    async hasWebhookEvent(externalEventId) {
      const [row] = await db()
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .where(eq(webhookEvents.externalEventId, externalEventId))
        .limit(1);
      return Boolean(row);
    },

    async recordWebhookEvent(externalEventId, type) {
      await db()
        .insert(webhookEvents)
        .values({ id: crypto.randomUUID(), externalEventId, type, processedAt: now() })
        .onConflictDoNothing({ target: webhookEvents.externalEventId });
    },
  };
}

let override: BillingStore | null = null;

export function setBillingStoreForTests(store: BillingStore | null): void {
  override = store;
}

export function billingStore(): BillingStore {
  return override ?? createDrizzleBillingStore();
}
