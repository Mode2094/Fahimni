import { and, eq, ne, sql } from 'drizzle-orm';

import { getDb } from '../../db';
import { offerProviderLinks } from '../../db/schema';

export type OfferLinkStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export type OfferProviderLink = {
  offerId: string;
  provider: string;
  planId: string | null;
  pricingId: string | null;
  currency: string | null;
  priceMinor: number | null;
  billingCycle: string | null;
  status: OfferLinkStatus;
  verified: boolean;
  attempts: number;
  lastError: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OfferProviderLinkStore = {
  findByOfferId(offerId: string): Promise<OfferProviderLink | null>;
  findByPlanId(provider: string, planId: string): Promise<OfferProviderLink | null>;
  listAll(): Promise<OfferProviderLink[]>;
  claimSync(offerId: string): Promise<OfferProviderLink | null>;
  completeSync(
    offerId: string,
    data: { planId: string; pricingId: string | null; currency: string; priceMinor: number; billingCycle: string },
  ): Promise<void>;
  markPending(offerId: string, message: string, planId?: string | null): Promise<void>;
  markFailed(offerId: string, message: string): Promise<void>;
};

function createDrizzleLinkStore(): OfferProviderLinkStore {
  const db = () => getDb();
  const columns = {
    offerId: offerProviderLinks.offerId,
    provider: offerProviderLinks.provider,
    planId: offerProviderLinks.planId,
    pricingId: offerProviderLinks.pricingId,
    currency: offerProviderLinks.currency,
    priceMinor: offerProviderLinks.priceMinor,
    billingCycle: offerProviderLinks.billingCycle,
    status: offerProviderLinks.status,
    verified: offerProviderLinks.verified,
    attempts: offerProviderLinks.attempts,
    lastError: offerProviderLinks.lastError,
    lastSyncedAt: offerProviderLinks.lastSyncedAt,
    createdAt: offerProviderLinks.createdAt,
    updatedAt: offerProviderLinks.updatedAt,
  };
  return {
    async findByOfferId(offerId) {
      const rows = await db().select(columns).from(offerProviderLinks).where(eq(offerProviderLinks.offerId, offerId)).limit(1);
      return (rows[0] as OfferProviderLink | undefined) ?? null;
    },
    async findByPlanId(provider, planId) {
      const rows = await db()
        .select(columns)
        .from(offerProviderLinks)
        .where(and(eq(offerProviderLinks.provider, provider), eq(offerProviderLinks.planId, planId)))
        .limit(1);
      return (rows[0] as OfferProviderLink | undefined) ?? null;
    },
    async listAll() {
      const rows = await db().select(columns).from(offerProviderLinks);
      return rows as OfferProviderLink[];
    },
    // Idempotency guard: exactly one sync can run per offer at a time. The
    // compare-and-set returns null when another run already holds the claim.
    async claimSync(offerId) {
      await db().insert(offerProviderLinks).values({ offerId }).onConflictDoNothing();
      const rows = await db()
        .update(offerProviderLinks)
        .set({ status: 'SYNCING', attempts: sql`${offerProviderLinks.attempts} + 1`, updatedAt: new Date() })
        .where(and(eq(offerProviderLinks.offerId, offerId), ne(offerProviderLinks.status, 'SYNCING')))
        .returning(columns);
      return (rows[0] as OfferProviderLink | undefined) ?? null;
    },
    async completeSync(offerId, data) {
      await db()
        .update(offerProviderLinks)
        .set({
          status: 'SYNCED',
          verified: true,
          planId: data.planId,
          pricingId: data.pricingId,
          currency: data.currency,
          priceMinor: data.priceMinor,
          billingCycle: data.billingCycle,
          lastError: null,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(offerProviderLinks.offerId, offerId));
    },
    async markPending(offerId, message, planId = null) {
      await db()
        .update(offerProviderLinks)
        .set({
          status: 'PENDING',
          verified: false,
          planId,
          lastError: message.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(offerProviderLinks.offerId, offerId));
    },
    async markFailed(offerId, message) {
      await db()
        .update(offerProviderLinks)
        .set({ status: 'FAILED', verified: false, lastError: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(offerProviderLinks.offerId, offerId));
    },
  };
}

let override: OfferProviderLinkStore | null = null;
let cached: OfferProviderLinkStore | null = null;

export function setOfferProviderLinkStoreForTests(store: OfferProviderLinkStore | null): void {
  override = store;
}

export function offerProviderLinkStore(): OfferProviderLinkStore {
  if (override) return override;
  cached ??= createDrizzleLinkStore();
  return cached;
}
