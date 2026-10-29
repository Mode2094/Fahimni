import {test} from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.AUTH_SECRET = 'billing-test-secret';
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

import { Freemius } from '@freemius/sdk';
import { POST as checkoutPost } from '../app/api/checkout/route';
import { POST as tutorPost } from '../app/api/tutor/route';
import { setAuthStoreForTests } from '../lib/auth/store';
import type { AuthSession, AuthStore, AuthUser } from '../lib/auth/store';
import { hashSessionToken } from '../lib/auth/session';
import {
 entitlementStatusForPurchase,
 hasSubjectAccess,
 isEntitlementActive,
 successStateFor,
 syncEntitlementFromPurchase,
} from '../lib/billing/entitlements';
import { setBillingStoreForTests } from '../lib/billing/store';
import type {
 BillingStore,
 EntitlementRecord,
 EntitlementUpsert,
 SubjectPlanInput,
 SubjectPlanRecord,
 AcademicTermInput,
 SubscriptionOfferInput,
} from '../lib/billing/store';
import { setFreemiusClientForTests } from '../lib/freemius/client';
import { handleFreemiusWebhook } from '../lib/freemius/webhook';
import { setBooksStoreForTests } from '../lib/books/store';
import type { BookRecord, BooksStore, NewChunk } from '../lib/books/store';
import { setDeviceStoreForTests } from '../lib/devices/store';
import type { DeviceRecord, DeviceStore } from '../lib/devices/store';
import { setLearningProgressStoreForTests } from '../lib/learning/progress';
import type { LearningProgressStore } from '../lib/learning/progress';
import { createMemoryLimiter, setRateLimiterForTests } from '../lib/rate-limit/limiter';
import { setStudentStoreForTests } from '../lib/student/store';
import type { AcademicField, CatalogSubject, Grade, StudentProfile, StudentStore } from '../lib/student/store';
import { setOfferProviderLinkStoreForTests } from '../lib/freemius/links';
import { createFakeProviderLinks } from './support/provider-links';
import { resetTrialTestDoubles, setTrialTestDoubles } from './support/trial-doubles';

const student: AuthUser = { id: 'student-1', email: 'student@example.com', name: 'طالب', image: null, role: 'STUDENT' };
const subject: CatalogSubject = { id: '11111111-1111-4111-8111-111111111111', gradeId: 'g12', academicFieldId: null, name: 'رياضيات', slug: 'math', shortDescription: null, image: null, isActive: true, isFeatured: false, sortOrder: 0 };
const profile: StudentProfile = { userId: student.id, gradeId: 'g12', academicFieldId: null, onboardingCompleted: true };

// The tutor route reads personalisation topics; without a fake this opens a real
// database connection in CI (DATABASE_URL is set) and leaves a pending promise
// that cancels later tests. Registered for the whole file and restored on reset.
const defaultProgress: LearningProgressStore = {
 async listForUser() { return []; },
 async recordAssessment() { throw new Error('not used'); },
};
setLearningProgressStoreForTests(defaultProgress);

