import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'trial-test-secret';
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

import { POST as claimPost } from '../app/api/trial/claim/route';
import { authorizeAiRequest, chargeAiCredits, refundAiCredits } from '../lib/ai/access';
import { setAuthStoreForTests } from '../lib/auth/store';
import type { AuthSession, AuthStore, AuthUser } from '../lib/auth/store';
import { hashSessionToken } from '../lib/auth/session';
import { isEntitlementActive } from '../lib/billing/entitlements';
import { setBillingStoreForTests } from '../lib/billing/store';
import type {
  BillingStore,
  ChargeResult,
  EntitlementRecord,
  EntitlementUpsert,
  RefundResult,
  SubjectPlanInput,
  SubjectPlanRecord,
} from '../lib/billing/store';
import { setDeviceStoreForTests } from '../lib/devices/store';
import type { DeviceRecord, DeviceStore } from '../lib/devices/store';
import { createMemoryLimiter, setRateLimiterForTests } from '../lib/rate-limit/limiter';
import { setStudentStoreForTests } from '../lib/student/store';
import type { AcademicField, CatalogSubject, Grade, StudentProfile, StudentStore } from '../lib/student/store';
import { setTrialBudgetForTests, type TrialBudget } from '../lib/trial/budget';
import { setTurnstileVerifierForTests, turnstileMode } from '../lib/trial/turnstile';
import { resetTrialTestDoubles, setTrialTestDoubles, type FakeTrialHarness } from './support/trial-doubles';

const student: AuthUser = { id: 'student-1', email: 'student@example.com', name: 'طالب', image: null, role: 'STUDENT' };
const other: AuthUser = { id: 'student-2', email: 'other@example.com', name: 'طالب آخر', image: null, role: 'STUDENT' };
const profile: StudentProfile = { userId: student.id, gradeId: 'g12', academicFieldId: null, onboardingCompleted: true };

function makeSubject(id: string, slug: string, gradeId = 'g12'): CatalogSubject {
  return { id, gradeId, academicFieldId: null, name: slug, slug, shortDescription: null, image: null, isActive: true, isFeatured: false, sortOrder: 0 };
}
const math = makeSubject('s-math', 'math');
const physics = makeSubject('s-physics', 'physics');
const otherGrade = makeSubject('s-g11', 'math-11', 'g11');

function fakeStudents(): StudentStore {
  const subjects = [math, physics, otherGrade];
  const grades: Grade[] = [
    { id: 'g12', name: 'التوجيهي', slug: 'tawjihi', isActive: true },
    { id: 'g11', name: 'الحادي عشر', slug: 'grade-11', isActive: true },
  ];
  const fields: AcademicField[] = [];
  return {
    async listActiveGrades() { return grades; },
    async findGradeById(id) { return grades.find((grade) => grade.id === id) ?? null; },
    async listActiveFields() { return fields; },
    async listActiveFieldsForGrade() { return fields; },
    async findFieldById() { return null; },
    async getProfile(userId) {
      if (userId === 'not-onboarded') return { userId, gradeId: 'g12', academicFieldId: null, onboardingCompleted: false };
      return { ...profile, userId };
    },
    async upsertProfile() {},
    async listSubjectsForStudent(gradeId) { return subjects.filter((subject) => subject.gradeId === gradeId); },
    async listActiveSubjectsForGrade(gradeId) { return subjects.filter((subject) => subject.gradeId === gradeId); },
    async findSubjectBySlug(slug) { return subjects.find((subject) => subject.slug === slug) ?? null; },
    async findSubjectById(id) { return subjects.find((subject) => subject.id === id) ?? null; },
  };
}

function createFakeDeviceStore(): DeviceStore {
  const devices = new Map<string, DeviceRecord>();
  return {
    async listDevices(userId) { return [...devices.values()].filter((device) => device.userId === userId); },
    async findDeviceByTokenHash(hash) { return [...devices.values()].find((device) => device.deviceTokenHash === hash) ?? null; },
    async countActiveDevices(userId) { return [...devices.values()].filter((device) => device.userId === userId && !device.revokedAt).length; },
    async createDevice(input) {
      const row: DeviceRecord = { ...input, createdAt: new Date(), lastSeenAt: new Date(), revokedAt: null };
      devices.set(row.id, row);
      return row;
    },
    async touchDevice(id, now) { const device = devices.get(id); if (device) devices.set(id, { ...device, lastSeenAt: now }); },
    async revokeDevice(userId, id) {
      const device = devices.get(id);
      if (!device || device.userId !== userId || device.revokedAt) return false;
      devices.set(id, { ...device, revokedAt: new Date() });
      return true;
    },
    async getMaxDevices() { return 2; },
    async setMaxDevices() {},
  };
}

