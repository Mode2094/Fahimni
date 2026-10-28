import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isTrialEnded, isTrialUsable, resolveSubjectAccess } from '../lib/billing/access-map';
import type { BillingStore, EntitlementRecord } from '../lib/billing/store';
import type { FreeTrialRecord } from '../lib/trial/store';

const NOW = new Date('2026-06-01T12:00:00Z');

function ent(overrides: Partial<EntitlementRecord>): EntitlementRecord {
  return {
    id: crypto.randomUUID(),
    userId: 'u1',
    subjectId: null,
    subjectPlanId: null,
    offerId: null,
    academicTermId: null,
    freemiusLicenseId: null,
    freemiusSubscriptionId: null,
    status: 'ACTIVE',
    renewalCanceled: false,
    startsAt: null,
    expiresAt: null,
    creditBalance: 0,
    creditPeriodStartedAt: null,
    creditPeriodEndsAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function trial(overrides: Partial<FreeTrialRecord>): FreeTrialRecord {
  return {
    id: 't1',
    userId: 'u1',
    browserIdentityHash: 'h',
    status: 'CLAIMED',
    totalCredits: 15,
    remainingCredits: 15,
    claimedAt: NOW,
    startedAt: null,
    expiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// The resolver only reads these two billing methods; the cast keeps the fake
// intentionally small and explicit.
function billingWith(entitlements: EntitlementRecord[], scopes: Record<string, string[]> = {}): BillingStore {
  return {
    listEntitlementsForUser: async () => entitlements,
    listEntitlementSubjectIds: async (id: string) => scopes[id] ?? [],
  } as unknown as BillingStore;
}

const subjects = [{ id: 'math' }, { id: 'physics' }];
const allBooks = new Set(['math', 'physics']);

async function resolve(input: {
  entitlements?: EntitlementRecord[];
  scopes?: Record<string, string[]>;
  trial?: FreeTrialRecord | null;
  trialEnabled?: boolean;
  ready?: Set<string>;
}) {
  return resolveSubjectAccess({
    billing: billingWith(input.entitlements ?? [], input.scopes),
    userId: 'u1',
    subjects,
    trial: input.trial ?? null,
    trialEnabled: input.trialEnabled ?? true,
    readyBookIds: input.ready ?? allBooks,
    now: NOW,
  });
}

test('zero paid subscriptions: trial-eligible when enabled, none when disabled', async () => {
  const eligible = await resolve({});
  assert.deepEqual([...eligible.values()], ['trial-eligible', 'trial-eligible']);

  const disabled = await resolve({ trialEnabled: false });
  assert.deepEqual([...disabled.values()], ['none', 'none']);
});

test('active and claimed trials grant the trial state without inventing a subscription', async () => {
  const active = await resolve({
    trial: trial({ status: 'ACTIVE', startedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000), remainingCredits: 12 }),
  });
  assert.deepEqual([...active.values()], ['trial', 'trial']);

  const claimed = await resolve({ trial: trial({ status: 'CLAIMED' }) });
  assert.deepEqual([...claimed.values()], ['trial', 'trial']);
});

test('paid subject entitlements win over the trial and other subjects stay trial-eligible', async () => {
  const states = await resolve({
    entitlements: [ent({ subjectId: 'math' })],
    trial: trial({ status: 'ACTIVE', startedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000) }),
  });
  assert.equal(states.get('math'), 'paid');
  assert.equal(states.get('physics'), 'trial');

  // A paid account cannot claim a trial, so other subjects show غير مشترك
  // instead of advertising an activation that the server would refuse.
  const paidNoTrial = await resolve({ entitlements: [ent({ subjectId: 'math' })] });
  assert.equal(paidNoTrial.get('math'), 'paid');
  assert.equal(paidNoTrial.get('physics'), 'none');
});

test('an active bundle covers its scoped subjects as ضمن باقتك', async () => {
  const states = await resolve({
    entitlements: [ent({ id: 'b1' })],
    scopes: { b1: ['math', 'physics'] },
  });
  assert.deepEqual([...states.values()], ['bundle', 'bundle']);
});

test('expired subscriptions and ended trials surface the expired state', async () => {
  const expiredSub = await resolve({ entitlements: [ent({ subjectId: 'math', status: 'EXPIRED' })] });
  assert.equal(expiredSub.get('math'), 'expired');
  assert.equal(expiredSub.get('physics'), 'trial-eligible');

  const endedTrial = await resolve({
    trial: trial({ status: 'EXPIRED', startedAt: NOW, expiresAt: new Date(NOW.getTime() - 1000) }),
  });
  assert.deepEqual([...endedTrial.values()], ['expired', 'expired']);
});

test('a non-ready textbook overrides every access state honestly', async () => {
  // trial-eligible base: the missing book still wins for math
  const eligible = await resolve({ ready: new Set(['physics']) });
  assert.equal(eligible.get('math'), 'book');
  assert.equal(eligible.get('physics'), 'trial-eligible');

  // a paid subject with no READY book is reported as book, never as usable
  const paid = await resolve({ entitlements: [ent({ subjectId: 'math' })], ready: new Set(['physics']) });
  assert.equal(paid.get('math'), 'book');
  assert.equal(paid.get('physics'), 'none'); // paid accounts cannot claim a trial
});

test('subjects outside the eligible list never appear', async () => {
  const states = await resolve({});
  assert.equal(states.size, 2);
  assert.equal(states.has('chemistry'), false);
});

test('trial usability and end detection use the real record only', () => {
  assert.equal(isTrialUsable(null), false);
  assert.equal(isTrialUsable(trial({ status: 'CLAIMED' }), NOW), true);
  assert.equal(isTrialUsable(trial({ status: 'CLAIMED', remainingCredits: 0 }), NOW), false);
  assert.equal(isTrialUsable(trial({ status: 'ACTIVE', startedAt: NOW, expiresAt: new Date(NOW.getTime() + 1000) }), NOW), true);
  assert.equal(isTrialUsable(trial({ status: 'ACTIVE', startedAt: NOW, expiresAt: new Date(NOW.getTime() - 1000) }), NOW), false);

  assert.equal(isTrialEnded(null), false);
  assert.equal(isTrialEnded(trial({ status: 'EXHAUSTED', remainingCredits: 0 }), NOW), true);
  assert.equal(isTrialEnded(trial({ status: 'ACTIVE', startedAt: NOW, expiresAt: new Date(NOW.getTime() - 1) }), NOW), true);
  assert.equal(isTrialEnded(trial({ status: 'ACTIVE', startedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) }), NOW), false);
});
