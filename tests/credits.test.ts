import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'credits-test-secret';
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

import { POST as tutorPost } from '../app/api/tutor/route';
import { POST as adminSettingsPost } from '../app/api/admin/settings/route';
import { legacyAiAllowed, deviceRegistrationDecision, chargeAiCredits, refundAiCredits } from '../lib/ai/access';
import { setAuthStoreForTests } from '../lib/auth/store';
import type { AuthSession, AuthStore, AuthUser } from '../lib/auth/store';
import { hashSessionToken } from '../lib/auth/session';
import { isEntitlementActive, syncEntitlementFromPurchase } from '../lib/billing/entitlements';
import { setBillingStoreForTests } from '../lib/billing/store';
import type { BillingStore, EntitlementRecord, EntitlementUpsert, SubjectPlanInput, SubjectPlanRecord, AcademicTermInput, SubscriptionOfferInput } from '../lib/billing/store';
import { setBooksStoreForTests } from '../lib/books/store';
import type { BookRecord, BooksStore, NewChunk } from '../lib/books/store';
import { setLearningProgressStoreForTests } from '../lib/learning/progress';
import type { LearningProgressStore } from '../lib/learning/progress';
import { setSettingsReaderForTests } from '../lib/settings/service';
import { createMemoryDailyBudget, setAiBudgetForTests } from '../lib/ai/budget';
import { createMemoryTrialBudget, setTrialBudgetForTests } from '../lib/trial/budget';
import { CREDIT_COSTS, speechCredits } from '../lib/credits/config';
import { ensureCreditPeriod, isCreditPeriodActive } from '../lib/credits/periods';
import { setDeviceStoreForTests, DEFAULT_MAX_DEVICES } from '../lib/devices/store';
import type { DeviceRecord, DeviceStore } from '../lib/devices/store';
import { createDeviceToken, deviceCookieHeader, deviceTokenFromRequest, hashDeviceToken } from '../lib/devices/token';
import { summarizeUserAgent } from '../lib/devices/user-agent';
import { productionRateLimitingReady } from '../lib/rate-limit/config';
import { createMemoryLimiter, setRateLimiterForTests } from '../lib/rate-limit/limiter';
import { setStudentStoreForTests } from '../lib/student/store';
import type { AcademicField, CatalogSubject, Grade, StudentProfile, StudentStore } from '../lib/student/store';
import { resetTrialTestDoubles } from './support/trial-doubles';

const student: AuthUser = { id: 'student-1', email: 'student@example.com', name: 'طالب', image: null, role: 'STUDENT' };
const admin: AuthUser = { id: 'admin-1', email: 'admin@example.com', name: 'مشرف', image: null, role: 'ADMIN' };
const subject: CatalogSubject = { id: '11111111-1111-4111-8111-111111111111', gradeId: 'g12', academicFieldId: null, name: 'رياضيات', slug: 'math', shortDescription: null, image: null, isActive: true, isFeatured: false, sortOrder: 0 };
const profile: StudentProfile = { userId: student.id, gradeId: 'g12', academicFieldId: null, onboardingCompleted: true };

// The tutor route reads personalisation topics; without a fake this opens a real
// database connection in CI (DATABASE_URL is set) and leaves a pending promise
// that cancels later tests. Register an empty fake for the whole file.
const emptyProgress: LearningProgressStore = {
 async listForUser() { return []; },
 async recordAssessment() { throw new Error('not used'); },
};
setLearningProgressStoreForTests(emptyProgress);

// The AI pipeline reads runtime config from settings. Without a reader override
// each request opens a database connection; in CI that pending promise cancels
// sibling tests. An empty reader lets the environment govern provider config.
const emptySettings = {
 async getPlain() { return null; },
 async getSecret() { return null; },
 async getSecretPresence() { return false; },
};
setSettingsReaderForTests(emptySettings);
// The AI pipeline charges against a global daily budget. Without an override a
// Redis-backed budget is created and its commands leave a pending promise that
// cancels sibling tests under the Node test runner (CI provides REDIS_URL).
setAiBudgetForTests(createMemoryDailyBudget('ai-test'));
setTrialBudgetForTests(createMemoryTrialBudget());
// The tutor route applies rate limits; without a memory limiter a Redis-backed
// limiter is created in CI and its pending command cancels sibling tests.
setRateLimiterForTests(createMemoryLimiter());

