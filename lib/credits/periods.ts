import type { BillingStore, EntitlementRecord } from '../billing/store';
import { CREDIT_PERIOD_MS } from './config';

export function isCreditPeriodActive(entitlement: EntitlementRecord, now = new Date()): boolean {
  return Boolean(entitlement.creditPeriodEndsAt && entitlement.creditPeriodEndsAt.getTime() > now.getTime());
}

// Lazy monthly rollover: when a period has ended, the balance is reset to the
// current allowance (unused credits never accumulate). Bundle entitlements hold
// ONE shared wallet; every subject covered by the bundle resolves to this same
// row, so the allowance is never granted per subject.
export async function ensureCreditPeriod(
  store: BillingStore,
  entitlement: EntitlementRecord,
  now = new Date(),
): Promise<EntitlementRecord> {
  if (entitlement.status !== 'ACTIVE') return entitlement;
  if (isCreditPeriodActive(entitlement, now)) return entitlement;
  // Access already over: never open a new period past the contractual end.
  if (entitlement.expiresAt && entitlement.expiresAt.getTime() <= now.getTime()) return entitlement;

  // Allowance resolution: unified offer first, then legacy subject plan.
  const offer = entitlement.offerId ? await store.findSubscriptionOfferById(entitlement.offerId) : null;
  const plan = !offer && entitlement.subjectPlanId ? await store.findSubjectPlanById(entitlement.subjectPlanId) : null;
  // Without a resolvable source the allowance is unknown, so the current
  // balance carries into the new period instead of being wiped.
  const allowance = offer ? offer.monthlyCreditAllowance : plan ? plan.monthlyCreditAllowance : entitlement.creditBalance;
  const standardEnd = new Date(now.getTime() + CREDIT_PERIOD_MS);
  const endsAt =
    entitlement.expiresAt && entitlement.expiresAt.getTime() < standardEnd.getTime()
      ? entitlement.expiresAt
      : standardEnd;
  await store.updateCreditPeriod(entitlement.id, allowance, now, endsAt);
  return { ...entitlement, creditBalance: allowance, creditPeriodStartedAt: now, creditPeriodEndsAt: endsAt };
}
