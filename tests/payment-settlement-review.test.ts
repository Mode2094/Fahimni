import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FreemiusWebhookDeps } from '../lib/freemius/webhook';

// Regression tests for authoritative payment settlement (PR #3, final gate).
// They verify that settlement uses the VERIFIED provider payment amount and
// currency (not just a license), that it FAILS CLOSED when the amount is
// unavailable, and that replays/cross-user events never double-grant or settle
// the wrong purchase.

type Purchase = {
  id: string;
  userId: string;
  offerId: string | null;
  offerName: string;
  credits: number;
  priceMinor: number;
  currency: string;
  status: string;
  provider: string;
  providerTransactionId: string | null;
  providerLicenseId: string | null;
  providerPlanId: string | null;
  creditsGrantedAt: Date | null;
};

function harness(options: {
  offer: { id: string; name: string; credits: number; priceMinor: number; currency: string; freemiusPlanId: string; status: string };
  semester?: { id: string; name: string; priceMinor: number; currency: string; includedCredits: number; freemiusPlanId: string } | null;
  usersByEmail: Record<string, string>;
  existingPurchase?: Purchase;
  pendingPurchase?: Purchase;
}) {
  const purchases = new Map<string, Purchase>();
  if (options.existingPurchase) purchases.set(options.existingPurchase.id, options.existingPurchase);
  if (options.pendingPurchase) purchases.set(options.pendingPurchase.id, options.pendingPurchase);
  const grants: { userId: string; credits: number; requestId: string }[] = [];
  let semesterProvisioned = 0;

  const topups = {
    async findOfferByFreemiusPlanId(planId: string) {
      return planId === options.offer.freemiusPlanId ? options.offer : null;
    },
    async findPurchaseByProviderTransactionId(tx: string) {
      return [...purchases.values()].find((p) => p.providerTransactionId === tx) ?? null;
    },
    async findPendingPurchaseForUser(userId: string, offerId: string) {
      return [...purchases.values()].find((p) => p.userId === userId && p.offerId === offerId && p.status === 'PENDING') ?? null;
    },
    async createPurchase(input: Partial<Purchase>) {
      const row = { ...input, creditsGrantedAt: null } as Purchase;
      purchases.set(row.id, row);
      return row;
    },
    async updatePurchase(id: string, patch: Partial<Purchase>) {
      const row = purchases.get(id);
      if (row) purchases.set(id, { ...row, ...patch });
    },
  };

  const wallets = {
    async grantTopupCredits(input: { userId: string; credits: number; requestId: string }) {
      const already = grants.some((g) => g.requestId === input.requestId);
      if (!already) grants.push({ userId: input.userId, credits: input.credits, requestId: input.requestId });
      return { granted: !already };
    },
    async grantSemesterCredits() {
      return { granted: false };
    },
  };

  const semesters = {
    async findSemesterByFreemiusPlanId(planId: string) {
      return options.semester && planId === options.semester.freemiusPlanId ? options.semester : null;
    },
  };

  const deps = {
    createListener: () => {
      const handlers: { types: string[]; fn: (event: unknown) => Promise<void> }[] = [];
      return {
        on: (types: string | string[], fn: (event: unknown) => Promise<void>) => {
          handlers.push({ types: Array.isArray(types) ? types : [types], fn });
        },
        _handlers: handlers,
      };
    },
    processFetch: async (listener: { _handlers?: unknown[] }, request: Request) => {
      const body = (await request.json()) as { id: string; type: string };
      for (const handler of (listener as { _handlers: { types: string[]; fn: (e: unknown) => Promise<void> }[] })._handlers) {
        if (handler.types.includes(body.type)) await handler.fn(body);
      }
      return new Response('OK', { status: 200 });
    },
    retrievePurchase: async () => null,
    store: {
      async hasWebhookEvent() { return false; },
      async recordWebhookEvent() {},
      async deleteEntitlementByLicenseId() {},
      async upsertEntitlement() {},
      async findEntitlementByLicenseId() { return null; },
    },
    findUserByEmail: async (email: string) => {
      const id = options.usersByEmail[email];
      return id ? { id } : null;
    },
    unified: {
      semesters,
      purchases: {
        async findPurchaseByProviderLicenseId() { return null; },
        async createPurchase(input: Record<string, unknown>) { semesterProvisioned += 1; return { id: String(input.id ?? 'sp-1'), creditsGrantedAt: null, entitlementId: null, createdAt: new Date() }; },
        async updatePurchase() {},
        async findPurchaseById() { return null; },
      },
      wallets,
      topups,
    },
  } as unknown as FreemiusWebhookDeps;

  return { deps, purchases, grants, semesterCount: () => semesterProvisioned };
}