function createFakeBillingStore() {
 const plans = new Map<string, SubjectPlanRecord>();
 const entitlements = new Map<string, EntitlementRecord>();
 const usage = new Map<string, { entitlementId: string | null; creditsCharged: number; refundedAt: Date | null }>();
 const store: BillingStore = {
  async listSubjectPlans() { return [...plans.values()]; },
  async findSubjectPlanById(id) { return plans.get(id) ?? null; },
  async findSubjectPlanByFreemiusPlanId(freemiusPlanId) { return [...plans.values()].find(plan => plan.freemiusPlanId === freemiusPlanId) ?? null; },
  async findSubjectPlanBySubjectAndType(subjectId, type) { return [...plans.values()].find(plan => plan.subjectId === subjectId && plan.type === type) ?? null; },
  async upsertSubjectPlan(input: SubjectPlanInput) {
   const existing = [...plans.values()].find(plan => plan.subjectId === input.subjectId && plan.type === input.type);
   const row: SubjectPlanRecord = { id: existing?.id ?? crypto.randomUUID(), ...input };
   plans.set(row.id, row);
   return row;
  },
  async findEntitlementByLicenseId(licenseId) { return [...entitlements.values()].find(item => item.freemiusLicenseId === licenseId) ?? null; },
  async findEntitlementById(id) { return entitlements.get(id) ?? null; },
  async upsertEntitlement(record: EntitlementUpsert) {
   const existing = [...entitlements.values()].find(item => item.freemiusLicenseId === record.freemiusLicenseId);
   const row: EntitlementRecord = {...record, id: existing?.id ?? record.id, createdAt: new Date(), updatedAt: new Date()};
   entitlements.set(row.id, row);
  },
  async updateCreditPeriod(id, balance, startedAt, endsAt) {
   const current = entitlements.get(id);
   if (current) entitlements.set(id, {...current, creditBalance: balance, creditPeriodStartedAt: startedAt, creditPeriodEndsAt: endsAt});
  },
  async deleteEntitlementByLicenseId(licenseId) {
   for (const [id, item] of entitlements) if (item.freemiusLicenseId === licenseId) entitlements.delete(id);
  },
  async findActiveEntitlement(userId, subjectId, now) {
   return [...entitlements.values()].find(item => item.userId === userId && item.subjectId === subjectId && isEntitlementActive(item, now)) ?? null;
  },
  async listEntitlementsForUser(userId) { return [...entitlements.values()].filter(item => item.userId === userId); },
  async listAcademicTerms() { return []; },
  async findAcademicTermById() { return null; },
  async upsertAcademicTerm(input: AcademicTermInput) { return {...input, createdAt: new Date(), updatedAt: new Date()}; },
  async setAcademicTermActive() {},
  async countSoldEntitlementsForTerm() { return 0; },
  async listSubscriptionOffers() { return []; },
  async findSubscriptionOfferById() { return null; },
  async findSubscriptionOfferByFreemiusPlanId() { return null; },
  async upsertSubscriptionOffer(input: SubscriptionOfferInput) { return {...input, createdAt: new Date(), updatedAt: new Date()}; },
  async setSubscriptionOfferActive() {},
  async listBundleSubjectIds() { return []; },
  async setBundleSubjects() {},
  async listEntitlementSubjectIds() { return []; },
  async ensureEntitlementSubjects() {},
  async replaceEntitlementSubjects() {},
  async findAccessibleEntitlement(userId, subjectId, now) {
   return [...entitlements.values()].find(item => item.userId === userId && item.subjectId === subjectId && isEntitlementActive(item, now)) ?? null;
  },
  async listEntitlementsWithUsers() { return []; },
  async chargeCredits(input) {
   if (usage.has(input.requestId)) {
    return { ok: true, balance: entitlements.get(input.entitlementId)?.creditBalance ?? 0, duplicate: true };
   }
   const entitlement = entitlements.get(input.entitlementId);
   if (!entitlement || entitlement.userId !== input.userId || entitlement.status !== 'ACTIVE' || entitlement.creditBalance < input.credits) {
    return { ok: false, reason: 'insufficient' };
   }
   const next = {...entitlement, creditBalance: entitlement.creditBalance - input.credits};
   entitlements.set(entitlement.id, next);
   usage.set(input.requestId, { entitlementId: entitlement.id, creditsCharged: input.credits, refundedAt: null });
   return { ok: true, balance: next.creditBalance, duplicate: false };
  },
  async refundCredits(requestId) {
   const event = usage.get(requestId);
   if (!event) return { ok: false, reason: 'not_found' };
   if (event.refundedAt) return { ok: false, reason: 'already_refunded' };
   event.refundedAt = new Date();
   if (event.entitlementId) {
    const entitlement = entitlements.get(event.entitlementId);
    if (entitlement) entitlements.set(entitlement.id, {...entitlement, creditBalance: entitlement.creditBalance + event.creditsCharged});
   }
   return { ok: true, refunded: event.creditsCharged };
  },
  async findUsageEventByRequestId(requestId) {
   const event = usage.get(requestId);
   return event ? { id: requestId, entitlementId: event.entitlementId, creditsCharged: event.creditsCharged, refundedAt: event.refundedAt } : null;
  },
  async hasWebhookEvent() { return false; },
  async recordWebhookEvent() {},
 };
 return { store, plans, entitlements, usage };
}

