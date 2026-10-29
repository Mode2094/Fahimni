import {test} from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test: proves the Phase 3 migrations apply, the seed is
// idempotent and subject filtering + onboarding run against real PostgreSQL.
test('student catalog: migrations, seed and grade/field filtering on PostgreSQL', {
 skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
 process.env.DATABASE_URL = testDatabaseUrl as string;
 const {sql} = await import('drizzle-orm');
 const {migrate} = await import('drizzle-orm/node-postgres/migrator');
 const {closeDb, getDb} = await import('../db/index');
 const {seedCatalog} = await import('../db/seed');
 const schema = await import('../db/schema');
 const {completeOnboarding} = await import('../lib/student/onboarding');
 const {studentStore} = await import('../lib/student/store');

 const db = getDb();
 await migrate(db, {migrationsFolder: './drizzle'});
 await seedCatalog(db);

 const store = studentStore();
 const grades = await store.listActiveGrades();
 assert.deepEqual(grades.map(grade => grade.slug), ['grade-11', 'tawjihi']);
 const tawjihi = grades.find(grade => grade.slug === 'tawjihi');
 const grade11 = grades.find(grade => grade.slug === 'grade-11');
 assert.ok(tawjihi);
 assert.ok(grade11);

 const fields = await store.listActiveFieldsForGrade(tawjihi.id);
 assert.deepEqual(fields.map(field => field.slug), ['scientific-technological', 'medical', 'literary', 'business']);
 const medical = fields.find(field => field.slug === 'medical');
 assert.ok(medical);

 const math = await store.findSubjectBySlug('tawjihi-math');
 assert.equal(math?.isActive, true);
 assert.equal(math?.isFeatured, true);
 const medicalSubjects = await store.listSubjectsForStudent(tawjihi.id, medical.id);
 assert.ok(medicalSubjects.some(item => item.slug === 'tawjihi-math'));
 assert.equal((await store.listSubjectsForStudent(grade11.id, null)).length, 0);

 const userId = `phase3-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
 await db.insert(schema.users).values({id: userId, email: `${userId}@example.com`, name: 'طالب اختبار', image: null, role: 'STUDENT'});
 try {
  assert.deepEqual(await completeOnboarding(store, userId, {gradeId: tawjihi.id, academicFieldId: null}), {ok: false, reason: 'field_required'});
  const wrongField = await completeOnboarding(store, userId, {gradeId: tawjihi.id, academicFieldId: grade11.id});
  assert.equal(wrongField.ok, false);
  assert.deepEqual(await completeOnboarding(store, userId, {gradeId: grade11.id, academicFieldId: medical.id}), {ok: false, reason: 'invalid_field'});

  const saved = await completeOnboarding(store, userId, {gradeId: tawjihi.id, academicFieldId: medical.id});
  assert.equal(saved.ok, true);
  const profile = await store.getProfile(userId);
  assert.equal(profile?.onboardingCompleted, true);
  assert.equal(profile?.gradeId, tawjihi.id);
  assert.equal(profile?.academicFieldId, medical.id);

  const updated = await completeOnboarding(store, userId, {gradeId: grade11.id, academicFieldId: null});
  assert.equal(updated.ok, true);
  const reread = await store.getProfile(userId);
  assert.equal(reread?.gradeId, grade11.id);
  assert.equal(reread?.academicFieldId, null);
 } finally {
  await db.execute(sql`delete from users where id = ${userId}`);
  await closeDb();
 }
});
