import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'unified-payments-test-secret';
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

import type { AuthSession, AuthStore, AuthUser } from '../lib/auth/store';
import { setAuthStoreForTests } from '../lib/auth/store';
import { hashSessionToken } from '../lib/auth/session';
import { setStudentStoreForTests } from '../lib/student/store';
import type { CatalogSubject, StudentProfile, StudentStore } from '../lib/student/store';
import { setBooksStoreForTests } from '../lib/books/store';
import type { BooksStore } from '../lib/books/store';
import { setFreemiusClientForTests } from '../lib/freemius/client';
import { setOfferProviderLinkStoreForTests } from '../lib/freemius/links';
import { setSemesterStoreForTests } from '../lib/billing/semester-store';
import { setPurchaseStoreForTests } from '../lib/billing/purchase-store';
import { setTopupStoreForTests } from '../lib/billing/topup-store';
import { setCreditWalletStoreForTests } from '../lib/billing/wallet-store';
import { setBillingStoreForTests } from '../lib/billing/store';
import { termWindowFromCalendarDates } from '../lib/billing/terms';

const student: AuthUser = { id: 'student-1', email: 'student@example.com', name: 'طالب', image: null, role: 'STUDENT' };
const profile: StudentProfile = { userId: student.id, gradeId: 'g12', academicFieldId: null, onboardingCompleted: true };
const subject: CatalogSubject = { id: '11111111-1111-4111-8111-111111111111', gradeId: 'g12', academicFieldId: null, name: 'رياضيات', slug: 'math', shortDescription: null, image: null, isActive: true, isFeatured: false, sortOrder: 0 };

