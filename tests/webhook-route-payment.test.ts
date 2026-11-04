import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'webhook-route-test-secret';
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

import { setFreemiusClientForTests } from '../lib/freemius/client';
import { setAuthStoreForTests } from '../lib/auth/store';
import { setBillingStoreForTests } from '../lib/billing/store';
import { setSemesterStoreForTests } from '../lib/billing/semester-store';
import { setPurchaseStoreForTests } from '../lib/billing/purchase-store';
import { setTopupStoreForTests } from '../lib/billing/topup-store';
import { setCreditWalletStoreForTests } from '../lib/billing/wallet-store';
import type { TopupOfferRecord } from '../lib/billing/topup-store';

// Route-level regression for the Freemius webhook: it proves the ROUTE maps the
// authoritative payment amount from the provider payment records into the
// settlement, and that a license-only purchase (no verified payment) fails closed.

const OFFER: TopupOfferRecord = {
  id: 'offer-1', name: '100 كريدت', credits: 100, priceMinor: 5_000, currency: 'JOD', status: 'ACTIVE',
  sortOrder: 0, freemiusPlanId: 'plan_topup', createdAt: new Date(), updatedAt: new Date(),
};

type Setup = {
  userId: string;
  payments: { id: string; gross: number; currency: string; subscription_id?: string | null; type?: string | null; created?: string }[];
  planId: string;
  licenseId: string;
};

function installSeams(setup: Setup) {
  const grants: { userId: string; credits: number; requestId: string }[] = [];
  const listeners: { types: string[]; fn: (e: unknown) => Promise<void> }[] = [];

  setAuthStoreForTests({
    findUserByEmail: async (email: string) => (email === 'u1@example.com' ? { id: setup.userId } : null),
  } as never);
  setBillingStoreForTests({
    async hasWebhookEvent() { return false; },
    async recordWebhookEvent() {},
    async deleteEntitlementByLicenseId() {},
    async upsertEntitlement() {},
    async findEntitlementByLicenseId() { return null; },
  } as never);
  setSemesterStoreForTests({ async findSemesterByFreemiusPlanId() { return null; } } as never);
  setPurchaseStoreForTests({ async findPurchaseByProviderLicenseId() { return null; } } as never);
  setTopupStoreForTests({
    async findOfferByFreemiusPlanId(planId: string) { return planId === OFFER.freemiusPlanId ? OFFER : null; },
    async findPurchaseByProviderTransactionId() { return null; },
    async findPendingPurchaseForUser() { return null; },
    async createPurchase(input: { id: string }) { return { ...input, creditsGrantedAt: null }; },
    async updatePurchase() {},
  } as never);
  setCreditWalletStoreForTests({
    async grantTopupCredits(input: { userId: string; credits: number; requestId: string }) {
      const dup = grants.some((g) => g.requestId === input.requestId);
      if (!dup) grants.push(input);
      return { granted: !dup, snapshot: { userId: input.userId, semesterBalance: 0, topupBalance: input.credits, semesterGrantedAt: null, semesterExpiresAt: null, updatedAt: new Date(), total: input.credits } };
    },
    async grantSemesterCredits() { return { granted: false, snapshot: { userId: 'u', semesterBalance: 0, topupBalance: 0, semesterGrantedAt: null, semesterExpiresAt: null, updatedAt: new Date(), total: 0 } }; },
  } as never);

  // Mock the Freemius client used by the route.
  const client = {
    purchase: {
      async retrievePurchase() {
        return {
          toData: () => ({
            email: 'u1@example.com', planId: setup.planId, licenseId: setup.licenseId,
            subscriptionId: null, canceled: false, expiration: null, created: new Date(),
            billingCycle: null, userId: 'fs-user-1',
          }),
        };
      },
    },
    api: {
      user: {
        async retrievePayments() {
          return setup.payments;
        },
      },
    },
    webhook: {
      createListener() {
        return {
          on: (types: string | string[], fn: (e: unknown) => Promise<void>) => listeners.push({ types: Array.isArray(types) ? types : [types], fn }),
        };
      },
      async processFetch(_listener: unknown, request: Request) {
        const body = (await request.json()) as { id: string; type: string };
        for (const handler of listeners) if (handler.types.includes(body.type)) await handler.fn(body);
        return new Response('OK', { status: 200 });
      },
    },
  };
  setFreemiusClientForTests(client as never);
  return { grants };
}

function resetSeams() {
  setFreemiusClientForTests(null);
  setAuthStoreForTests(null);
  setBillingStoreForTests(null);
  setSemesterStoreForTests(null);
  setPurchaseStoreForTests(null);
  setTopupStoreForTests(null);
  setCreditWalletStoreForTests(null);
}

test('route maps the provider payment amount so the paid top-up settles', async () => {
  const h = installSeams({
    userId: 'user-1', planId: 'plan_topup', licenseId: 'lic-1',
    payments: [{ id: 'pay-1', gross: 5.0, currency: 'JOD', subscription_id: null, type: 'payment', created: '2026-01-01T00:00:00Z' }],
  });
  try {
    const { POST } = await import('../app/api/webhooks/freemius/route');
    const response = await POST(new Request('http://localhost/api/webhooks/freemius', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'evt-1', type: 'license.created', objects: { license: { id: 'lic-1' }, user: { email: 'u1@example.com' } } }),
    }));
    assert.equal(response.status, 200);
    assert.equal(h.grants.length, 1, 'the route mapped the payment amount and settlement granted once');
    assert.equal(h.grants[0].credits, 100);
  } finally {
    resetSeams();
  }
});

test('route withholds a top-up when the provider returns no verifiable payment', async () => {
  const h = installSeams({ userId: 'user-1', planId: 'plan_topup', licenseId: 'lic-2', payments: [] });
  try {
    const { POST } = await import('../app/api/webhooks/freemius/route');
    const response = await POST(new Request('http://localhost/api/webhooks/freemius', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'evt-2', type: 'license.created', objects: { license: { id: 'lic-2' }, user: { email: 'u1@example.com' } } }),
    }));
    assert.equal(response.status, 200);
    assert.equal(h.grants.length, 0, 'license-only purchase must not grant credits');
  } finally {
    resetSeams();
  }
});

test('route ignores refunded provider payments', async () => {
  const h = installSeams({
    userId: 'user-1', planId: 'plan_topup', licenseId: 'lic-3',
    payments: [{ id: 'pay-9', gross: 5.0, currency: 'JOD', subscription_id: null, type: 'refund', created: '2026-01-01T00:00:00Z' }],
  });
  try {
    const { POST } = await import('../app/api/webhooks/freemius/route');
    const response = await POST(new Request('http://localhost/api/webhooks/freemius', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'evt-3', type: 'license.created', objects: { license: { id: 'lic-3' }, user: { email: 'u1@example.com' } } }),
    }));
    assert.equal(response.status, 200);
    assert.equal(h.grants.length, 0, 'a refunded-only payment is not a settlement');
  } finally {
    resetSeams();
  }
});