// Minimal billing store: only entitlement lookup + charging are exercised here.
function createFakeBillingStore(): { store: BillingStore; entitlements: Map<string, EntitlementRecord>; charges: string[] } {
  const entitlements = new Map<string, EntitlementRecord>();
  const charges: string[] = [];
  const unused = async () => {
    throw new Error('not used');
  };
  const store: BillingStore = {
    listSubjectPlans: async () => [],
    findSubjectPlanById: async () => null,
    findSubjectPlanByFreemiusPlanId: async () => null,
    findSubjectPlanBySubjectAndType: async () => null,
    upsertSubjectPlan: unused as unknown as (input: SubjectPlanInput) => Promise<SubjectPlanRecord>,
    listAcademicTerms: async () => [],
    findAcademicTermById: async () => null,
    upsertAcademicTerm: unused as never,
    setAcademicTermActive: unused as never,
    countSoldEntitlementsForTerm: async () => 0,
    listSubscriptionOffers: async () => [],
    findSubscriptionOfferById: async () => null,
    findSubscriptionOfferByFreemiusPlanId: async () => null,
    upsertSubscriptionOffer: unused as never,
    setSubscriptionOfferActive: unused as never,
    listBundleSubjectIds: async () => [],
    setBundleSubjects: unused as never,
    listEntitlementSubjectIds: async () => [],
    ensureEntitlementSubjects: unused as never,
    replaceEntitlementSubjects: unused as never,
    findEntitlementByLicenseId: async () => null,
    findEntitlementById: async (id) => entitlements.get(id) ?? null,
    upsertEntitlement: unused as unknown as (record: EntitlementUpsert) => Promise<void>,
    async updateCreditPeriod(id, balance, startedAt, endsAt) {
      const entitlement = entitlements.get(id);
      if (entitlement) {
        entitlements.set(id, { ...entitlement, creditBalance: balance, creditPeriodStartedAt: startedAt, creditPeriodEndsAt: endsAt });
      }
    },
    deleteEntitlementByLicenseId: unused as never,
    findActiveEntitlement: async (userId, subjectId, now) =>
      [...entitlements.values()].find((item) => item.userId === userId && item.subjectId === subjectId && isEntitlementActive(item, now)) ?? null,
    findAccessibleEntitlement: async (userId, subjectId, now) =>
      [...entitlements.values()].find((item) => item.userId === userId && item.subjectId === subjectId && isEntitlementActive(item, now)) ?? null,
    listEntitlementsForUser: async (userId) => [...entitlements.values()].filter((item) => item.userId === userId),
    listEntitlementsWithUsers: async () => [],
    async chargeCredits(input): Promise<ChargeResult> {
      charges.push(input.requestId);
      const entitlement = entitlements.get(input.entitlementId);
      if (!entitlement || entitlement.creditBalance < input.credits) return { ok: false, reason: 'insufficient' };
      const next = { ...entitlement, creditBalance: entitlement.creditBalance - input.credits };
      entitlements.set(next.id, next);
      return { ok: true, balance: next.creditBalance, duplicate: false };
    },
    async refundCredits(): Promise<RefundResult> {
      return { ok: true, refunded: 1 };
    },
    findUsageEventByRequestId: async () => null,
    hasWebhookEvent: async () => false,
    recordWebhookEvent: async () => {},
  };
  return { store, entitlements, charges };
}

async function installSession(user: AuthUser | null, token: string) {
  const sessionId = await hashSessionToken(token, 'trial-test-secret');
  const unused = async () => {
    throw new Error('not used');
  };
  const authStore: AuthStore = {
    findUserByEmail: unused,
    findUserById: async (id) => (user && id === user.id ? user : null),
    insertUser: unused,
    promoteUser: unused,
    updateUserProfile: unused,
    linkAccount: unused,
    insertSession: unused,
    findSession: async (id): Promise<AuthSession | null> =>
      user && id === sessionId ? { id, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) } : null,
    deleteSession: unused,
    deleteExpiredSessions: unused,
  };
  setAuthStoreForTests(authStore);
}