function createFakeDeviceStore() {
 const devices = new Map<string, DeviceRecord>();
 const settings = { max: DEFAULT_MAX_DEVICES };
 const store: DeviceStore = {
  async listDevices(userId) { return [...devices.values()].filter(device => device.userId === userId); },
  async findDeviceByTokenHash(hash) { return [...devices.values()].find(device => device.deviceTokenHash === hash) ?? null; },
  async countActiveDevices(userId) { return [...devices.values()].filter(device => device.userId === userId && !device.revokedAt).length; },
  async createDevice(input) {
   const row: DeviceRecord = {...input, createdAt: new Date(), lastSeenAt: new Date(), revokedAt: null};
   devices.set(row.id, row);
   return row;
  },
  async touchDevice(id, now) { const device = devices.get(id); if (device) devices.set(id, {...device, lastSeenAt: now}); },
  async revokeDevice(userId, id) {
   const device = devices.get(id);
   if (!device || device.userId !== userId || device.revokedAt) return false;
   devices.set(id, {...device, revokedAt: new Date()});
   return true;
  },
  async getMaxDevices() { return settings.max; },
  async setMaxDevices(value) { settings.max = value; },
 };
 return { store, devices, settings };
}

function fakeStudents(): StudentStore {
 return {
  async listActiveGrades(): Promise<Grade[]> { return []; },
  async findGradeById() { return null; },
  async listActiveFields(): Promise<AcademicField[]> { return []; },
  async listActiveFieldsForGrade() { return []; },
  async findFieldById() { return null; },
  async getProfile(userId) { return userId === student.id ? profile : null; },
  async upsertProfile() {},
  async listSubjectsForStudent() { return [subject]; },
  async listActiveSubjectsForGrade() { return [subject]; },
  async findSubjectBySlug(slug) { return slug === subject.slug ? subject : null; },
  async findSubjectById(id) { return id === subject.id ? subject : null; },
 };
}

