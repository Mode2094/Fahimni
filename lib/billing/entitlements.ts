import { CREDIT_PERIOD_MS } from '../credits/config';
import type {
  AcademicTermRecord,
  EntitlementRecord,
  EntitlementStatus,
  BillingStore,
  PlanType,
  SubscriptionOfferRecord,
} from './store';
import { semesterAccessWindow } from './terms';

export function isEntitlementActive(record: EntitlementRecord | null | undefined, now = new Date()): boolean {
  if (!record || record.status !== 'ACTIVE') return false;
  // A semester purchase made before the term starts becomes usable only on the
  // configured start boundary.
  if (record.startsAt && record.startsAt.getTime() > now.getTime()) return false;
  if (!record.expiresAt) return true;
  return record.expiresAt.getTime() > now.getTime();
}

// Server-side paywall check: an ACTIVE, in-window entitlement for exactly this
// user and subject. Bundle purchases resolve through their frozen scope.
export async function hasSubjectAccess(
  store: BillingStore,
  userId: string,
  subjectId: string,
  now = new Date(),
): Promise<boolean> {
  const entitlement = await store.findAccessibleEntitlement(userId, subjectId, now);
  return isEntitlementActive(entitlement, now);
}

// Minimal, structural view of a Freemius purchase; produced by the SDK's
// PurchaseInfo and by test fakes.
export type PurchaseLike = {
  email: string;
  planId: string;
  licenseId: string;
  subscriptionId: string | null;
  canceled: boolean;
  expiration: Date | null;
  created: Date;
  // Present on real SDK purchases; optional so older fakes stay valid.
  billingCycle?: 'monthly' | 'yearly' | 'oneoff' | null;
};

