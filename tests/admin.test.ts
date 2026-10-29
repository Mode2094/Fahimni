import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'admin-test-secret';
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

import {
 createField,
 createGrade,
 createSubject,
 deleteGrade,
 updateGrade,
} from '../lib/admin/actions';
import {adminAccessFor} from '../lib/admin/guard';
import {formatMinor, formatMinorAmount, parseMoneyToMinor} from '../lib/admin/money';
import {gradeInputSchema, subjectInputSchema} from '../lib/admin/schemas';
import type {AdminStore, FieldRecord, GradeRecord, SubjectRecord} from '../lib/admin/store';
import {setAdminStoreForTests} from '../lib/admin/store';
import {hashSessionToken} from '../lib/auth/session';
import {setAuthStoreForTests} from '../lib/auth/store';
import type {AuthSession, AuthStore, AuthUser} from '../lib/auth/store';
import {POST as createGradeRoute} from '../app/api/admin/grades/route';
import {POST as gradeActionRoute} from '../app/api/admin/grades/[id]/route';
import {POST as createSubjectRoute} from '../app/api/admin/subjects/route';

const admin: AuthUser = {id: 'admin-1', email: 'admin@example.com', name: 'مشرف', image: null, role: 'ADMIN'};
const student: AuthUser = {id: 'student-1', email: 'student@example.com', name: 'طالب', image: null, role: 'STUDENT'};

function createFakeAdminStore() {
 const grades = new Map<string, GradeRecord>();
 const fields = new Map<string, FieldRecord>();
 const subjects = new Map<string, SubjectRecord>();
 const nextId = () => crypto.randomUUID();
 const gradeSlugTaken = (slug: string, skipId?: string) =>
  [...grades.values()].some((grade) => grade.slug === slug && grade.id !== skipId);
 const subjectSlugTaken = (slug: string, skipId?: string) =>
  [...subjects.values()].some((subject) => subject.slug === slug && subject.id !== skipId);
 const store: AdminStore = {
  async countStudents() { return 4; },
  async listStudents() { return []; },
  async countGrades() { return grades.size; },
  async countSubjects() { const all = [...subjects.values()]; return {total: all.length, active: all.filter(item => item.isActive).length}; },
  async listGrades() { return [...grades.values()]; },
  async findGrade(id) { return grades.get(id) ?? null; },
  async createGrade(input) {
   if (gradeSlugTaken(input.slug)) return {ok: false, reason: 'duplicate'};
   const row: GradeRecord = {id: nextId(), ...input};
   grades.set(row.id, row);
   return {ok: true, id: row.id};
  },
  async updateGrade(id, input) {
   const existing = grades.get(id);
   if (!existing) return {ok: false, reason: 'missing'};
   if (gradeSlugTaken(input.slug, id)) return {ok: false, reason: 'duplicate'};
   grades.set(id, {...existing, ...input});
   return {ok: true, id};
  },
  async deleteGrade(id) { return grades.delete(id) ? {ok: true, id} : {ok: false, reason: 'missing'}; },
  async countGradeReferences(id) {
   return {
    fields: [...fields.values()].filter(field => field.gradeId === id).length,
    subjects: [...subjects.values()].filter(subject => subject.gradeId === id).length,
    profiles: 0,
   };
  },
  async listFields() { return [...fields.values()]; },
  async findField(id) { return fields.get(id) ?? null; },
  async createField(input) {
   const grade = grades.get(input.gradeId);
   const duplicate = [...fields.values()].some(field => field.gradeId === input.gradeId && field.slug === input.slug);
   if (duplicate) return {ok: false, reason: 'duplicate'};
   const row: FieldRecord = {id: nextId(), ...input, gradeName: grade?.name ?? ''};
   fields.set(row.id, row);
   return {ok: true, id: row.id};
  },
  async updateField(id, input) {
   const existing = fields.get(id);
   if (!existing) return {ok: false, reason: 'missing'};
   const duplicate = [...fields.values()].some(field => field.id !== id && field.gradeId === input.gradeId && field.slug === input.slug);
   if (duplicate) return {ok: false, reason: 'duplicate'};
   const grade = grades.get(input.gradeId);
   fields.set(id, {...existing, ...input, gradeName: grade?.name ?? ''});
   return {ok: true, id};
  },
  async listSubjects() { return [...subjects.values()]; },
  async findSubject(id) { return subjects.get(id) ?? null; },
  async createSubject(input) {
   if (subjectSlugTaken(input.slug)) return {ok: false, reason: 'duplicate'};
   const row: SubjectRecord = {
    id: nextId(),
    ...input,
    gradeName: grades.get(input.gradeId)?.name ?? '',
    fieldName: input.academicFieldId ? fields.get(input.academicFieldId)?.name ?? null : null,
   };
   subjects.set(row.id, row);
   return {ok: true, id: row.id};
  },
  async updateSubject(id, input) {
   const existing = subjects.get(id);
   if (!existing) return {ok: false, reason: 'missing'};
   if (subjectSlugTaken(input.slug, id)) return {ok: false, reason: 'duplicate'};
   subjects.set(id, {
    ...existing,
    ...input,
    gradeName: grades.get(input.gradeId)?.name ?? '',
    fieldName: input.academicFieldId ? fields.get(input.academicFieldId)?.name ?? null : null,
   });
   return {ok: true, id};
  },
 };
 return {store, grades, fields, subjects};
}