async function deliver(deps: FreemiusWebhookDeps, purchase: Record<string, unknown>, email: string, eventId = 'evt-1') {
  (deps as unknown as { retrievePurchase: () => Promise<unknown> }).retrievePurchase = async () => purchase;
  const { handleFreemiusWebhook } = await import('../lib/freemius/webhook');
  const request = new Request('http://localhost/api/webhooks/freemius', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: eventId, type: 'license.created', objects: { license: { id: 'lic-1' }, user: { email } } }),
  });
  return handleFreemiusWebhook(request, deps);
}

const OFFER = { id: 'offer-1', name: '100 كريدت', credits: 100, priceMinor: 5_000, currency: 'JOD', freemiusPlanId: 'plan_topup', status: 'ACTIVE' };
const VERIFIED = { paidAmountMinor: 5_000, paidCurrency: 'JOD', providerPaymentId: 'pay-1' };

test('top-up settlement uses the verified payment amount and the purchase snapshot', async () => {
  const pending: Purchase = {
    id: 'pending-1', userId: 'user-1', offerId: 'offer-1', offerName: '100 كريدت',
    credits: 100, priceMinor: 5_000, currency: 'JOD', status: 'PENDING', provider: 'freemius',
    providerTransactionId: null, providerLicenseId: null, providerPlanId: 'plan_topup', creditsGrantedAt: null,
  };
  // The live offer was raised to 500 credits AFTER the student checked out.
  const h = harness({
    offer: { ...OFFER, name: '500 كريدت', credits: 500 },
    usersByEmail: { 'u1@example.com': 'user-1' },
    pendingPurchase: pending,
  });
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_topup', licenseId: 'lic-1', subscriptionId: null, canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff', ...VERIFIED }, 'u1@example.com');
  assert.equal(h.grants.length, 1);
  assert.equal(h.grants[0].credits, 100, 'grants the snapshot 100, not the edited 500');
});

test('settlement fails closed when no verified payment amount is available', async () => {
  const h = harness({
    offer: OFFER,
    usersByEmail: { 'u1@example.com': 'user-1' },
    pendingPurchase: {
      id: 'p1', userId: 'user-1', offerId: 'offer-1', offerName: '100 كريدت', credits: 100,
      priceMinor: 5_000, currency: 'JOD', status: 'PENDING', provider: 'freemius',
      providerTransactionId: null, providerLicenseId: null, providerPlanId: 'plan_topup', creditsGrantedAt: null,
    },
  });
  // A license-only purchase (no verified payment fields) must NOT grant credits.
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_topup', licenseId: 'lic-1', subscriptionId: null, canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff' }, 'u1@example.com');
  assert.equal(h.grants.length, 0, 'no credits without a verified paid amount');
});

test('settlement withholds when the verified amount does not match the snapshot', async () => {
  const h = harness({
    offer: OFFER,
    usersByEmail: { 'u1@example.com': 'user-1' },
    pendingPurchase: {
      id: 'p1', userId: 'user-1', offerId: 'offer-1', offerName: '100 كريدت', credits: 100,
      priceMinor: 5_000, currency: 'JOD', status: 'PENDING', provider: 'freemius',
      providerTransactionId: null, providerLicenseId: null, providerPlanId: 'plan_topup', creditsGrantedAt: null,
    },
  });
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_topup', licenseId: 'lic-1', subscriptionId: null, canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff', paidAmountMinor: 1_000, paidCurrency: 'JOD', providerPaymentId: 'pay-1' }, 'u1@example.com');
  assert.equal(h.grants.length, 0, 'no credits when the paid amount differs from the snapshot');
});