function fakeBooks(): BooksStore {
 const book: BookRecord = { id: 'book-1', subjectId: subject.id, title: 'كتاب', originalFileName: 'book.pdf', storedFilePath: 'books/x/source.pdf', sha256: 'sha', totalPages: 1, indexedPages: 1, status: 'READY', errorMessage: null, pendingStagedToken: null, pendingStagedAt: null, createdAt: new Date(), updatedAt: new Date() };
 const chunk: NewChunk = { id: 'chunk-1', bookId: book.id, subjectId: subject.id, sourceId: 'src', pdfPage: 1, printedPage: 1, unit: 'المعادلات', lesson: 'حل معادلات خاصة', heading: null, text: 'حل معادلة خاصة بالتحليل إلى عوامل', equations: [], pageImagePath: '1.jpg', searchText: 'حل معادله خاصه' };
 return {
  async findBookBySubject() { return book; },
  async findReadyBookBySubject() { return book; },
  async findBookById() { return book; },
  async createBook() { return book; },
  async updateBook() {},
  async deleteBook() {},
  async listChunksForBook() { return [chunk]; },
  async replaceChunks() { return true; },
  async stageReplacement() { return true; },
  async clearPendingReplacement() {},
  async claimNextUploadedBook() { return null; },
  async resetStaleProcessing() { return 0; },
  async listBookIds() { return []; },
 };
}

async function installSession(user: AuthUser | null, token: string) {
 const sessionId = await hashSessionToken(token, 'credits-test-secret');
 const unused = async () => { throw new Error('not used'); };
 const authStore: AuthStore = {
  findUserByEmail: unused,
  findUserById: async (id) => (user && id === user.id ? user : null),
  insertUser: unused,
  promoteUser: unused,
  updateUserProfile: unused,
  linkAccount: unused,
  insertSession: unused,
  findSession: async (id): Promise<AuthSession | null> => (user && id === sessionId ? { id, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) } : null),
  deleteSession: unused,
  deleteExpiredSessions: unused,
 };
 setAuthStoreForTests(authStore);
}

function tutorRequest(token: string, requestId = crypto.randomUUID()) {
 return new Request('http://localhost/api/tutor', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://localhost', cookie: `fahimni_session=${token}` },
  body: JSON.stringify({ question: 'حل معادلة خاصة', board: { objects: [] }, history: [], currentStep: 0, currentLesson: null, subjectSlug: 'math', requestId }),
 });
}

function reset() {
 setAuthStoreForTests(null);
 setStudentStoreForTests(null);
 setBillingStoreForTests(null);
 setBooksStoreForTests(null);
 setDeviceStoreForTests(null);
 setLearningProgressStoreForTests(emptyProgress);
 setSettingsReaderForTests(emptySettings);
 setAiBudgetForTests(createMemoryDailyBudget('ai-test'));
 setTrialBudgetForTests(createMemoryTrialBudget());
 setRateLimiterForTests(createMemoryLimiter());
 resetTrialTestDoubles();
}

test('credit costs are centralized and speech scales with text size', () => {
 assert.equal(CREDIT_COSTS.tutor, 1);
 assert.equal(CREDIT_COSTS.vision, 3);
 assert.equal(CREDIT_COSTS.transcription, 2);
 assert.equal(speechCredits('قصير'), 1);
 assert.equal(speechCredits('ا'.repeat(600)), 2);
 assert.equal(speechCredits('ا'.repeat(1300)), 3);
});

test('legacy AI access is dev/test or ADMIN only in production', () => {
 assert.equal(legacyAiAllowed(student, 'development'), true);
 assert.equal(legacyAiAllowed(student, 'test'), true);
 assert.equal(legacyAiAllowed(student, 'production'), false);
 assert.equal(legacyAiAllowed(admin, 'production'), true);
 assert.equal(legacyAiAllowed(null, 'production'), false);
});

test('device registration decision respects the active-device limit', () => {
 assert.equal(deviceRegistrationDecision({ hasValidDevice: true, activeCount: 5, maxDevices: 2 }), 'use');
 assert.equal(deviceRegistrationDecision({ hasValidDevice: false, activeCount: 1, maxDevices: 2 }), 'register');
 assert.equal(deviceRegistrationDecision({ hasValidDevice: false, activeCount: 2, maxDevices: 2 }), 'limit');
});

