import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'unified-semester-test-secret';

import { isValidTermWindow, termWindowFromCalendarDates, semesterAccessWindow, daysRemaining, ammanDateKey } from '../lib/billing/terms';
import {
  computeLateEnrollmentPrice,
  includedSubjectIds,
  subjectAppliesToScope,
  subscriptionStatusFor,
  provisionSemesterPurchase,
} from '../lib/billing/subscription';
import { isSellableSemester, type SemesterRecord, type SemesterStore } from '../lib/billing/semester-store';
import type { PurchaseStore, SubscriptionPurchaseRecord } from '../lib/billing/purchase-store';
import type { CreditWalletStore, CreditLedgerRecord, CreditWalletRecord, WalletSnapshot } from '../lib/billing/wallet-store';
import type { BillingStore, EntitlementRecord } from '../lib/billing/store';

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
void mutableEnv;

/* ------------------------------- term logic ------------------------------- */

test('Amman term windows are inclusive through the end date and reject inverted ranges', () => {
  const window = termWindowFromCalendarDates('2027-09-01', '2028-01-15');
  assert.ok(window);
  if (!window) return;
  // End is the last instant of the inclusive end date in Asia/Amman.
  assert.equal(ammanDateKey(window.endsAt), '2028-01-15');
  assert.equal(window.startsAt.getTime() < window.endsAt.getTime(), true);
  assert.equal(isValidTermWindow(window.startsAt, window.endsAt), true);
  assert.equal(termWindowFromCalendarDates('2028-01-15', '2027-09-01'), null);
  assert.equal(termWindowFromCalendarDates('bad', '2028-01-15'), null);
  // Early purchase: window starts at the semester start, never before.
  const early = semesterAccessWindow({ startsAt: window.startsAt, endsAt: window.endsAt, purchasedAt: new Date('2027-08-01T00:00:00Z') });
  assert.equal(early.startsAt.getTime(), window.startsAt.getTime());
  // Mid-semester purchase: window starts at purchase time, ends at semester end.
  const mid = new Date('2027-10-01T00:00:00Z');
  const during = semesterAccessWindow({ startsAt: window.startsAt, endsAt: window.endsAt, purchasedAt: mid });
  assert.equal(during.startsAt.getTime(), mid.getTime());
  assert.equal(during.endsAt.getTime(), window.endsAt.getTime());
  // Days remaining never goes negative.
  assert.equal(daysRemaining(window.endsAt, new Date('2030-01-01T00:00:00Z')), 0);
});

/* ------------------------- subject scope resolution ----------------------- */

test('the unified subscription covers every ready subject of the grade/track only', () => {
  const subjects = [
    { id: 'm1', gradeId: 'g12', academicFieldId: null },
    { id: 'p1', gradeId: 'g12', academicFieldId: 'sci' },
    { id: 'c1', gradeId: 'g12', academicFieldId: 'sci' },
    { id: 'x1', gradeId: 'g11', academicFieldId: null },
  ];
  const ready = new Set(['m1', 'p1', 'x1']); // c1 has no ready book
  const gradeWide = includedSubjectIds(subjects, ready, { gradeId: 'g12', academicFieldId: null });
  // Grade-wide includes every ready subject of g12 regardless of track.
  assert.deepEqual(gradeWide.sort(), ['m1', 'p1']);
  const sci = includedSubjectIds(subjects, ready, { gradeId: 'g12', academicFieldId: 'sci' });
  // Track scope keeps the grade-wide subject and the same-track ready subject.
  assert.deepEqual(sci.sort(), ['m1', 'p1']);
  // A different grade is never covered.
  assert.equal(includedSubjectIds(subjects, ready, { gradeId: 'g11', academicFieldId: null }).includes('m1'), false);
  // A subject with no ready book is excluded.
  assert.equal(sci.includes('c1'), false);
});

