import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { FreemiusWebhookDeps } from '../lib/freemius/webhook';

// Regression tests for the payment-settlement review (PR #3, Blocker 5). They
// verify that settlement uses the PURCHASE SNAPSHOT (not the live catalogue),
// that a provider event cannot settle another user's purchase, and that replays
// never add credits twice.

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
  usersByEmail: Record<string, string>;
  existingPurchase?: Purchase;
  pendingPurchase?: Purchase;
}) {
  const purchases = new Map<string, Purchase>();
  if (options.existingPurchase) purchases.set(options.existingPurchase.id, options.existingPurchase);
  if (options.pendingPurchase) purchases.set(options.pendingPurchase.id, options.pendingPurchase);

  const grants: { userId: string; credits: number; requestId: string }[] = [];

  const topups = {
    async findOfferByFreemiusPlanId(planId: string) {
      return planId === options.offer.freemiusPlanId ? options.offer : null;
    },
    async findPurchaseByProviderTransactionId(tx: string) {
      return [...purchases.values()].find((p) => p.providerTransactionId === tx) ?? null;
    },
    async findPendingPurchaseForUser(userId: string, offerId: string) {
      return (
        [...purchases.values()].find((p) => p.userId === userId && p.offerId === offerId && p.status === 'PENDING') ?? null
      );
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
      // Idempotent by requestId, mirroring the real wallet.
      const already = grants.some((g) => g.requestId === input.requestId);
      if (!already) grants.push({ userId: input.userId, credits: input.credits, requestId: input.requestId });
      return { granted: !already };
    },
    async grantSemesterCredits() {
      return { granted: false };
    },
  };

  const deps = {
    createListener: () => {
      const handlers: { types: string[]; fn: (event: { id: string; type: string }) => Promise<void> }[] = [];
      return {
        on: (types: string | string[], fn: (event: { id: string; type: string }) => Promise<void>) => {
          handlers.push({ types: Array.isArray(types) ? types : [types], fn });
        },
        _handlers: handlers,
      };
    },
    processFetch: async (listener: { _handlers?: unknown[] }, request: Request) => {
      const body = (await request.json()) as { id: string; type: string; objects?: unknown };
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
    },
    findUserByEmail: async (email: string) => {
      const id = options.usersByEmail[email];
      return id ? { id } : null;
    },
    unified: {
      semesters: { async findSemesterByFreemiusPlanId() { return null; } },
      purchases: { async findPurchaseByProviderLicenseId() { return null; }, async createPurchase() { throw new Error('unused'); }, async updatePurchase() {}, async findPurchaseById() { return null; } },
      wallets,
      topups,
    },
  } as unknown as FreemiusWebhookDeps;

  return { deps, purchases, grants };
}

async function deliver(deps: FreemiusWebhookDeps, purchase: Record<string, unknown>, email: string, eventId = 'evt-1') {
  // The webhook retrieves the purchase itself; wrap it.
  (deps as unknown as { retrievePurchase: () => Promise<unknown> }).retrievePurchase = async () => purchase;
  const { handleFreemiusWebhook } = await import('../lib/freemius/webhook');
  const request = new Request('http://localhost/api/webhooks/freemius', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: eventId, type: 'license.created', objects: { license: { id: 'lic-1' }, user: { email } } }),
  });
  return handleFreemiusWebhook(request, deps);
}

test('top-up settlement uses the purchase snapshot, not an edited offer', async () => {
  const pending: Purchase = {
    id: 'pending-1', userId: 'user-1', offerId: 'offer-1', offerName: '100 كريدت',
    credits: 100, priceMinor: 5_000, currency: 'JOD', status: 'PENDING', provider: 'freemius',
    providerTransactionId: null, providerLicenseId: null, providerPlanId: 'plan_topup', creditsGrantedAt: null,
  };
  // The live offer was raised to 500 credits for 5 JOD AFTER the student checked out.
  const h = harness({
    offer: { id: 'offer-1', name: '500 كريدت', credits: 500, priceMinor: 5_000, currency: 'JOD', freemiusPlanId: 'plan_topup', status: 'ACTIVE' },
    usersByEmail: { 'u1@example.com': 'user-1' },
    pendingPurchase: pending,
  });
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_topup', licenseId: 'lic-1', subscriptionId: 'tx-1', canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff' }, 'u1@example.com');
  assert.equal(h.grants.length, 1);
  assert.equal(h.grants[0].credits, 100, 'grants the snapshot 100, not the edited 500');
});

