import {test} from 'node:test';
import assert from 'node:assert/strict';

import type {AuthUser} from '../lib/auth/store';
import {
 completeOnboarding,
 isOnboarded,
 parseOnboardingForm,
 studentAccessFor,
 subjectAppliesTo,
 subjectsFor,
 visibleSubjectFor,
 type OnboardingInput,
} from '../lib/student/onboarding';
import type {AcademicField, CatalogSubject, Grade, StudentProfile, StudentStore} from '../lib/student/store';

const subject = (overrides: Partial<CatalogSubject> & {id: string}): CatalogSubject => ({
 gradeId: 'g12',
 academicFieldId: null,
 name: overrides.id,
 slug: overrides.id,
 shortDescription: null,
 image: null,
 isActive: true,
 isFeatured: false,
 sortOrder: 0,
 ...overrides,
});

function createStudentFixture() {
 const grades: Grade[] = [
  {id: 'g11', name: 'الصف الحادي عشر', slug: 'grade-11', isActive: true},
  {id: 'g12', name: 'الصف الثاني عشر (توجيهي)', slug: 'tawjihi', isActive: true},
  {id: 'g-old', name: 'صف موقوف', slug: 'inactive-grade', isActive: false},
 ];
 const fields: AcademicField[] = [
  {id: 'f-sci', gradeId: 'g12', name: 'الحقل العلمي والتكنولوجي', slug: 'scientific', isActive: true},
  {id: 'f-med', gradeId: 'g12', name: 'الحقل الطبي', slug: 'medical', isActive: true},
  {id: 'f-off', gradeId: 'g12', name: 'حقل موقوف', slug: 'off', isActive: false},
  {id: 'f-other', gradeId: 'g-old', name: 'حقل صف آخر', slug: 'other', isActive: true},
 ];
 const catalog: CatalogSubject[] = [
  subject({id: 's-both', gradeId: 'g12', academicFieldId: null}),
  subject({id: 's-sci', gradeId: 'g12', academicFieldId: 'f-sci'}),
  subject({id: 's-med', gradeId: 'g12', academicFieldId: 'f-med'}),
  subject({id: 's-11', gradeId: 'g11'}),
  subject({id: 's-off', gradeId: 'g12', isActive: false}),
 ];
 const profiles = new Map<string, StudentProfile>();
 const store: StudentStore = {
  async listActiveGrades() { return grades.filter(grade => grade.isActive); },
  async findGradeById(id) { return grades.find(grade => grade.id === id) ?? null; },
  async listActiveFields() { return fields.filter(field => field.isActive); },
  async listActiveFieldsForGrade(gradeId) { return fields.filter(field => field.gradeId === gradeId && field.isActive); },
  async findFieldById(id) { return fields.find(field => field.id === id) ?? null; },
  async getProfile(userId) { return profiles.get(userId) ?? null; },
  async upsertProfile(profile) { profiles.set(profile.userId, {...profile}); },
  async listSubjectsForStudent(gradeId, academicFieldId) { return subjectsFor(catalog, gradeId, academicFieldId); },
  async listActiveSubjectsForGrade(gradeId) { return catalog.filter(item => item.isActive && item.gradeId === gradeId); },
  async findSubjectBySlug(slug) { return catalog.find(item => item.slug === slug) ?? null; },
  async findSubjectById(id) { return catalog.find(item => item.id === id) ?? null; },
 };
 return {store, profiles, catalog, grades, fields};
}

const student: AuthUser = {id: 'student-1', email: 'student@example.com', name: 'سالم الطالب', image: null, role: 'STUDENT'};
const otherProfile: StudentProfile = {userId: 'student-2', gradeId: 'g12', academicFieldId: 'f-med', onboardingCompleted: true};

test('student access decides login, onboarding and ready states', () => {
 const anonymous = studentAccessFor(null, null, '/app/subjects');
 assert.equal(anonymous.kind, 'login');
 assert.equal(anonymous.kind === 'login' ? anonymous.loginPath : '', '/login?returnTo=%2Fapp%2Fsubjects');

 assert.equal(studentAccessFor(student, null, '/app').kind, 'onboarding');
 assert.equal(studentAccessFor(student, {...otherProfile, userId: student.id, onboardingCompleted: false}, '/app').kind, 'onboarding');

 const ready = studentAccessFor(student, {...otherProfile, userId: student.id}, '/app');
 assert.equal(ready.kind, 'ready');
 assert.equal(ready.kind === 'ready' ? ready.profile.gradeId : '', 'g12');
});

test('onboarding form parsing ignores untrusted identity and role fields', () => {
 const form = new FormData();
 form.set('gradeId', ' g12 ');
 form.set('academicFieldId', '');
 form.set('userId', 'victim-user');
 form.set('role', 'ADMIN');
 const input = parseOnboardingForm(form);
 assert.deepEqual(input, {gradeId: 'g12', academicFieldId: null});
 assert.equal('userId' in input, false);
 assert.equal('role' in input, false);
});

test('onboarding accepts a valid grade without fields and marks the profile complete', async () => {
 const {store, profiles} = createStudentFixture();
 const result = await completeOnboarding(store, student.id, {gradeId: 'g11', academicFieldId: null});
 assert.equal(result.ok, true);
 const profile = profiles.get(student.id);
 assert.equal(profile?.onboardingCompleted, true);
 assert.equal(profile?.gradeId, 'g11');
 assert.equal(profile?.academicFieldId, null);
 assert.equal(isOnboarded(profile ?? null), true);
});

