import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';

import { getDb } from '../../db';
import { academicFields, grades, studentProfiles, subjects, users } from '../../db/schema';

export type StudentRecord = {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  gradeName: string | null;
  fieldName: string | null;
  onboardingCompleted: boolean;
};

export type GradeRecord = { id: string; name: string; slug: string; sortOrder: number; isActive: boolean };

export type FieldRecord = {
  id: string;
  gradeId: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  gradeName: string;
};

export type SubjectRecord = {
  id: string;
  gradeId: string;
  academicFieldId: string | null;
  name: string;
  slug: string;
  shortDescription: string | null;
  image: string | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  monthlyPriceMinor: number | null;
  semesterPriceMinor: number | null;
  currency: string;
  gradeName: string;
  fieldName: string | null;
};

export type MutationResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'duplicate' | 'missing' | 'in_use' | 'invalid_grade' | 'invalid_field' };

export type GradeInput = { name: string; slug: string; sortOrder: number; isActive: boolean };
export type FieldInput = { gradeId: string; name: string; slug: string; sortOrder: number; isActive: boolean };
export type SubjectInput = {
  gradeId: string;
  academicFieldId: string | null;
  name: string;
  slug: string;
  shortDescription: string | null;
  image: string | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
  monthlyPriceMinor: number | null;
  semesterPriceMinor: number | null;
  currency: string;
};

export type GradeReferences = { fields: number; subjects: number; profiles: number };

export type AdminStore = {
  countStudents(): Promise<number>;
  listStudents(limit: number, search?: string | null): Promise<StudentRecord[]>;
  countGrades(): Promise<number>;
  countSubjects(): Promise<{ total: number; active: number }>;
  listGrades(): Promise<GradeRecord[]>;
  findGrade(id: string): Promise<GradeRecord | null>;
  createGrade(input: GradeInput): Promise<MutationResult>;
  updateGrade(id: string, input: GradeInput): Promise<MutationResult>;
  deleteGrade(id: string): Promise<MutationResult>;
  countGradeReferences(id: string): Promise<GradeReferences>;
  listFields(): Promise<FieldRecord[]>;
  findField(id: string): Promise<FieldRecord | null>;
  createField(input: FieldInput): Promise<MutationResult>;
  updateField(id: string, input: FieldInput): Promise<MutationResult>;
  listSubjects(): Promise<SubjectRecord[]>;
  findSubject(id: string): Promise<SubjectRecord | null>;
  createSubject(input: SubjectInput): Promise<MutationResult>;
  updateSubject(id: string, input: SubjectInput): Promise<MutationResult>;
};

function errorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === 'object' && 'code' in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    current = typeof current === 'object' && 'cause' in current ? (current as { cause?: unknown }).cause : null;
  }
  return null;
}

const gradeColumns = {
  id: grades.id,
  name: grades.name,
  slug: grades.slug,
  sortOrder: grades.sortOrder,
  isActive: grades.isActive,
};

const fieldColumns = {
  id: academicFields.id,
  gradeId: academicFields.gradeId,
  name: academicFields.name,
  slug: academicFields.slug,
  sortOrder: academicFields.sortOrder,
  isActive: academicFields.isActive,
  gradeName: grades.name,
};

const subjectColumns = {
  id: subjects.id,
  gradeId: subjects.gradeId,
  academicFieldId: subjects.academicFieldId,
  name: subjects.name,
  slug: subjects.slug,
  shortDescription: subjects.shortDescription,
  image: subjects.image,
  isActive: subjects.isActive,
  isFeatured: subjects.isFeatured,
  sortOrder: subjects.sortOrder,
  monthlyPriceMinor: subjects.monthlyPriceMinor,
  semesterPriceMinor: subjects.semesterPriceMinor,
  currency: subjects.currency,
  gradeName: grades.name,
  fieldName: academicFields.name,
};

