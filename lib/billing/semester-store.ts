import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';

import { getDb } from '../../db';
import { semesters, subscriptionPurchases, users } from '../../db/schema';
import { isValidTermWindow } from './terms';

export type SemesterStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'ARCHIVED';
export type LateEnrollmentPolicy = 'FULL_PRICE' | 'PRORATED';

export type SemesterRecord = {
  id: string;
  name: string;
  academicYear: string;
  gradeId: string;
  academicFieldId: string | null;
  startsAt: Date;
  endsAt: Date;
  salesStartAt: Date;
  salesEndAt: Date | null;
  priceMinor: number;
  currency: string;
  includedCredits: number;
  status: SemesterStatus;
  lateEnrollmentPolicy: LateEnrollmentPolicy;
  topUpEnabled: boolean;
  freemiusPlanId: string | null;
  adminNotes: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SemesterInput = Omit<SemesterRecord, 'createdAt' | 'updatedAt'>;
export type SemesterPatch = Partial<
  Pick<
    SemesterRecord,
    | 'name'
    | 'academicYear'
    | 'gradeId'
    | 'academicFieldId'
    | 'startsAt'
    | 'endsAt'
    | 'salesStartAt'
    | 'salesEndAt'
    | 'priceMinor'
    | 'currency'
    | 'includedCredits'
    | 'status'
    | 'lateEnrollmentPolicy'
    | 'topUpEnabled'
    | 'freemiusPlanId'
    | 'adminNotes'
  >
>;

export type SemesterSubscriberRow = {
  purchaseId: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  status: string;
  startsAt: Date;
  expiresAt: Date;
  priceMinor: number;
  currency: string;
  includedCredits: number;
  creditsGrantedAt: Date | null;
  createdAt: Date;
};

export type SemesterStore = {
  listSemesters(): Promise<SemesterRecord[]>;
  findSemesterById(id: string): Promise<SemesterRecord | null>;
  findSemesterByFreemiusPlanId(planId: string): Promise<SemesterRecord | null>;
  createSemester(input: SemesterInput): Promise<SemesterRecord>;
  updateSemester(id: string, patch: SemesterPatch): Promise<void>;
  // The semester currently selling/published for a grade+track, or the nearest
  // upcoming one, used to find the single student-facing offer.
  findCurrentSemesterForScope(input: {
    gradeId: string;
    academicFieldId: string | null;
    now: Date;
  }): Promise<SemesterRecord | null>;
  // Detects overlapping non-archived semesters with the same grade/track scope
  // and an ACTIVE or SCHEDULED status (invalid conflicting calendars).
  findOverlapping(input: {
    gradeId: string;
    academicFieldId: string | null;
    startsAt: Date;
    endsAt: Date;
    excludeId?: string | null;
  }): Promise<SemesterRecord[]>;
  listSubscribers(semesterId: string): Promise<SemesterSubscriberRow[]>;
};

const columns = {
  id: semesters.id,
  name: semesters.name,
  academicYear: semesters.academicYear,
  gradeId: semesters.gradeId,
  academicFieldId: semesters.academicFieldId,
  startsAt: semesters.startsAt,
  endsAt: semesters.endsAt,
  salesStartAt: semesters.salesStartAt,
  salesEndAt: semesters.salesEndAt,
  priceMinor: semesters.priceMinor,
  currency: semesters.currency,
  includedCredits: semesters.includedCredits,
  status: semesters.status,
  lateEnrollmentPolicy: semesters.lateEnrollmentPolicy,
  topUpEnabled: semesters.topUpEnabled,
  freemiusPlanId: semesters.freemiusPlanId,
  adminNotes: semesters.adminNotes,
  createdBy: semesters.createdBy,
  createdAt: semesters.createdAt,
  updatedAt: semesters.updatedAt,
};

// Scope match: same grade and either the same specific track or the semester is
// grade-wide (academicFieldId null covers every track of that grade).
function scopeMatch(gradeId: string, academicFieldId: string | null) {
  const fieldMatch = academicFieldId
    ? or(eq(semesters.academicFieldId, academicFieldId), isNull(semesters.academicFieldId))
    : isNull(semesters.academicFieldId);
  return and(eq(semesters.gradeId, gradeId), fieldMatch);
}

function createDrizzleSemesterStore(): SemesterStore {
  const db = () => getDb();
  const now = () => new Date();

  return {
    async listSemesters() {
      return db().select(columns).from(semesters).orderBy(asc(semesters.startsAt));
    },

    async findSemesterById(id) {
      const [row] = await db().select(columns).from(semesters).where(eq(semesters.id, id)).limit(1);
      return row ?? null;
    },

    async findSemesterByFreemiusPlanId(planId) {
      const [row] = await db().select(columns).from(semesters).where(eq(semesters.freemiusPlanId, planId)).limit(1);
      return row ?? null;
    },

    async createSemester(input) {
      const stamp = now();
      const [row] = await db()
        .insert(semesters)
        .values({ ...input, createdAt: stamp, updatedAt: stamp })
        .returning(columns);
      return row;
    },

    async updateSemester(id, patch) {
      await db().update(semesters).set({ ...patch, updatedAt: now() }).where(eq(semesters.id, id));
    },

    // Prefer a semester whose sales window includes `now`; otherwise the nearest
    // upcoming one. Only SCHEDULED/ACTIVE semesters are offered to students.
    async findCurrentSemesterForScope({ gradeId, academicFieldId, now: at }) {
      const rows = await db()
        .select(columns)
        .from(semesters)
        .where(
          and(
            scopeMatch(gradeId, academicFieldId),
            inArray(semesters.status, ['SCHEDULED', 'ACTIVE']),
            lte(semesters.salesStartAt, at),
            or(isNull(semesters.salesEndAt), gte(semesters.salesEndAt, at)),
            // A semester that already ended is never sold.
            gte(semesters.endsAt, at),
          ),
        )
        .orderBy(asc(semesters.startsAt));
      if (rows.length) {
        // Prefer the ongoing semester over a future one.
        const ongoing = rows.find((row) => row.startsAt.getTime() <= at.getTime());
        return ongoing ?? rows[0];
      }
      // Fall back to the nearest upcoming published semester.
      const [upcoming] = await db()
        .select(columns)
        .from(semesters)
        .where(
          and(
            scopeMatch(gradeId, academicFieldId),
            inArray(semesters.status, ['SCHEDULED', 'ACTIVE']),
            gte(semesters.startsAt, at),
          ),
        )
        .orderBy(asc(semesters.startsAt))
        .limit(1);
      return upcoming ?? null;
    },

    async findOverlapping({ gradeId, academicFieldId, startsAt, endsAt, excludeId }) {
      const conditions = [
        scopeMatch(gradeId, academicFieldId),
        inArray(semesters.status, ['SCHEDULED', 'ACTIVE']),
        // Interval overlap: a.start < b.end AND a.end > b.start.
        lte(semesters.startsAt, endsAt),
        gte(semesters.endsAt, startsAt),
      ];
      if (excludeId) conditions.push(ne(semesters.id, excludeId));
      return db()
        .select(columns)
        .from(semesters)
        .where(and(...conditions));
    },

    async listSubscribers(semesterId) {
      const rows = await db()
        .select({
          purchaseId: subscriptionPurchases.id,
          userId: subscriptionPurchases.userId,
          userEmail: users.email,
          userName: users.name,
          status: subscriptionPurchases.status,
          startsAt: subscriptionPurchases.startsAt,
          expiresAt: subscriptionPurchases.expiresAt,
          priceMinor: subscriptionPurchases.priceMinor,
          currency: subscriptionPurchases.currency,
          includedCredits: subscriptionPurchases.includedCredits,
          creditsGrantedAt: subscriptionPurchases.creditsGrantedAt,
          createdAt: subscriptionPurchases.createdAt,
        })
        .from(subscriptionPurchases)
        .innerJoin(users, eq(users.id, subscriptionPurchases.userId))
        .where(eq(subscriptionPurchases.semesterId, semesterId))
        .orderBy(asc(subscriptionPurchases.createdAt));
      return rows;
    },
  };
}

// Pure validity helper shared by the admin API and tests.
export function isSellableSemester(semester: SemesterRecord, at = new Date()): boolean {
  if (semester.status !== 'SCHEDULED' && semester.status !== 'ACTIVE') return false;
  if (!isValidTermWindow(semester.startsAt, semester.endsAt)) return false;
  if (semester.salesStartAt.getTime() > at.getTime()) return false;
  if (semester.salesEndAt && semester.salesEndAt.getTime() < at.getTime()) return false;
  if (semester.endsAt.getTime() < at.getTime()) return false;
  return semester.priceMinor > 0 && semester.includedCredits >= 0;
}

let override: SemesterStore | null = null;

export function setSemesterStoreForTests(store: SemesterStore | null): void {
  override = store;
}

export function semesterStore(): SemesterStore {
  return override ?? createDrizzleSemesterStore();
}

export { sql };
