import { loginPathFor } from '../auth/urls';
import type { AuthUser } from '../auth/store';
import type { CatalogSubject, StudentProfile, StudentStore } from './store';
import type { AcademicField } from './store';

export type OnboardingInput = {
  gradeId: string;
  academicFieldId: string | null;
};

export type OnboardingFailure = 'invalid_grade' | 'invalid_field' | 'field_required';

export type OnboardingResult = { ok: true; profile: StudentProfile } | { ok: false; reason: OnboardingFailure };

// Only grade and field are ever read from the browser; identity and role stay
// server-side.
export function parseOnboardingForm(form: FormData): OnboardingInput {
  const grade = form.get('gradeId');
  const field = form.get('academicFieldId');
  return {
    gradeId: typeof grade === 'string' ? grade.trim() : '',
    academicFieldId: typeof field === 'string' && field.trim() ? field.trim() : null,
  };
}

export async function completeOnboarding(
  store: StudentStore,
  userId: string,
  input: OnboardingInput,
): Promise<OnboardingResult> {
  if (!input.gradeId) return { ok: false, reason: 'invalid_grade' };
  const grade = await store.findGradeById(input.gradeId);
  if (!grade || !grade.isActive) return { ok: false, reason: 'invalid_grade' };

  const activeFields = await store.listActiveFieldsForGrade(grade.id);
  let academicFieldId: string | null = null;
  if (activeFields.length > 0) {
    if (!input.academicFieldId) return { ok: false, reason: 'field_required' };
    const field = activeFields.find((candidate) => candidate.id === input.academicFieldId);
    if (!field) return { ok: false, reason: 'invalid_field' };
    academicFieldId = field.id;
  } else if (input.academicFieldId) {
    // A field was submitted for a grade that has none: never trust it.
    return { ok: false, reason: 'invalid_field' };
  }

  const profile: StudentProfile = {
    userId,
    gradeId: grade.id,
    academicFieldId,
    onboardingCompleted: true,
  };
  await store.upsertProfile(profile);
  return { ok: true, profile };
}

export function isOnboarded(profile: StudentProfile | null): boolean {
  return Boolean(profile?.onboardingCompleted);
}

export type StudentAccess =
  | { kind: 'login'; loginPath: string }
  | { kind: 'onboarding' }
  | { kind: 'ready'; profile: StudentProfile };

export function studentAccessFor(user: AuthUser | null, profile: StudentProfile | null, returnTo: string): StudentAccess {
  if (!user) return { kind: 'login', loginPath: loginPathFor(returnTo) };
  if (!isOnboarded(profile) || profile === null) return { kind: 'onboarding' };
  return { kind: 'ready', profile };
}

export function subjectAppliesTo(
  subject: CatalogSubject,
  gradeId: string,
  academicFieldId: string | null,
): boolean {
  if (!subject.isActive || subject.gradeId !== gradeId) return false;
  if (subject.academicFieldId === null) return true;
  return academicFieldId !== null && subject.academicFieldId === academicFieldId;
}

export function visibleSubjectFor(
  profile: StudentProfile,
  subject: CatalogSubject | null,
): CatalogSubject | null {
  if (!subject || !subjectAppliesTo(subject, profile.gradeId, profile.academicFieldId)) return null;
  return subject;
}

export function subjectsFor(
  catalog: readonly CatalogSubject[],
  gradeId: string,
  academicFieldId: string | null,
): CatalogSubject[] {
  return catalog.filter((subject) => subjectAppliesTo(subject, gradeId, academicFieldId));
}

export function fieldNameFor(fields: readonly AcademicField[], academicFieldId: string | null): string | null {
  if (!academicFieldId) return null;
  return fields.find((field) => field.id === academicFieldId)?.name ?? null;
}
