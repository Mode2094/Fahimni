import { isEntitlementActive } from './entitlements';
import type { BillingStore } from './store';
import type { FreeTrialRecord } from '../trial/store';

// Presentation states for a subject card. Priority (highest first):
//   book  → paid → bundle → trial → trial-eligible → expired → none
// "book" wins because the tutor is not usable without a READY textbook.
export type SubjectAccessState = 'paid' | 'bundle' | 'trial' | 'trial-eligible' | 'expired' | 'none' | 'book';

// A claimed trial has not started; an active trial is usable until it expires
// or runs out of credits. Shared across every eligible subject.
export function isTrialUsable(trial: FreeTrialRecord | null, now = new Date()): boolean {
  if (!trial || trial.remainingCredits <= 0) return false;
  if (trial.status === 'CLAIMED') return true;
  if (trial.status === 'ACTIVE') return Boolean(trial.expiresAt && trial.expiresAt.getTime() > now.getTime());
  return false;
}

export function isTrialEnded(trial: FreeTrialRecord | null, now = new Date()): boolean {
  if (!trial) return false;
  if (trial.status === 'EXPIRED' || trial.status === 'EXHAUSTED' || trial.status === 'REVOKED') return true;
  if (trial.status === 'ACTIVE') {
    return trial.remainingCredits <= 0 || Boolean(trial.expiresAt && trial.expiresAt.getTime() <= now.getTime());
  }
  return false;
}

export type SubjectAccessInput = {
  billing: BillingStore;
  userId: string;
  subjects: readonly { id: string }[];
  trial: FreeTrialRecord | null;
  trialEnabled: boolean;
  readyBookIds: ReadonlySet<string>;
  now?: Date;
};

// Server-side, real access state per subject. Paid entitlements are
// authoritative (direct subject entitlements, then bundle scopes); an
// active/claimed shared trial covers every eligible subject; expired access is
// remembered only so the card can offer renewal. Nothing is client-guessed.
export async function resolveSubjectAccess(input: SubjectAccessInput): Promise<Map<string, SubjectAccessState>> {
  const { billing, userId, subjects, trial, trialEnabled, readyBookIds } = input;
  const now = input.now ?? new Date();
  const wanted = new Set(subjects.map((subject) => subject.id));

  const directPaid = new Set<string>();
  const bundleCovered = new Set<string>();
  const hadAccess = new Set<string>();

  const entitlements = await billing.listEntitlementsForUser(userId);
  for (const entitlement of entitlements) {
    const covers = async (): Promise<string[]> => {
      if (entitlement.subjectId) return [entitlement.subjectId];
      return billing.listEntitlementSubjectIds(entitlement.id);
    };
    if (isEntitlementActive(entitlement, now)) {
      if (entitlement.subjectId) directPaid.add(entitlement.subjectId);
      else for (const id of await covers()) bundleCovered.add(id);
    } else {
      for (const id of await covers()) hadAccess.add(id);
    }
  }

  const trialUsable = isTrialUsable(trial, now);
  const trialEnded = isTrialEnded(trial, now);
  // The trial claim flow refuses accounts that already hold paid access, so the
  // catalog must not advertise a trial they cannot activate.
  const paidAccess = directPaid.size > 0 || bundleCovered.size > 0;

  const states = new Map<string, SubjectAccessState>();
  for (const subject of subjects) {
    if (!wanted.has(subject.id)) continue;
    let state: SubjectAccessState;
    if (directPaid.has(subject.id)) state = 'paid';
    else if (bundleCovered.has(subject.id)) state = 'bundle';
    else if (trialUsable) state = 'trial';
    // A subject the student previously paid for (or a trial that ended) offers
    // renewal; untouched subjects can still start the one-time trial.
    else if (trialEnded || hadAccess.has(subject.id)) state = 'expired';
    else if (!trial && trialEnabled && !paidAccess) state = 'trial-eligible';
    else state = 'none';

    // The textbook gates the tutor: an unusable tutor is never advertised.
    if (!readyBookIds.has(subject.id)) state = 'book';
    states.set(subject.id, state);
  }
  return states;
}
