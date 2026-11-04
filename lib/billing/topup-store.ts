import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { getDb } from '../../db';
import { topupOffers, topupPurchases } from '../../db/schema';

export type TopupOfferStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

export type TopupOfferRecord = {
  id: string;
  name: string;
  credits: number;
  priceMinor: number;
  currency: string;
  status: TopupOfferStatus;
  sortOrder: number;
  freemiusPlanId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TopupOfferInput = Omit<TopupOfferRecord, 'createdAt' | 'updatedAt'>;

export type TopupPurchaseStatus = 'PENDING' | 'ACTIVE' | 'CANCELED' | 'EXPIRED' | 'REFUNDED' | 'FAILED';

export type TopupPurchaseRecord = {
  id: string;
  userId: string;
  offerId: string | null;
  offerName: string;
  credits: number;
  priceMinor: number;
  currency: string;
  status: TopupPurchaseStatus;
  provider: string;
  providerTransactionId: string | null;
  providerLicenseId: string | null;
  providerPlanId: string | null;
  creditsGrantedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TopupPurchaseInput = Omit<TopupPurchaseRecord, 'createdAt' | 'updatedAt'>;
export type TopupPurchasePatch = Partial<
  Pick<
    TopupPurchaseRecord,
    | 'status'
    | 'providerTransactionId'
    | 'providerLicenseId'
    | 'providerPlanId'
    | 'creditsGrantedAt'
  >
>;

export type TopupStore = {
  listOffers(): Promise<TopupOfferRecord[]>;
  listActiveOffers(): Promise<TopupOfferRecord[]>;
  findOfferById(id: string): Promise<TopupOfferRecord | null>;
  findOfferByFreemiusPlanId(planId: string): Promise<TopupOfferRecord | null>;
  upsertOffer(input: TopupOfferInput): Promise<TopupOfferRecord>;
  setOfferStatus(id: string, status: TopupOfferStatus): Promise<void>;
  createPurchase(input: TopupPurchaseInput): Promise<TopupPurchaseRecord>;
  findPurchaseById(id: string): Promise<TopupPurchaseRecord | null>;
  findPurchaseByProviderTransactionId(transactionId: string): Promise<TopupPurchaseRecord | null>;
  findPendingPurchaseForUser(userId: string, offerId: string): Promise<TopupPurchaseRecord | null>;
  updatePurchase(id: string, patch: TopupPurchasePatch): Promise<void>;
  listPurchasesForUser(userId: string, limit: number): Promise<TopupPurchaseRecord[]>;
  listPurchases(limit: number): Promise<TopupPurchaseRecord[]>;
};

const offerColumns = {
  id: topupOffers.id,
  name: topupOffers.name,
  credits: topupOffers.credits,
  priceMinor: topupOffers.priceMinor,
  currency: topupOffers.currency,
  status: topupOffers.status,
  sortOrder: topupOffers.sortOrder,
  freemiusPlanId: topupOffers.freemiusPlanId,
  createdAt: topupOffers.createdAt,
  updatedAt: topupOffers.updatedAt,
};

const purchaseColumns = {
  id: topupPurchases.id,
  userId: topupPurchases.userId,
  offerId: topupPurchases.offerId,
  offerName: topupPurchases.offerName,
  credits: topupPurchases.credits,
  priceMinor: topupPurchases.priceMinor,
  currency: topupPurchases.currency,
  status: topupPurchases.status,
  provider: topupPurchases.provider,
  providerTransactionId: topupPurchases.providerTransactionId,
  providerLicenseId: topupPurchases.providerLicenseId,
  providerPlanId: topupPurchases.providerPlanId,
  creditsGrantedAt: topupPurchases.creditsGrantedAt,
  createdAt: topupPurchases.createdAt,
  updatedAt: topupPurchases.updatedAt,
};

function createDrizzleTopupStore(): TopupStore {
  const db = () => getDb();
  const now = () => new Date();

  return {
    async listOffers() {
      return db().select(offerColumns).from(topupOffers).orderBy(asc(topupOffers.sortOrder), asc(topupOffers.credits));
    },

    async listActiveOffers() {
      return db()
        .select(offerColumns)
        .from(topupOffers)
        .where(eq(topupOffers.status, 'ACTIVE'))
        .orderBy(asc(topupOffers.sortOrder), asc(topupOffers.credits));
    },

    async findOfferById(id) {
      const [row] = await db().select(offerColumns).from(topupOffers).where(eq(topupOffers.id, id)).limit(1);
      return row ?? null;
    },

    async findOfferByFreemiusPlanId(planId) {
      const [row] = await db().select(offerColumns).from(topupOffers).where(eq(topupOffers.freemiusPlanId, planId)).limit(1);
      return row ?? null;
    },

    async upsertOffer(input) {
      const stamp = now();
      const [row] = await db()
        .insert(topupOffers)
        .values({ ...input, createdAt: stamp, updatedAt: stamp })
        .onConflictDoUpdate({ target: topupOffers.id, set: { ...input, updatedAt: stamp } })
        .returning(offerColumns);
      return row;
    },

    async setOfferStatus(id, status) {
      await db().update(topupOffers).set({ status, updatedAt: now() }).where(eq(topupOffers.id, id));
    },

    async createPurchase(input) {
      const stamp = now();
      const [row] = await db()
        .insert(topupPurchases)
        .values({ ...input, createdAt: stamp, updatedAt: stamp })
        .returning(purchaseColumns);
      return row;
    },

    async findPurchaseById(id) {
      const [row] = await db().select(purchaseColumns).from(topupPurchases).where(eq(topupPurchases.id, id)).limit(1);
      return row ?? null;
    },

    async findPurchaseByProviderTransactionId(transactionId) {
      const [row] = await db()
        .select(purchaseColumns)
        .from(topupPurchases)
        .where(eq(topupPurchases.providerTransactionId, transactionId))
        .limit(1);
      return row ?? null;
    },

    async findPendingPurchaseForUser(userId, offerId) {
      const [row] = await db()
        .select(purchaseColumns)
        .from(topupPurchases)
        .where(
          and(
            eq(topupPurchases.userId, userId),
            eq(topupPurchases.offerId, offerId),
            inArray(topupPurchases.status, ['PENDING']),
          ),
        )
        .orderBy(desc(topupPurchases.createdAt))
        .limit(1);
      return row ?? null;
    },

    async updatePurchase(id, patch) {
      await db().update(topupPurchases).set({ ...patch, updatedAt: now() }).where(eq(topupPurchases.id, id));
    },

    async listPurchasesForUser(userId, limit) {
      return db()
        .select(purchaseColumns)
        .from(topupPurchases)
        .where(eq(topupPurchases.userId, userId))
        .orderBy(desc(topupPurchases.createdAt))
        .limit(limit);
    },

    async listPurchases(limit) {
      return db().select(purchaseColumns).from(topupPurchases).orderBy(desc(topupPurchases.createdAt)).limit(limit);
    },
  };
}

let override: TopupStore | null = null;

export function setTopupStoreForTests(store: TopupStore | null): void {
  override = store;
}

export function topupStore(): TopupStore {
  return override ?? createDrizzleTopupStore();
}