test('a provider event cannot settle another user\'s pending purchase', async () => {
  const pendingOther: Purchase = {
    id: 'pending-other', userId: 'user-2', offerId: 'offer-1', offerName: '100 كريدت',
    credits: 100, priceMinor: 5_000, currency: 'JOD', status: 'PENDING', provider: 'freemius',
    providerTransactionId: null, providerLicenseId: null, providerPlanId: 'plan_topup', creditsGrantedAt: null,
  };
  const h = harness({
    offer: { id: 'offer-1', name: '100 كريدت', credits: 100, priceMinor: 5_000, currency: 'JOD', freemiusPlanId: 'plan_topup', status: 'ACTIVE' },
    usersByEmail: { 'u1@example.com': 'user-1', 'u2@example.com': 'user-2' },
    pendingPurchase: pendingOther,
  });
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_topup', licenseId: 'lic-1', subscriptionId: 'tx-1', canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff' }, 'u1@example.com');
  // A NEW purchase is created for user-1; user-2's pending purchase is untouched.
  assert.equal(h.grants.length, 1);
  assert.equal(h.grants[0].userId, 'user-1');
  assert.equal(h.purchases.get('pending-other')?.providerTransactionId, null, 'another user\'s pending purchase is never bound');
});

test('top-up replay by the same transaction id grants credits exactly once', async () => {
  const h = harness({
    offer: { id: 'offer-1', name: '100 كريدت', credits: 100, priceMinor: 5_000, currency: 'JOD', freemiusPlanId: 'plan_topup', status: 'ACTIVE' },
    usersByEmail: { 'u1@example.com': 'user-1' },
    existingPurchase: {
      id: 'p1', userId: 'user-1', offerId: 'offer-1', offerName: '100 كريدت', credits: 100,
      priceMinor: 5_000, currency: 'JOD', status: 'ACTIVE', provider: 'freemius',
      providerTransactionId: 'tx-1', providerLicenseId: 'lic-1', providerPlanId: 'plan_topup', creditsGrantedAt: new Date(),
    },
  });
  const purchase = { email: 'u1@example.com', planId: 'plan_topup', licenseId: 'lic-1', subscriptionId: 'tx-1', canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff' };
  await deliver(h.deps, purchase, 'u1@example.com', 'evt-1');
  await deliver(h.deps, purchase, 'u1@example.com', 'evt-2');
  assert.equal(h.grants.length, 1, 'replays never double-grant');
});

test('a mismatched paid amount withholds settlement', async () => {
  const h = harness({
    offer: { id: 'offer-1', name: '100 كريدت', credits: 100, priceMinor: 5_000, currency: 'JOD', freemiusPlanId: 'plan_topup', status: 'ACTIVE' },
    usersByEmail: { 'u1@example.com': 'user-1' },
    pendingPurchase: {
      id: 'p1', userId: 'user-1', offerId: 'offer-1', offerName: '100 كريدت', credits: 100,
      priceMinor: 5_000, currency: 'JOD', status: 'PENDING', provider: 'freemius',
      providerTransactionId: null, providerLicenseId: null, providerPlanId: 'plan_topup', creditsGrantedAt: null,
    },
  });
  // Provider reports a different amount (e.g. a tampered/again-unrelated charge).
  await deliver(h.deps, { email: 'u1@example.com', planId: 'plan_topup', licenseId: 'lic-1', subscriptionId: 'tx-1', canceled: false, expiration: null, created: new Date(), billingCycle: 'oneoff', amountMinor: 1_000 }, 'u1@example.com');
  assert.equal(h.grants.length, 0, 'no credits issued when the amount does not match the snapshot');
});
