import {test} from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test: book lifecycle, chunk swap, claim locking, stale
// recovery and retrieval isolation against real PostgreSQL.
test('books on PostgreSQL: claim, chunks, retrieval isolation and cleanup', {
 skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
 process.env.DATABASE_URL = testDatabaseUrl as string;
 const {eq, sql} = await import('drizzle-orm');
 const {migrate} = await import('drizzle-orm/node-postgres/migrator');
 const {closeDb, getDb} = await import('../db/index');
 const {seedCatalog} = await import('../db/seed');
 const schema = await import('../db/schema');
 const {booksStore} = await import('../lib/books/store');
 const {subjectRetriever} = await import('../lib/textbook/subject-retrieval');

 const db = getDb();
 await migrate(db, {migrationsFolder: './drizzle'});
 await seedCatalog(db);

 const store = booksStore();
  const [math] = await db.select().from(schema.subjects).where(eq(schema.subjects.slug, 'tawjihi-math')).limit(1);
  assert.ok(math);

  const otherId = crypto.randomUUID();
  await db.insert(schema.subjects).values({
   id: otherId,
   gradeId: math.gradeId,
   name: 'مادة أخرى',
   slug: `other-${Date.now()}`,
   isActive: true,
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let bookA: string | null = null;
  let bookB: string | null = null;

  try {
   const created = await store.createBook({
    id: crypto.randomUUID(),
    subjectId: math.id,
    title: 'كتاب اختبار',
    originalFileName: 'test.pdf',
    storedFilePath: 'books/test/source.pdf',
    sha256: null,
    totalPages: 0,
    indexedPages: 0,
    status: 'UPLOADED',
    errorMessage: null,
   });
   bookA = created.id;

   const claimed = await store.claimNextUploadedBook();
   assert.equal(claimed?.id, bookA);
   assert.equal((await store.findBookById(bookA))?.status, 'PROCESSING');

   await db.execute(sql`update books set updated_at = now() - interval '2 hours' where id = ${bookA}`);
   assert.equal(await store.resetStaleProcessing(new Date(Date.now() - 30 * 60 * 1000)), 1);
   assert.equal((await store.findBookById(bookA))?.status, 'UPLOADED');

   const chunkA = {
    id: `${suffix}-a1`,
    bookId: bookA,
    subjectId: math.id,
    sourceId: `src-${suffix}`,
    pdfPage: 1,
    printedPage: 1,
    unit: 'المعادلات',
    lesson: 'حل معادلات خاصة',
    heading: null,
    text: 'حل معادلة خاصة بالتحليل إلى عوامل',
    equations: ['x = 1'],
    pageImagePath: '1.jpg',
    searchText: 'حل معادلة خاصه بالتحليل',
   };
   await store.replaceChunks(bookA, math.id, [chunkA], {status: 'READY', totalPages: 1, indexedPages: 1});
   assert.equal((await store.findReadyBookBySubject(math.id))?.id, bookA);
   assert.equal((await store.listChunksForBook(bookA)).length, 1);

   // A pending replacement keeps the book READY and available, and is claimed
   // by the worker without changing the status.
   const pendingToken = crypto.randomUUID();
   assert.equal(await store.stageReplacement(bookA, pendingToken), true);
   assert.equal((await store.findReadyBookBySubject(math.id))?.id, bookA, 'the book stays available while a replacement is pending');
   // A second concurrent replacement cannot claim the book.
   assert.equal(await store.stageReplacement(bookA, crypto.randomUUID()), false, 'only one replacement may be pending');
   const claimedReplacement = await store.claimNextUploadedBook();
   assert.equal(claimedReplacement?.id, bookA);
   assert.equal((await store.findBookById(bookA))?.status, 'READY', 'a claimed replacement stays READY');

   // A token-guarded commit only succeeds for the tracked token.
   const staleCommit = await store.replaceChunks(bookA, math.id, [{...chunkA, id: `${suffix}-stale`}], {status: 'READY'}, crypto.randomUUID());
   assert.equal(staleCommit, false, 'a stale token must not commit');
   assert.equal((await store.listChunksForBook(bookA)).length, 1, 'the index is untouched by the stale commit');

   const committed = await store.replaceChunks(bookA, math.id, [{...chunkA, id: `${suffix}-a3`, pdfPage: 3}], {status: 'READY', totalPages: 3, indexedPages: 1}, pendingToken);
   assert.equal(committed, true);
   assert.equal((await store.findBookById(bookA))?.pendingStagedToken, null, 'the pending marker is cleared on commit');
   assert.equal((await store.listChunksForBook(bookA))[0]?.pdfPage, 3);

   const createdB = await store.createBook({
   id: crypto.randomUUID(),
   subjectId: otherId,
   title: 'كتاب آخر',
   originalFileName: 'other.pdf',
   storedFilePath: 'books/other/source.pdf',
   sha256: null,
   totalPages: 0,
   indexedPages: 0,
   status: 'UPLOADED',
   errorMessage: null,
  });
  bookB = createdB.id;
  await store.replaceChunks(bookB, otherId, [{
   ...chunkA,
   id: `${suffix}-b1`,
   bookId: bookB,
   subjectId: otherId,
   text: 'حل معادلة خاصة بالتحليل إلى عوامل',
  }], {status: 'READY', totalPages: 1, indexedPages: 1});

  const retriever = await subjectRetriever(math.id, store);
  assert.ok(retriever);
  const results = retriever?.('حل معادلة خاصة', 5) ?? [];
  assert.ok(results.length > 0);
  assert.ok(results.every((chunk) => chunk.bookId === bookA));
  assert.equal(results.some((chunk) => chunk.bookId === bookB), false);

  // Re-index replaces the old chunk set atomically.
  await store.replaceChunks(bookA, math.id, [{...chunkA, id: `${suffix}-a2`, pdfPage: 2}], {status: 'READY', totalPages: 2, indexedPages: 1});
  const afterReindex = await store.listChunksForBook(bookA);
  assert.equal(afterReindex.length, 1);
  assert.equal(afterReindex[0].pdfPage, 2);
 } finally {
  if (bookB) await db.execute(sql`delete from books where id = ${bookB}`);
  if (bookA) await db.execute(sql`delete from books where id = ${bookA}`);
  await db.execute(sql`delete from subjects where id = ${otherId}`);
  await closeDb();
 }
});