async function installSession(user: AuthUser | null, token: string) {
 const sessionId = await hashSessionToken(token, 'admin-test-secret');
 const unused = async () => { throw new Error('not used'); };
 const authStore: AuthStore = {
  findUserByEmail: unused,
  findUserById: async (id) => (user && id === user.id ? user : null),
  insertUser: unused,
  promoteUser: unused,
  updateUserProfile: unused,
  linkAccount: unused,
  insertSession: unused,
  findSession: async (id): Promise<AuthSession | null> =>
   user && id === sessionId ? {id, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000)} : null,
  deleteSession: unused,
  deleteExpiredSessions: unused,
 };
 setAuthStoreForTests(authStore);
}

function adminPost(path: string, body: Record<string, string>, options: {token?: string; origin?: string} = {}) {
 const headers: Record<string, string> = {'content-type': 'application/x-www-form-urlencoded'};
 if (options.token) headers.cookie = `fahimni_session=${options.token}`;
 if (options.origin) headers.origin = options.origin;
 return new Request(`http://localhost${path}`, {method: 'POST', headers, body: new URLSearchParams(body)});
}

function reset() {
 setAdminStoreForTests(null);
 setAuthStoreForTests(null);
}

test('admin access is decided server-side: login, forbidden, ok', () => {
 assert.equal(adminAccessFor(null, '/admin').kind, 'login');
 assert.equal(adminAccessFor(student, '/admin').kind, 'forbidden');
 const allowed = adminAccessFor(admin, '/admin');
 assert.equal(allowed.kind, 'ok');
 assert.equal(allowed.kind === 'ok' ? allowed.user.role : '', 'ADMIN');
});

test('anonymous callers are redirected to login and STUDENT sessions get 403', async () => {
 const {store, grades} = createFakeAdminStore();
 setAdminStoreForTests(store);
 try {
  const anonymous = await createGradeRoute(adminPost('/api/admin/grades', {name: 'صف', slug: 'grade-x', sortOrder: '0'}));
  assert.equal(anonymous.status, 303);
  assert.match(anonymous.headers.get('location') ?? '', /\/login\?returnTo=%2Fadmin/);

  await installSession(student, 'student-token');
  const forbidden = await createGradeRoute(adminPost('/api/admin/grades', {name: 'صف', slug: 'grade-x', sortOrder: '0'}, {token: 'student-token'}));
  assert.equal(forbidden.status, 403);
  assert.equal(grades.size, 0);
 } finally {
  reset();
 }
});

test('cross-origin admin writes are rejected before any store access', async () => {
 const {store, grades} = createFakeAdminStore();
 setAdminStoreForTests(store);
 await installSession(admin, 'admin-token');
 try {
  const response = await createGradeRoute(adminPost('/api/admin/grades', {name: 'صف', slug: 'grade-x', sortOrder: '0'}, {token: 'admin-token', origin: 'https://evil.example'}));
  assert.equal(response.status, 403);
  assert.equal(grades.size, 0);
 } finally {
  reset();
 }
});