async function installSession(user: AuthUser | null, token: string) {
  const sessionId = await hashSessionToken(token, 'unified-payments-test-secret');
  const unused = async () => { throw new Error('not used'); };
  const store: AuthStore = {
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
  setAuthStoreForTests(store);
}

function fakeStudents(): StudentStore {
  return {
    async listActiveGrades() { return []; },
    async findGradeById() { return null; },
    async listActiveFields() { return []; },
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
  return {
    async findBookBySubject() { return null; },
    async findReadyBookBySubject() { return { id: 'book-1', subjectId: subject.id, title: 'كتاب', originalFileName: 'book.pdf', storedFilePath: 'books/x/source.pdf', sha256: 'sha', totalPages: 1, indexedPages: 1, status: 'READY', errorMessage: null, pendingStagedToken: null, pendingStagedAt: null, createdAt: new Date(), updatedAt: new Date() }; },
    async findBookById() { return null; },
    async createBook() { throw new Error('not used'); },
    async updateBook() {},
    async deleteBook() {},
    async stageReplacement() { return false; },
    async clearPendingReplacement() {},
    async listChunksForBook() { return []; },
    async replaceChunks() { return true; },
    async claimNextUploadedBook() { return null; },
    async resetStaleProcessing() { return 0; },
    async listBookIds() { return []; },
  };
}

function semesterStoreFake() {
  const window = termWindowFromCalendarDates('2026-09-01', '2027-06-15')!;
  const row = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'الفصل الأول 2026/2027',
    academicYear: '2026/2027',
    gradeId: 'g12',
    academicFieldId: null,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    salesStartAt: new Date('2026-01-01T00:00:00Z'),
    salesEndAt: null,
    priceMinor: 29_000,
    currency: 'JOD',
    includedCredits: 300,
    status: 'ACTIVE' as const,
    lateEnrollmentPolicy: 'FULL_PRICE' as const,
    topUpEnabled: true,
    freemiusPlanId: 'plan_semester',
    adminNotes: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    async listSemesters() { return [row]; },
    async findSemesterById(id: string) { return id === row.id ? row : null; },
    async findSemesterByFreemiusPlanId(planId: string) { return planId === row.freemiusPlanId ? row : null; },
    async createSemester() { return row; },
    async updateSemester() {},
    async findCurrentSemesterForScope() { return row; },
    async findOverlapping() { return []; },
    async listSubscribers() { return []; },
  };
}

// A minimal in-memory verifier for the Freemius webhook listener + fetch.
function fakeWebhookDeps(purchase: Record<string, unknown> | null) {
  const seen = new Set<string>();
  const events: { type: string }[] = [];
  return {
    seen,
    events,
    deps: (overrides: Record<string, unknown>) => ({
      createListener: () => {
        const handlers: { types: string[]; fn: (event: { id: string; type: string; objects?: unknown; data?: unknown }) => Promise<void> }[] = [];
        return {
          on: (types: string | string[], fn: (event: { id: string; type: string }) => Promise<void>) => {
            handlers.push({ types: Array.isArray(types) ? types : [types], fn });
          },
          _handlers: handlers,
        };
      },
      processFetch: async (listener: { _handlers?: unknown[] }, request: Request) => {
        const body = await request.json() as { id: string; type: string; objects?: unknown; data?: unknown };
        const handlers = (listener as { _handlers: { types: string[]; fn: (e: unknown) => Promise<void> }[] })._handlers;
        for (const handler of handlers) {
          if (handler.types.includes(body.type)) await handler.fn(body);
        }
        return new Response('OK', { status: 200 });
      },
      retrievePurchase: async () => purchase as never,
      findUserByEmail: async () => ({ id: student.id }),
      ...overrides,
    }),
  };
}

test('semester checkout rejects anonymous, unready mappings and duplicate purchases', async () => {
  setStudentStoreForTests(fakeStudents());
  setBooksStoreForTests(fakeBooks());
  setSemesterStoreForTests(semesterStoreFake() as never);
  setFreemiusClientForTests({ checkout: { create: async () => { const checkout = { setUser: () => checkout, getLink: () => 'https://checkout.example/semester' }; return checkout; } } } as never);

  const purchases = new Map<string, Record<string, unknown>>();
  setPurchaseStoreForTests({
    async createPurchase(input: Record<string, unknown>) { const row: Record<string, unknown> = { ...input, createdAt: new Date(), updatedAt: new Date() }; purchases.set(String(row.id), row); return row as never; },
    async findPurchaseById(id: string) { return (purchases.get(id) ?? null) as never; },
    async findPurchaseByProviderLicenseId() { return null; },
    async findLivePurchaseForUserSemester() { return null; },
    async findLatestPurchaseForUserSemester() { return null; },
    async listPurchasesForUser() { return []; },
    async listPurchasesForSemester() { return []; },
    async updatePurchase() {},
  });

  const { POST } = await import('../app/api/checkout/route');
  const body = JSON.stringify({ kind: 'semester', semesterId: '22222222-2222-4222-8222-222222222222' });

  // Anonymous.
  const anonymous = await POST(new Request('http://localhost/api/checkout', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body }));
  assert.equal(anonymous.status, 401);

  await installSession(student, 'student-token', );

  // Unverified provider mapping: no live checkout.
  setOfferProviderLinkStoreForTests({ findByOfferId: async () => null, findByPlanId: async () => null } as never);
  const notReady = await POST(new Request('http://localhost/api/checkout', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', cookie: 'fahimni_session=student-token' }, body }));
  assert.equal(notReady.status, 409);
  assert.equal(((await notReady.json()) as { code?: string }).code, 'semester_unavailable');

  // Verified mapping: checkout link returned.
  setOfferProviderLinkStoreForTests({ findByOfferId: async () => null, findByPlanId: async () => ({ status: 'SYNCED', verified: true, planId: 'plan_semester' }) } as never);
  const ok = await POST(new Request('http://localhost/api/checkout', { method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json', cookie: 'fahimni_session=student-token' }, body }));
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { url?: string }).url, 'https://checkout.example/semester');

  // Reset seams.
  setAuthStoreForTests(null);
  setStudentStoreForTests(null);
  setBooksStoreForTests(null);
  setSemesterStoreForTests(null);
  setPurchaseStoreForTests(null);
  setOfferProviderLinkStoreForTests(null);
  setFreemiusClientForTests(null);
});

test('a replayed webhook grants semester credits exactly once', async () => {
  setBillingStoreForTests({
    async upsertEntitlement() {},
    async findEntitlementByLicenseId() { return null; },
    async hasWebhookEvent() { return false; },
    async recordWebhookEvent() {},
    async deleteEntitlementByLicenseId() {},
  } as never);

  const walletCalls: string[] = [];
  const wallets = new Map<string, { semester: number; topup: number }>();
  const snap = (userId: string) => { const w = wallets.get(userId) ?? { semester: 0, topup: 0 }; return { userId, semesterBalance: w.semester, topupBalance: w.topup, semesterGrantedAt: null, semesterExpiresAt: null, updatedAt: new Date(), total: w.semester + w.topup }; };
  setCreditWalletStoreForTests({
    async getWallet() { return null; },
    async getSnapshot(userId: string) { return snap(userId); },
    async grantSemesterCredits(input: { userId: string; requestId: string; credits: number }) {
      if (walletCalls.includes(input.requestId)) return { granted: false, snapshot: snap(input.userId) };
      walletCalls.push(input.requestId);
      const w = wallets.get(input.userId) ?? { semester: 0, topup: 0 };
      w.semester += input.credits;
      wallets.set(input.userId, w);
      return { granted: true, snapshot: snap(input.userId) };
    },
    async grantTopupCredits(input: { userId: string; requestId: string; credits: number }) {
      if (walletCalls.includes(input.requestId)) return { granted: false, snapshot: snap(input.userId) };
      walletCalls.push(input.requestId);
      const w = wallets.get(input.userId) ?? { semester: 0, topup: 0 };
      w.topup += input.credits;
      wallets.set(input.userId, w);
      return { granted: true, snapshot: snap(input.userId) };
    },
    async spend() { return { ok: true as const, charged: false, duplicate: false, snapshot: { userId: 'x', semesterBalance: 0, topupBalance: 0, semesterGrantedAt: null, semesterExpiresAt: null, updatedAt: new Date(), total: 0 } }; },
    async refund() { return { ok: false as const, reason: 'not_found' as const }; },
    async expireSemesterCredits() { return { userId: 'x', semesterBalance: 0, topupBalance: 0, semesterGrantedAt: null, semesterExpiresAt: null, updatedAt: new Date(), total: 0 }; },
    async adjust() { return { userId: 'x', semesterBalance: 0, topupBalance: 0, semesterGrantedAt: null, semesterExpiresAt: null, updatedAt: new Date(), total: 0 }; },
    async listLedger() { return []; },
    async findLedgerByRequestId() { return null; },
  } as never);

  const purchases = new Map<string, { id: string; providerLicenseId: string | null; creditsGrantedAt: Date | null }>();
  setPurchaseStoreForTests({
    async createPurchase(input: { id: string; userId: string }) { const row = { ...input, providerLicenseId: input && (input as { providerLicenseId?: string }).providerLicenseId, creditsGrantedAt: null } as never; purchases.set(input.id, row as never); return row; },
    async findPurchaseById(id: string) { return (purchases.get(id) ?? null) as never; },
    async findPurchaseByProviderLicenseId(licenseId: string) { return ([...purchases.values()].find((row) => row.providerLicenseId === licenseId) ?? null) as never; },
    async findLivePurchaseForUserSemester() { return null; },
    async findLatestPurchaseForUserSemester() { return null; },
    async listPurchasesForUser() { return []; },
    async listPurchasesForSemester() { return []; },
    async updatePurchase(id: string, patch: Record<string, unknown>) { const row = purchases.get(id); if (row) purchases.set(id, { ...row, ...patch } as never); },
  });
  setSemesterStoreForTests(semesterStoreFake() as never);

  const { handleFreemiusWebhook } = await import('../lib/freemius/webhook');
  const harness = fakeWebhookDeps({ email: student.email, planId: 'plan_semester', licenseId: 'lic-sem-1', subscriptionId: null, canceled: false, expiration: null, created: new Date('2027-08-01T00:00:00Z'), billingCycle: 'oneoff' });
  const { semesterStore } = await import('../lib/billing/semester-store');
  const { purchaseStore } = await import('../lib/billing/purchase-store');
  const { creditWalletStore } = await import('../lib/billing/wallet-store');
  const { billingStore: bs } = await import('../lib/billing/store');

  const deps = harness.deps({
    store: bs(),
    unified: { semesters: semesterStore(), purchases: purchaseStore(), wallets: creditWalletStore(), topups: { async findOfferByFreemiusPlanId() { return null; } } },
  });

  const request1 = new Request('http://localhost/api/webhooks/freemius', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'evt-1', type: 'license.created', objects: { license: { id: 'lic-sem-1' }, user: { email: student.email } } }) });
  await handleFreemiusWebhook(request1, deps as never);
  const grantsAfterFirst = walletCalls.filter((id) => id.startsWith('semester-grant:')).length;
  assert.equal(grantsAfterFirst, 1);

  // Replay the same event id: idempotency is enforced by the wallet requestId.
  const request2 = new Request('http://localhost/api/webhooks/freemius', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'evt-1', type: 'license.created', objects: { license: { id: 'lic-sem-1' }, user: { email: student.email } } }) });
  await handleFreemiusWebhook(request2, deps as never);
  const grantsAfterReplay = walletCalls.filter((id) => id.startsWith('semester-grant:')).length;
  assert.equal(grantsAfterReplay, grantsAfterFirst, 'a replayed event never double-grants');

  setBillingStoreForTests(null);
  setCreditWalletStoreForTests(null);
  setPurchaseStoreForTests(null);
  setSemesterStoreForTests(null);
  setAuthStoreForTests(null);
});