test('subjectAppliesToScope enforces grade and track', () => {
  assert.equal(subjectAppliesToScope({ gradeId: 'g12', academicFieldId: 'sci' }, { gradeId: 'g12', academicFieldId: 'sci' }), true);
  assert.equal(subjectAppliesToScope({ gradeId: 'g12', academicFieldId: null }, { gradeId: 'g12', academicFieldId: 'sci' }), true);
  assert.equal(subjectAppliesToScope({ gradeId: 'g12', academicFieldId: 'lit' }, { gradeId: 'g12', academicFieldId: 'sci' }), false);
  assert.equal(subjectAppliesToScope({ gradeId: 'g11', academicFieldId: 'sci' }, { gradeId: 'g12', academicFieldId: 'sci' }), false);
});

/* --------------------------- late enrollment price ------------------------ */

test('late enrollment price follows the policy and never goes below one minor unit', () => {
  const startsAt = new Date('2027-09-01T00:00:00Z');
  const endsAt = new Date('2028-01-01T00:00:00Z');
  const half = new Date(startsAt.getTime() + (endsAt.getTime() - startsAt.getTime()) / 2);
  assert.equal(computeLateEnrollmentPrice({ policy: 'FULL_PRICE', priceMinor: 29_000, startsAt, endsAt, purchasedAt: half }), 29_000);
  const prorated = computeLateEnrollmentPrice({ policy: 'PRORATED', priceMinor: 29_000, startsAt, endsAt, purchasedAt: half });
  assert.ok(prorated > 14_000 && prorated < 15_000);
  assert.equal(computeLateEnrollmentPrice({ policy: 'PRORATED', priceMinor: 29_000, startsAt, endsAt, purchasedAt: endsAt }), 29_000);
  assert.equal(computeLateEnrollmentPrice({ policy: 'PRORATED', priceMinor: 100, startsAt, endsAt, purchasedAt: new Date('2027-12-31T23:00:00Z') }) >= 1, true);
});

/* --------------------------- sellability rules ---------------------------- */

