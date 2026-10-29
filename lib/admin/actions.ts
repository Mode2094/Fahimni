import type {
  AdminStore,
  FieldInput,
  GradeInput,
  MutationResult,
  SubjectInput,
} from './store';

// Field and subject writes re-validate their relationships server-side so an
// invalid grade/field pairing can never reach the database.
export async function createGrade(store: AdminStore, input: GradeInput): Promise<MutationResult> {
  return store.createGrade(input);
}

export async function updateGrade(store: AdminStore, id: string, input: GradeInput): Promise<MutationResult> {
  const existing = await store.findGrade(id);
  if (!existing) return { ok: false, reason: 'missing' };
  return store.updateGrade(id, input);
}

export async function deleteGrade(store: AdminStore, id: string): Promise<MutationResult> {
  const existing = await store.findGrade(id);
  if (!existing) return { ok: false, reason: 'missing' };
  const references = await store.countGradeReferences(id);
  if (references.fields > 0 || references.subjects > 0 || references.profiles > 0) {
    return { ok: false, reason: 'in_use' };
  }
  return store.deleteGrade(id);
}

export async function createField(store: AdminStore, input: FieldInput): Promise<MutationResult> {
  const grade = await store.findGrade(input.gradeId);
  if (!grade) return { ok: false, reason: 'invalid_grade' };
  return store.createField(input);
}

export async function updateField(store: AdminStore, id: string, input: FieldInput): Promise<MutationResult> {
  const existing = await store.findField(id);
  if (!existing) return { ok: false, reason: 'missing' };
  const grade = await store.findGrade(input.gradeId);
  if (!grade) return { ok: false, reason: 'invalid_grade' };
  return store.updateField(id, input);
}

export async function createSubject(store: AdminStore, input: SubjectInput): Promise<MutationResult> {
  const grade = await store.findGrade(input.gradeId);
  if (!grade) return { ok: false, reason: 'invalid_grade' };
  if (input.academicFieldId) {
    const field = await store.findField(input.academicFieldId);
    if (!field || field.gradeId !== input.gradeId) return { ok: false, reason: 'invalid_field' };
  }
  return store.createSubject(input);
}

export async function updateSubject(store: AdminStore, id: string, input: SubjectInput): Promise<MutationResult> {
  const existing = await store.findSubject(id);
  if (!existing) return { ok: false, reason: 'missing' };
  const grade = await store.findGrade(input.gradeId);
  if (!grade) return { ok: false, reason: 'invalid_grade' };
  if (input.academicFieldId) {
    const field = await store.findField(input.academicFieldId);
    if (!field || field.gradeId !== input.gradeId) return { ok: false, reason: 'invalid_field' };
  }
  return store.updateSubject(id, input);
}

export async function toggleGradeActive(store: AdminStore, id: string): Promise<MutationResult> {
  const existing = await store.findGrade(id);
  if (!existing) return { ok: false, reason: 'missing' };
  return store.updateGrade(id, {
    name: existing.name,
    slug: existing.slug,
    sortOrder: existing.sortOrder,
    isActive: !existing.isActive,
  });
}

export async function toggleFieldActive(store: AdminStore, id: string): Promise<MutationResult> {
  const existing = await store.findField(id);
  if (!existing) return { ok: false, reason: 'missing' };
  return store.updateField(id, {
    gradeId: existing.gradeId,
    name: existing.name,
    slug: existing.slug,
    sortOrder: existing.sortOrder,
    isActive: !existing.isActive,
  });
}

function subjectToInput(subject: Awaited<ReturnType<AdminStore['findSubject']>>): SubjectInput | null {
  if (!subject) return null;
  return {
    gradeId: subject.gradeId,
    academicFieldId: subject.academicFieldId,
    name: subject.name,
    slug: subject.slug,
    shortDescription: subject.shortDescription,
    image: subject.image,
    isActive: subject.isActive,
    isFeatured: subject.isFeatured,
    sortOrder: subject.sortOrder,
    monthlyPriceMinor: subject.monthlyPriceMinor,
    semesterPriceMinor: subject.semesterPriceMinor,
    currency: subject.currency,
  };
}

export async function toggleSubjectActive(store: AdminStore, id: string): Promise<MutationResult> {
  const input = subjectToInput(await store.findSubject(id));
  if (!input) return { ok: false, reason: 'missing' };
  return store.updateSubject(id, { ...input, isActive: !input.isActive });
}

export async function toggleSubjectFeatured(store: AdminStore, id: string): Promise<MutationResult> {
  const input = subjectToInput(await store.findSubject(id));
  if (!input) return { ok: false, reason: 'missing' };
  return store.updateSubject(id, { ...input, isFeatured: !input.isFeatured });
}