export function entitlementStatusForPurchase(purchase: PurchaseLike, now = new Date()): EntitlementStatus {
  if (purchase.canceled) return 'CANCELED';
  if (purchase.expiration && purchase.expiration.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export type OfferLifecycle = { status: EntitlementStatus; renewalCanceled: boolean };

// Renewal-aware lifecycle for verified offers:
// - recurring monthly cancellations keep access until the paid-through date;
// - canceled one-off (semester) purchases are treated as revoked/refunded;
// - anything past its effective expiry is EXPIRED.
export function offerLifecycleForPurchase(
  purchase: PurchaseLike,
  offerType: PlanType,
  now: Date,
  effectiveExpiresAt: Date | null,
): OfferLifecycle {
  if (effectiveExpiresAt && effectiveExpiresAt.getTime() <= now.getTime()) {
    return { status: 'EXPIRED', renewalCanceled: false };
  }
  if (!purchase.canceled) return { status: 'ACTIVE', renewalCanceled: false };
  if (offerType === 'SEMESTER' || !purchase.subscriptionId) {
    return { status: 'REFUNDED', renewalCanceled: false };
  }
  if (effectiveExpiresAt) return { status: 'ACTIVE', renewalCanceled: true };
  return { status: 'CANCELED', renewalCanceled: false };
}

// An offer must map unambiguously to the right Freemius billing configuration:
// a one-off purchase can never fund a recurring offer, and a recurring
// subscription can never fund a fixed academic semester.
export function offerMappingMatches(offer: Pick<SubscriptionOfferRecord, 'type'>, purchase: PurchaseLike): boolean {
  const cycle = purchase.billingCycle;
  if (cycle === 'oneoff') return offer.type === 'SEMESTER';
  if (cycle === 'monthly' || cycle === 'yearly') return offer.type === 'MONTHLY';
  if (offer.type === 'MONTHLY') {
    // Unknown cycle: structural check — a one-off has no subscription id and a
    // null expiration.
    return Boolean(purchase.subscriptionId) || purchase.expiration !== null;
  }
  return true;
}

function clampCreditPeriodEnd(now: Date, expiresAt: Date | null): Date {
  const standard = new Date(now.getTime() + CREDIT_PERIOD_MS);
  if (expiresAt && expiresAt.getTime() < standard.getTime()) return expiresAt;
  return standard;
}

export type SyncResult =
  | { ok: true }
  | { ok: false; reason: 'unknown_plan' | 'unknown_user' | 'plan_mismatch' | 'invalid_offer' };

// Maps a verified Freemius purchase to a local entitlement. Access is only ever
// granted when the Freemius plan maps to a local offer/plan AND the purchaser
// email maps to a local user.
export async function syncEntitlementFromPurchase(
  deps: { store: BillingStore; findUserByEmail: (email: string) => Promise<{ id: string } | null> },
  purchase: PurchaseLike,
  now = new Date(),
): Promise<SyncResult> {
  const offer = await deps.store.findSubscriptionOfferByFreemiusPlanId(purchase.planId);
  if (offer) return syncOfferEntitlement(deps, offer, purchase, now);

  // Backward compatibility: legacy per-subject plans keep their original
  // mapping behavior when no offer claims the Freemius plan id.
  const plan = await deps.store.findSubjectPlanByFreemiusPlanId(purchase.planId);
  if (!plan) return { ok: false, reason: 'unknown_plan' };

  const user = await deps.findUserByEmail(purchase.email.trim().toLowerCase());
  if (!user) return { ok: false, reason: 'unknown_user' };

  const existing = await deps.store.findEntitlementByLicenseId(purchase.licenseId);
  const status = entitlementStatusForPurchase(purchase, now);

  // Credits: initialize on first activation; reset only when the monthly usage
  // period has ended (unused credits never accumulate).
  let creditBalance = existing?.creditBalance ?? 0;
  let creditPeriodStartedAt = existing?.creditPeriodStartedAt ?? null;
  let creditPeriodEndsAt = existing?.creditPeriodEndsAt ?? null;
  if (status === 'ACTIVE') {
    const periodActive = creditPeriodEndsAt !== null && creditPeriodEndsAt.getTime() > now.getTime();
    if (!existing || !periodActive) {
      creditBalance = plan.monthlyCreditAllowance;
      creditPeriodStartedAt = now;
      creditPeriodEndsAt = new Date(now.getTime() + CREDIT_PERIOD_MS);
    }
  }

  await deps.store.upsertEntitlement({
    id: existing?.id ?? crypto.randomUUID(),
    userId: user.id,
    subjectId: plan.subjectId,
    subjectPlanId: plan.id,
    offerId: existing?.offerId ?? null,
    academicTermId: existing?.academicTermId ?? null,
    freemiusLicenseId: purchase.licenseId,
    freemiusSubscriptionId: purchase.subscriptionId,
    status,
    renewalCanceled: false,
    startsAt: purchase.created,
    expiresAt: purchase.expiration,
    creditBalance,
    creditPeriodStartedAt,
    creditPeriodEndsAt,
  });
  return { ok: true };
}

async function syncOfferEntitlement(
  deps: { store: BillingStore; findUserByEmail: (email: string) => Promise<{ id: string } | null> },
  offer: SubscriptionOfferRecord,
  purchase: PurchaseLike,
  now: Date,
): Promise<SyncResult> {
  if (offer.kind === 'SUBJECT' && !offer.subjectId) return { ok: false, reason: 'invalid_offer' };
  if (!offerMappingMatches(offer, purchase)) return { ok: false, reason: 'plan_mismatch' };

  const user = await deps.findUserByEmail(purchase.email.trim().toLowerCase());
  if (!user) return { ok: false, reason: 'unknown_user' };

  const existing = await deps.store.findEntitlementByLicenseId(purchase.licenseId);

  let startsAt: Date | null = purchase.created;
  let expiresAt: Date | null = purchase.expiration;
  let academicTermId: string | null = null;
  if (offer.type === 'SEMESTER') {
    const term: AcademicTermRecord | null = offer.academicTermId
      ? await deps.store.findAcademicTermById(offer.academicTermId)
      : null;
    if (term) {
      academicTermId = term.id;
      const window = semesterAccessWindow({ startsAt: term.startsAt, endsAt: term.endsAt, purchasedAt: purchase.created });
      startsAt = window.startsAt;
      expiresAt = window.endsAt;
      // Sold contracts are protected: a re-sync (license.updated, out-of-order
      // events) never moves boundaries that were already granted.
      if (existing?.academicTermId === term.id && existing.expiresAt) {
        startsAt = existing.startsAt ?? startsAt;
        expiresAt = existing.expiresAt;
      }
    } else {
      // Grandfathered legacy semester offer without a term: keep the purchase's
      // own expiry. A one-off with null expiration is NOT lifetime access once
      // a term is attached; without a term it is only kept for the legacy plan.
      startsAt = purchase.created;
      expiresAt = purchase.expiration;
    }
  }

  const lifecycle = offerLifecycleForPurchase(purchase, offer.type, now, expiresAt);

  let creditBalance = existing?.creditBalance ?? 0;
  let creditPeriodStartedAt = existing?.creditPeriodStartedAt ?? null;
  let creditPeriodEndsAt = existing?.creditPeriodEndsAt ?? null;
  if (lifecycle.status === 'ACTIVE') {
    const periodActive = creditPeriodEndsAt !== null && creditPeriodEndsAt.getTime() > now.getTime();
    if (!existing || !periodActive) {
      creditBalance = offer.monthlyCreditAllowance;
      creditPeriodStartedAt = now;
      creditPeriodEndsAt = clampCreditPeriodEnd(now, expiresAt);
    }
  } else if (!existing) {
    creditBalance = 0;
  }

  const entitlementId = existing?.id ?? crypto.randomUUID();
  const planChanged = Boolean(existing?.offerId) && existing?.offerId !== offer.id;

  await deps.store.upsertEntitlement({
    id: entitlementId,
    userId: user.id,
    subjectId: offer.kind === 'SUBJECT' ? offer.subjectId : null,
    subjectPlanId: existing?.subjectPlanId ?? null,
    offerId: offer.id,
    academicTermId,
    freemiusLicenseId: purchase.licenseId,
    freemiusSubscriptionId: purchase.subscriptionId,
    status: lifecycle.status,
    renewalCanceled: lifecycle.renewalCanceled,
    startsAt,
    expiresAt,
    creditBalance,
    creditPeriodStartedAt,
    creditPeriodEndsAt,
  });

  if (offer.kind === 'BUNDLE') {
    const scope = await deps.store.listBundleSubjectIds(offer.id);
    if (planChanged) {
      // Deliberate, verified plan change: replace the frozen scope.
      await deps.store.replaceEntitlementSubjects(entitlementId, scope);
    } else {
      // First grant freezes the scope; later syncs never widen it.
      await deps.store.ensureEntitlementSubjects(entitlementId, scope);
    }
  } else if (planChanged) {
    await deps.store.replaceEntitlementSubjects(entitlementId, []);
  }
  return { ok: true };
}

// The success page never grants access from redirect parameters; it only reads
// local entitlements written by the verified webhook flow.
export function successStateFor(entitlements: EntitlementRecord[], now = new Date()): 'active' | 'pending' {
  return entitlements.some((record) => isEntitlementActive(record, now)) ? 'active' : 'pending';
}