function semester(overrides: Partial<SemesterRecord> = {}): SemesterRecord {
  const window = termWindowFromCalendarDates('2027-09-01', '2028-01-15');
  return {
    id: crypto.randomUUID(),
    name: 'الفصل الأول 2027/2028',
    academicYear: '2027/2028',
    gradeId: 'g12',
    academicFieldId: null,
    startsAt: window!.startsAt,
    endsAt: window!.endsAt,
    salesStartAt: new Date('2027-08-01T00:00:00Z'),
    salesEndAt: null,
    priceMinor: 29_000,
    currency: 'JOD',
    includedCredits: 300,
    status: 'ACTIVE',
    lateEnrollmentPolicy: 'FULL_PRICE',
    topUpEnabled: true,
    freemiusPlanId: 'plan_x',
    adminNotes: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test('isSellableSemester rejects draft/archived, closed sales and ended semesters', () => {
  const during = new Date('2027-10-01T00:00:00Z');
  assert.equal(isSellableSemester(semester(), during), true);
  assert.equal(isSellableSemester(semester({ status: 'DRAFT' }), during), false);
  assert.equal(isSellableSemester(semester({ status: 'SCHEDULED' }), during), true);
  assert.equal(isSellableSemester(semester({ salesStartAt: new Date('2027-11-01T00:00:00Z') }), during), false);
  assert.equal(isSellableSemester(semester({ salesEndAt: new Date('2027-09-15T00:00:00Z') }), during), false);
  assert.equal(isSellableSemester(semester(), new Date('2028-02-01T00:00:00Z')), false);
  assert.equal(isSellableSemester(semester({ priceMinor: 0 }), during), false);
});

/* ----------------------------- in-memory stores --------------------------- */

function createMemorySemesters(seed: SemesterRecord[] = []) {
  const rows = new Map(seed.map((row) => [row.id, row]));
  const store: SemesterStore = {
    async listSemesters() { return [...rows.values()]; },
    async findSemesterById(id) { return rows.get(id) ?? null; },
    async findSemesterByFreemiusPlanId(planId) { return [...rows.values()].find((row) => row.freemiusPlanId === planId) ?? null; },
    async createSemester(input) { const row = { ...input, createdAt: new Date(), updatedAt: new Date() } as SemesterRecord; rows.set(row.id, row); return row; },
    async updateSemester(id, patch) { const row = rows.get(id); if (row) rows.set(id, { ...row, ...patch, updatedAt: new Date() }); },
    async findCurrentSemesterForScope() { return [...rows.values()].find((row) => row.status === 'ACTIVE') ?? null; },
    async findOverlapping({ gradeId, academicFieldId, startsAt, endsAt, excludeId }) {
      return [...rows.values()].filter((row) =>
        row.gradeId === gradeId &&
        (academicFieldId ? row.academicFieldId === academicFieldId || row.academicFieldId === null : row.academicFieldId === null) &&
        (row.status === 'ACTIVE' || row.status === 'SCHEDULED') &&
        row.id !== excludeId &&
        row.startsAt.getTime() <= endsAt.getTime() && row.endsAt.getTime() >= startsAt.getTime());
    },
    async listSubscribers() { return []; },
  };
  return { store, rows };
}

function createMemoryPurchases() {
  const rows = new Map<string, SubscriptionPurchaseRecord>();
  const store: PurchaseStore = {
    async createPurchase(input) { const row = { ...input, createdAt: new Date(), updatedAt: new Date() } as SubscriptionPurchaseRecord; rows.set(row.id, row); return row; },
    async findPurchaseById(id) { return rows.get(id) ?? null; },
    async findPurchaseByProviderLicenseId(licenseId) { return [...rows.values()].find((row) => row.providerLicenseId === licenseId) ?? null; },
    async findLivePurchaseForUserSemester(userId, semesterId) { return [...rows.values()].find((row) => row.userId === userId && row.semesterId === semesterId && (row.status === 'PENDING' || row.status === 'ACTIVE')) ?? null; },
    async findLatestPurchaseForUserSemester(userId, semesterId) { return [...rows.values()].filter((row) => row.userId === userId && row.semesterId === semesterId).pop() ?? null; },
    async listPurchasesForUser(userId) { return [...rows.values()].filter((row) => row.userId === userId); },
    async listPurchasesForSemester(semesterId) { return [...rows.values()].filter((row) => row.semesterId === semesterId); },
    async updatePurchase(id, patch) { const row = rows.get(id); if (row) rows.set(id, { ...row, ...patch, updatedAt: new Date() }); },
  };
  return { store, rows };
}

// A faithful in-memory wallet with the same idempotency + bucket semantics.
function createMemoryWallets() {
  const wallets = new Map<string, CreditWalletRecord>();
  const ledgerRows: CreditLedgerRecord[] = [];
  const walletOf = (userId: string): CreditWalletRecord => wallets.get(userId) ?? { userId, semesterBalance: 0, topupBalance: 0, semesterGrantedAt: null, semesterExpiresAt: null, updatedAt: new Date() };
  const snap = (w: CreditWalletRecord): WalletSnapshot => ({ ...w, total: w.semesterBalance + w.topupBalance });
  const store: CreditWalletStore = {
    async getWallet(userId) { return wallets.get(userId) ?? null; },
    async getSnapshot(userId) { return snap(walletOf(userId)); },
    async grantSemesterCredits(input) {
      if (ledgerRows.some((row) => row.requestId === input.requestId)) return { granted: false, snapshot: snap(walletOf(input.userId)) };
      const w = walletOf(input.userId);
      const next = { ...w, semesterBalance: w.semesterBalance + input.credits, semesterGrantedAt: new Date(), semesterExpiresAt: input.expiresAt, updatedAt: new Date() };
      wallets.set(input.userId, next);
      ledgerRows.push({ id: crypto.randomUUID(), userId: input.userId, bucket: 'SEMESTER', kind: 'GRANT', delta: input.credits, balanceAfter: next.semesterBalance, subjectId: null, semesterId: input.semesterId, entitlementId: input.entitlementId, topupPurchaseId: null, requestId: input.requestId, reversesRequestId: null, note: null, actorId: null, createdAt: new Date() });
      return { granted: true, snapshot: snap(next) };
    },
    async grantTopupCredits(input) {
      if (ledgerRows.some((row) => row.requestId === input.requestId)) return { granted: false, snapshot: snap(walletOf(input.userId)) };
      const w = walletOf(input.userId);
      const next = { ...w, topupBalance: w.topupBalance + input.credits, updatedAt: new Date() };
      wallets.set(input.userId, next);
      ledgerRows.push({ id: crypto.randomUUID(), userId: input.userId, bucket: 'TOPUP', kind: 'TOPUP_PURCHASE', delta: input.credits, balanceAfter: next.topupBalance, subjectId: null, semesterId: null, entitlementId: null, topupPurchaseId: input.topupPurchaseId, requestId: input.requestId, reversesRequestId: null, note: input.note ?? null, actorId: null, createdAt: new Date() });
      return { granted: true, snapshot: snap(next) };
    },
    async spend(input) {
      const w = walletOf(input.userId);
      if (input.credits <= 0) return { ok: true, charged: false, duplicate: false, snapshot: snap(w) };
      if (ledgerRows.some((row) => row.requestId === input.requestId)) return { ok: true, charged: false, duplicate: true, snapshot: snap(w) };
      const total = w.semesterBalance + w.topupBalance;
      if (total < input.credits) return { ok: false, reason: 'insufficient', snapshot: snap(w) };
      const fromSemester = Math.min(w.semesterBalance, input.credits);
      const fromTopup = input.credits - fromSemester;
      const next = { ...w, semesterBalance: w.semesterBalance - fromSemester, topupBalance: w.topupBalance - fromTopup, updatedAt: new Date() };
      wallets.set(input.userId, next);
      if (fromSemester > 0) ledgerRows.push({ id: crypto.randomUUID(), userId: input.userId, bucket: 'SEMESTER', kind: 'CONSUME', delta: -fromSemester, balanceAfter: next.semesterBalance, subjectId: input.subjectId, semesterId: null, entitlementId: input.entitlementId, topupPurchaseId: null, requestId: input.requestId, reversesRequestId: null, note: null, actorId: null, createdAt: new Date() });
      if (fromTopup > 0) ledgerRows.push({ id: crypto.randomUUID(), userId: input.userId, bucket: 'TOPUP', kind: 'CONSUME', delta: -fromTopup, balanceAfter: next.topupBalance, subjectId: input.subjectId, semesterId: null, entitlementId: input.entitlementId, topupPurchaseId: null, requestId: `${input.requestId}:topup`, reversesRequestId: null, note: null, actorId: null, createdAt: new Date() });
      return { ok: true, charged: true, duplicate: false, snapshot: snap(next) };
    },
    async refund(input) {
      if (ledgerRows.some((row) => row.kind === 'REFUND' && row.reversesRequestId === input.reversesRequestId)) return { ok: false, reason: 'already_refunded' };
      const debits = ledgerRows.filter((row) => row.kind === 'CONSUME' && (row.requestId === input.reversesRequestId || row.requestId === `${input.reversesRequestId}:topup`));
      if (!debits.length) return { ok: false, reason: 'not_found' };
      const w = walletOf(input.userId);
      let sem = 0;
      let top = 0;
      for (const debit of debits) {
        if (debit.bucket === 'SEMESTER') sem += -debit.delta;
        else top += -debit.delta;
      }
      const next = { ...w, semesterBalance: w.semesterBalance + sem, topupBalance: w.topupBalance + top, updatedAt: new Date() };
      wallets.set(input.userId, next);
      ledgerRows.push({ id: crypto.randomUUID(), userId: input.userId, bucket: sem > 0 ? 'SEMESTER' : 'TOPUP', kind: 'REFUND', delta: sem + top, balanceAfter: sem > 0 ? next.semesterBalance : next.topupBalance, subjectId: null, semesterId: null, entitlementId: null, topupPurchaseId: null, requestId: input.requestId, reversesRequestId: input.reversesRequestId, note: input.note ?? null, actorId: null, createdAt: new Date() });
      return { ok: true, refunded: sem + top };
    },
    async expireSemesterCredits(input) {
      if (ledgerRows.some((row) => row.requestId === input.requestId)) return snap(walletOf(input.userId));
      const w = walletOf(input.userId);
      if (w.semesterBalance <= 0) return snap(w);
      const next = { ...w, semesterBalance: 0, semesterExpiresAt: new Date(), updatedAt: new Date() };
      wallets.set(input.userId, next);
      ledgerRows.push({ id: crypto.randomUUID(), userId: input.userId, bucket: 'SEMESTER', kind: 'EXPIRE', delta: -w.semesterBalance, balanceAfter: 0, subjectId: null, semesterId: input.semesterId, entitlementId: null, topupPurchaseId: null, requestId: input.requestId, reversesRequestId: null, note: input.note ?? null, actorId: null, createdAt: new Date() });
      return snap(next);
    },
    async adjust(input) {
      const w = walletOf(input.userId);
      const current = input.bucket === 'SEMESTER' ? w.semesterBalance : w.topupBalance;
      const nextBalance = current + input.delta;
      if (nextBalance < 0) throw new Error('negative_balance');
      const next = input.bucket === 'SEMESTER' ? { ...w, semesterBalance: nextBalance, updatedAt: new Date() } : { ...w, topupBalance: nextBalance, updatedAt: new Date() };
      wallets.set(input.userId, next);
      ledgerRows.push({ id: crypto.randomUUID(), userId: input.userId, bucket: input.bucket, kind: 'ADMIN_ADJUSTMENT', delta: input.delta, balanceAfter: nextBalance, subjectId: null, semesterId: null, entitlementId: null, topupPurchaseId: null, requestId: input.requestId, reversesRequestId: null, note: input.reason, actorId: input.actorId, createdAt: new Date() });
      return snap(next);
    },
    async listLedger(userId) { return ledgerRows.filter((row) => row.userId === userId); },
    async findLedgerByRequestId(requestId) { return ledgerRows.find((row) => row.requestId === requestId) ?? null; },
    async listSemesterGrants() { return []; },
  };
  return { store, wallets, ledgerRows };
}

function createMemoryBilling() {
  const rows = new Map<string, EntitlementRecord>();
  const store = {
    async upsertEntitlement(record: EntitlementRecord) {
      const existing = [...rows.values()].find((row) => row.freemiusLicenseId === record.freemiusLicenseId);
      rows.set(existing?.id ?? record.id, { ...record, id: existing?.id ?? record.id });
    },
    async findEntitlementByLicenseId(licenseId: string) { return [...rows.values()].find((row) => row.freemiusLicenseId === licenseId) ?? null; },
    async listEntitlementsForUser(userId: string) { return [...rows.values()].filter((row) => row.userId === userId); },
  } as unknown as BillingStore;
  return { store, rows };
}

/* --------------------------- provisioning + grant ------------------------- */

test('provisioning grants semester credits exactly once and freezes the window', async () => {
  const wallet = createMemoryWallets();
  const purchases = createMemoryPurchases();
  const billing = createMemoryBilling();
  const sem = semester();
  const userId = 'user-1';
  const purchasedAt = new Date('2027-08-20T00:00:00Z');

  const first = await provisionSemesterPurchase({
    purchases: purchases.store,
    billing: billing.store,
    wallets: wallet.store,
    semester: sem,
    userId,
    provider: { licenseId: 'lic-1', subscriptionId: null, planId: 'plan_x' },
    purchasedAt,
    now: purchasedAt,
  });
  assert.equal(first.grantedCredits, true);
  assert.equal(first.wallet.semesterBalance, 300);
  assert.equal(first.wallet.topupBalance, 0);

  // Replay the same verified webhook: no double grant, same purchase.
  const second = await provisionSemesterPurchase({
    purchases: purchases.store,
    billing: billing.store,
    wallets: wallet.store,
    semester: sem,
    userId,
    provider: { licenseId: 'lic-1', subscriptionId: null, planId: 'plan_x' },
    purchasedAt,
    now: purchasedAt,
  });
  assert.equal(second.grantedCredits, false);
  assert.equal(second.wallet.semesterBalance, 300);
  assert.equal(purchases.rows.size, 1);
  // Early purchase: activation at the semester start, expiry at semester end.
  assert.equal(second.purchase.startsAt.getTime(), sem.startsAt.getTime());
  assert.equal(second.purchase.expiresAt.getTime(), sem.endsAt.getTime());
});

/* ------------------------------ wallet rules ------------------------------ */

test('the wallet spends semester credits before top-up credits and is idempotent', async () => {
  const wallet = createMemoryWallets();
  await wallet.store.grantSemesterCredits({ userId: 'u', credits: 3, semesterId: 's', entitlementId: 'e', requestId: 'g1', expiresAt: new Date(Date.now() + 86_400_000) });
  await wallet.store.grantTopupCredits({ userId: 'u', credits: 5, topupPurchaseId: 't', requestId: 'g2' });

  // Spend 4: 3 from semester, 1 from top-up.
  const first = await wallet.store.spend({ userId: 'u', entitlementId: 'e', subjectId: 'sub', requestId: 'r1', credits: 4 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.snapshot.semesterBalance, 0);
  assert.equal(first.snapshot.topupBalance, 4);
  // Duplicate request id: no second charge.
  const dup = await wallet.store.spend({ userId: 'u', entitlementId: 'e', subjectId: 'sub', requestId: 'r1', credits: 4 });
  assert.equal(dup.ok, true);
  if (!dup.ok) return;
  assert.equal(dup.charged, false);
  assert.equal(dup.duplicate, true);
  // Insufficient.
  const tooMuch = await wallet.store.spend({ userId: 'u', entitlementId: 'e', subjectId: 'sub', requestId: 'r9', credits: 99 });
  assert.equal(tooMuch.ok, false);
});

test('a refund restores exactly the buckets a spend debited, once', async () => {
  const wallet = createMemoryWallets();
  await wallet.store.grantSemesterCredits({ userId: 'u', credits: 3, semesterId: 's', entitlementId: 'e', requestId: 'g1', expiresAt: new Date(Date.now() + 86_400_000) });
  await wallet.store.grantTopupCredits({ userId: 'u', credits: 5, topupPurchaseId: 't', requestId: 'g2' });
  await wallet.store.spend({ userId: 'u', entitlementId: 'e', subjectId: 'sub', requestId: 'r1', credits: 4 });
  const refund = await wallet.store.refund({ userId: 'u', requestId: 'refund-1', reversesRequestId: 'r1' });
  assert.equal(refund.ok, true);
  if (!refund.ok) return;
  assert.equal(refund.refunded, 4);
  const after = await wallet.store.getSnapshot('u');
  assert.equal(after.semesterBalance, 3);
  assert.equal(after.topupBalance, 5);
  // A second refund of the same spend is refused.
  const again = await wallet.store.refund({ userId: 'u', requestId: 'refund-2', reversesRequestId: 'r1' });
  assert.equal(again.ok, false);
});

test('semester credit expiry clears only the semester bucket and a manual adjustment is audited', async () => {
  const wallet = createMemoryWallets();
  await wallet.store.grantSemesterCredits({ userId: 'u', credits: 10, semesterId: 's', entitlementId: 'e', requestId: 'g1', expiresAt: new Date(Date.now() - 1000) });
  await wallet.store.grantTopupCredits({ userId: 'u', credits: 7, topupPurchaseId: 't', requestId: 'g2' });
  const afterExpiry = await wallet.store.expireSemesterCredits({ userId: 'u', semesterId: 's', requestId: 'exp-1' });
  assert.equal(afterExpiry.semesterBalance, 0);
  assert.equal(afterExpiry.topupBalance, 7);

  const adjusted = await wallet.store.adjust({ userId: 'u', bucket: 'TOPUP', delta: 3, actorId: 'admin', reason: 'goodwill', requestId: 'adj-1' });
  assert.equal(adjusted.topupBalance, 10);
  await assert.rejects(() => wallet.store.adjust({ userId: 'u', bucket: 'TOPUP', delta: -100, actorId: 'admin', reason: 'x', requestId: 'adj-2' }));
});

/* --------------------------- subscription status -------------------------- */

test('subscription status reflects scheduled, active and expired states', async () => {
  const sem = semester();
  const now = new Date('2027-10-01T00:00:00Z');
  const base: SubscriptionPurchaseRecord = {
    id: 'p', userId: 'u', semesterId: sem.id, entitlementId: 'e', semesterName: sem.name,
    priceMinor: 29_000, currency: 'JOD', includedCredits: 300,
    startsAt: sem.startsAt, expiresAt: sem.endsAt, lateEnrollment: false, status: 'ACTIVE',
    provider: 'freemius', providerLicenseId: 'l', providerSubscriptionId: null, providerPlanId: 'plan_x',
    creditsGrantedAt: now, createdAt: now, updatedAt: now,
  };
  assert.equal(subscriptionStatusFor({ semester: sem, purchase: null, now }), 'none');
  assert.equal(subscriptionStatusFor({ semester: sem, purchase: { ...base, startsAt: new Date('2027-11-01T00:00:00Z') }, now }), 'scheduled');
  assert.equal(subscriptionStatusFor({ semester: sem, purchase: base, now }), 'active');
  assert.equal(subscriptionStatusFor({ semester: sem, purchase: { ...base, expiresAt: new Date('2027-09-15T00:00:00Z') }, now }), 'expired');
  assert.equal(subscriptionStatusFor({ semester: sem, purchase: { ...base, status: 'REFUNDED' }, now }), 'expired');
});

/* ------------------------ semester overlap validation --------------------- */

test('overlap detection finds conflicting active/scheduled semesters for the same scope', async () => {
  const existing = semester({ status: 'ACTIVE', gradeId: 'g12', academicFieldId: null });
  const { store } = createMemorySemesters([existing]);
  const window = termWindowFromCalendarDates('2027-12-01', '2028-03-01')!;
  const overlap = await store.findOverlapping({ gradeId: 'g12', academicFieldId: null, startsAt: window.startsAt, endsAt: window.endsAt });
  assert.equal(overlap.length, 1);
  // A different grade never conflicts.
  const otherGrade = await store.findOverlapping({ gradeId: 'g11', academicFieldId: null, startsAt: window.startsAt, endsAt: window.endsAt });
  assert.equal(otherGrade.length, 0);
  // Excluding the same id removes the self-match.
  const selfExcluded = await store.findOverlapping({ gradeId: 'g12', academicFieldId: null, startsAt: window.startsAt, endsAt: window.endsAt, excludeId: existing.id });
  assert.equal(selfExcluded.length, 0);
});

test('semesterStore test seam is installed and cleared', async () => {
  const { setSemesterStoreForTests } = await import('../lib/billing/semester-store');
  const { store } = createMemorySemesters([semester()]);
  setSemesterStoreForTests(store);
  const { semesterStore } = await import('../lib/billing/semester-store');
  assert.equal((await semesterStore().listSemesters()).length, 1);
  setSemesterStoreForTests(null);
});

test('top-up credits persist across semester expiry and stay in the wallet', async () => {
  const wallet = createMemoryWallets();
  await wallet.store.grantTopupCredits({ userId: 'u', credits: 50, topupPurchaseId: 't1', requestId: 'g1' });
  await wallet.store.grantSemesterCredits({ userId: 'u', credits: 300, semesterId: 's1', entitlementId: 'e1', requestId: 'g2', expiresAt: new Date(Date.now() + 1000) });
  await wallet.store.expireSemesterCredits({ userId: 'u', semesterId: 's1', requestId: 'e1-exp' });
  const snap = await wallet.store.getSnapshot('u');
  assert.equal(snap.semesterBalance, 0);
  assert.equal(snap.topupBalance, 50, 'purchased top-up credits survive semester expiry');
});