function createFakeBillingStore() {
 const plans = new Map<string, SubjectPlanRecord>();
 const entitlements = new Map<string, EntitlementRecord>();
 const events = new Set<string>();
 const usage = new Map<string, { entitlementId: string | null; creditsCharged: number; refundedAt: Date | null }>();
 const store: BillingStore = {
  async listSubjectPlans(subjectId) { return [...plans.values()].filter(plan => plan.subjectId === subjectId); },
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
   const existing = usage.get(input.requestId);
   if (existing) {
    const entitlement = entitlements.get(input.entitlementId);
    return { ok: true, balance: entitlement?.creditBalance ?? 0, duplicate: true };
   }
   const entitlement = entitlements.get(input.entitlementId);
   if (!entitlement || entitlement.userId !== input.userId || entitlement.status !== 'ACTIVE' || entitlement.creditBalance < input.credits) {
    return { ok: false, reason: 'insufficient' };
   }
   entitlements.set(entitlement.id, {...entitlement, creditBalance: entitlement.creditBalance - input.credits});
   usage.set(input.requestId, { entitlementId: entitlement.id, creditsCharged: input.credits, refundedAt: null });
   return { ok: true, balance: entitlement.creditBalance - input.credits, duplicate: false };
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
  async hasWebhookEvent(externalEventId) { return events.has(externalEventId); },
  async recordWebhookEvent(externalEventId) { events.add(externalEventId); },
 };
 return { store, plans, entitlements, events, usage };
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

function createFakeBooksStore() {
 const book: BookRecord = { id: 'book-1', subjectId: subject.id, title: 'كتاب', originalFileName: 'book.pdf', storedFilePath: 'books/x/source.pdf', sha256: 'sha', totalPages: 1, indexedPages: 1, status: 'READY', errorMessage: null, pendingStagedToken: null, pendingStagedAt: null, createdAt: new Date(), updatedAt: new Date() };
 const chunk: NewChunk = { id: 'chunk-1', bookId: book.id, subjectId: subject.id, sourceId: 'src', pdfPage: 1, printedPage: 1, unit: 'المعادلات', lesson: 'حل معادلات خاصة', heading: null, text: 'حل معادلة خاصة بالتحليل إلى عوامل', equations: [], pageImagePath: '1.jpg', searchText: 'حل معادلة خاصه' };
 const store: BooksStore = {
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
 return store;
}

function createFakeDeviceStore() {
 const devices = new Map<string, DeviceRecord>();
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
  async getMaxDevices() { return 2; },
  async setMaxDevices() {},
 };
 return store;
}

async function installSession(user: AuthUser | null, token: string) {
 const sessionId = await hashSessionToken(token, 'billing-test-secret');
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

function checkoutRequest(body: unknown, token?: string) {
 const headers: Record<string, string> = { 'content-type': 'application/json', origin: 'http://localhost' };
 if (token) headers.cookie = `fahimni_session=${token}`;
 return new Request('http://localhost/api/checkout', { method: 'POST', headers, body: JSON.stringify(body) });
}

function fakeFreemiusCheckout() {
 const captured: { planId?: string; email?: string; name?: string; readonly?: boolean } = {};
 const client = {
  checkout: {
   create: async (options: { planId?: string }) => {
    captured.planId = options.planId;
    return {
     setUser(user: { email?: string; name?: string }, readonly?: boolean) {
      captured.email = user.email;
      captured.name = user.name;
      captured.readonly = readonly;
      return this;
     },
     getLink() { return 'https://checkout.freemius.com/product/1/plan/999/'; },
    };
   },
  },
 };
 return { client, captured };
}

function reset() {
 setAuthStoreForTests(null);
 setStudentStoreForTests(null);
 setBillingStoreForTests(null);
 setBooksStoreForTests(null);
 setDeviceStoreForTests(null);
 setLearningProgressStoreForTests(defaultProgress);
 setRateLimiterForTests(null);
 setFreemiusClientForTests(null);
 resetTrialTestDoubles();
}

test('entitlement activity honors status and expiry', () => {
 const base: EntitlementRecord = { id: 'e1', userId: student.id, subjectId: subject.id, subjectPlanId: null, offerId: null, academicTermId: null, freemiusLicenseId: 'lic', freemiusSubscriptionId: null, status: 'ACTIVE', renewalCanceled: false, startsAt: null, expiresAt: null, creditBalance: 5, creditPeriodStartedAt: null, creditPeriodEndsAt: null, createdAt: new Date(), updatedAt: new Date() };
 assert.equal(isEntitlementActive(base), true);
 assert.equal(isEntitlementActive({...base, expiresAt: new Date(Date.now() + 60_000)}), true);
 assert.equal(isEntitlementActive({...base, expiresAt: new Date(Date.now() - 60_000)}), false);
 assert.equal(isEntitlementActive({...base, status: 'CANCELED'}), false);
 assert.equal(isEntitlementActive({...base, status: 'EXPIRED'}), false);
 assert.equal(isEntitlementActive(null), false);
});

test('another student’s entitlement can never be reused', async () => {
 const { store, entitlements } = createFakeBillingStore();
 entitlements.set('e1', { id: 'e1', userId: 'other-user', subjectId: subject.id, subjectPlanId: null, offerId: null, academicTermId: null, freemiusLicenseId: 'lic', freemiusSubscriptionId: null, status: 'ACTIVE', renewalCanceled: false, startsAt: null, expiresAt: null, creditBalance: 5, creditPeriodStartedAt: null, creditPeriodEndsAt: null, createdAt: new Date(), updatedAt: new Date() });
 assert.equal(await hasSubjectAccess(store, student.id, subject.id), false);
 assert.equal(await hasSubjectAccess(store, 'other-user', subject.id), true);
});

test('purchase status mapping and success state never fake activation', () => {
 const now = new Date('2026-01-01T00:00:00Z');
 const purchase = { email: student.email, planId: 'plan-1', licenseId: 'lic', subscriptionId: null, canceled: false, expiration: new Date('2026-02-01T00:00:00Z'), created: now };
 assert.equal(entitlementStatusForPurchase(purchase, now), 'ACTIVE');
 assert.equal(entitlementStatusForPurchase({...purchase, canceled: true}, now), 'CANCELED');
 assert.equal(entitlementStatusForPurchase({...purchase, expiration: new Date('2025-12-01T00:00:00Z')}, now), 'EXPIRED');
 const active: EntitlementRecord = { id: 'e', userId: student.id, subjectId: subject.id, subjectPlanId: null, offerId: null, academicTermId: null, freemiusLicenseId: 'lic', freemiusSubscriptionId: null, status: 'ACTIVE', renewalCanceled: false, startsAt: null, expiresAt: null, creditBalance: 5, creditPeriodStartedAt: null, creditPeriodEndsAt: null, createdAt: now, updatedAt: now };
 assert.equal(successStateFor([], now), 'pending');
 assert.equal(successStateFor([active], now), 'active');
 assert.equal(successStateFor([{...active, status: 'EXPIRED'}], now), 'pending');
});

test('sync maps purchase to user+subject and refuses unprovable mappings', async () => {
 const { store, entitlements } = createFakeBillingStore();
 await store.upsertSubjectPlan({ subjectId: subject.id, type: 'MONTHLY', freemiusPlanId: 'plan-1', priceMinor: 39_000, monthlyCreditAllowance: 200, currency: 'JOD', isActive: true });
 const findUserByEmail = async (email: string) => (email === student.email ? { id: student.id } : null);
 const purchase = { email: student.email, planId: 'plan-1', licenseId: 'lic-1', subscriptionId: 'sub-1', canceled: false, expiration: null, created: new Date() };

 const unknownPlan = await syncEntitlementFromPurchase({ store, findUserByEmail }, {...purchase, planId: 'ghost'});
 assert.deepEqual(unknownPlan, { ok: false, reason: 'unknown_plan' });
 const unknownUser = await syncEntitlementFromPurchase({ store, findUserByEmail }, {...purchase, email: 'ghost@example.com'});
 assert.deepEqual(unknownUser, { ok: false, reason: 'unknown_user' });
 assert.equal(entitlements.size, 0);

 const ok = await syncEntitlementFromPurchase({ store, findUserByEmail }, purchase);
 assert.deepEqual(ok, { ok: true });
 const saved = [...entitlements.values()][0];
 assert.equal(saved.userId, student.id);
 assert.equal(saved.subjectId, subject.id);
 assert.equal(saved.freemiusLicenseId, 'lic-1');
 assert.equal(saved.status, 'ACTIVE');

 await syncEntitlementFromPurchase({ store, findUserByEmail }, {...purchase, canceled: true});
 assert.equal(entitlements.size, 1);
 assert.equal([...entitlements.values()][0].status, 'CANCELED');
});

test('checkout requires auth, onboarding, visible subject and an active plan', async () => {
 const { store, plans } = createFakeBillingStore();
 plans.set('plan-1', { id: 'plan-1', subjectId: subject.id, type: 'MONTHLY', freemiusPlanId: '999', priceMinor: 39_000, monthlyCreditAllowance: 200, currency: 'JOD', isActive: true });
 setBillingStoreForTests(store);
 setStudentStoreForTests(fakeStudents());
 setBooksStoreForTests(createFakeBooksStore());

 try {
  const anonymous = await checkoutPost(checkoutRequest({ subjectId: subject.id, planType: 'MONTHLY' }));
  assert.equal(anonymous.status, 401);

  await installSession(student, 'student-token');
  const invalid = await checkoutPost(checkoutRequest({ subjectId: subject.id, planType: 'MONTHLY', freemiusPlanId: 'evil', price: 1, userId: 'other' }, 'student-token'));
  assert.equal(invalid.status, 400);

  setStudentStoreForTests({...fakeStudents(), async getProfile() { return null; }});
  const noOnboarding = await checkoutPost(checkoutRequest({ subjectId: subject.id, planType: 'MONTHLY' }, 'student-token'));
  assert.equal(noOnboarding.status, 403);

  setStudentStoreForTests({...fakeStudents(), async findSubjectById() { return null; }});
  const hidden = await checkoutPost(checkoutRequest({ subjectId: subject.id, planType: 'MONTHLY' }, 'student-token'));
  assert.equal(hidden.status, 404);

  setStudentStoreForTests(fakeStudents());
  plans.set('plan-1', {...plans.get('plan-1')!, isActive: false});
  const inactive = await checkoutPost(checkoutRequest({ subjectId: subject.id, planType: 'MONTHLY' }, 'student-token'));
  assert.equal(inactive.status, 409);
 } finally {
  reset();
 }
});

test('checkout uses the server-side plan and the authenticated email', async () => {
 const { store, plans } = createFakeBillingStore();
 plans.set('plan-1', { id: 'plan-1', subjectId: subject.id, type: 'MONTHLY', freemiusPlanId: '999', priceMinor: 39_000, monthlyCreditAllowance: 200, currency: 'JOD', isActive: true });
 setBillingStoreForTests(store);
 setStudentStoreForTests(fakeStudents());
 setBooksStoreForTests(createFakeBooksStore());
 const { client, captured } = fakeFreemiusCheckout();
 setFreemiusClientForTests(client as never);
 await installSession(student, 'student-token');

 // Legacy plans now share the offer verification source of truth.
 const links = createFakeProviderLinks();
 setOfferProviderLinkStoreForTests(links.store);

 try {
  // Unverified plan id: no live checkout may start.
  const unverified = await checkoutPost(checkoutRequest({ subjectId: subject.id, planType: 'MONTHLY' }, 'student-token'));
  assert.equal(unverified.status, 409);
  assert.equal(((await unverified.json()) as { code?: string }).code, 'plan_unavailable');

  // Demo/placeholder plan id: blocked before any provider call.
  plans.set('plan-1', {...plans.get('plan-1')!, freemiusPlanId: 'plan_demo_math_monthly'});
  const demo = await checkoutPost(checkoutRequest({ subjectId: subject.id, planType: 'MONTHLY' }, 'student-token'));
  assert.equal(demo.status, 409);
  assert.equal(captured.planId, undefined, 'a demo plan id must never reach the provider');

  // Only a verified provider mapping starts the real, server-resolved checkout.
  plans.set('plan-1', {...plans.get('plan-1')!, freemiusPlanId: '999'});
  links.seed('plan-1', { planId: '999' });
  const response = await checkoutPost(checkoutRequest({ subjectId: subject.id, planType: 'MONTHLY' }, 'student-token'));
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { url?: string };
  assert.equal(payload.url, 'https://checkout.freemius.com/product/1/plan/999/');
  assert.equal(captured.planId, '999');
  assert.equal(captured.email, student.email);
  assert.equal(captured.readonly, true);
 } finally {
  reset();
 }
});

test('webhook rejects invalid signatures and processes valid events idempotently', async () => {
 const secret = '0123456789abcdef0123456789abcdef';
 const freemius = new Freemius({ productId: '1', apiKey: 'sk_test_0123456789abcdef0123456789abcdef', secretKey: secret, publicKey: 'pk_test_0123456789abcdef' });
 const { store, entitlements, events } = createFakeBillingStore();
 await store.upsertSubjectPlan({ subjectId: subject.id, type: 'MONTHLY', freemiusPlanId: 'plan-1', priceMinor: 39_000, monthlyCreditAllowance: 200, currency: 'JOD', isActive: true });
 let retrieveCalls = 0;

 const deps = {
  createListener: () => freemius.webhook.createListener(),
  processFetch: (listener: ReturnType<Freemius['webhook']['createListener']>, request: Request) => freemius.webhook.processFetch(listener, request),
  retrievePurchase: async (licenseId: string) => {
   retrieveCalls += 1;
   return { email: student.email, planId: 'plan-1', licenseId, subscriptionId: null, canceled: false, expiration: null, created: new Date() };
  },
  store,
  findUserByEmail: async (email: string) => (email === student.email ? { id: student.id } : null),
 };

 const body = JSON.stringify({ id: 'evt-1', type: 'license.created', created: new Date().toISOString(), updated: null, state: 'processed', objects: { license: { id: 'lic-9' } } });
 const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest('hex');
 const makeRequest = (payload: string, signature: string) =>
  new Request('http://localhost/api/webhooks/freemius', { method: 'POST', headers: { 'x-signature': signature, 'content-type': 'application/json' }, body: payload });

 const invalid = await handleFreemiusWebhook(makeRequest(body, 'deadbeef'), deps);
 assert.equal(invalid.status, 401);
 assert.equal(retrieveCalls, 0);
 assert.equal(entitlements.size, 0);

 const first = await handleFreemiusWebhook(makeRequest(body, sign(body)), deps);
 assert.equal(first.status, 200);
 assert.equal(retrieveCalls, 1);
 assert.equal(entitlements.size, 1);
 assert.equal([...entitlements.values()][0].freemiusLicenseId, 'lic-9');
 assert.equal(events.size, 1);

 const duplicate = await handleFreemiusWebhook(makeRequest(body, sign(body)), deps);
 assert.equal(duplicate.status, 200);
 assert.equal(retrieveCalls, 1);
 assert.equal(entitlements.size, 1);

 const deleted = JSON.stringify({ id: 'evt-2', type: 'license.deleted', created: new Date().toISOString(), updated: null, state: 'processed', data: { license_id: 'lic-9' } });
 const deletion = await handleFreemiusWebhook(makeRequest(deleted, sign(deleted)), deps);
 assert.equal(deletion.status, 200);
 assert.equal(entitlements.size, 0);
 assert.equal(events.size, 2);

 const deletionDuplicate = await handleFreemiusWebhook(makeRequest(deleted, sign(deleted)), deps);
 assert.equal(deletionDuplicate.status, 200);
 assert.equal(events.size, 2);
});

test('webhook skips entitlements when the plan or user cannot be proven', async () => {
 const secret = 'fedcba9876543210fedcba9876543210';
 const freemius = new Freemius({ productId: '1', apiKey: 'sk_test_0123456789abcdef0123456789abcdef', secretKey: secret, publicKey: 'pk_test_0123456789abcdef' });
 const { store, entitlements } = createFakeBillingStore();
 const deps = {
  createListener: () => freemius.webhook.createListener(),
  processFetch: (listener: ReturnType<Freemius['webhook']['createListener']>, request: Request) => freemius.webhook.processFetch(listener, request),
  retrievePurchase: async (licenseId: string) => ({ email: 'ghost@example.com', planId: 'ghost-plan', licenseId, subscriptionId: null, canceled: false, expiration: null, created: new Date() }),
  store,
  findUserByEmail: async () => null,
 };
 const body = JSON.stringify({ id: 'evt-3', type: 'license.created', created: new Date().toISOString(), updated: null, state: 'processed', objects: { license: { id: 'lic-x' } } });
 const signature = createHmac('sha256', secret).update(body).digest('hex');
 const response = await handleFreemiusWebhook(new Request('http://localhost/api/webhooks/freemius', { method: 'POST', headers: { 'x-signature': signature }, body }), deps);
 assert.equal(response.status, 200);
 assert.equal(entitlements.size, 0);
});

test('subject tutor API blocks without entitlement and passes the gate with one', async () => {
 setStudentStoreForTests(fakeStudents());
 setBooksStoreForTests(createFakeBooksStore());
 const { store, entitlements } = createFakeBillingStore();
 setBillingStoreForTests(store);
 setDeviceStoreForTests(createFakeDeviceStore());
 setLearningProgressStoreForTests(defaultProgress);
 setRateLimiterForTests(createMemoryLimiter());
 setTrialTestDoubles();
 await installSession(student, 'student-token');

 const tutorRequest = () =>
  new Request('http://localhost/api/tutor', {
   method: 'POST',
   headers: { 'content-type': 'application/json', origin: 'http://localhost', cookie: 'fahimni_session=student-token' },
   body: JSON.stringify({ question: 'حل معادلة خاصة', board: { objects: [] }, history: [], currentStep: 0, currentLesson: null, subjectSlug: 'math', requestId: crypto.randomUUID() }),
  });

 try {
  const blocked = await tutorPost(tutorRequest());
  assert.equal(blocked.status, 403);
  assert.equal(((await blocked.json()) as { code?: string }).code, 'entitlement_required');

  entitlements.set('e1', { id: 'e1', userId: student.id, subjectId: subject.id, subjectPlanId: null, offerId: null, academicTermId: null, freemiusLicenseId: 'lic', freemiusSubscriptionId: null, status: 'ACTIVE', renewalCanceled: false, startsAt: null, expiresAt: null, creditBalance: 5, creditPeriodStartedAt: null, creditPeriodEndsAt: null, createdAt: new Date(), updatedAt: new Date() });
  const allowed = await tutorPost(tutorRequest());
  // The paywall/credit/device gates passed; the provider is not configured in tests.
  assert.equal(allowed.status, 503);

  entitlements.set('e1', {...entitlements.get('e1')!, status: 'EXPIRED'});
  const expired = await tutorPost(tutorRequest());
  assert.equal(expired.status, 403);
  assert.equal(((await expired.json()) as { code?: string }).code, 'entitlement_required');
 } finally {
  reset();
 }
});

test('renewal failures are recorded for admins and never change entitlements (SIMULATED)', async () => {
 const secret = 'sk_test_secret_renewal_failures_0123456789';
 const freemius = new Freemius({ productId: '1', apiKey: 'sk_test_0123456789abcdef0123456789abcdef', secretKey: secret, publicKey: 'pk_test_0123456789abcdef' });
 const { store, entitlements } = createFakeBillingStore();
 const recorded: { type: string; licenseId?: string | null; subscriptionId?: string | null; userEmail?: string | null }[] = [];
 const deps = {
  createListener: () => freemius.webhook.createListener(),
  processFetch: (listener: ReturnType<Freemius['webhook']['createListener']>, request: Request) => freemius.webhook.processFetch(listener, request),
  retrievePurchase: async () => null,
  store,
  findUserByEmail: async () => null,
  events: {
   record: async (input: { type: string; licenseId?: string | null; subscriptionId?: string | null; userEmail?: string | null }) => { recorded.push(input); },
   list: async () => [],
  },
 };
 const body = JSON.stringify({
  id: 'evt-renewal-failed',
  type: 'subscription.renewal.failed.last',
  created: new Date().toISOString(),
  updated: null,
  state: 'processed',
  objects: { license: { id: 'lic-9' }, subscription: { id: 'sub-9' }, user: { email: student.email } },
 });
 const signature = createHmac('sha256', secret).update(body).digest('hex');
 const makeRequest = () => new Request('http://localhost/api/webhooks/freemius', { method: 'POST', headers: { 'x-signature': signature }, body });

 const response = await handleFreemiusWebhook(makeRequest(), deps);
 assert.equal(response.status, 200);
 assert.equal(recorded.length, 1);
 assert.equal(recorded[0].type, 'subscription.renewal.failed.last');
 assert.equal(recorded[0].licenseId, 'lic-9');
 assert.equal(recorded[0].subscriptionId, 'sub-9');
 assert.equal(recorded[0].userEmail, student.email);
 // Payment failures never grant or revoke access.
 assert.equal(entitlements.size, 0);

 // Duplicate delivery: no second timeline entry.
 await handleFreemiusWebhook(makeRequest(), deps);
 assert.equal(recorded.length, 1);
});

test('verified cancellations add an admin timeline entry only after a successful sync (SIMULATED)', async () => {
 const secret = 'sk_test_secret_cancellation_audit_0123456789';
 const freemius = new Freemius({ productId: '1', apiKey: 'sk_test_0123456789abcdef0123456789abcdef', secretKey: secret, publicKey: 'pk_test_0123456789abcdef' });
 const { store, entitlements } = createFakeBillingStore();
 await store.upsertSubjectPlan({ subjectId: subject.id, type: 'MONTHLY', freemiusPlanId: 'plan-1', priceMinor: 39_000, monthlyCreditAllowance: 200, currency: 'JOD', isActive: true });
 const recorded: { type: string }[] = [];
 const deps = {
  createListener: () => freemius.webhook.createListener(),
  processFetch: (listener: ReturnType<Freemius['webhook']['createListener']>, request: Request) => freemius.webhook.processFetch(listener, request),
  retrievePurchase: async (licenseId: string) => ({ email: student.email, planId: 'plan-1', licenseId, subscriptionId: 'sub-9', canceled: true, expiration: null, created: new Date() }),
  store,
  findUserByEmail: async (email: string) => (email === student.email ? { id: student.id } : null),
  events: {
   record: async (input: { type: string }) => { recorded.push(input); },
   list: async () => [],
  },
 };
 const body = JSON.stringify({
  id: 'evt-cancelled',
  type: 'license.cancelled',
  created: new Date().toISOString(),
  updated: null,
  state: 'processed',
  objects: { license: { id: 'lic-cancel' }, subscription: { id: 'sub-9' }, user: { email: student.email } },
 });
 const signature = createHmac('sha256', secret).update(body).digest('hex');
 const response = await handleFreemiusWebhook(
  new Request('http://localhost/api/webhooks/freemius', { method: 'POST', headers: { 'x-signature': signature }, body }),
  deps,
 );
 assert.equal(response.status, 200);
 assert.equal(entitlements.size, 1);
 assert.equal([...entitlements.values()][0].status, 'CANCELED');
 assert.deepEqual(recorded.map((item) => item.type), ['license.cancelled']);
});
