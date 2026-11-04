import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { getDb } from '../../db';
import { subscriptionPurchases } from '../../db/schema';

export type SubscriptionPurchaseStatus = 'PENDING' | 'ACTIVE' | 'CANCELED' | 'EXPIRED' | 'REFUNDED' | 'FAILED';

export type SubscriptionPurchaseRecord = {
  id: string;
  userId: string;
  semesterId: string;
  entitlementId: string | null;
  semesterName: string;
  priceMinor: number;
  currency: string;
  includedCredits: number;
  startsAt: Date;
  expiresAt: Date;
  lateEnrollment: boolean;
  status: SubscriptionPurchaseStatus;
  provider: string;
  providerLicenseId: string | null;
  providerSubscriptionId: string | null;
  providerPlanId: string | null;
  creditsGrantedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SubscriptionPurchaseInput = Omit<SubscriptionPurchaseRecord, 'createdAt' | 'updatedAt'>;
export type SubscriptionPurchasePatch = Partial<
  Pick<
    SubscriptionPurchaseRecord,
    | 'entitlementId'
    | 'status'
    | 'providerLicenseId'
    | 'providerSubscriptionId'
    | 'providerPlanId'
    | 'creditsGrantedAt'
    | 'startsAt'
    | 'expiresAt'
  >
>;

export type PurchaseStore = {
  createPurchase(input: SubscriptionPurchaseInput): Promise<SubscriptionPurchaseRecord>;
  findPurchaseById(id: string): Promise<SubscriptionPurchaseRecord | null>;
  findPurchaseByProviderLicenseId(licenseId: string): Promise<SubscriptionPurchaseRecord | null>;
  // The current non-terminal purchase for one user+semester, used for the
  // duplicate-purchase guard and for showing the student their status.
  findLivePurchaseForUserSemester(userId: string, semesterId: string): Promise<SubscriptionPurchaseRecord | null>;
  findLatestPurchaseForUserSemester(userId: string, semesterId: string): Promise<SubscriptionPurchaseRecord | null>;
  listPurchasesForUser(userId: string): Promise<SubscriptionPurchaseRecord[]>;
  listPurchasesForSemester(semesterId: string): Promise<SubscriptionPurchaseRecord[]>;
  updatePurchase(id: string, patch: SubscriptionPurchasePatch): Promise<void>;
};

const purchaseColumns = {
  id: subscriptionPurchases.id,
  userId: subscriptionPurchases.userId,
  semesterId: subscriptionPurchases.semesterId,
  entitlementId: subscriptionPurchases.entitlementId,
  semesterName: subscriptionPurchases.semesterName,
  priceMinor: subscriptionPurchases.priceMinor,
  currency: subscriptionPurchases.currency,
  includedCredits: subscriptionPurchases.includedCredits,
  startsAt: subscriptionPurchases.startsAt,
  expiresAt: subscriptionPurchases.expiresAt,
  lateEnrollment: subscriptionPurchases.lateEnrollment,
  status: subscriptionPurchases.status,
  provider: subscriptionPurchases.provider,
  providerLicenseId: subscriptionPurchases.providerLicenseId,
  providerSubscriptionId: subscriptionPurchases.providerSubscriptionId,
  providerPlanId: subscriptionPurchases.providerPlanId,
  creditsGrantedAt: subscriptionPurchases.creditsGrantedAt,
  createdAt: subscriptionPurchases.createdAt,
  updatedAt: subscriptionPurchases.updatedAt,
};

const LIVE_STATUSES: SubscriptionPurchaseStatus[] = ['PENDING', 'ACTIVE'];

function createDrizzlePurchaseStore(): PurchaseStore {
  const db = () => getDb();
  const now = () => new Date();

  return {
    async createPurchase(input) {
      const stamp = now();
      const [row] = await db()
        .insert(subscriptionPurchases)
        .values({ ...input, createdAt: stamp, updatedAt: stamp })
        .returning(purchaseColumns);
      return row;
    },

    async findPurchaseById(id) {
      const [row] = await db().select(purchaseColumns).from(subscriptionPurchases).where(eq(subscriptionPurchases.id, id)).limit(1);
      return row ?? null;
    },

    async findPurchaseByProviderLicenseId(licenseId) {
      const [row] = await db()
        .select(purchaseColumns)
        .from(subscriptionPurchases)
        .where(eq(subscriptionPurchases.providerLicenseId, licenseId))
        .limit(1);
      return row ?? null;
    },

    async findLivePurchaseForUserSemester(userId, semesterId) {
      const [row] = await db()
        .select(purchaseColumns)
        .from(subscriptionPurchases)
        .where(
          and(
            eq(subscriptionPurchases.userId, userId),
            eq(subscriptionPurchases.semesterId, semesterId),
            inArray(subscriptionPurchases.status, LIVE_STATUSES),
          ),
        )
        .orderBy(desc(subscriptionPurchases.createdAt))
        .limit(1);
      return row ?? null;
    },

    async findLatestPurchaseForUserSemester(userId, semesterId) {
      const [row] = await db()
        .select(purchaseColumns)
        .from(subscriptionPurchases)
        .where(and(eq(subscriptionPurchases.userId, userId), eq(subscriptionPurchases.semesterId, semesterId)))
        .orderBy(desc(subscriptionPurchases.createdAt))
        .limit(1);
      return row ?? null;
    },

    async listPurchasesForUser(userId) {
      return db()
        .select(purchaseColumns)
        .from(subscriptionPurchases)
        .where(eq(subscriptionPurchases.userId, userId))
        .orderBy(asc(subscriptionPurchases.createdAt));
    },

    async listPurchasesForSemester(semesterId) {
      return db()
        .select(purchaseColumns)
        .from(subscriptionPurchases)
        .where(eq(subscriptionPurchases.semesterId, semesterId))
        .orderBy(asc(subscriptionPurchases.createdAt));
    },

    async updatePurchase(id, patch) {
      await db().update(subscriptionPurchases).set({ ...patch, updatedAt: now() }).where(eq(subscriptionPurchases.id, id));
    },
  };
}

let override: PurchaseStore | null = null;

export function setPurchaseStoreForTests(store: PurchaseStore | null): void {
  override = store;
}

export function purchaseStore(): PurchaseStore {
  return override ?? createDrizzlePurchaseStore();
}
