import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.AUTH_SECRET = 'subscriptions-test-secret';
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

import { Freemius } from '@freemius/sdk';
import { POST as checkoutPost } from '../app/api/checkout/route';
import { POST as adminOffersPost } from '../app/api/admin/subscriptions/offers/route';
import { POST as adminOfferUpdatePost } from '../app/api/admin/subscriptions/offers/[id]/route';
import { POST as adminTermUpdatePost } from '../app/api/admin/subscriptions/terms/[id]/route';
import { offerReadiness } from '../lib/admin/offer-readiness';
import { setAuthStoreForTests } from '../lib/auth/store';
import type { AuthSession, AuthStore, AuthUser } from '../lib/auth/store';
import { hashSessionToken } from '../lib/auth/session';
import {
  isEntitlementActive,
  offerLifecycleForPurchase,
  offerMappingMatches,
  syncEntitlementFromPurchase,
} from '../lib/billing/entitlements';
import {
  bundleOfferDedupeKey,
  setBillingStoreForTests,
  subjectOfferDedupeKey,
  type AcademicTermInput,
  type AcademicTermRecord,
  type BillingStore,
  type EntitlementRecord,
  type EntitlementUpsert,
  type PlanType,
  type SubscriptionOfferInput,
  type SubscriptionOfferRecord,
} from '../lib/billing/store';
import { ammanDayEnd, ammanDayStart, semesterAccessWindow, termWindowFromCalendarDates } from '../lib/billing/terms';
import { ensureCreditPeriod } from '../lib/credits/periods';
import { setFreemiusClientForTests } from '../lib/freemius/client';
import { setOfferProviderLinkStoreForTests } from '../lib/freemius/links';
import { resyncEntitlementFromProvider } from '../lib/freemius/reconcile';
import { duplicatePlanIdMappings, verifyOfferAgainstProvider } from '../lib/freemius/verification';
import { setBooksStoreForTests } from '../lib/books/store';
import type { BookRecord, BooksStore } from '../lib/books/store';
import { createFakeProviderLinks } from './support/provider-links';
import { handleFreemiusWebhook } from '../lib/freemius/webhook';
import { setStudentStoreForTests } from '../lib/student/store';
import type { AcademicField, CatalogSubject, Grade, StudentProfile, StudentStore } from '../lib/student/store';

const student: AuthUser = { id: 'student-1', email: 'student@example.com', name: 'طالب', image: null, role: 'STUDENT' };
const admin: AuthUser = { id: 'admin-1', email: 'admin@example.com', name: 'مشرف', image: null, role: 'ADMIN' };
const profile: StudentProfile = { userId: student.id, gradeId: 'g12', academicFieldId: 'f-sci', onboardingCompleted: true };

function makeSubject(input: {
  id: string;
  gradeId: string;
  academicFieldId: string | null;
  name: string;
  slug: string;
}): CatalogSubject {
  return { ...input, shortDescription: null, image: null, isActive: true, isFeatured: false, sortOrder: 0 };
}

const math = makeSubject({ id: 's-math', gradeId: 'g12', academicFieldId: 'f-sci', name: 'الرياضيات', slug: 'math' });
const physics = makeSubject({ id: 's-physics', gradeId: 'g12', academicFieldId: 'f-sci', name: 'الفيزياء', slug: 'physics' });
const arabic = makeSubject({ id: 's-arabic', gradeId: 'g12', academicFieldId: 'f-lit', name: 'العربية', slug: 'arabic' });
const religion = makeSubject({ id: 's-religion', gradeId: 'g12', academicFieldId: null, name: 'التربية الإسلامية', slug: 'religion' });
const math11 = makeSubject({ id: 's-math11', gradeId: 'g11', academicFieldId: null, name: 'رياضيات ١١', slug: 'math-11' });
const catalog = [math, physics, arabic, religion, math11];

function fakeStudents(): StudentStore {
  const grades: Grade[] = [
    { id: 'g12', name: 'التوجيهي', slug: 'tawjihi', isActive: true },
    { id: 'g11', name: 'الصف الحادي عشر', slug: 'grade-11', isActive: true },
  ];
  const fields: AcademicField[] = [
    { id: 'f-sci', gradeId: 'g12', name: 'العلمي', slug: 'sci', isActive: true },
    { id: 'f-lit', gradeId: 'g12', name: 'الأدبي', slug: 'lit', isActive: true },
  ];
  return {
    async listActiveGrades() {
      return grades;
    },
    async findGradeById(id) {
      return grades.find((grade) => grade.id === id) ?? null;
    },
    async listActiveFields() {
      return fields;
    },
    async listActiveFieldsForGrade(gradeId) {
      return fields.filter((field) => field.gradeId === gradeId);
    },
    async findFieldById(id) {
      return fields.find((field) => field.id === id) ?? null;
    },
    async getProfile(userId) {
      return userId === student.id ? profile : null;
    },
    async upsertProfile() {},
    async listSubjectsForStudent(gradeId, academicFieldId) {
      return catalog.filter((subject) => {
        if (!subject.isActive || subject.gradeId !== gradeId) return false;
        if (subject.academicFieldId === null) return true;
        return academicFieldId !== null && subject.academicFieldId === academicFieldId;
      });
    },
    async listActiveSubjectsForGrade(gradeId) {
      return catalog.filter((subject) => subject.gradeId === gradeId);
    },
    async findSubjectBySlug(slug) {
      return catalog.find((subject) => subject.slug === slug) ?? null;
    },
    async findSubjectById(id) {
      return catalog.find((subject) => subject.id === id) ?? null;
    },
  };
}

