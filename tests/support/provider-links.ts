import type { OfferProviderLink, OfferProviderLinkStore } from '../../lib/freemius/links';

// In-memory provider-link store used by unit tests: mirrors the PostgreSQL
// store's semantics, including the compare-and-set sync claim.
export function createFakeProviderLinks(): {
  store: OfferProviderLinkStore;
  seed: (offerId: string, data?: Partial<OfferProviderLink>) => OfferProviderLink;
  get: (offerId: string) => OfferProviderLink | null;
} {
  const map = new Map<string, OfferProviderLink>();
  const store: OfferProviderLinkStore = {
    async findByOfferId(offerId) {
      return map.get(offerId) ?? null;
    },
    async findByPlanId(provider, planId) {
      return [...map.values()].find((link) => link.provider === provider && link.planId === planId) ?? null;
    },
    async listAll() {
      return [...map.values()];
    },
    async claimSync(offerId) {
      const row = map.get(offerId) ?? {
        offerId,
        provider: 'freemius',
        planId: null,
        pricingId: null,
        currency: null,
        priceMinor: null,
        billingCycle: null,
        status: 'PENDING' as const,
        verified: false,
        attempts: 0,
        lastError: null,
        lastSyncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      if (row.status === 'SYNCING') {
        map.set(offerId, row);
        return null;
      }
      const next = { ...row, status: 'SYNCING' as const, attempts: row.attempts + 1, updatedAt: new Date() };
      map.set(offerId, next);
      return next;
    },
    async completeSync(offerId, data) {
      const row = map.get(offerId);
      if (!row) return;
      map.set(offerId, { ...row, ...data, status: 'SYNCED', verified: true, lastError: null, lastSyncedAt: new Date(), updatedAt: new Date() });
    },
    async markPending(offerId, message, planId = null) {
      const row = map.get(offerId);
      if (!row) return;
      map.set(offerId, { ...row, status: 'PENDING', verified: false, planId, lastError: message, updatedAt: new Date() });
    },
    async markFailed(offerId, message) {
      const row = map.get(offerId);
      if (!row) return;
      map.set(offerId, { ...row, status: 'FAILED', verified: false, lastError: message, updatedAt: new Date() });
    },
  };
  const seed = (offerId: string, data: Partial<OfferProviderLink> = {}) => {
    const row: OfferProviderLink = {
      offerId,
      provider: 'freemius',
      planId: 'plan-verified',
      pricingId: 'pricing-1',
      currency: 'JOD',
      priceMinor: 39000,
      billingCycle: 'monthly',
      status: 'SYNCED',
      verified: true,
      attempts: 1,
      lastError: null,
      lastSyncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    map.set(offerId, row);
    return row;
  };
  return { store, seed, get: (offerId) => map.get(offerId) ?? null };
}