test('monthly credit periods reset to the allowance and never accumulate', async () => {
 const { store, plans, entitlements } = createFakeBillingStore();
 const plan = await store.upsertSubjectPlan({ subjectId: subject.id, type: 'MONTHLY', freemiusPlanId: 'p1', priceMinor: 39_000, monthlyCreditAllowance: 200, currency: 'JOD', isActive: true });
 const base: EntitlementRecord = { id: 'e1', userId: student.id, subjectId: subject.id, subjectPlanId: plan.id, offerId: null, academicTermId: null, freemiusLicenseId: 'lic', freemiusSubscriptionId: null, status: 'ACTIVE', renewalCanceled: false, startsAt: null, expiresAt: null, creditBalance: 0, creditPeriodStartedAt: null, creditPeriodEndsAt: null, createdAt: new Date(), updatedAt: new Date() };
 entitlements.set('e1', base);

 const initialized = await ensureCreditPeriod(store, base);
 assert.equal(initialized.creditBalance, 200);
 assert.equal(isCreditPeriodActive(initialized), true);

 const midPeriod = {...initialized, creditBalance: 7};
 const kept = await ensureCreditPeriod(store, midPeriod);
 assert.equal(kept.creditBalance, 7);

 const expired = {...initialized, creditBalance: 3, creditPeriodEndsAt: new Date(Date.now() - 1000)};
 const reset = await ensureCreditPeriod(store, expired);
 assert.equal(reset.creditBalance, 200);
 assert.equal(entitlements.get('e1')?.creditBalance, 200);
 assert.ok(plans.size > 0);
});

test('entitlement activation initializes credits and renewals keep the running period', async () => {
 const { store, entitlements } = createFakeBillingStore();
 await store.upsertSubjectPlan({ subjectId: subject.id, type: 'MONTHLY', freemiusPlanId: 'plan-1', priceMinor: 39_000, monthlyCreditAllowance: 150, currency: 'JOD', isActive: true });
 const findUserByEmail = async (email: string) => (email === student.email ? { id: student.id } : null);
 const purchase = { email: student.email, planId: 'plan-1', licenseId: 'lic-1', subscriptionId: null, canceled: false, expiration: null, created: new Date() };

 await syncEntitlementFromPurchase({ store, findUserByEmail }, purchase);
 const saved = [...entitlements.values()][0];
 assert.equal(saved.creditBalance, 150);
 assert.ok(saved.creditPeriodEndsAt);

 // Renewal while the period is running: balance untouched.
 entitlements.set(saved.id, {...saved, creditBalance: 42});
 await syncEntitlementFromPurchase({ store, findUserByEmail }, purchase);
 assert.equal([...entitlements.values()][0].creditBalance, 42);

 // Canceled licenses keep their credit state for the record.
 await syncEntitlementFromPurchase({ store, findUserByEmail }, {...purchase, canceled: true});
 assert.equal([...entitlements.values()][0].status, 'CANCELED');
});

test('charging is idempotent per requestId and refunds only once', async () => {
 const { store, entitlements, usage } = createFakeBillingStore();
 entitlements.set('e1', { id: 'e1', userId: student.id, subjectId: subject.id, subjectPlanId: null, offerId: null, academicTermId: null, freemiusLicenseId: 'lic', freemiusSubscriptionId: null, status: 'ACTIVE', renewalCanceled: false, startsAt: null, expiresAt: null, creditBalance: 5, creditPeriodStartedAt: null, creditPeriodEndsAt: null, createdAt: new Date(), updatedAt: new Date() });
 const context = { user: student, subject, profile, entitlement: entitlements.get('e1')!, trial: null, device: null, balance: 5, resetAt: null };

 const first = await chargeAiCredits(context, { operation: 'tutor', credits: 1, requestId: 'req-1' }, store);
 assert.equal(first.ok && first.charged, true);
 assert.equal(entitlements.get('e1')?.creditBalance, 4);

 const duplicate = await chargeAiCredits(context, { operation: 'tutor', credits: 1, requestId: 'req-1' }, store);
 assert.equal(duplicate.ok && duplicate.charged, false);
 assert.equal(entitlements.get('e1')?.creditBalance, 4);
 assert.equal(usage.size, 1);

 await refundAiCredits(first, store);
 assert.equal(entitlements.get('e1')?.creditBalance, 5);
 await refundAiCredits(duplicate, store);
 assert.equal(entitlements.get('e1')?.creditBalance, 5);

 const again = await store.refundCredits('req-1');
 assert.deepEqual(again, { ok: false, reason: 'already_refunded' });
});