function createHarness() {
  const terms = new Map<string, AcademicTermRecord>();
  const offers = new Map<string, SubscriptionOfferRecord>();
  const bundleScopes = new Map<string, Set<string>>();
  const entitlements = new Map<string, EntitlementRecord>();
  const entitlementScopes = new Map<string, Set<string>>();
  const events = new Set<string>();
  const usage = new Map<string, { entitlementId: string | null; creditsCharged: number; refundedAt: Date | null }>();
  const emails = new Map<string, string>([[student.id, student.email], [admin.id, admin.email]]);

  const store: BillingStore = {
    async listSubjectPlans() {
      return [];
    },
    async findSubjectPlanById() {
      return null;
    },
    async findSubjectPlanByFreemiusPlanId() {
      return null;
    },
    async findSubjectPlanBySubjectAndType() {
      return null;
    },
    async upsertSubjectPlan(input) {
      return { id: crypto.randomUUID(), ...input };
    },
    async listAcademicTerms() {
      return [...terms.values()];
    },
    async findAcademicTermById(id) {
      return terms.get(id) ?? null;
    },
    async upsertAcademicTerm(input: AcademicTermInput) {
      const existing = terms.get(input.id);
      const row: AcademicTermRecord = { ...input, createdAt: existing?.createdAt ?? new Date(), updatedAt: new Date() };
      terms.set(row.id, row);
      return row;
    },
    async setAcademicTermActive(id, isActive) {
      const term = terms.get(id);
      if (term) terms.set(id, { ...term, isActive });
    },
    async countSoldEntitlementsForTerm(termId) {
      return [...entitlements.values()].filter((item) => item.academicTermId === termId).length;
    },
    async listSubscriptionOffers() {
      return [...offers.values()];
    },
    async findSubscriptionOfferById(id) {
      return offers.get(id) ?? null;
    },
    async findSubscriptionOfferByFreemiusPlanId(freemiusPlanId) {
      return [...offers.values()].find((offer) => offer.freemiusPlanId === freemiusPlanId) ?? null;
    },
    async upsertSubscriptionOffer(input: SubscriptionOfferInput) {
      const existing = [...offers.values()].find((offer) => offer.dedupeKey === input.dedupeKey);
      const row: SubscriptionOfferRecord = {
        ...input,
        id: existing?.id ?? input.id,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      offers.set(row.id, row);
      return row;
    },
    async setSubscriptionOfferActive(id, isActive) {
      const offer = offers.get(id);
      if (offer) offers.set(id, { ...offer, isActive });
    },
    async listBundleSubjectIds(offerId) {
      return [...(bundleScopes.get(offerId) ?? [])];
    },
    async setBundleSubjects(offerId, subjectIds) {
      bundleScopes.set(offerId, new Set(subjectIds));
    },
    async listEntitlementSubjectIds(entitlementId) {
      return [...(entitlementScopes.get(entitlementId) ?? [])];
    },
    async ensureEntitlementSubjects(entitlementId, subjectIds) {
      const existing = entitlementScopes.get(entitlementId);
      if (existing && existing.size) return;
      entitlementScopes.set(entitlementId, new Set(subjectIds));
    },
    async replaceEntitlementSubjects(entitlementId, subjectIds) {
      entitlementScopes.set(entitlementId, new Set(subjectIds));
    },
    async findEntitlementByLicenseId(licenseId) {
      return [...entitlements.values()].find((item) => item.freemiusLicenseId === licenseId) ?? null;
    },
    async findEntitlementById(id) {
      return entitlements.get(id) ?? null;
    },
    async upsertEntitlement(record: EntitlementUpsert) {
      const existing = [...entitlements.values()].find((item) => item.freemiusLicenseId === record.freemiusLicenseId);
      const row: EntitlementRecord = {
        ...record,
        id: existing?.id ?? record.id,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      entitlements.set(row.id, row);
    },
    async updateCreditPeriod(id, balance, startedAt, endsAt) {
      const current = entitlements.get(id);
      if (current) entitlements.set(id, { ...current, creditBalance: balance, creditPeriodStartedAt: startedAt, creditPeriodEndsAt: endsAt });
    },
    async deleteEntitlementByLicenseId(licenseId) {
      for (const [id, item] of entitlements) {
        if (item.freemiusLicenseId === licenseId) {
          entitlements.delete(id);
          entitlementScopes.delete(id);
        }
      }
    },
    async findActiveEntitlement(userId, subjectId, now) {
      return (
        [...entitlements.values()].find(
          (item) => item.userId === userId && item.subjectId === subjectId && isEntitlementActive(item, now),
        ) ?? null
      );
    },
    async findAccessibleEntitlement(userId, subjectId, now) {
      const candidates = [...entitlements.values()].filter(
        (item) =>
          item.userId === userId &&
          isEntitlementActive(item, now) &&
          (item.subjectId === subjectId || entitlementScopes.get(item.id)?.has(subjectId)),
      );
      candidates.sort((a, b) => {
        const specificA = a.subjectId === subjectId ? 0 : 1;
        const specificB = b.subjectId === subjectId ? 0 : 1;
        if (specificA !== specificB) return specificA - specificB;
        const expiryA = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
        const expiryB = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
        if (expiryA !== expiryB) return expiryA - expiryB;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      return candidates[0] ?? null;
    },
    async listEntitlementsForUser(userId) {
      return [...entitlements.values()].filter((item) => item.userId === userId);
    },
    async listEntitlementsWithUsers() {
      return [...entitlements.values()].map((item) => ({
        ...item,
        userEmail: emails.get(item.userId) ?? 'unknown@test',
        userName: null,
      }));
    },
    async chargeCredits(input) {
      if (usage.has(input.requestId)) {
        return { ok: true, balance: entitlements.get(input.entitlementId)?.creditBalance ?? 0, duplicate: true };
      }
      const entitlement = entitlements.get(input.entitlementId);
      if (
        !entitlement ||
        entitlement.userId !== input.userId ||
        entitlement.status !== 'ACTIVE' ||
        entitlement.creditBalance < input.credits
      ) {
        return { ok: false, reason: 'insufficient' };
      }
      const next = { ...entitlement, creditBalance: entitlement.creditBalance - input.credits };
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
        if (entitlement) entitlements.set(entitlement.id, { ...entitlement, creditBalance: entitlement.creditBalance + event.creditsCharged });
      }
      return { ok: true, refunded: event.creditsCharged };
    },
    async findUsageEventByRequestId(requestId) {
      const event = usage.get(requestId);
      return event ? { id: requestId, entitlementId: event.entitlementId, creditsCharged: event.creditsCharged, refundedAt: event.refundedAt } : null;
    },
    async hasWebhookEvent(externalEventId) {
      return events.has(externalEventId);
    },
    async recordWebhookEvent(externalEventId) {
      events.add(externalEventId);
    },
  };

  return { store, terms, offers, bundleScopes, entitlements, entitlementScopes, events, usage };
}

async function installSession(user: AuthUser | null, token: string) {
  const sessionId = await hashSessionToken(token, 'subscriptions-test-secret');
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

function fakeFreemiusCheckout() {
  const captured: { planId?: string } = {};
  const client = {
    checkout: {
      create: async (options: { planId?: string }) => {
        captured.planId = options.planId;
        return {
          setUser() {
            return this;
          },
          getLink() {
            return 'https://checkout.freemius.com/product/1/plan/999/';
          },
        };
      },
    },
  };
  return { client, captured };
}

function jsonRequest(url: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: 'http://localhost' };
  if (token) headers.cookie = `fahimni_session=${token}`;
  return new Request(`http://localhost${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

function formRequest(url: string, form: FormData, token?: string) {
  const headers: Record<string, string> = { origin: 'http://localhost' };
  if (token) headers.cookie = `fahimni_session=${token}`;
  return new Request(`http://localhost${url}`, { method: 'POST', headers, body: form });
}

function reset() {
  setAuthStoreForTests(null);
  setStudentStoreForTests(null);
  setBillingStoreForTests(null);
  setFreemiusClientForTests(null);
  setOfferProviderLinkStoreForTests(null);
  setBooksStoreForTests(null);
}

// READY textbooks exist only for the subjects listed here; everything else is
// treated as "content not ready" (physics/chemistry in production today).
function fakeBooksWithReady(...readySubjectIds: string[]): BooksStore {
  const ready = new Set(readySubjectIds);
  return {
    async findReadyBookBySubject(subjectId: string) {
      if (!ready.has(subjectId)) return null;
      return {
        id: `book-${subjectId}`,
        subjectId,
        title: 'كتاب',
        originalFileName: 'book.pdf',
        storedFilePath: 'books/x/source.pdf',
        sha256: 'sha',
        totalPages: 1,
        indexedPages: 1,
        status: 'READY',
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies BookRecord;
    },
  } as unknown as BooksStore;
}

function term(overrides: Partial<AcademicTermRecord> = {}): AcademicTermRecord {
  const now = Date.now();
  return {
    id: 'term-1',
    name: 'الفصل الأول',
    academicYear: '2026/2027',
    gradeId: 'g12',
    academicFieldId: 'f-sci',
    startsAt: new Date(now - 10 * 24 * 3600_000),
    endsAt: new Date(now + 50 * 24 * 3600_000),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function addOffer(
  harness: ReturnType<typeof createHarness>,
  input: {
    kind: 'SUBJECT' | 'BUNDLE';
    type: PlanType;
    subjectId?: string;
    gradeId?: string;
    academicFieldId?: string | null;
    termId?: string | null;
    planId: string;
    allowance?: number;
    scope?: string[];
    active?: boolean;
  },
): Promise<SubscriptionOfferRecord> {
  const dedupeKey =
    input.kind === 'SUBJECT'
      ? subjectOfferDedupeKey(input.subjectId as string, input.type, input.termId ?? null)
      : bundleOfferDedupeKey(input.gradeId as string, input.academicFieldId ?? null, input.type, input.termId ?? null);
  const offer = await harness.store.upsertSubscriptionOffer({
    id: crypto.randomUUID(),
    dedupeKey,
    kind: input.kind,
    type: input.type,
    subjectId: input.kind === 'SUBJECT' ? (input.subjectId as string) : null,
    gradeId: input.kind === 'BUNDLE' ? (input.gradeId as string) : null,
    academicFieldId: input.kind === 'BUNDLE' ? input.academicFieldId ?? null : null,
    academicTermId: input.termId ?? null,
    freemiusPlanId: input.planId,
    priceMinor: 39_000,
    monthlyCreditAllowance: input.allowance ?? 200,
    currency: 'JOD',
    isActive: input.active ?? true,
  });
  if (input.kind === 'BUNDLE' && input.scope) await harness.store.setBundleSubjects(offer.id, input.scope);
  return offer;
}

function purchaseFor(planId: string, overrides: Record<string, unknown> = {}) {
  return {
    email: student.email,
    planId,
    licenseId: `lic-${planId}`,
    subscriptionId: 'sub-1' as string | null,
    canceled: false,
    expiration: new Date(Date.now() + 30 * 24 * 3600_000) as Date | null,
    created: new Date(),
    billingCycle: 'monthly' as 'monthly' | 'yearly' | 'oneoff' | null,
    ...overrides,
  };
}

test('academic term boundaries use Asia/Amman and validate start < end', () => {
  const start = ammanDayStart('2026-09-01');
  const end = ammanDayEnd('2026-12-20');
  // Jordan is UTC+3: midnight Amman is 21:00 UTC on the previous day.
  assert.equal(start.toISOString(), '2026-08-31T21:00:00.000Z');
  assert.equal(end.toISOString(), '2026-12-20T20:59:59.999Z');
  assert.equal(termWindowFromCalendarDates('2026-12-20', '2026-09-01'), null);
  assert.equal(termWindowFromCalendarDates('not-a-date', '2026-09-01'), null);
  const window = semesterAccessWindow({ startsAt: start, endsAt: end, purchasedAt: new Date('2026-10-01T00:00:00Z') });
  assert.equal(window.startsAt.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(window.endsAt.getTime(), end.getTime());
  const early = semesterAccessWindow({ startsAt: start, endsAt: end, purchasedAt: new Date('2026-07-01T00:00:00Z') });
  assert.equal(early.startsAt.getTime(), start.getTime());
});

test('single subject monthly purchase grants a subject entitlement', async () => {
  const harness = createHarness();
  const offer = await addOffer(harness, { kind: 'SUBJECT', type: 'MONTHLY', subjectId: math.id, planId: 'plan-math-monthly' });
  const result = await syncEntitlementFromPurchase(
    { store: harness.store, findUserByEmail: async () => ({ id: student.id }) },
    purchaseFor('plan-math-monthly'),
  );
  assert.deepEqual(result, { ok: true });
  const entitlement = [...harness.entitlements.values()][0];
  assert.equal(entitlement.subjectId, math.id);
  assert.equal(entitlement.offerId, offer.id);
  assert.equal(entitlement.status, 'ACTIVE');
  assert.equal(entitlement.creditBalance, 200);
  assert.equal(await harness.store.findAccessibleEntitlement(student.id, math.id, new Date()) !== null, true);
  assert.equal(await harness.store.findAccessibleEntitlement(student.id, physics.id, new Date()), null);
});

test('single subject semester purchase mid-term starts immediately and ends at term end', async () => {
  const harness = createHarness();
  const activeTerm = term();
  await harness.store.upsertAcademicTerm(activeTerm);
  await addOffer(harness, { kind: 'SUBJECT', type: 'SEMESTER', subjectId: math.id, planId: 'plan-math-sem', termId: activeTerm.id });
  const purchase = purchaseFor('plan-math-sem', {
    subscriptionId: null,
    expiration: null,
    billingCycle: 'oneoff',
    created: new Date(Date.now() - 3600_000),
  });
  const result = await syncEntitlementFromPurchase({ store: harness.store, findUserByEmail: async () => ({ id: student.id }) }, purchase);
  assert.deepEqual(result, { ok: true });
  const entitlement = [...harness.entitlements.values()][0];
  assert.equal(entitlement.expiresAt?.getTime(), activeTerm.endsAt.getTime());
  assert.equal(entitlement.startsAt?.getTime(), purchase.created.getTime());
  assert.equal(entitlement.academicTermId, activeTerm.id);
  // A one-off purchase never becomes lifetime access.
  assert.notEqual(entitlement.expiresAt, null);
});

test('semester purchased before start blocks access until the start boundary', async () => {
  const harness = createHarness();
  const futureTerm = term({
    id: 'term-future',
    startsAt: new Date(Date.now() + 20 * 24 * 3600_000),
    endsAt: new Date(Date.now() + 110 * 24 * 3600_000),
  });
  await harness.store.upsertAcademicTerm(futureTerm);
  await addOffer(harness, { kind: 'SUBJECT', type: 'SEMESTER', subjectId: math.id, planId: 'plan-future', termId: futureTerm.id });
  await syncEntitlementFromPurchase(
    { store: harness.store, findUserByEmail: async () => ({ id: student.id }) },
    purchaseFor('plan-future', { subscriptionId: null, expiration: null, billingCycle: 'oneoff' }),
  );
  const now = new Date();
  assert.equal(await harness.store.findAccessibleEntitlement(student.id, math.id, now), null);
  const afterStart = new Date(futureTerm.startsAt.getTime() + 1000);
  assert.ok(await harness.store.findAccessibleEntitlement(student.id, math.id, afterStart));
  // And access ends exactly at the term end.
  assert.equal(await harness.store.findAccessibleEntitlement(student.id, math.id, new Date(futureTerm.endsAt.getTime() + 1000)), null);
});

test('bundle purchase covers exactly its frozen scope and shares one wallet', async () => {
  const harness = createHarness();
  await addOffer(harness, {
    kind: 'BUNDLE',
    type: 'MONTHLY',
    gradeId: 'g12',
    academicFieldId: 'f-sci',
    planId: 'plan-bundle',
    allowance: 500,
    scope: [math.id, physics.id],
  });
  await syncEntitlementFromPurchase(
    { store: harness.store, findUserByEmail: async () => ({ id: student.id }) },
    purchaseFor('plan-bundle'),
  );
  const entitlement = [...harness.entitlements.values()][0];
  assert.equal(entitlement.subjectId, null);
  assert.equal(entitlement.creditBalance, 500);
  assert.ok(await harness.store.findAccessibleEntitlement(student.id, math.id, new Date()));
  assert.ok(await harness.store.findAccessibleEntitlement(student.id, physics.id, new Date()));
  // Excluded subjects and other grades/fields are never granted.
  assert.equal(await harness.store.findAccessibleEntitlement(student.id, arabic.id, new Date()), null);
  assert.equal(await harness.store.findAccessibleEntitlement(student.id, math11.id, new Date()), null);

  // One shared allowance: both subjects debit the same entitlement row.
  const first = await harness.store.chargeCredits({
    entitlementId: entitlement.id,
    userId: student.id,
    subjectId: math.id,
    operation: 'tutor',
    credits: 100,
    requestId: 'req-1',
  });
  const second = await harness.store.chargeCredits({
    entitlementId: entitlement.id,
    userId: student.id,
    subjectId: physics.id,
    operation: 'tutor',
    credits: 150,
    requestId: 'req-2',
  });
  assert.equal(first.ok && first.balance, 400);
  assert.equal(second.ok && second.balance, 250);
  assert.equal(harness.entitlements.get(entitlement.id)?.creditBalance, 250);

  // Refunds restore the shared wallet exactly once.
  const refund = await harness.store.refundCredits('req-2');
  assert.equal(refund.ok && refund.refunded, 150);
  assert.equal(harness.entitlements.get(entitlement.id)?.creditBalance, 400);
  const again = await harness.store.refundCredits('req-2');
  assert.deepEqual(again, { ok: false, reason: 'already_refunded' });
});

test('bundle scope is frozen at purchase and only a verified plan change re-scopes it', async () => {
  const harness = createHarness();
  const bundle = await addOffer(harness, {
    kind: 'BUNDLE',
    type: 'MONTHLY',
    gradeId: 'g12',
    academicFieldId: 'f-sci',
    planId: 'plan-bundle-a',
    scope: [math.id, physics.id],
  });
  const deps = { store: harness.store, findUserByEmail: async () => ({ id: student.id }) };
  await syncEntitlementFromPurchase(deps, purchaseFor('plan-bundle-a'));

  // Admin widens the offer scope later: sold access stays frozen.
  await harness.store.setBundleSubjects(bundle.id, [math.id, physics.id, religion.id]);
  await syncEntitlementFromPurchase(deps, purchaseFor('plan-bundle-a', { expiration: new Date(Date.now() + 40 * 24 * 3600_000) }));
  const entitlement = [...harness.entitlements.values()][0];
  assert.deepEqual((await harness.store.listEntitlementSubjectIds(entitlement.id)).sort(), [math.id, physics.id].sort());
  assert.equal(await harness.store.findAccessibleEntitlement(student.id, religion.id, new Date()), null);

  // A verified plan change (same license) replaces the scope deliberately.
  const bundleB = await addOffer(harness, {
    kind: 'BUNDLE',
    type: 'MONTHLY',
    gradeId: 'g12',
    academicFieldId: 'f-lit',
    planId: 'plan-bundle-b',
    scope: [arabic.id, religion.id],
  });
  await syncEntitlementFromPurchase(deps, purchaseFor('plan-bundle-b', { licenseId: 'lic-plan-bundle-a' }));
  const updated = harness.entitlements.get(entitlement.id);
  assert.equal(updated?.offerId, bundleB.id);
  assert.deepEqual((await harness.store.listEntitlementSubjectIds(entitlement.id)).sort(), [arabic.id, religion.id].sort());
  assert.equal(await harness.store.findAccessibleEntitlement(student.id, math.id, new Date()), null);
});

test('wallet policy: subject wallet wins, then soonest-expiring bundle', async () => {
  const harness = createHarness();
  const monthlyBundle = await addOffer(harness, {
    kind: 'BUNDLE',
    type: 'MONTHLY',
    gradeId: 'g12',
    academicFieldId: 'f-sci',
    planId: 'plan-b1',
    scope: [math.id],
  });
  const subjectOffer = await addOffer(harness, { kind: 'SUBJECT', type: 'MONTHLY', subjectId: math.id, planId: 'plan-s1' });
  const deps = { store: harness.store, findUserByEmail: async () => ({ id: student.id }) };
  await syncEntitlementFromPurchase(deps, purchaseFor('plan-b1', { licenseId: 'lic-b1', expiration: new Date(Date.now() + 5 * 24 * 3600_000) }));
  await syncEntitlementFromPurchase(deps, purchaseFor('plan-s1', { licenseId: 'lic-s1', expiration: new Date(Date.now() + 25 * 24 * 3600_000) }));

  const chosen = await harness.store.findAccessibleEntitlement(student.id, math.id, new Date());
  const subjectEntitlement = [...harness.entitlements.values()].find((item) => item.offerId === subjectOffer.id);
  assert.equal(chosen?.id, subjectEntitlement?.id);
  assert.equal(chosen?.id !== monthlyBundle.id, true);

  // Without the subject wallet, the soonest-expiring bundle is used first.
  const laterBundle = await addOffer(harness, {
    kind: 'BUNDLE',
    type: 'MONTHLY',
    gradeId: 'g12',
    academicFieldId: 'f-sci',
    planId: 'plan-b2',
    scope: [math.id],
  });
  await syncEntitlementFromPurchase(deps, purchaseFor('plan-b2', { licenseId: 'lic-b2', expiration: new Date(Date.now() + 60 * 24 * 3600_000) }));
  await harness.store.deleteEntitlementByLicenseId('lic-s1');
  const bundleChosen = await harness.store.findAccessibleEntitlement(student.id, math.id, new Date());
  const firstBundle = [...harness.entitlements.values()].find((item) => item.offerId === monthlyBundle.id);
  assert.equal(bundleChosen?.id, firstBundle?.id);
  assert.equal(laterBundle.id !== bundleChosen?.id, true);
});

test('renewal cancellation keeps access until paid-through; one-off cancellation revokes', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const paidThrough = new Date('2026-02-01T00:00:00Z');
  const monthly = offerLifecycleForPurchase(
    purchaseFor('p', { canceled: true, expiration: paidThrough, subscriptionId: 'sub-1' }),
    'MONTHLY',
    now,
    paidThrough,
  );
  assert.deepEqual(monthly, { status: 'ACTIVE', renewalCanceled: true });
  const lapsed = offerLifecycleForPurchase(
    purchaseFor('p', { canceled: true, expiration: paidThrough, subscriptionId: 'sub-1' }),
    'MONTHLY',
    paidThrough,
    paidThrough,
  );
  assert.equal(lapsed.status, 'EXPIRED');
  const oneoff = offerLifecycleForPurchase(
    purchaseFor('p', { canceled: true, expiration: null, subscriptionId: null }),
    'SEMESTER',
    now,
    paidThrough,
  );
  assert.equal(oneoff.status, 'REFUNDED');
});

test('offer mapping rejects wrong Freemius billing configurations', async () => {
  const harness = createHarness();
  await addOffer(harness, { kind: 'SUBJECT', type: 'MONTHLY', subjectId: math.id, planId: 'plan-monthly' });
  await addOffer(harness, { kind: 'SUBJECT', type: 'SEMESTER', subjectId: physics.id, planId: 'plan-semester', termId: null });
  const deps = { store: harness.store, findUserByEmail: async () => ({ id: student.id }) };

  const oneoffIntoMonthly = await syncEntitlementFromPurchase(
    deps,
    purchaseFor('plan-monthly', { billingCycle: 'oneoff', subscriptionId: null, expiration: null }),
  );
  assert.deepEqual(oneoffIntoMonthly, { ok: false, reason: 'plan_mismatch' });

  const subscriptionIntoSemester = await syncEntitlementFromPurchase(
    deps,
    purchaseFor('plan-semester', { billingCycle: 'monthly' }),
  );
  assert.deepEqual(subscriptionIntoSemester, { ok: false, reason: 'plan_mismatch' });

  const unknown = await syncEntitlementFromPurchase(deps, purchaseFor('plan-ghost'));
  assert.deepEqual(unknown, { ok: false, reason: 'unknown_plan' });
  assert.equal(harness.entitlements.size, 0);

  assert.equal(offerMappingMatches({ type: 'MONTHLY' }, purchaseFor('p', { billingCycle: 'monthly' })), true);
  assert.equal(offerMappingMatches({ type: 'MONTHLY' }, purchaseFor('p', { billingCycle: 'oneoff', subscriptionId: null, expiration: null })), false);
  assert.equal(offerMappingMatches({ type: 'SEMESTER' }, purchaseFor('p', { billingCycle: 'oneoff' })), true);
});

test('checkout resolves offers server-side and blocks unsafe states', async () => {
  const harness = createHarness();
  setBillingStoreForTests(harness.store);
  setStudentStoreForTests(fakeStudents());
  setBooksStoreForTests(fakeBooksWithReady(math.id, physics.id, math11.id));
  const { client, captured } = fakeFreemiusCheckout();
  setFreemiusClientForTests(client as never);
  await installSession(student, 'student-token');

  const activeTerm = term();
  await harness.store.upsertAcademicTerm(activeTerm);
  const good = await addOffer(harness, {
    kind: 'SUBJECT',
    type: 'MONTHLY',
    subjectId: math.id,
    planId: 'plan-good',
  });
  const links = createFakeProviderLinks();
  setOfferProviderLinkStoreForTests(links.store);
  links.seed(good.id, { planId: 'plan-good' });
  const inactive = await addOffer(harness, { kind: 'SUBJECT', type: 'MONTHLY', subjectId: physics.id, planId: 'plan-off', active: false });
  const unmapped = await addOffer(harness, { kind: 'SUBJECT', type: 'MONTHLY', subjectId: religion.id, planId: 'plan-null', active: true });
  await harness.store.setSubscriptionOfferActive(unmapped.id, true);
  harness.offers.set(unmapped.id, { ...(harness.offers.get(unmapped.id) as SubscriptionOfferRecord), freemiusPlanId: null });
  const endedTerm = term({ id: 'term-ended', startsAt: new Date(Date.now() - 100 * 24 * 3600_000), endsAt: new Date(Date.now() - 10 * 24 * 3600_000) });
  await harness.store.upsertAcademicTerm(endedTerm);
  const ended = await addOffer(harness, { kind: 'SUBJECT', type: 'SEMESTER', subjectId: religion.id, planId: 'plan-ended', termId: endedTerm.id });
  const otherGrade = await addOffer(harness, { kind: 'BUNDLE', type: 'MONTHLY', gradeId: 'g11', academicFieldId: null, planId: 'plan-g11', scope: [math11.id] });

  try {
    const anonymous = await checkoutPost(jsonRequest('/api/checkout', { offerId: good.id }));
    assert.equal(anonymous.status, 401);

    const success = await checkoutPost(jsonRequest('/api/checkout', { offerId: good.id }, 'student-token'));
    assert.equal(success.status, 200);
    assert.equal(captured.planId, 'plan-good');

    const inactiveResponse = await checkoutPost(jsonRequest('/api/checkout', { offerId: inactive.id }, 'student-token'));
    assert.equal(inactiveResponse.status, 409);
    assert.equal(((await inactiveResponse.json()) as { code?: string }).code, 'offer_unavailable');

    const unmappedResponse = await checkoutPost(jsonRequest('/api/checkout', { offerId: unmapped.id }, 'student-token'));
    assert.equal(unmappedResponse.status, 409);

    const endedResponse = await checkoutPost(jsonRequest('/api/checkout', { offerId: ended.id }, 'student-token'));
    assert.equal(endedResponse.status, 409);
    assert.equal(((await endedResponse.json()) as { code?: string }).code, 'term_unavailable');

    const otherGradeResponse = await checkoutPost(jsonRequest('/api/checkout', { offerId: otherGrade.id }, 'student-token'));
    assert.equal(otherGradeResponse.status, 404);

    // Duplicate active offer is never charged twice.
    await syncEntitlementFromPurchase(
      { store: harness.store, findUserByEmail: async () => ({ id: student.id }) },
      purchaseFor('plan-good'),
    );
    const duplicate = await checkoutPost(jsonRequest('/api/checkout', { offerId: good.id }, 'student-token'));
    assert.equal(duplicate.status, 409);
    assert.equal(((await duplicate.json()) as { code?: string }).code, 'already_subscribed');

    // The browser can never smuggle a price or plan id.
    const forged = await checkoutPost(jsonRequest('/api/checkout', { offerId: good.id, priceMinor: 1 }, 'student-token'));
    assert.equal(forged.status, 400);
  } finally {
    reset();
  }
});

test('bundle checkout requires the exact grade and field', async () => {
  const harness = createHarness();
  setBillingStoreForTests(harness.store);
  setStudentStoreForTests(fakeStudents());
  setBooksStoreForTests(fakeBooksWithReady(math.id, physics.id));
  const { client } = fakeFreemiusCheckout();
  setFreemiusClientForTests(client as never);
  await installSession(student, 'student-token');

  const litBundle = await addOffer(harness, { kind: 'BUNDLE', type: 'MONTHLY', gradeId: 'g12', academicFieldId: 'f-lit', planId: 'plan-lit', scope: [arabic.id] });
  const matching = await addOffer(harness, { kind: 'BUNDLE', type: 'MONTHLY', gradeId: 'g12', academicFieldId: 'f-sci', planId: 'plan-sci', scope: [math.id, physics.id] });
  const links = createFakeProviderLinks();
  setOfferProviderLinkStoreForTests(links.store);
  links.seed(litBundle.id, { planId: 'plan-lit' });
  links.seed(matching.id, { planId: 'plan-sci' });

  try {
    const wrongField = await checkoutPost(jsonRequest('/api/checkout', { offerId: litBundle.id }, 'student-token'));
    assert.equal(wrongField.status, 404);
    // An enabled bundle with an empty declared scope is never purchasable.
    await harness.store.setBundleSubjects(matching.id, []);
    const noScope = await checkoutPost(jsonRequest('/api/checkout', { offerId: matching.id }, 'student-token'));
    assert.equal(noScope.status, 409);
    await harness.store.setBundleSubjects(matching.id, [math.id, physics.id]);
    const ok = await checkoutPost(jsonRequest('/api/checkout', { offerId: matching.id }, 'student-token'));
    assert.equal(ok.status, 200);
    // A bundle that includes a subject without a READY textbook is not sellable.
    await harness.store.setBundleSubjects(matching.id, [math.id, religion.id]);
    const incomplete = await checkoutPost(jsonRequest('/api/checkout', { offerId: matching.id }, 'student-token'));
    assert.equal(incomplete.status, 409);
    assert.equal(((await incomplete.json()) as { code?: string }).code, 'offer_unavailable');
  } finally {
    reset();
  }
});

test('admin subscription routes reject students and validate offer scope', async () => {
  const harness = createHarness();
  setBillingStoreForTests(harness.store);
  setStudentStoreForTests(fakeStudents());

  const buildForm = (overrides: Record<string, string> = {}) => {
    const form = new FormData();
    const base: Record<string, string> = {
      kind: 'BUNDLE',
      type: 'MONTHLY',
      gradeId: 'g12',
      academicFieldId: 'f-sci',
      price: '49',
      credits: '500',
      freemiusPlanId: 'plan-admin-bundle',
      isActive: 'on',
      ...overrides,
    };
    for (const [key, value] of Object.entries(base)) form.set(key, value);
    return form;
  };

  try {
    await installSession(student, 'student-token');
    const studentAttempt = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', buildForm(), 'student-token'));
    assert.equal(studentAttempt.status, 403);

    await installSession(admin, 'admin-token');
    const validForm = buildForm();
    validForm.append('bundleSubjectIds', math.id);
    validForm.append('bundleSubjectIds', physics.id);
    const created = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', validForm, 'admin-token'));
    assert.equal(created.status, 303);
    assert.ok(created.headers.get('location')?.includes('status=offer_saved'));

    const saved = [...harness.offers.values()][0];
    assert.equal(saved.kind, 'BUNDLE');
    assert.equal(saved.dedupeKey, bundleOfferDedupeKey('g12', 'f-sci', 'MONTHLY', null));
    assert.deepEqual((await harness.store.listBundleSubjectIds(saved.id)).sort(), [math.id, physics.id].sort());

    // Re-posting the same combination updates the same offer instead of duplicating it.
    const updated = buildForm({ price: '59' });
    updated.append('bundleSubjectIds', math.id);
    const second = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', updated, 'admin-token'));
    assert.equal(second.status, 303);
    assert.equal(harness.offers.size, 1);
    assert.equal([...harness.offers.values()][0].priceMinor, 59_000);

    // A subject from another field/grade can never enter the scope.
    const forged = buildForm();
    forged.append('bundleSubjectIds', arabic.id);
    const rejected = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', forged, 'admin-token'));
    assert.equal(rejected.status, 303);
    assert.ok(rejected.headers.get('location')?.includes('error=invalid_offer_scope'));

    const empty = buildForm();
    const emptyResult = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', empty, 'admin-token'));
    assert.ok(emptyResult.headers.get('location')?.includes('error=bundle_subjects_required'));

    const noPlan = buildForm({ freemiusPlanId: '' });
    noPlan.append('bundleSubjectIds', math.id);
    const noPlanResult = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', noPlan, 'admin-token'));
    assert.ok(noPlanResult.headers.get('location')?.includes('error=plan_id_required'));
  } finally {
    reset();
  }
});

test('sold term dates are locked unless the admin explicitly confirms', async () => {
  const harness = createHarness();
  setBillingStoreForTests(harness.store);
  setStudentStoreForTests(fakeStudents());
  await installSession(admin, 'admin-token');

  const activeTerm = term();
  await harness.store.upsertAcademicTerm(activeTerm);
  await addOffer(harness, { kind: 'SUBJECT', type: 'SEMESTER', subjectId: math.id, planId: 'plan-lock', termId: activeTerm.id });
  await syncEntitlementFromPurchase(
    { store: harness.store, findUserByEmail: async () => ({ id: student.id }) },
    purchaseFor('plan-lock', { subscriptionId: null, expiration: null, billingCycle: 'oneoff' }),
  );
  const entitlement = [...harness.entitlements.values()][0];
  const contractualEnd = entitlement.expiresAt?.getTime();

  const editForm = (extra: Record<string, string> = {}) => {
    const form = new FormData();
    const base: Record<string, string> = {
      name: activeTerm.name,
      academicYear: activeTerm.academicYear,
      gradeId: activeTerm.gradeId,
      academicFieldId: activeTerm.academicFieldId ?? '',
      startDate: '2026-09-01',
      endDate: '2026-12-20',
      isActive: 'on',
      ...extra,
    };
    for (const [key, value] of Object.entries(base)) form.set(key, value);
    return form;
  };

  try {
    const blocked = await adminTermUpdatePost(formRequest(`/api/admin/subscriptions/terms/${activeTerm.id}`, editForm(), 'admin-token'), {
      params: Promise.resolve({ id: activeTerm.id }),
    });
    assert.equal(blocked.status, 303);
    assert.ok(blocked.headers.get('location')?.includes('error=term_dates_locked'));

    const confirmedForm = editForm({ confirmDates: 'on' });
    const confirmed = await adminTermUpdatePost(
      formRequest(`/api/admin/subscriptions/terms/${activeTerm.id}`, confirmedForm, 'admin-token'),
      {
        params: Promise.resolve({ id: activeTerm.id }),
      },
    );
    assert.equal(confirmed.status, 303);
    assert.ok(confirmed.headers.get('location')?.includes('status=term_saved'));
    // The sold entitlement keeps its contractual boundary even after the edit.
    assert.equal(harness.entitlements.get(entitlement.id)?.expiresAt?.getTime(), contractualEnd);
  } finally {
    reset();
  }
});

test('webhook offer grants stay idempotent and reconcile the latest purchase state', async () => {
  const secret = 'sk_test_0123456789abcdef0123456789abcdef';
  const freemius = new Freemius({ productId: '1', apiKey: 'sk_test_0123456789abcdef0123456789abcdef', secretKey: secret, publicKey: 'pk_test_0123456789abcdef' });
  const harness = createHarness();
  await addOffer(harness, { kind: 'SUBJECT', type: 'MONTHLY', subjectId: math.id, planId: 'plan-wh', allowance: 300 });

  let currentPurchase = purchaseFor('plan-wh', { licenseId: 'lic-wh', subscriptionId: 'sub-wh' });
  let retrieveCalls = 0;
  const deps = {
    createListener: () => freemius.webhook.createListener(),
    processFetch: (listener: ReturnType<Freemius['webhook']['createListener']>, request: Request) =>
      freemius.webhook.processFetch(listener, request),
    retrievePurchase: async () => {
      retrieveCalls += 1;
      return currentPurchase;
    },
    store: harness.store,
    findUserByEmail: async () => ({ id: student.id }),
  };

  const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest('hex');
  const event = (id: string, type: string) =>
    JSON.stringify({ id, type, created: new Date().toISOString(), updated: null, state: 'processed', objects: { license: { id: 'lic-wh' } } });
  const send = async (payload: string) =>
    handleFreemiusWebhook(
      new Request('http://localhost/api/webhooks/freemius', {
        method: 'POST',
        headers: { 'x-signature': sign(payload), 'content-type': 'application/json' },
        body: payload,
      }),
      deps,
    );

  const created = await send(event('evt-wh-1', 'license.created'));
  assert.equal(created.status, 200);
  assert.equal(harness.entitlements.size, 1);
  assert.equal(harness.entitlements.get([...harness.entitlements.keys()][0])?.creditBalance, 300);

  // Duplicate delivery is ignored.
  await send(event('evt-wh-1', 'license.created'));
  assert.equal(retrieveCalls, 1);

  // An out-of-order older event still reconciles to the authoritative state:
  // the renewal was canceled but access continues until the paid-through date.
  currentPurchase = { ...currentPurchase, canceled: true };
  await send(event('evt-wh-2', 'license.updated'));
  const reconciled = harness.entitlements.get([...harness.entitlements.keys()][0]);
  assert.equal(reconciled?.status, 'ACTIVE');
  assert.equal(reconciled?.renewalCanceled, true);

  // A later license.deleted revokes the entitlement entirely.
  await send(event('evt-wh-3', 'license.deleted'));
  assert.equal(harness.entitlements.size, 0);
});

test('credit period resets follow the offer allowance and clamp to access end', async () => {
  const harness = createHarness();
  const activeTerm = term();
  await harness.store.upsertAcademicTerm(activeTerm);
  await addOffer(harness, { kind: 'SUBJECT', type: 'SEMESTER', subjectId: math.id, planId: 'plan-credit', allowance: 120, termId: activeTerm.id });
  await syncEntitlementFromPurchase(
    { store: harness.store, findUserByEmail: async () => ({ id: student.id }) },
    purchaseFor('plan-credit', { subscriptionId: null, expiration: null, billingCycle: 'oneoff' }),
  );
  let entitlement = [...harness.entitlements.values()][0];
  assert.equal(entitlement.creditBalance, 120);
  // The first period never extends past the semester end.
  assert.ok((entitlement.creditPeriodEndsAt as Date).getTime() <= (entitlement.expiresAt as Date).getTime());

  // Spend, then fast-forward past the period: the allowance resets once.
  await harness.store.chargeCredits({
    entitlementId: entitlement.id,
    userId: student.id,
    subjectId: math.id,
    operation: 'tutor',
    credits: 50,
    requestId: 'req-credit-1',
  });
  const afterPeriod = new Date((entitlement.creditPeriodEndsAt as Date).getTime() + 1000);
  entitlement = await ensureCreditPeriod(harness.store, harness.entitlements.get(entitlement.id) as EntitlementRecord, afterPeriod);
  assert.equal(entitlement.creditBalance, 120);

  // Once access itself is over, no new period is opened.
  const afterEnd = new Date((entitlement.expiresAt as Date).getTime() + 1000);
  const expired = await ensureCreditPeriod(harness.store, harness.entitlements.get(entitlement.id) as EntitlementRecord, afterEnd);
  assert.equal(expired.creditPeriodEndsAt?.getTime(), entitlement.creditPeriodEndsAt?.getTime());
});

test('offer readiness flags every missing provider requirement', () => {
  const activeTerm = term();
  assert.deepEqual(
    offerReadiness({ kind: 'SUBJECT', type: 'MONTHLY', freemiusPlanId: 'plan-1', priceMinor: 1000, term: null, bundleSubjectIds: [] }),
    { ready: true, issues: [] },
  );
  assert.deepEqual(
    offerReadiness({ kind: 'SUBJECT', type: 'MONTHLY', freemiusPlanId: null, priceMinor: null, term: null, bundleSubjectIds: [] }).issues,
    ['plan_id_required', 'price_required'],
  );
  assert.deepEqual(
    offerReadiness({ kind: 'SUBJECT', type: 'SEMESTER', freemiusPlanId: 'plan-1', priceMinor: 1000, term: null, bundleSubjectIds: [] }).issues,
    ['term_required'],
  );
  assert.deepEqual(
    offerReadiness({
      kind: 'SUBJECT',
      type: 'SEMESTER',
      freemiusPlanId: 'plan-1',
      priceMinor: 1000,
      term: { isActive: false, endsAt: activeTerm.endsAt },
      bundleSubjectIds: [],
    }).issues,
    ['term_inactive'],
  );
  assert.deepEqual(
    offerReadiness({
      kind: 'SUBJECT',
      type: 'SEMESTER',
      freemiusPlanId: 'plan-1',
      priceMinor: 1000,
      term: { isActive: true, endsAt: new Date(Date.now() - 86_400_000) },
      bundleSubjectIds: [],
    }).issues,
    ['term_ended'],
  );
  assert.deepEqual(
    offerReadiness({ kind: 'BUNDLE', type: 'MONTHLY', freemiusPlanId: 'plan-1', priceMinor: 1000, term: null, bundleSubjectIds: [] }).issues,
    ['bundle_subjects_required'],
  );
});

test('offer wizard saves drafts and refuses unsafe publishes', async () => {
  const harness = createHarness();
  setBillingStoreForTests(harness.store);
  setStudentStoreForTests(fakeStudents());
  await installSession(admin, 'admin-token');

  const buildForm = (overrides: Record<string, string> = {}) => {
    const form = new FormData();
    const base: Record<string, string> = {
      kind: 'BUNDLE',
      type: 'MONTHLY',
      gradeId: 'g12',
      academicFieldId: 'f-sci',
      price: '49',
      credits: '500',
      freemiusPlanId: 'plan-wizard',
      ...overrides,
    };
    for (const [key, value] of Object.entries(base)) form.set(key, value);
    form.append('bundleSubjectIds', math.id);
    return form;
  };

  try {
    // Draft saves without a plan id or price.
    const draft = buildForm({ freemiusPlanId: '', price: '' });
    draft.set('intent', 'draft');
    const draftResult = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', draft, 'admin-token'));
    assert.equal(draftResult.status, 303);
    assert.ok(draftResult.headers.get('location')?.includes('status=offer_drafted'));
    assert.equal([...harness.offers.values()][0].isActive, false);

    // Publishing without a plan id is refused.
    const noPlan = buildForm({ freemiusPlanId: '' });
    noPlan.set('intent', 'publish');
    const noPlanResult = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', noPlan, 'admin-token'));
    assert.ok(noPlanResult.headers.get('location')?.includes('error=plan_id_required'));

    // A semester offer whose term already ended can never be published.
    const endedTerm = term({
      id: 'term-ended',
      startsAt: new Date(Date.now() - 200 * 24 * 3600_000),
      endsAt: new Date(Date.now() - 100 * 24 * 3600_000),
    });
    await harness.store.upsertAcademicTerm(endedTerm);
    const ended = buildForm({ type: 'SEMESTER', academicTermId: endedTerm.id, freemiusPlanId: 'plan-ended' });
    ended.set('intent', 'publish');
    const endedResult = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', ended, 'admin-token'));
    assert.ok(endedResult.headers.get('location')?.includes('error=term_ended'));

    // An inactive term blocks publishing too.
    const inactiveTerm = term({ id: 'term-inactive', isActive: false });
    await harness.store.upsertAcademicTerm(inactiveTerm);
    const inactive = buildForm({ type: 'SEMESTER', academicTermId: inactiveTerm.id, freemiusPlanId: 'plan-inactive' });
    inactive.set('intent', 'publish');
    const inactiveResult = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', inactive, 'admin-token'));
    assert.ok(inactiveResult.headers.get('location')?.includes('error=term_inactive'));

    // A fully configured publish succeeds and goes live.
    const goodTerm = term({ id: 'term-good' });
    await harness.store.upsertAcademicTerm(goodTerm);
    const publish = buildForm({ type: 'SEMESTER', academicTermId: goodTerm.id, freemiusPlanId: 'plan-good' });
    publish.set('intent', 'publish');
    const publishResult = await adminOffersPost(formRequest('/api/admin/subscriptions/offers', publish, 'admin-token'));
    assert.equal(publishResult.status, 303);
    assert.ok(publishResult.headers.get('location')?.includes('status=offer_saved'));
    const published = [...harness.offers.values()].find((offer) => offer.freemiusPlanId === 'plan-good');
    assert.equal(published?.isActive, true);
    assert.equal(published?.academicTermId, goodTerm.id);
  } finally {
    reset();
  }
});

test('activating an offer with an ended term is refused while deactivation stays possible', async () => {
  const harness = createHarness();
  setBillingStoreForTests(harness.store);
  setStudentStoreForTests(fakeStudents());
  await installSession(admin, 'admin-token');

  const endedTerm = term({
    id: 'term-toggle-ended',
    startsAt: new Date(Date.now() - 200 * 24 * 3600_000),
    endsAt: new Date(Date.now() - 100 * 24 * 3600_000),
  });
  await harness.store.upsertAcademicTerm(endedTerm);
  const brokenOffer = await addOffer(harness, {
    kind: 'SUBJECT',
    type: 'SEMESTER',
    subjectId: math.id,
    termId: endedTerm.id,
    planId: 'plan-toggle-ended',
    active: false,
  });

  try {
    const activation = await adminOfferUpdatePost(
      formRequest(`/api/admin/subscriptions/offers/${brokenOffer.id}`, (() => {
        const form = new FormData();
        form.set('intent', 'toggle');
        return form;
      })(), 'admin-token'),
      { params: Promise.resolve({ id: brokenOffer.id }) },
    );
    assert.ok(activation.headers.get('location')?.includes('error=term_ended'));

    // An offer that is already active can always be deactivated.
    const activeOffer = await addOffer(harness, {
      kind: 'SUBJECT',
      type: 'MONTHLY',
      subjectId: physics.id,
      planId: 'plan-toggle-active',
      active: true,
    });
    const deactivation = await adminOfferUpdatePost(
      formRequest(`/api/admin/subscriptions/offers/${activeOffer.id}`, (() => {
        const form = new FormData();
        form.set('intent', 'toggle');
        return form;
      })(), 'admin-token'),
      { params: Promise.resolve({ id: activeOffer.id }) },
    );
    assert.ok(deactivation.headers.get('location')?.includes('status=offer_deactivated'));
    assert.equal(harness.offers.get(activeOffer.id)?.isActive, false);
  } finally {
    reset();
  }
});

test('offer edits preserve an explicitly submitted currency', async () => {
  const harness = createHarness();
  setBillingStoreForTests(harness.store);
  setStudentStoreForTests(fakeStudents());
  await installSession(admin, 'admin-token');

  try {
    const created = await addOffer(harness, { kind: 'SUBJECT', type: 'MONTHLY', subjectId: math.id, planId: 'plan-usd' });
    const offer = harness.offers.get(created.id) as SubscriptionOfferRecord;
    assert.equal(offer.currency, 'JOD');

    const form = new FormData();
    form.set('price', '19');
    form.set('currency', 'USD');
    form.set('credits', '300');
    form.set('freemiusPlanId', 'plan-usd');
    form.set('isActive', 'on');
    const response = await adminOfferUpdatePost(formRequest(`/api/admin/subscriptions/offers/${offer.id}`, form, 'admin-token'), {
      params: Promise.resolve({ id: offer.id }),
    });
    assert.equal(response.status, 303);
    assert.ok(response.headers.get('location')?.includes('status=offer_saved'));
    assert.equal(harness.offers.get(offer.id)?.currency, 'USD');
    assert.equal(harness.offers.get(offer.id)?.priceMinor, 1_900);
    assert.equal(harness.offers.get(offer.id)?.monthlyCreditAllowance, 300);
  } finally {
    reset();
  }
});

test('checkout currency gate rejects unsupported currencies before any provider call (SIMULATED)', () => {
  const plan = {
    planId: 'p1',
    name: null,
    title: null,
    pricing: [{ pricingId: 'pr1', currency: 'USD', monthlyMinor: 1_000, annualMinor: null, lifetimeMinor: null }],
  };
  // JOD is not a Freemius checkout currency: no silent conversion, offer stays not ready.
  const jod = verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'MONTHLY', currency: 'JOD', priceMinor: 39_000 }, plan });
  assert.deepEqual(jod, { ok: false, reason: 'unsupported_currency' });
  // A supported currency with an exact provider price match verifies.
  const usd = verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'MONTHLY', currency: 'USD', priceMinor: 1_000 }, plan });
  assert.equal(usd.ok, true);
  // And a mismatch in the supported currency still fails precisely.
  const mismatch = verifyOfferAgainstProvider({ offer: { kind: 'SUBJECT', type: 'MONTHLY', currency: 'USD', priceMinor: 2_000 }, plan });
  assert.deepEqual(mismatch, { ok: false, reason: 'price_mismatch' });
});

test('two offers pointing at one Freemius plan are flagged as a mapping conflict', () => {
  const conflicts = duplicatePlanIdMappings([
    { id: 'offer-a', freemiusPlanId: 'plan-shared' },
    { id: 'offer-b', freemiusPlanId: 'plan-shared' },
    { id: 'offer-c', freemiusPlanId: 'plan-solo' },
    { id: 'offer-d', freemiusPlanId: null },
  ]);
  assert.deepEqual(conflicts, [{ planId: 'plan-shared', offerIds: ['offer-a', 'offer-b'] }]);
  assert.deepEqual(duplicatePlanIdMappings([{ id: 'offer-a', freemiusPlanId: 'plan-1' }]), []);
});

test('two independently purchased subjects grant separate access and wallets (SIMULATED)', async () => {
  const harness = createHarness();
  await addOffer(harness, { kind: 'SUBJECT', type: 'MONTHLY', subjectId: math.id, planId: 'plan-math-6', allowance: 200 });
  await addOffer(harness, { kind: 'SUBJECT', type: 'MONTHLY', subjectId: physics.id, planId: 'plan-phys-6', allowance: 150 });
  const sync = (planId: string, licenseId: string) =>
    syncEntitlementFromPurchase(
      { store: harness.store, findUserByEmail: async () => ({ id: student.id }) },
      purchaseFor(planId, { licenseId }),
    );
  assert.deepEqual(await sync('plan-math-6', 'lic-math-6'), { ok: true });
  assert.deepEqual(await sync('plan-phys-6', 'lic-phys-6'), { ok: true });
  assert.equal(harness.entitlements.size, 2);
  const now = new Date();
  assert.ok(await harness.store.findAccessibleEntitlement(student.id, math.id, now));
  assert.ok(await harness.store.findAccessibleEntitlement(student.id, physics.id, now));
  const bySubject = new Map([...harness.entitlements.values()].map((record) => [record.subjectId, record]));
  assert.equal(bySubject.get(math.id)?.creditBalance, 200);
  assert.equal(bySubject.get(physics.id)?.creditBalance, 150);
  // No cross-subject leakage: each wallet funds only its own subject.
  const mathEntitlement = bySubject.get(math.id) as EntitlementRecord;
  const charged = await harness.store.chargeCredits({
    entitlementId: mathEntitlement.id,
    userId: student.id,
    subjectId: math.id,
    operation: 'lesson',
    credits: 1,
    requestId: 'req-math-6',
  });
  assert.equal(charged.ok, true);
  assert.equal(harness.entitlements.get(mathEntitlement.id)?.creditBalance, 199);
  assert.equal(bySubject.get(physics.id)?.creditBalance, 150);
});

test('admin reconciliation re-reads the license and applies the verified state (SIMULATED)', async () => {
  const harness = createHarness();
  await addOffer(harness, { kind: 'SUBJECT', type: 'MONTHLY', subjectId: math.id, planId: 'plan-math-7' });
  await syncEntitlementFromPurchase(
    { store: harness.store, findUserByEmail: async () => ({ id: student.id }) },
    purchaseFor('plan-math-7', { licenseId: 'lic-math-7' }),
  );
  const entitlement = [...harness.entitlements.values()][0];
  assert.equal(entitlement.status, 'ACTIVE');

  const deps = {
    store: harness.store,
    findUserByEmail: async () => ({ id: student.id }),
    retrievePurchase: async () => purchaseFor('plan-math-7', { licenseId: 'lic-math-7', canceled: true, expiration: null }),
  };
  const outcome = await resyncEntitlementFromProvider(entitlement.id, deps);
  assert.deepEqual(outcome, { ok: true, status: 'CANCELED' });
  assert.equal(harness.entitlements.get(entitlement.id)?.status, 'CANCELED');

  // Failure paths stay precise and never invent access.
  assert.deepEqual(await resyncEntitlementFromProvider('missing', deps), { ok: false, reason: 'not_found' });
  assert.deepEqual(
    await resyncEntitlementFromProvider(entitlement.id, { ...deps, retrievePurchase: async () => null }),
    { ok: false, reason: 'provider_missing' },
  );
  assert.deepEqual(
    await resyncEntitlementFromProvider(entitlement.id, { ...deps, retrievePurchase: async () => { throw new Error('network'); } }),
    { ok: false, reason: 'provider_error' },
  );
  assert.deepEqual(
    await resyncEntitlementFromProvider(entitlement.id, { ...deps, retrievePurchase: async () => purchaseFor('unknown-plan', { licenseId: 'lic-math-7' }) }),
    { ok: false, reason: 'sync_failed' },
  );

  // A local entitlement without a provider license can never be reconciled.
  harness.entitlements.set('local-only', { ...entitlement, id: 'local-only', freemiusLicenseId: null });
  assert.deepEqual(await resyncEntitlementFromProvider('local-only', deps), { ok: false, reason: 'no_license' });
});
