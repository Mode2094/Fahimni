import type { BillingStore, EntitlementRecord } from './store';
import type { SemesterRecord } from './semester-store';
import type { PurchaseStore, SubscriptionPurchaseRecord } from './purchase-store';
import type { CreditWalletStore, WalletSnapshot } from './wallet-store';
import { semesterAccessWindow, termPhase, daysRemaining } from './terms';

// The single unified subscription: one semester, all ready subjects for the
// student's grade/track, one credit wallet. This module owns the business rules
// that decide price, window, duplicate protection and the exact credit grant.

export type SubscriptionScope = {
  gradeId: string;
  academicFieldId: string | null;
};

// The subjects a unified semester subscription covers: every subject that is
// part of the student's grade/track AND has a READY textbook. Ordered and
// deduplicated so the frozen scope is deterministic.
export function includedSubjectIds(
  subjects: readonly { id: string; gradeId: string; academicFieldId: string | null }[],
  readyBookSubjectIds: ReadonlySet<string>,
  scope: SubscriptionScope,
): string[] {
  return subjects
    .filter((subject) => subjectAppliesToScope(subject, scope))
    .filter((subject) => readyBookSubjectIds.has(subject.id))
    .map((subject) => subject.id)
    .filter((id, index, all) => all.indexOf(id) === index);
}

export function subjectAppliesToScope(
  subject: { gradeId: string; academicFieldId: string | null },
  scope: SubscriptionScope,
): boolean {
  if (subject.gradeId !== scope.gradeId) return false;
  // A grade-wide semester (scope track null) covers every track of that grade.
  if (scope.academicFieldId === null) return true;
  // A grade-wide subject (no track) belongs to every track of its grade.
  if (subject.academicFieldId === null) return true;
  // Otherwise the subject's track must match the semester's track.
  return subject.academicFieldId === scope.academicFieldId;
}

export type StudentSubscriptionView = {
  semester: SemesterRecord | null;
  purchase: SubscriptionPurchaseRecord | null;
  // Publishable offer for display only when the semester is sellable.
  sellable: boolean;
  phase: 'upcoming' | 'ongoing' | 'ended' | 'none';
  daysRemaining: number;
  // Price is always from the server-side semester row; never from the client.
  priceMinor: number;
  currency: string;
  includedCredits: number;
  startsAt: Date | null;
  endsAt: Date | null;
  includedSubjectIds: string[];
  status: 'none' | 'scheduled' | 'active' | 'expired';
  wallet: WalletSnapshot | null;
};

// Late-enrollment price: the admin policy decides full price or a rubric-free
// simple proration by remaining whole days. Never below zero.
export function computeLateEnrollmentPrice(input: {
  policy: 'FULL_PRICE' | 'PRORATED';
  priceMinor: number;
  startsAt: Date;
  endsAt: Date;
  purchasedAt: Date;
}): number {
  if (input.policy === 'FULL_PRICE') return input.priceMinor;
  const totalMs = input.endsAt.getTime() - input.startsAt.getTime();
  const remainingMs = input.endsAt.getTime() - input.purchasedAt.getTime();
  if (totalMs <= 0 || remainingMs <= 0) return input.priceMinor;
  const ratio = Math.min(1, remainingMs / totalMs);
  // Round to the nearest minor unit, never below one minor unit.
  return Math.max(1, Math.round(input.priceMinor * ratio));
}

// A purchase is a duplicate when a live (PENDING/ACTIVE) purchase already exists
// for the same user and semester. Terminal states (expired/refunded/canceled)
// do not block a legitimate re-purchase.
export async function findDuplicatePurchase(
  purchases: PurchaseStore,
  userId: string,
  semesterId: string,
): Promise<SubscriptionPurchaseRecord | null> {
  return purchases.findLivePurchaseForUserSemester(userId, semesterId);
}

export type ProvisionResult = {
  purchase: SubscriptionPurchaseRecord;
  grantedCredits: boolean;
  wallet: WalletSnapshot;
};