function createDrizzleAdminStore(): AdminStore {
  const db = () => getDb();
  const now = () => new Date();

  return {
    async countStudents() {
      const [row] = await db().select({ value: count() }).from(users).where(eq(users.role, 'STUDENT'));
      return Number(row?.value ?? 0);
    },

    // Read-only student roster for the admin dashboard. Progress and lesson
    // history are never exposed here — only account-level facts.
    async listStudents(limit, search) {
      const needle = search?.trim();
      const base = db()
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          createdAt: users.createdAt,
          gradeName: grades.name,
          fieldName: academicFields.name,
          onboardingCompleted: studentProfiles.onboardingCompleted,
        })
        .from(users)
        .leftJoin(studentProfiles, eq(studentProfiles.userId, users.id))
        .leftJoin(grades, eq(grades.id, studentProfiles.gradeId))
        .leftJoin(academicFields, eq(academicFields.id, studentProfiles.academicFieldId))
        .where(needle ? and(eq(users.role, 'STUDENT'), or(ilike(users.email, `%${needle}%`), ilike(users.name, `%${needle}%`))) : eq(users.role, 'STUDENT'))
        .orderBy(desc(users.createdAt))
        .limit(limit);
      const rows = await base;
      return rows.map((row) => ({ ...row, onboardingCompleted: row.onboardingCompleted ?? false }));
    },

    async countGrades() {
      const [row] = await db().select({ value: count() }).from(grades);
      return Number(row?.value ?? 0);
    },

    async countSubjects() {
      const rows = await db().select({ isActive: subjects.isActive, value: count() }).from(subjects).groupBy(subjects.isActive);
      const total = rows.reduce((sum, row) => sum + Number(row.value), 0);
      const active = Number(rows.find((row) => row.isActive)?.value ?? 0);
      return { total, active };
    },

    async listGrades() {
      return db().select(gradeColumns).from(grades).orderBy(asc(grades.sortOrder), asc(grades.name));
    },

    async findGrade(id) {
      const [row] = await db().select(gradeColumns).from(grades).where(eq(grades.id, id)).limit(1);
      return row ?? null;
    },

    async createGrade(input) {
      try {
        const [row] = await db()
          .insert(grades)
          .values({ id: crypto.randomUUID(), ...input, createdAt: now(), updatedAt: now() })
          .returning({ id: grades.id });
        return { ok: true, id: row.id };
      } catch (error) {
        if (errorCode(error) === '23505') return { ok: false, reason: 'duplicate' };
        throw error;
      }
    },

    async updateGrade(id, input) {
      try {
        const [row] = await db()
          .update(grades)
          .set({ ...input, updatedAt: now() })
          .where(eq(grades.id, id))
          .returning({ id: grades.id });
        return row ? { ok: true, id: row.id } : { ok: false, reason: 'missing' };
      } catch (error) {
        if (errorCode(error) === '23505') return { ok: false, reason: 'duplicate' };
        throw error;
      }
    },

    async deleteGrade(id) {
      const [row] = await db().delete(grades).where(eq(grades.id, id)).returning({ id: grades.id });
      return row ? { ok: true, id: row.id } : { ok: false, reason: 'missing' };
    },

    async countGradeReferences(id) {
      const [fieldsRow, subjectsRow, profilesRow] = await Promise.all([
        db().select({ value: count() }).from(academicFields).where(eq(academicFields.gradeId, id)),
        db().select({ value: count() }).from(subjects).where(eq(subjects.gradeId, id)),
        db().select({ value: count() }).from(studentProfiles).where(eq(studentProfiles.gradeId, id)),
      ]);
      return {
        fields: Number(fieldsRow[0]?.value ?? 0),
        subjects: Number(subjectsRow[0]?.value ?? 0),
        profiles: Number(profilesRow[0]?.value ?? 0),
      };
    },

    async listFields() {
      return db()
        .select(fieldColumns)
        .from(academicFields)
        .innerJoin(grades, eq(academicFields.gradeId, grades.id))
        .orderBy(asc(grades.sortOrder), asc(academicFields.sortOrder), asc(academicFields.name));
    },

    async findField(id) {
      const [row] = await db()
        .select(fieldColumns)
        .from(academicFields)
        .innerJoin(grades, eq(academicFields.gradeId, grades.id))
        .where(eq(academicFields.id, id))
        .limit(1);
      return row ?? null;
    },

    async createField(input) {
      try {
        const [row] = await db()
          .insert(academicFields)
          .values({ id: crypto.randomUUID(), ...input })
          .returning({ id: academicFields.id });
        return { ok: true, id: row.id };
      } catch (error) {
        if (errorCode(error) === '23505') return { ok: false, reason: 'duplicate' };
        if (errorCode(error) === '23503') return { ok: false, reason: 'missing' };
        throw error;
      }
    },

    async updateField(id, input) {
      try {
        const [row] = await db()
          .update(academicFields)
          .set(input)
          .where(eq(academicFields.id, id))
          .returning({ id: academicFields.id });
        return row ? { ok: true, id: row.id } : { ok: false, reason: 'missing' };
      } catch (error) {
        if (errorCode(error) === '23505') return { ok: false, reason: 'duplicate' };
        if (errorCode(error) === '23503') return { ok: false, reason: 'missing' };
        throw error;
      }
    },

    async listSubjects() {
      return db()
        .select(subjectColumns)
        .from(subjects)
        .innerJoin(grades, eq(subjects.gradeId, grades.id))
        .leftJoin(academicFields, eq(subjects.academicFieldId, academicFields.id))
        .orderBy(asc(grades.sortOrder), asc(subjects.sortOrder), asc(subjects.name));
    },

    async findSubject(id) {
      const [row] = await db()
        .select(subjectColumns)
        .from(subjects)
        .innerJoin(grades, eq(subjects.gradeId, grades.id))
        .leftJoin(academicFields, eq(subjects.academicFieldId, academicFields.id))
        .where(eq(subjects.id, id))
        .limit(1);
      return row ?? null;
    },

    async createSubject(input) {
      try {
        const [row] = await db()
          .insert(subjects)
          .values({ id: crypto.randomUUID(), ...input, createdAt: now(), updatedAt: now() })
          .returning({ id: subjects.id });
        return { ok: true, id: row.id };
      } catch (error) {
        if (errorCode(error) === '23505') return { ok: false, reason: 'duplicate' };
        if (errorCode(error) === '23503') return { ok: false, reason: 'missing' };
        throw error;
      }
    },

    async updateSubject(id, input) {
      try {
        const [row] = await db()
          .update(subjects)
          .set({ ...input, updatedAt: now() })
          .where(eq(subjects.id, id))
          .returning({ id: subjects.id });
        return row ? { ok: true, id: row.id } : { ok: false, reason: 'missing' };
      } catch (error) {
        if (errorCode(error) === '23505') return { ok: false, reason: 'duplicate' };
        if (errorCode(error) === '23503') return { ok: false, reason: 'missing' };
        throw error;
      }
    },
  };
}

let override: AdminStore | null = null;

export function setAdminStoreForTests(store: AdminStore | null): void {
  override = store;
}

export function adminStore(): AdminStore {
  return override ?? createDrizzleAdminStore();
}