test('zero balance blocks the tutor before any provider call', async () => {
 const { store, entitlements } = createFakeBillingStore();
 entitlements.set('e1', { id: 'e1', userId: student.id, subjectId: subject.id, subjectPlanId: null, offerId: null, academicTermId: null, freemiusLicenseId: 'lic', freemiusSubscriptionId: null, status: 'ACTIVE', renewalCanceled: false, startsAt: null, expiresAt: null, creditBalance: 0, creditPeriodStartedAt: null, creditPeriodEndsAt: null, createdAt: new Date(), updatedAt: new Date() });
 setBillingStoreForTests(store);
 setStudentStoreForTests(fakeStudents());
 setBooksStoreForTests(fakeBooks());
 setDeviceStoreForTests(createFakeDeviceStore().store);
 await installSession(student, 'student-token');

 try {
  const response = await tutorPost(tutorRequest('student-token'));
  assert.equal(response.status, 402);
  const payload = (await response.json()) as { code?: string; error?: string };
  assert.equal(payload.code, 'credit_required');
  assert.match(payload.error ?? '', /انتهى رصيدك/);
 } finally {
  reset();
 }
});

test('failed provider calls refund once and retries cannot double-charge', async () => {
 const { store, entitlements } = createFakeBillingStore();
 entitlements.set('e1', { id: 'e1', userId: student.id, subjectId: subject.id, subjectPlanId: null, offerId: null, academicTermId: null, freemiusLicenseId: 'lic', freemiusSubscriptionId: null, status: 'ACTIVE', renewalCanceled: false, startsAt: null, expiresAt: null, creditBalance: 5, creditPeriodStartedAt: null, creditPeriodEndsAt: null, createdAt: new Date(), updatedAt: new Date() });
 setBillingStoreForTests(store);
 setStudentStoreForTests(fakeStudents());
 setBooksStoreForTests(fakeBooks());
 setDeviceStoreForTests(createFakeDeviceStore().store);
 await installSession(student, 'student-token');

 try {
  // No OpenAI key in tests: the provider fails after the charge, so the charge
  // is refunded once.
  const first = await tutorPost(tutorRequest('student-token', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  assert.equal(first.status, 503);
  assert.equal(entitlements.get('e1')?.creditBalance, 5);

  const retry = await tutorPost(tutorRequest('student-token', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  assert.equal(retry.status, 503);
  assert.equal(entitlements.get('e1')?.creditBalance, 5);
 } finally {
  reset();
 }
});

test('device limit blocks AI but a free slot registers the device', async () => {
 const { store, entitlements } = createFakeBillingStore();
 entitlements.set('e1', { id: 'e1', userId: student.id, subjectId: subject.id, subjectPlanId: null, offerId: null, academicTermId: null, freemiusLicenseId: 'lic', freemiusSubscriptionId: null, status: 'ACTIVE', renewalCanceled: false, startsAt: null, expiresAt: null, creditBalance: 5, creditPeriodStartedAt: null, creditPeriodEndsAt: null, createdAt: new Date(), updatedAt: new Date() });
 setBillingStoreForTests(store);
 setStudentStoreForTests(fakeStudents());
 setBooksStoreForTests(fakeBooks());
 const devices = createFakeDeviceStore();
 setDeviceStoreForTests(devices.store);
 await installSession(student, 'student-token');

 try {
  for (let index = 0; index < 2; index += 1) {
   await devices.store.createDevice({ id: `d-${index}`, userId: student.id, deviceTokenHash: `hash-${index}`, name: 'جهاز', userAgentSummary: null });
  }
  const blocked = await tutorPost(tutorRequest('student-token'));
  assert.equal(blocked.status, 403);
  assert.equal(((await blocked.json()) as { code?: string }).code, 'device_limit');
  assert.ok(blocked.headers.get('set-cookie')?.includes('fahimni_device='));

  // Removing one device frees a slot; the same browser registers a new device.
  await devices.store.revokeDevice(student.id, 'd-0');
  const allowed = await tutorPost(tutorRequest('student-token'));
  assert.equal(allowed.status, 503); // provider missing key: the gate passed
  assert.equal(await devices.store.countActiveDevices(student.id), 2);
 } finally {
  reset();
 }
});

test('revoked device tokens are never resurrected', async () => {
 const devices = createFakeDeviceStore();
 const token = createDeviceToken();
 const hash = await hashDeviceToken(token, 'credits-test-secret');
 await devices.store.createDevice({ id: 'd-1', userId: student.id, deviceTokenHash: hash, name: 'جهاز', userAgentSummary: null });
 await devices.store.revokeDevice(student.id, 'd-1');
 const existing = await devices.store.findDeviceByTokenHash(hash);
 assert.equal(existing?.revokedAt instanceof Date, true);
});

test('rate limiting is per key with a memory fallback, Redis required in production', async () => {
 const limiter = createMemoryLimiter();
 assert.equal((await limiter.consume('k', 2, 1000)).ok, true);
 assert.equal((await limiter.consume('k', 2, 1000)).ok, true);
 assert.equal((await limiter.consume('k', 2, 1000)).ok, false);
 assert.equal((await limiter.consume('other', 2, 1000)).ok, true);

 assert.equal(productionRateLimitingReady({ NODE_ENV: 'production', REDIS_URL: 'redis://x' } as NodeJS.ProcessEnv), true);
 assert.equal(productionRateLimitingReady({ NODE_ENV: 'production' } as NodeJS.ProcessEnv), false);
 assert.equal(productionRateLimitingReady({ NODE_ENV: 'test' } as NodeJS.ProcessEnv), true);
});

test('device tokens are random, hashed and delivered via a secure HttpOnly cookie', async () => {
 const token = createDeviceToken();
 assert.ok(token.length >= 32);
 const hash = await hashDeviceToken(token, 'credits-test-secret');
 assert.notEqual(hash, token);
 assert.equal(hash, await hashDeviceToken(token, 'credits-test-secret'));
 const header = deviceCookieHeader(token, true);
 assert.match(header, /fahimni_device=/);
 assert.match(header, /HttpOnly/);
 assert.match(header, /SameSite=Lax/);
 assert.match(header, /Secure/);
 assert.match(header, /Max-Age=\d+/);
 assert.doesNotMatch(deviceCookieHeader(token, false), /Secure/);

 const request = new Request('http://localhost', { headers: { cookie: `other=1; fahimni_device=${token}` } });
 assert.equal(deviceTokenFromRequest(request), token);
});

test('user agent summary stays simple and fingerprint-free', () => {
 assert.deepEqual(summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Chrome/126 Safari/604.1'), { name: 'Chrome · iOS', summary: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Chrome/126 Safari/604.1' });
 assert.equal(summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0) Firefox/127.0').name, 'Firefox · Windows');
 assert.equal(summarizeUserAgent('').name, 'جهاز غير معروف');
});

test('admin can change the device limit; students cannot', async () => {
 const devices = createFakeDeviceStore();
 setDeviceStoreForTests(devices.store);
 await installSession(admin, 'admin-token');
 try {
  const request = () => new Request('http://localhost/api/admin/settings', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost', cookie: 'fahimni_session=admin-token' }, body: new URLSearchParams({ maxDevices: '3' }) });
  const response = await adminSettingsPost(request());
  assert.equal(response.status, 303);
  assert.equal(devices.settings.max, 3);

  await installSession(student, 'student-token');
  const studentRequest = new Request('http://localhost/api/admin/settings', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost', cookie: 'fahimni_session=student-token' }, body: new URLSearchParams({ maxDevices: '9' }) });
  const forbidden = await adminSettingsPost(studentRequest);
  assert.equal(forbidden.status, 403);
  assert.equal(devices.settings.max, 3);
 } finally {
  reset();
 }
});