function claimRequest(token: string | undefined, body: unknown = {}, cookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: 'http://localhost' };
  if (token) headers.cookie = cookie ? `${cookie}; fahimni_session=${token}` : `fahimni_session=${token}`;
  else if (cookie) headers.cookie = cookie;
  return new Request('http://localhost/api/trial/claim', { method: 'POST', headers, body: JSON.stringify(body) });
}

function trialIdentityCookieFrom(response: Response): string | null {
  const header = response.headers.get('set-cookie');
  if (!header) return null;
  const match = /fahimni_trial_identity=([^;]+)/.exec(header);
  return match ? `fahimni_trial_identity=${match[1]}` : null;
}

function aiRequest(token: string, body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/tutor', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', cookie: `fahimni_session=${token}` },
    body: JSON.stringify({
      question: 'اشرح',
      board: { objects: [] },
      history: [],
      currentStep: 0,
      currentLesson: null,
      subjectSlug: 'math',
      requestId: crypto.randomUUID(),
      ...body,
    }),
  });
}

async function authorizeFor(harness: FakeTrialHarness, subjectSlug: string) {
  return authorizeAiRequest(aiRequest('student-token', { subjectSlug }), { operation: 'tutor', subjectSlug });
}

function reset() {
  setAuthStoreForTests(null);
  setStudentStoreForTests(null);
  setBillingStoreForTests(null);
  setDeviceStoreForTests(null);
  setRateLimiterForTests(null);
  setTurnstileVerifierForTests(null);
  resetTrialTestDoubles();
  delete process.env.TURNSTILE_SECRET_KEY;
}

async function installAccessEnvironment(billing: BillingStore) {
  setBillingStoreForTests(billing);
  setStudentStoreForTests(fakeStudents());
  setDeviceStoreForTests(createFakeDeviceStore());
  setRateLimiterForTests(createMemoryLimiter());
  await installSession(student, 'student-token');
}