test('ADMIN creates and edits a grade through the API with safe redirects', async () => {
 const {store, grades} = createFakeAdminStore();
 setAdminStoreForTests(store);
 await installSession(admin, 'admin-token');
 try {
  const created = await createGradeRoute(adminPost('/api/admin/grades', {name: 'الصف العاشر', slug: 'grade-10', sortOrder: '3', isActive: 'on'}, {token: 'admin-token'}));
  assert.equal(created.status, 303);
  assert.match(created.headers.get('location') ?? '', /\/admin\/grades\?status=created/);
  const grade = [...grades.values()][0];
  assert.equal(grade.name, 'الصف العاشر');
  assert.equal(grade.isActive, true);

  const duplicate = await createGradeRoute(adminPost('/api/admin/grades', {name: 'صف آخر', slug: 'grade-10', sortOrder: '4'}, {token: 'admin-token'}));
  assert.match(duplicate.headers.get('location') ?? '', /error=duplicate/);

  const invalid = await createGradeRoute(adminPost('/api/admin/grades', {name: 'ص', slug: 'Bad Slug', sortOrder: '-1'}, {token: 'admin-token'}));
  assert.match(invalid.headers.get('location') ?? '', /error=invalid/);

  const updated = await gradeActionRoute(adminPost(`/api/admin/grades/${grade.id}`, {name: 'الصف العاشر الجديد', slug: 'grade-10', sortOrder: '5', isActive: 'on'}, {token: 'admin-token'}), {params: Promise.resolve({id: grade.id})});
  assert.match(updated.headers.get('location') ?? '', /status=updated/);
  assert.equal(grades.get(grade.id)?.name, 'الصف العاشر الجديد');
  assert.equal(grades.get(grade.id)?.sortOrder, 5);

  const toggled = await gradeActionRoute(adminPost(`/api/admin/grades/${grade.id}`, {intent: 'toggle'}, {token: 'admin-token'}), {params: Promise.resolve({id: grade.id})});
  assert.match(toggled.headers.get('location') ?? '', /status=updated/);
  assert.equal(grades.get(grade.id)?.isActive, false);
 } finally {
  reset();
 }
});

test('grade writes validate existence and reject duplicates in the service layer', async () => {
 const {store, grades, fields} = createFakeAdminStore();
 const created = await createGrade(store, {name: 'الصف الأول', slug: 'first', sortOrder: 0, isActive: true});
 assert.equal(created.ok, true);
 if (!created.ok) return;
 assert.deepEqual(await updateGrade(store, 'missing-id', {name: 'لا يوجد', slug: 'nope', sortOrder: 0, isActive: true}), {ok: false, reason: 'missing'});
 const duplicate = await createGrade(store, {name: 'الصف الأول', slug: 'first', sortOrder: 1, isActive: true});
 assert.deepEqual(duplicate, {ok: false, reason: 'duplicate'});

 const field = await createField(store, {gradeId: created.id, name: 'حقل', slug: 'f', sortOrder: 0, isActive: true});
 assert.equal(field.ok, true);
 assert.deepEqual(await deleteGrade(store, created.id), {ok: false, reason: 'in_use'});
 assert.equal(fields.size, 1);
 assert.equal(grades.size, 1);
});

test('fields require a valid grade and subjects require a field from the same grade', async () => {
 const {store} = createFakeAdminStore();
 const gradeA = await createGrade(store, {name: 'صف أ', slug: 'grade-a', sortOrder: 0, isActive: true});
 const gradeB = await createGrade(store, {name: 'صف ب', slug: 'grade-b', sortOrder: 1, isActive: true});
 assert.equal(gradeA.ok && gradeB.ok, true);
 if (!gradeA.ok || !gradeB.ok) return;

 const invalidGrade = await createField(store, {gradeId: 'ghost', name: 'حقل', slug: 'f', sortOrder: 0, isActive: true});
 assert.deepEqual(invalidGrade, {ok: false, reason: 'invalid_grade'});

 const fieldA = await createField(store, {gradeId: gradeA.id, name: 'حقل أ', slug: 'field-a', sortOrder: 0, isActive: true});
 assert.equal(fieldA.ok, true);
 if (!fieldA.ok) return;

 const wrongRelation = await createSubject(store, {
  gradeId: gradeB.id,
  academicFieldId: fieldA.id,
  name: 'مادة خاطئة',
  slug: 'wrong-subject',
  shortDescription: null,
  image: null,
  isActive: true,
  isFeatured: false,
  sortOrder: 0,
  monthlyPriceMinor: null,
  semesterPriceMinor: null,
  currency: 'JOD',
 });
 assert.deepEqual(wrongRelation, {ok: false, reason: 'invalid_field'});

 const valid = await createSubject(store, {
  gradeId: gradeA.id,
  academicFieldId: fieldA.id,
  name: 'مادة صحيحة',
  slug: 'valid-subject',
  shortDescription: null,
  image: null,
  isActive: true,
  isFeatured: false,
  sortOrder: 0,
  monthlyPriceMinor: 39_500,
  semesterPriceMinor: 99_000,
  currency: 'JOD',
 });
 assert.equal(valid.ok, true);
 if (valid.ok) {
  const saved = await store.findSubject(valid.id);
  assert.equal(saved?.monthlyPriceMinor, 39_500);
  assert.equal(saved?.semesterPriceMinor, 99_000);
  assert.equal(saved?.currency, 'JOD');
 }
});