test('settlement withholds when the verified currency does not match the snapshot', async () => {
  const h = harness({
    offer: OFFER,
    usersByEmail: { 'u1@example.com': 'user-1' },
    pendingPurchase: {
      id: 'p1', userId: 'user-1', offerId: 'offer-1', offerName: '100 كريدت', credits: 100,
      priceMinor: 5_000, currency: 'JOD', status: 'PENDING', provider: 'freemius',
      providerTransactionId: null, providerLicenseId: null, providerPlanId: 'plan_topup', creditsGrantedAt: null,
    },
  });
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_topup', licenseId: 'lic-1', subscriptionId: null, canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff', paidAmountMinor: 5_000, paidCurrency: 'USD', providerPaymentId: 'pay-1' }, 'u1@example.com');
  assert.equal(h.grants.length, 0, 'no credits when the paid currency differs from the snapshot');
});

test('top-up replay by the verified payment id grants credits exactly once', async () => {
  const h = harness({
    offer: OFFER,
    usersByEmail: { 'u1@example.com': 'user-1' },
    existingPurchase: {
      id: 'p1', userId: 'user-1', offerId: 'offer-1', offerName: '100 كريدت', credits: 100,
      priceMinor: 5_000, currency: 'JOD', status: 'ACTIVE', provider: 'freemius',
      providerTransactionId: 'pay-1', providerLicenseId: 'lic-1', providerPlanId: 'plan_topup', creditsGrantedAt: new Date(),
    },
  });
  const purchase = { email: 'u1@example.com', planId: 'plan_topup', licenseId: 'lic-1', subscriptionId: null, canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff', ...VERIFIED };
  await deliver(h.deps, purchase, 'u1@example.com', 'evt-1');
  await deliver(h.deps, purchase, 'u1@example.com', 'evt-2');
  assert.equal(h.grants.length, 1, 'replays never double-grant');
});

test('a provider event cannot settle another user\'s pending purchase', async () => {
  const h = harness({
    offer: OFFER,
    usersByEmail: { 'u1@example.com': 'user-1', 'u2@example.com': 'user-2' },
    pendingPurchase: {
      id: 'pending-other', userId: 'user-2', offerId: 'offer-1', offerName: '100 كريدت', credits: 100,
      priceMinor: 5_000, currency: 'JOD', status: 'PENDING', provider: 'freemius',
      providerTransactionId: null, providerLicenseId: null, providerPlanId: 'plan_topup', creditsGrantedAt: null,
    },
  });
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_topup', licenseId: 'lic-1', subscriptionId: null, canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff', ...VERIFIED }, 'u1@example.com');
  assert.equal(h.grants.length, 1);
  assert.equal(h.grants[0].userId, 'user-1');
  assert.equal(h.purchases.get('pending-other')?.providerTransactionId, null, 'another user\'s pending purchase is never bound');
});

test('semester settlement fails closed without a verified amount and grants on a match', async () => {
  const semester = { id: 'sem-1', name: 'الفصل الأول', priceMinor: 29_000, currency: 'JOD', includedCredits: 300, freemiusPlanId: 'plan_semester', startsAt: new Date('2026-09-01T00:00:00Z'), endsAt: new Date('2027-06-15T20:59:59.999Z') };
  const h = harness({ offer: OFFER, semester, usersByEmail: { 'u1@example.com': 'user-1' } });

  // No verified amount -> withheld.
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_semester', licenseId: 'lic-1', subscriptionId: null, canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff' }, 'u1@example.com');
  assert.equal(h.semesterCount(), 0, 'semester settlement withheld without a verified amount');

  // Mismatched amount -> withheld.
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_semester', licenseId: 'lic-1', subscriptionId: null, canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff', paidAmountMinor: 1_000, paidCurrency: 'JOD', providerPaymentId: 'pay-2' }, 'u1@example.com');
  assert.equal(h.semesterCount(), 0, 'semester settlement withheld on amount mismatch');

  // Verified match -> proceeds to provisioning (createPurchase is invoked).
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_semester', licenseId: 'lic-1', subscriptionId: null, canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff', paidAmountMinor: 29_000, paidCurrency: 'JOD', providerPaymentId: 'pay-3' }, 'u1@example.com');
  assert.equal(h.semesterCount(), 1, 'semester settlement proceeds with a verified amount');
});
