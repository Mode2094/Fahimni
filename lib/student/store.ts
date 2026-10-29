import { and, asc, eq, isNull, or } from 'drizzle-orm';

import { getDb } from '../../db';
import { academicFields, grades, studentProfiles, subjects } from '../../db/schema';

export type Grade = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

export type AcademicField = {
  id: string;
  gradeId: string;
  name: string;
  slug: string;
  isActive: boolean;
};

export type CatalogSubject = {
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
};

export type StudentProfile = {
  userId: string;
  gradeId: string;
  academicFieldId: string | null;
  onboardingCompleted: boolean;
};

export type StudentStore = {
  listActiveGrades(): Promise<Grade[]>;
  findGradeById(id: string): Promise<Grade | null>;
  listActiveFields(): Promise<AcademicField[]>;
  listActiveFieldsForGrade(gradeId: string): Promise<AcademicField[]>;
  findFieldById(id: string): Promise<AcademicField | null>;
  getProfile(userId: string): Promise<StudentProfile | null>;
  upsertProfile(profile: StudentProfile): Promise<void>;
  listSubjectsForStudent(gradeId: string, academicFieldId: string | null): Promise<CatalogSubject[]>;
  listActiveSubjectsForGrade(gradeId: string): Promise<CatalogSubject[]>;
  findSubjectBySlug(slug: string): Promise<CatalogSubject | null>;
  findSubjectById(id: string): Promise<CatalogSubject | null>;
};

const gradeColumns = { id: grades.id, name: grades.name, slug: grades.slug, isActive: grades.isActive };
const fieldColumns = {
  id: academicFields.id,
  gradeId: academicFields.gradeId,
  name: academicFields.name,
  slug: academicFields.slug,
  isActive: academicFields.isActive,
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
};

function createDrizzleStudentStore(): StudentStore {
  return {
    async listActiveGrades() {
      return getDb()
        .select(gradeColumns)
        .from(grades)
        .where(eq(grades.isActive, true))
        .orderBy(asc(grades.sortOrder), asc(grades.name));
    },

    async findGradeById(id) {
      const [row] = await getDb().select(gradeColumns).from(grades).where(eq(grades.id, id)).limit(1);
      return row ?? null;
    },

    async listActiveFields() {
      return getDb()
        .select(fieldColumns)
        .from(academicFields)
        .where(eq(academicFields.isActive, true))
        .orderBy(asc(academicFields.sortOrder), asc(academicFields.name));
    },

    async listActiveFieldsForGrade(gradeId) {
      return getDb()
        .select(fieldColumns)
        .from(academicFields)
        .where(and(eq(academicFields.gradeId, gradeId), eq(academicFields.isActive, true)))
        .orderBy(asc(academicFields.sortOrder), asc(academicFields.name));
    },

    async findFieldById(id) {
      const [row] = await getDb().select(fieldColumns).from(academicFields).where(eq(academicFields.id, id)).limit(1);
      return row ?? null;
    },

    async getProfile(userId) {
      const [row] = await getDb()
        .select({
          userId: studentProfiles.userId,
          gradeId: studentProfiles.gradeId,
          academicFieldId: studentProfiles.academicFieldId,
          onboardingCompleted: studentProfiles.onboardingCompleted,
        })
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, userId))
        .limit(1);
      return row ?? null;
    },

    async upsertProfile(profile) {
      const now = new Date();
      await getDb()
        .insert(studentProfiles)
        .values({ ...profile, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: studentProfiles.userId,
          set: {
            gradeId: profile.gradeId,
            academicFieldId: profile.academicFieldId,
            onboardingCompleted: profile.onboardingCompleted,
            updatedAt: now,
          },
        });
    },

    async listSubjectsForStudent(gradeId, academicFieldId) {
      // Subjects without a field apply to the whole grade; a student with no
      // field only sees those.
      const visibility =
        academicFieldId === null
          ? isNull(subjects.academicFieldId)
          : or(isNull(subjects.academicFieldId), eq(subjects.academicFieldId, academicFieldId));
      return getDb()
        .select(subjectColumns)
        .from(subjects)
        .where(and(eq(subjects.gradeId, gradeId), eq(subjects.isActive, true), visibility))
        .orderBy(asc(subjects.sortOrder), asc(subjects.name));
    },

    async listActiveSubjectsForGrade(gradeId) {
      return getDb()
        .select(subjectColumns)
        .from(subjects)
        .where(and(eq(subjects.gradeId, gradeId), eq(subjects.isActive, true)))
        .orderBy(asc(subjects.sortOrder), asc(subjects.name));
    },

    async findSubjectBySlug(slug) {
      const [row] = await getDb().select(subjectColumns).from(subjects).where(eq(subjects.slug, slug)).limit(1);
      return row ?? null;
    },

    async findSubjectById(id) {
      const [row] = await getDb().select(subjectColumns).from(subjects).where(eq(subjects.id, id)).limit(1);
      return row ?? null;
    },
  };
}

let override: StudentStore | null = null;

export function setStudentStoreForTests(store: StudentStore | null): void {
  override = store;
}

export function studentStore(): StudentStore {
  return override ?? createDrizzleStudentStore();
}
