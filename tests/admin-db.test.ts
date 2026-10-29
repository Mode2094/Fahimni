import {test} from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test: admin CRUD, relation validation, duplicate handling,
// reference guards and money storage against real PostgreSQL.
test('admin store on PostgreSQL: CRUD, relations, duplicates, references and prices', {
 skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
 process.env.DATABASE_URL = testDatabaseUrl as string;
 const {sql} = await import('drizzle-orm');
 const {migrate} = await import('drizzle-orm/node-postgres/migrator');
 const {closeDb, getDb} = await import('../db/index');
 const {seedCatalog} = await import('../db/seed');
 const {adminStore} = await import('../lib/admin/store');
 const {createField, createGrade, createSubject, deleteGrade, toggleGradeActive} = await import('../lib/admin/actions');

 const db = getDb();
 await migrate(db, {migrationsFolder: './drizzle'});
 await seedCatalog(db);

 const store = adminStore();
 const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
 let gradeId: string | null = null;

 try {
  const grade = await createGrade(store, {name: 'صف اختبار', slug: `admin-grade-${suffix}`, sortOrder: 99, isActive: true});
  assert.equal(grade.ok, true);
  if (!grade.ok) return;
  gradeId = grade.id;

  const duplicate = await createGrade(store, {name: 'صف مكرر', slug: `admin-grade-${suffix}`, sortOrder: 100, isActive: true});
  assert.deepEqual(duplicate, {ok: false, reason: 'duplicate'});

  const field = await createField(store, {gradeId: grade.id, name: 'حقل اختبار', slug: `field-${suffix}`, sortOrder: 0, isActive: true});
  assert.equal(field.ok, true);
  if (!field.ok) return;

  assert.deepEqual(await deleteGrade(store, grade.id), {ok: false, reason: 'in_use'});

  const toggled = await toggleGradeActive(store, grade.id);
  assert.equal(toggled.ok, true);
  assert.equal((await store.findGrade(grade.id))?.isActive, false);
  await toggleGradeActive(store, grade.id);
  assert.equal((await store.findGrade(grade.id))?.isActive, true);

  const subject = await createSubject(store, {
   gradeId: grade.id,
   academicFieldId: field.id,
   name: 'مادة اختبار',
   slug: `subject-${suffix}`,
   shortDescription: 'وصف مختصر',
   image: '/book/8.jpg',
   isActive: true,
   isFeatured: true,
   sortOrder: 0,
   monthlyPriceMinor: 39_500,
   semesterPriceMinor: 99_000,
   currency: 'JOD',
  });
  assert.equal(subject.ok, true);
  if (!subject.ok) return;

  const saved = await store.findSubject(subject.id);
  assert.equal(saved?.monthlyPriceMinor, 39_500);
  assert.equal(saved?.semesterPriceMinor, 99_000);
  assert.equal(saved?.currency, 'JOD');
  assert.equal(saved?.gradeName, 'صف اختبار');
  assert.equal(saved?.fieldName, 'حقل اختبار');

  const foreignField = (await store.listFields()).find((item) => item.slug.startsWith('medical'));
  if (foreignField) {
   const wrongRelation = await createSubject(store, {
    gradeId: grade.id,
    academicFieldId: foreignField.id,
    name: 'مادة خاطئة',
    slug: `wrong-${suffix}`,
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
  }

  const counts = await store.countSubjects();
  assert.ok(counts.total >= 1);
  assert.ok(counts.active >= 1);
  assert.ok((await store.countGrades()) >= 1);
  assert.ok((await store.countStudents()) >= 0);

  assert.deepEqual(await deleteGrade(store, grade.id), {ok: false, reason: 'in_use'});
 } finally {
  if (gradeId) await db.execute(sql`delete from grades where id = ${gradeId}`);
  await closeDb();
 }
});