test('subject API stores prices as integer minor units and rejects invalid prices', async () => {
 const {store, subjects} = createFakeAdminStore();
 const grade = await createGrade(store, {name: 'توجيهي', slug: 'tawjihi', sortOrder: 0, isActive: true});
 assert.equal(grade.ok, true);
 if (!grade.ok) return;
 setAdminStoreForTests(store);
 await installSession(admin, 'admin-token');
 try {
  const response = await createSubjectRoute(adminPost('/api/admin/subjects', {
   gradeId: grade.id,
   name: 'رياضيات',
   slug: 'math',
   shortDescription: 'وصف',
   image: '/book/8.jpg',
   sortOrder: '1',
   isActive: 'on',
   isFeatured: 'on',
   monthlyPrice: '39.5',
   semesterPrice: '99',
   currency: 'JOD',
  }, {token: 'admin-token'}));
  assert.match(response.headers.get('location') ?? '', /status=created/);
  const saved = [...subjects.values()][0];
  assert.equal(saved.monthlyPriceMinor, 39_500);
  assert.equal(saved.semesterPriceMinor, 99_000);
  assert.equal(saved.isFeatured, true);

  const invalidPrice = await createSubjectRoute(adminPost('/api/admin/subjects', {
   gradeId: grade.id,
   name: 'مادة',
   slug: 'math-2',
   sortOrder: '0',
   monthlyPrice: '3.4567',
  }, {token: 'admin-token'}));
  assert.match(invalidPrice.headers.get('location') ?? '', /error=invalid/);
  assert.equal(subjects.size, 1);
 } finally {
  reset();
 }
});

test('money helpers keep prices exact and never use floating point', () => {
 assert.equal(parseMoneyToMinor('39', 'JOD'), 39_000);
 assert.equal(parseMoneyToMinor('39.5', 'JOD'), 39_500);
 assert.equal(parseMoneyToMinor('39.005', 'JOD'), 39_005);
 assert.equal(parseMoneyToMinor('0', 'JOD'), 0);
 assert.equal(parseMoneyToMinor('', 'JOD'), null);
 assert.equal(parseMoneyToMinor('3.4567', 'JOD'), 'invalid');
 assert.equal(parseMoneyToMinor('-5', 'JOD'), 'invalid');
 assert.equal(parseMoneyToMinor('1,5', 'JOD'), 'invalid');
 assert.equal(parseMoneyToMinor('39.5', 'USD'), 3_950);
 assert.equal(formatMinorAmount(39_500, 'JOD'), '39.5');
 assert.equal(formatMinorAmount(39_000, 'JOD'), '39');
 assert.equal(formatMinor(39_000, 'JOD'), '39 د.أ');
 assert.equal(formatMinor(null, 'JOD'), '—');
});

test('admin schemas reject bad slugs, unsafe image URLs and invalid money', () => {
 assert.equal(gradeInputSchema.safeParse({name: 'صف', slug: 'bad slug', sortOrder: '0'}).success, false);
 assert.equal(gradeInputSchema.safeParse({name: 'صف', slug: 'good-slug', sortOrder: '0', isActive: 'on'}).success, true);
 assert.equal(subjectInputSchema.safeParse({gradeId: 'not-a-uuid', name: 'مادة', slug: 'math', sortOrder: '0'}).success, false);
 assert.equal(subjectInputSchema.safeParse({gradeId: crypto.randomUUID(), name: 'مادة', slug: 'math', sortOrder: '0', image: 'javascript:alert(1)'}).success, false);
 assert.equal(subjectInputSchema.safeParse({gradeId: crypto.randomUUID(), name: 'مادة', slug: 'math', sortOrder: '0', image: 'https://cdn.example/img.png'}).success, true);
 assert.equal(subjectInputSchema.safeParse({gradeId: crypto.randomUUID(), name: 'مادة', slug: 'math', sortOrder: '0', monthlyPrice: 'abc'}).success, false);
});