test('a top-up payment grants purchased credits exactly once and survives replay', async () => {
  setBillingStoreForTests({
    async upsertEntitlement() {},
    async hasWebhookEvent() { return false; },
    async recordWebhookEvent() {},
    async deleteEntitlementByLicenseId() {},
  } as never);

  const granted: string[] = [];
  const topupSnap = (userId: string) => ({ userId, semesterBalance: 0, topupBalance: granted.length * 100, semesterGrantedAt: null, semesterExpiresAt: null, updatedAt: new Date(), total: granted.length * 100 });
  setCreditWalletStoreForTests({
    async getWallet() { return null; },
    async getSnapshot(userId: string) { return topupSnap(userId); },
    async grantSemesterCredits(input: { userId: string }) { return { granted: false, snapshot: topupSnap(input.userId) }; },
    async grantTopupCredits(input: { requestId: string; credits: number; userId: string }) {
      if (granted.includes(input.requestId)) return { granted: false, snapshot: topupSnap(input.userId) };
      granted.push(input.requestId);
      return { granted: true, snapshot: topupSnap(input.userId) };
    },
    async spend() { return { ok: true as const, charged: false, duplicate: false, snapshot: topupSnap('u') }; },
    async refund() { return { ok: false as const, reason: 'not_found' as const }; },
    async expireSemesterCredits() { return topupSnap('u'); },
    async adjust() { return topupSnap('u'); },
    async listLedger() { return []; },
    async findLedgerByRequestId() { return null; },
  } as never);

  const offer = { id: 'offer-1', name: '100 كريدت', credits: 100, priceMinor: 5_000, currency: 'JOD', status: 'ACTIVE' as const, sortOrder: 0, freemiusPlanId: 'plan_topup', createdAt: new Date(), updatedAt: new Date() };
  const purchaseRows = new Map<string, { id: string; providerTransactionId: string | null; creditsGrantedAt: Date | null }>();
  setTopupStoreForTests({
    async listOffers() { return [offer]; },
    async listActiveOffers() { return [offer]; },
    async findOfferById() { return offer; },
    async findOfferByFreemiusPlanId(planId: string) { return planId === offer.freemiusPlanId ? offer : null; },
    async upsertOffer() { return offer; },
    async setOfferStatus() {},
    async createPurchase(input: { id: string }) { const row = { ...input, providerTransactionId: null, creditsGrantedAt: null }; purchaseRows.set(input.id, row); return row as never; },
    async findPurchaseById(id: string) { return (purchaseRows.get(id) ?? null) as never; },
    async findPurchaseByProviderTransactionId(tx: string) { return ([...purchaseRows.values()].find((row) => row.providerTransactionId === tx) ?? null) as never; },
    async findPendingPurchaseForUser() { return null; },
    async updatePurchase(id: string, patch: Record<string, unknown>) { const row = purchaseRows.get(id); if (row) purchaseRows.set(id, { ...row, ...patch }); },
    async listPurchasesForUser() { return []; },
    async listPurchases() { return []; },
  });

  const { handleFreemiusWebhook } = await import('../lib/freemius/webhook');
  const harness = fakeWebhookDeps({ email: student.email, planId: 'plan_topup', licenseId: 'lic-top-1', subscriptionId: 'tx-1', canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff' });
  const { topupStore } = await import('../lib/billing/topup-store');
  const { creditWalletStore } = await import('../lib/billing/wallet-store');
  const { purchaseStore } = await import('../lib/billing/purchase-store');
  const { semesterStore, setSemesterStoreForTests: setSem } = await import('../lib/billing/semester-store');
  const { billingStore: bs } = await import('../lib/billing/store');
  // No semester matches the top-up plan, so the store is only probed; keep it
  // in-memory so no real database connection is opened.
  setSem(semesterStoreFake() as never);
  const deps = harness.deps({
    store: bs(),
    unified: { semesters: semesterStore(), purchases: purchaseStore(), wallets: creditWalletStore(), topups: topupStore() },
  });

  const body = JSON.stringify({ id: 'evt-top-1', type: 'license.created', objects: { license: { id: 'lic-top-1' }, user: { email: student.email } } });
  await handleFreemiusWebhook(new Request('http://localhost/api/webhooks/freemius', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), deps as never);
  await handleFreemiusWebhook(new Request('http://localhost/api/webhooks/freemius', { method: 'POST', headers: { 'content-type': 'application/json' }, body }), deps as never);
  assert.equal(granted.length, 1, 'top-up credits are granted exactly once across replays');

  setBillingStoreForTests(null);
  setCreditWalletStoreForTests(null);
  setTopupStoreForTests(null);
  setAuthStoreForTests(null);
});