// Records a verified semester purchase and grants its credits exactly once.
// Every step is idempotent: re-running with the same license id updates the
// existing purchase and never double-grants (the wallet store dedupes by
// requestId). The entitlement window is the shared semester window.
export async function provisionSemesterPurchase(input: {
  purchases: PurchaseStore;
  billing: BillingStore;
  wallets: CreditWalletStore;
  semester: SemesterRecord;
  userId: string;
  provider: { licenseId: string | null; subscriptionId: string | null; planId: string | null };
  purchasedAt: Date;
  now: Date;
}): Promise<ProvisionResult> {
  const { semester, userId } = input;
  const window = semesterAccessWindow({
    startsAt: semester.startsAt,
    endsAt: semester.endsAt,
    purchasedAt: input.purchasedAt,
  });
  const lateEnrollment = input.purchasedAt.getTime() > semester.startsAt.getTime();

  // Idempotent purchase row keyed by provider license id when present.
  let purchase =
    input.provider.licenseId
      ? await input.purchases.findPurchaseByProviderLicenseId(input.provider.licenseId)
      : null;
  if (purchase) {
    await input.purchases.updatePurchase(purchase.id, {
      status: 'ACTIVE',
      startsAt: window.startsAt,
      expiresAt: window.endsAt,
    });
    purchase = (await input.purchases.findPurchaseById(purchase.id)) ?? purchase;
  } else {
    purchase = await input.purchases.createPurchase({
      id: crypto.randomUUID(),
      userId,
      semesterId: semester.id,
      entitlementId: null,
      semesterName: semester.name,
      priceMinor: semester.priceMinor,
      currency: semester.currency,
      includedCredits: semester.includedCredits,
      startsAt: window.startsAt,
      expiresAt: window.endsAt,
      lateEnrollment,
      status: 'ACTIVE',
      provider: 'freemius',
      providerLicenseId: input.provider.licenseId,
      providerSubscriptionId: input.provider.subscriptionId,
      providerPlanId: input.provider.planId ?? semester.freemiusPlanId,
      creditsGrantedAt: null,
    });
  }

  // Create/refresh the single all-subject entitlement for this purchase.
  const entitlementId = purchase.entitlementId ?? crypto.randomUUID();
  const licenseKey = input.provider.licenseId ?? `semester:${semester.id}:${userId}`;
  const record: EntitlementRecord = {
    id: entitlementId,
    userId,
    subjectId: null,
    subjectPlanId: null,
    offerId: null,
    academicTermId: null,
    freemiusLicenseId: licenseKey,
    freemiusSubscriptionId: input.provider.subscriptionId,
    status: 'ACTIVE',
    renewalCanceled: false,
    startsAt: window.startsAt,
    expiresAt: window.endsAt,
    // The unified wallet is the source of truth; the entitlement's own balance
    // stays zero so the two accounting models never disagree.
    creditBalance: 0,
    creditPeriodStartedAt: null,
    creditPeriodEndsAt: null,
    createdAt: purchase.createdAt,
    updatedAt: input.now,
  };
  await input.billing.upsertEntitlement(record);
  if (purchase.entitlementId !== entitlementId) {
    await input.purchases.updatePurchase(purchase.id, { entitlementId });
  }

  // Grant semester-included credits exactly once, keyed by purchase id. The
  // grant is isolated per semester and starts when the semester's access window
  // starts, so an early purchase reserves credits that are not yet spendable and
  // never disturbs another semester's grant or expiry.
  const grant = await input.wallets.grantSemesterCredits({
    userId,
    credits: semester.includedCredits,
    semesterId: semester.id,
    entitlementId,
    purchaseId: purchase.id,
    requestId: `semester-grant:${purchase.id}`,
    startsAt: window.startsAt,
    expiresAt: window.endsAt,
  });
  if (grant.granted && purchase.creditsGrantedAt === null) {
    await input.purchases.updatePurchase(purchase.id, { creditsGrantedAt: input.now });
  }

  return { purchase: (await input.purchases.findPurchaseById(purchase.id)) ?? purchase, grantedCredits: grant.granted, wallet: grant.snapshot };
}

// Builds the single student-facing view of their subscription state.
export function subscriptionStatusFor(input: {
  semester: SemesterRecord | null;
  purchase: SubscriptionPurchaseRecord | null;
  now: Date;
}): 'none' | 'scheduled' | 'active' | 'expired' {
  if (!input.purchase) return 'none';
  const status = input.purchase.status;
  if (status === 'PENDING') return 'scheduled';
  if (status !== 'ACTIVE') return 'expired';
  if (input.purchase.startsAt.getTime() > input.now.getTime()) return 'scheduled';
  if (input.purchase.expiresAt.getTime() <= input.now.getTime()) return 'expired';
  return 'active';
}

export { termPhase, daysRemaining };