test('turnstile modes fail closed in production and skip locally', () => {
  assert.equal(turnstileMode({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), 'config_error');
  assert.equal(turnstileMode({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'x' } as NodeJS.ProcessEnv), 'verify');
  assert.equal(turnstileMode({ NODE_ENV: 'development' } as NodeJS.ProcessEnv), 'dev_skip');
  assert.equal(turnstileMode({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), 'dev_skip');
});

test('first account claims one trial with 15 credits and cannot claim twice', async () => {
  const harness = setTrialTestDoubles();
  await installAccessEnvironment(createFakeBillingStore().store);
  await installSession(student, 'student-token');

  try {
    const first = await claimPost(claimRequest('student-token'));
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { created: boolean; trial: { status: string; totalCredits: number; remainingCredits: number } };
    assert.equal(firstBody.created, true);
    assert.equal(firstBody.trial.status, 'CLAIMED');
    assert.equal(firstBody.trial.totalCredits, 15);
    assert.equal(firstBody.trial.remainingCredits, 15);
    assert.ok(trialIdentityCookieFrom(first)?.startsWith('fahimni_trial_identity='));
    assert.equal(harness.trials.size, 1);

    const second = await claimPost(claimRequest('student-token'));
    assert.equal(second.status, 200);
    const secondBody = (await second.json()) as { created: boolean };
    assert.equal(secondBody.created, false);
    assert.equal(harness.trials.size, 1);
  } finally {
    reset();
  }
});

test('a different account in the same browser is denied; the original resumes', async () => {
  const harness = setTrialTestDoubles();
  await installAccessEnvironment(createFakeBillingStore().store);

  try {
    await installSession(student, 'student-token');
    const first = await claimPost(claimRequest('student-token'));
    assert.equal(first.status, 200);
    const cookie = trialIdentityCookieFrom(first);
    assert.ok(cookie);

    // A second Google account reusing the same browser identity is refused
    // without revealing anything about the first account.
    await installSession(other, 'other-token');
    const second = await claimPost(claimRequest('other-token', {}, cookie as string));
    assert.equal(second.status, 409);
    const secondBody = (await second.json()) as { code?: string; error?: string };
    assert.equal(secondBody.code, 'browser_used');
    assert.ok(!secondBody.error?.includes(student.email));
    assert.equal(harness.trials.size, 1);

    // The original account still resumes its existing trial.
    await installSession(student, 'student-token');
    const resume = await claimPost(claimRequest('student-token', {}, cookie as string));
    assert.equal(resume.status, 200);
    const resumeBody = (await resume.json()) as { created: boolean; trial: { remainingCredits: number } };
    assert.equal(resumeBody.created, false);
    assert.equal(resumeBody.trial.remainingCredits, 15);
  } finally {
    reset();
  }
});

test('claim requires a session, onboarding, no paid plan, and an enabled trial', async () => {
  const billing = createFakeBillingStore();
  setTrialTestDoubles();
  setBillingStoreForTests(billing.store);
  setStudentStoreForTests(fakeStudents());
  setRateLimiterForTests(createMemoryLimiter());

  try {
    const anonymous = await claimPost(claimRequest(undefined));
    assert.equal(anonymous.status, 401);

    // A session without a completed profile is refused.
    await installSession({ ...other, id: 'not-onboarded' }, 'other-token');
    const notOnboarded = await claimPost(claimRequest('other-token'));
    assert.equal(notOnboarded.status, 403);
    assert.equal(((await notOnboarded.json()) as { code?: string }).code, 'onboarding_required');

    await installSession(student, 'student-token');
    const eligible = await claimPost(claimRequest('student-token'));
    assert.equal(eligible.status, 200);

    // Paid users are not offered a trial.
    billing.entitlements.set('e1', {
      id: 'e1',
      userId: student.id,
      subjectId: math.id,
      subjectPlanId: null,
      offerId: null,
      academicTermId: null,
      freemiusLicenseId: 'lic',
      freemiusSubscriptionId: null,
      status: 'ACTIVE',
      renewalCanceled: false,
      startsAt: null,
      expiresAt: null,
      creditBalance: 5,
      creditPeriodStartedAt: null,
      creditPeriodEndsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const paid = await claimPost(claimRequest('student-token'));
    assert.equal(paid.status, 409);
    assert.equal(((await paid.json()) as { code?: string }).code, 'already_subscribed');
  } finally {
    reset();
  }

  const disabled = setTrialTestDoubles({ enabled: false });
  await installAccessEnvironment(createFakeBillingStore().store);
  await installSession(student, 'student-token');
  try {
    const response = await claimPost(claimRequest('student-token'));
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { code?: string }).code, 'trial_disabled');
    assert.equal(disabled.trials.size, 0);
  } finally {
    reset();
  }
});

test('claim verifies Turnstile on the server when configured', async () => {
  setTrialTestDoubles();
  await installAccessEnvironment(createFakeBillingStore().store);
  await installSession(student, 'student-token');
  process.env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';

  try {
    // Missing token is rejected before the verifier is consulted.
    const missing = await claimPost(claimRequest('student-token', {}));
    assert.equal(missing.status, 400);
    assert.equal(((await missing.json()) as { code?: string }).code, 'turnstile_failed');

    setTurnstileVerifierForTests(async () => ({ ok: false, reason: 'rejected' }));
    const rejected = await claimPost(claimRequest('student-token', { turnstileToken: 'bad-token' }));
    assert.equal(rejected.status, 400);

    let seenAction: string | null = null;
    setTurnstileVerifierForTests(async (input) => {
      seenAction = input.expectedAction;
      return { ok: true };
    });
    const accepted = await claimPost(claimRequest('student-token', { turnstileToken: 'good-token' }));
    assert.equal(accepted.status, 200);
    assert.equal(seenAction, 'claim_trial');
  } finally {
    reset();
  }
});

test('the 48h countdown starts on the first accepted AI request, not before', async () => {
  const harness = setTrialTestDoubles();
  await installAccessEnvironment(createFakeBillingStore().store);
  await installSession(student, 'student-token');

  try {
    await claimPost(claimRequest('student-token'));
    const claimed = [...harness.trials.values()][0];
    assert.equal(claimed.startedAt, null);
    assert.equal(claimed.expiresAt, null);

    // Opening dashboards only reads the record: the countdown is untouched.
    await harness.store.findByUserId(student.id);
    assert.equal(harness.trials.get(claimed.id)?.startedAt, null);

    const access = await authorizeFor(harness, 'math');
    assert.equal(access.ok, true);
    if (!access.ok) return;
    assert.equal(access.context.trial?.status, 'ACTIVE');
    const started = harness.trials.get(claimed.id);
    assert.ok(started?.startedAt);
    assert.ok(started?.expiresAt);
    assert.equal(
      (started?.expiresAt as Date).getTime() - (started?.startedAt as Date).getTime(),
      48 * 60 * 60 * 1000,
    );

    const startedAt = started?.startedAt?.getTime();
    const again = await authorizeFor(harness, 'math');
    assert.equal(again.ok, true);
    assert.equal(harness.trials.get(claimed.id)?.startedAt?.getTime(), startedAt);
  } finally {
    reset();
  }
});

test('one shared wallet is spent across different subjects without refill', async () => {
  const harness = setTrialTestDoubles();
  await installAccessEnvironment(createFakeBillingStore().store);
  await installSession(student, 'student-token');

  try {
    await claimPost(claimRequest('student-token'));
    const first = await authorizeFor(harness, 'math');
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const firstCharge = await chargeAiCredits(first.context, { operation: 'tutor', credits: 1, requestId: 'req-1' });
    assert.equal(firstCharge.ok, true);
    if (!firstCharge.ok) return;
    assert.equal(firstCharge.balance, 14);
    assert.equal(firstCharge.trial, true);

    const second = await authorizeFor(harness, 'physics');
    assert.equal(second.ok, true);
    if (!second.ok) return;
    const secondCharge = await chargeAiCredits(second.context, { operation: 'vision', credits: 3, requestId: 'req-2' });
    assert.equal(secondCharge.ok, true);
    if (!secondCharge.ok) return;
    assert.equal(secondCharge.balance, 11);

    // Same wallet row for both subjects.
    assert.equal(second.context.trial?.id, first.context.trial?.id);
    assert.equal([...harness.trials.values()][0].remainingCredits, 11);
  } finally {
    reset();
  }
});

test('expired and exhausted trials block AI but keep the account intact', async () => {
  const harness = setTrialTestDoubles();
  await installAccessEnvironment(createFakeBillingStore().store);
  await installSession(student, 'student-token');

  try {
    await claimPost(claimRequest('student-token'));
    const trial = [...harness.trials.values()][0];

    // Simulate a started trial whose window has passed.
    harness.trials.set(trial.id, {
      ...trial,
      status: 'ACTIVE',
      startedAt: new Date(Date.now() - 50 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    const expired = await authorizeFor(harness, 'math');
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.failure.code, 'trial_expired');
    assert.equal(harness.trials.get(trial.id)?.status, 'EXPIRED');
    assert.ok(await harness.store.findByUserId(student.id)); // account survives

    harness.trials.set(trial.id, { ...trial, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000), remainingCredits: 0 });
    const exhausted = await authorizeFor(harness, 'math');
    assert.equal(exhausted.ok, false);
    if (!exhausted.ok) assert.equal(exhausted.failure.code, 'trial_exhausted');
    assert.equal(harness.trials.get(trial.id)?.status, 'EXHAUSTED');
  } finally {
    reset();
  }
});

test('failed trial AI requests refund exactly once', async () => {
  const harness = setTrialTestDoubles();
  await installAccessEnvironment(createFakeBillingStore().store);
  await installSession(student, 'student-token');

  try {
    await claimPost(claimRequest('student-token'));
    const access = await authorizeFor(harness, 'math');
    assert.equal(access.ok, true);
    if (!access.ok) return;
    const charge = await chargeAiCredits(access.context, { operation: 'tutor', credits: 2, requestId: 'req-refund' });
    assert.equal(charge.ok, true);
    if (!charge.ok) return;
    assert.equal(charge.balance, 13);

    await refundAiCredits(charge);
    assert.equal([...harness.trials.values()][0].remainingCredits, 15);
    await refundAiCredits(charge);
    assert.equal([...harness.trials.values()][0].remainingCredits, 15);
    assert.ok(harness.usage.get('req-refund')?.refundedAt);
  } finally {
    reset();
  }
});

test('the daily budget blocks trial AI only, never paid wallets', async () => {
  const harness = setTrialTestDoubles();
  const billing = createFakeBillingStore();
  await installAccessEnvironment(billing.store);
  await installSession(student, 'student-token');

  try {
    await claimPost(claimRequest('student-token'));
    // A paid entitlement exists for another subject; the trial still covers
    // physics, and the budget only gates the trial wallet.
    billing.entitlements.set('paid-1', {
      id: 'paid-1',
      userId: student.id,
      subjectId: math.id,
      subjectPlanId: null,
      offerId: null,
      academicTermId: null,
      freemiusLicenseId: 'lic-paid',
      freemiusSubscriptionId: null,
      status: 'ACTIVE',
      renewalCanceled: false,
      startsAt: null,
      expiresAt: null,
      creditBalance: 10,
      creditPeriodStartedAt: null,
      creditPeriodEndsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const access = await authorizeFor(harness, 'physics');
    assert.equal(access.ok, true);
    if (!access.ok) return;

    // Budget exhausted: the trial charge is refused before any provider call.
    const exhaustedBudget: TrialBudget = {
      reserve: async () => ({ ok: false, spentMicroUsd: 5_000_000 }),
      release: async () => {},
    };
    setTrialBudgetForTests(exhaustedBudget);
    const blocked = await chargeAiCredits(access.context, { operation: 'tutor', credits: 1, requestId: 'req-budget' });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.failure.code, 'trial_budget');
    assert.equal([...harness.trials.values()][0].remainingCredits, 15);

    // Paid students are never affected by the trial budget.
    const paidContext = {
      user: student,
      subject: math,
      profile,
      entitlement: billing.entitlements.get('paid-1') as EntitlementRecord,
      trial: null,
      device: null,
      balance: 10,
      resetAt: null,
    };
    const paidCharge = await chargeAiCredits(paidContext, { operation: 'tutor', credits: 1, requestId: 'req-paid' }, billing.store);
    assert.equal(paidCharge.ok, true);
    if (!paidCharge.ok) return;
    assert.equal(paidCharge.balance, 9);
    assert.deepEqual(billing.charges, ['req-paid']);
  } finally {
    reset();
  }
});

test('paid access stays authoritative when a trial also exists', async () => {
  const harness = setTrialTestDoubles();
  const billing = createFakeBillingStore();
  await installAccessEnvironment(billing.store);
  await installSession(student, 'student-token');

  try {
    await claimPost(claimRequest('student-token'));
    // The student later buys a paid plan for the same subject.
    billing.entitlements.set('paid-2', {
      id: 'paid-2',
      userId: student.id,
      subjectId: math.id,
      subjectPlanId: null,
      offerId: null,
      academicTermId: null,
      freemiusLicenseId: 'lic-paid-2',
      freemiusSubscriptionId: null,
      status: 'ACTIVE',
      renewalCanceled: false,
      startsAt: null,
      expiresAt: null,
      creditBalance: 4,
      creditPeriodStartedAt: null,
      creditPeriodEndsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const access = await authorizeFor(harness, 'math');
    assert.equal(access.ok, true);
    if (!access.ok) return;
    // Paid entitlement wins; the trial is not even resolved into the context.
    assert.ok(access.context.entitlement);
    assert.equal(access.context.trial, null);

    const charge = await chargeAiCredits(access.context, { operation: 'tutor', credits: 1, requestId: 'req-overlap' }, billing.store);
    assert.equal(charge.ok, true);
    if (!charge.ok) return;
    assert.equal(charge.balance, 3);
    assert.equal(charge.trial, undefined);
    // The trial wallet is untouched: no double charge.
    assert.equal([...harness.trials.values()][0].remainingCredits, 15);
  } finally {
    reset();
  }
});

test('concurrent trial charges cannot overspend the shared wallet', async () => {
  const harness = setTrialTestDoubles();
  await installAccessEnvironment(createFakeBillingStore().store);
  await installSession(student, 'student-token');

  try {
    await claimPost(claimRequest('student-token'));
    const trial = [...harness.trials.values()][0];
    harness.trials.set(trial.id, { ...trial, status: 'ACTIVE', startedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), remainingCredits: 5 });

    const access = await authorizeFor(harness, 'math');
    assert.equal(access.ok, true);
    if (!access.ok) return;
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        chargeAiCredits(access.context, { operation: 'tutor', credits: 1, requestId: `req-conc-${index}` }),
      ),
    );
    assert.equal(attempts.filter((attempt) => attempt.ok).length, 5);
    assert.equal(harness.trials.get(trial.id)?.remainingCredits, 0);
    assert.equal(harness.trials.get(trial.id)?.status, 'EXHAUSTED');
  } finally {
    reset();
  }
});

test('trial access still enforces subject visibility and grade eligibility', async () => {
  const harness = setTrialTestDoubles();
  await installAccessEnvironment(createFakeBillingStore().store);
  await installSession(student, 'student-token');

  try {
    await claimPost(claimRequest('student-token'));
    const wrongGrade = await authorizeFor(harness, 'math-11');
    assert.equal(wrongGrade.ok, false);
    if (!wrongGrade.ok) assert.equal(wrongGrade.failure.code, 'subject_unavailable');
    // The failed attempt never started the countdown.
    assert.equal([...harness.trials.values()][0].startedAt, null);
  } finally {
    reset();
  }
});