test('onboarding rejects unknown and inactive grades', async () => {
 const {store} = createStudentFixture();
 assert.deepEqual(await completeOnboarding(store, student.id, {gradeId: 'missing', academicFieldId: null}), {ok: false, reason: 'invalid_grade'});
 assert.deepEqual(await completeOnboarding(store, student.id, {gradeId: 'g-old', academicFieldId: null}), {ok: false, reason: 'invalid_grade'});
 assert.deepEqual(await completeOnboarding(store, student.id, {gradeId: '', academicFieldId: null}), {ok: false, reason: 'invalid_grade'});
});

test('onboarding requires a field when the grade has fields and validates membership', async () => {
 const {store} = createStudentFixture();
 const base: OnboardingInput = {gradeId: 'g12', academicFieldId: null};
 assert.deepEqual(await completeOnboarding(store, student.id, base), {ok: false, reason: 'field_required'});
 assert.deepEqual(await completeOnboarding(store, student.id, {gradeId: 'g12', academicFieldId: 'f-off'}), {ok: false, reason: 'invalid_field'});
 assert.deepEqual(await completeOnboarding(store, student.id, {gradeId: 'g12', academicFieldId: 'f-other'}), {ok: false, reason: 'invalid_field'});
 assert.deepEqual(await completeOnboarding(store, student.id, {gradeId: 'g12', academicFieldId: 'missing'}), {ok: false, reason: 'invalid_field'});
});

test('onboarding rejects a field submitted for a grade that has no fields', async () => {
 const {store} = createStudentFixture();
 assert.deepEqual(await completeOnboarding(store, student.id, {gradeId: 'g11', academicFieldId: 'f-sci'}), {ok: false, reason: 'invalid_field'});
});

test('onboarding writes only the authenticated student profile and never another student', async () => {
 const {store, profiles} = createStudentFixture();
 profiles.set('student-2', {...otherProfile});
 const form = new FormData();
 form.set('gradeId', 'g12');
 form.set('academicFieldId', 'f-sci');
 form.set('userId', 'student-2');
 const input = parseOnboardingForm(form);

 const result = await completeOnboarding(store, 'student-1', input);
 assert.equal(result.ok, true);
 assert.equal(profiles.get('student-1')?.academicFieldId, 'f-sci');
 assert.equal(profiles.get('student-2')?.academicFieldId, 'f-med');

 const repeat = await completeOnboarding(store, 'student-1', {gradeId: 'g12', academicFieldId: 'f-med'});
 assert.equal(repeat.ok, true);
 assert.equal(profiles.get('student-1')?.academicFieldId, 'f-med');
 assert.equal(profiles.get('student-2')?.academicFieldId, 'f-med');
});

test('subject visibility follows grade, field and active flags', () => {
 assert.equal(subjectAppliesTo(subject({id: 'x', gradeId: 'g12', academicFieldId: null}), 'g12', 'f-sci'), true);
 assert.equal(subjectAppliesTo(subject({id: 'x', gradeId: 'g12', academicFieldId: null}), 'g12', null), true);
 assert.equal(subjectAppliesTo(subject({id: 'x', gradeId: 'g12', academicFieldId: 'f-sci'}), 'g12', 'f-sci'), true);
 assert.equal(subjectAppliesTo(subject({id: 'x', gradeId: 'g12', academicFieldId: 'f-med'}), 'g12', 'f-sci'), false);
 assert.equal(subjectAppliesTo(subject({id: 'x', gradeId: 'g12', academicFieldId: 'f-sci'}), 'g12', null), false);
 assert.equal(subjectAppliesTo(subject({id: 'x', gradeId: 'g11'}), 'g12', null), false);
 assert.equal(subjectAppliesTo(subject({id: 'x', gradeId: 'g12', isActive: false}), 'g12', null), false);
});

test('subject filtering returns only subjects for the student grade and field', () => {
 const {catalog} = createStudentFixture();
 assert.deepEqual(subjectsFor(catalog, 'g12', 'f-sci').map(item => item.id), ['s-both', 's-sci']);
 assert.deepEqual(subjectsFor(catalog, 'g12', 'f-med').map(item => item.id), ['s-both', 's-med']);
 assert.deepEqual(subjectsFor(catalog, 'g12', null).map(item => item.id), ['s-both']);
 assert.deepEqual(subjectsFor(catalog, 'g11', null).map(item => item.id), ['s-11']);
 assert.deepEqual(subjectsFor(catalog, 'g11', 'f-sci').map(item => item.id), ['s-11']);
 assert.deepEqual(subjectsFor(catalog, 'g-old', null), []);
});

test('visibleSubjectFor hides inactive and out-of-scope subjects', () => {
 const profile: StudentProfile = {userId: 'student-1', gradeId: 'g12', academicFieldId: 'f-sci', onboardingCompleted: true};
 assert.equal(visibleSubjectFor(profile, subject({id: 'ok', gradeId: 'g12', academicFieldId: 'f-sci'}))?.id, 'ok');
 assert.equal(visibleSubjectFor(profile, subject({id: 'other-field', gradeId: 'g12', academicFieldId: 'f-med'})), null);
 assert.equal(visibleSubjectFor(profile, subject({id: 'inactive', gradeId: 'g12', isActive: false})), null);
 assert.equal(visibleSubjectFor(profile, subject({id: 'other-grade', gradeId: 'g11'})), null);
 assert.equal(visibleSubjectFor(profile, null), null);
});
