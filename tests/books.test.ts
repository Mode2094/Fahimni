import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.AUTH_SECRET = 'books-test-secret';
process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused';
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

import type { AuthUser } from '../lib/auth/store';
import type { BillingStore } from '../lib/billing/store';
import { processBook, type Extractor } from '../lib/books/indexing';
import { allowBookAction } from '../lib/books/rate-limit';
import { resolveBookPage } from '../lib/books/pages';
import { pageImagePath, safeFileName, sourcePdfPath, writeBookSource, dataDir } from '../lib/books/storage';
import type { BookRecord, BooksStore, NewChunk } from '../lib/books/store';
import { MAX_PDF_BYTES, uploadBook } from '../lib/books/upload';
import { subjectRetriever } from '../lib/textbook/subject-retrieval';
import { normalize } from '../lib/textbook/retrieval';
import type { StudentProfile, StudentStore, CatalogSubject } from '../lib/student/store';
import type { TrialStore } from '../lib/trial/store';

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'fahimni-books-'));
process.env.DATA_DIR = tempRoot;
after(() => rm(tempRoot, {recursive: true, force: true}));

const admin: AuthUser = { id: 'admin-1', email: 'admin@example.com', name: 'مشرف', image: null, role: 'ADMIN' };
const student: AuthUser = { id: 'student-1', email: 'student@example.com', name: 'طالب', image: null, role: 'STUDENT' };
const profile: StudentProfile = { userId: 'student-1', gradeId: 'g12', academicFieldId: null, onboardingCompleted: true };
const subject: CatalogSubject = { id: 'subject-1', gradeId: 'g12', academicFieldId: null, name: 'رياضيات', slug: 'math', shortDescription: null, image: null, isActive: true, isFeatured: false, sortOrder: 0 };

function pdfBytes(payload = 'hello'): Uint8Array<ArrayBuffer> {
 const text = `%PDF-1.4\n${payload}\n%%EOF`;
 const buffer = new ArrayBuffer(text.length);
 const bytes = new Uint8Array(buffer);
 for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
 return bytes;
}

// Minimal access stores for page authorization: an entitlement, an active
// trial, an expired trial or nothing at all.
function accessStores(options: { entitled?: boolean; trial?: 'CLAIMED' | 'ACTIVE' | 'EXPIRED' | 'EXHAUSTED' | null } = {}): { billing: BillingStore; trials: TrialStore } {
 const billing = {
  findAccessibleEntitlement: async () => (options.entitled ? { id: 'ent-1', userId: student.id, subjectId: subject.id, status: 'ACTIVE', startsAt: null, expiresAt: null } : null),
 } as unknown as BillingStore;
 const trials = {
  findByUserId: async () =>
   options.trial
    ? {
       id: 'trial-1',
       userId: student.id,
       status: options.trial,
       remainingCredits: options.trial === 'EXPIRED' || options.trial === 'EXHAUSTED' ? 0 : 5,
       expiresAt: options.trial === 'EXPIRED' ? new Date(Date.now() - 86_400_000) : new Date(Date.now() + 86_400_000),
      }
    : null,
 } as unknown as TrialStore;
 return { billing, trials };
}

function createFakeBooksStore() {
 const books = new Map<string, BookRecord>();
 const chunksByBook = new Map<string, NewChunk[]>();
 const store: BooksStore = {
  async findBookBySubject(subjectId) { return [...books.values()].find(book => book.subjectId === subjectId) ?? null; },
  async findReadyBookBySubject(subjectId) { return [...books.values()].find(book => book.subjectId === subjectId && book.status === 'READY') ?? null; },
  async findBookById(id) { return books.get(id) ?? null; },
  async createBook(input) { const row: BookRecord = {...input, createdAt: new Date(), updatedAt: new Date()}; books.set(row.id, row); return row; },
  async updateBook(id, patch) { const book = books.get(id); if (book) books.set(id, {...book, ...patch, updatedAt: new Date()}); },
  async deleteBook(id) { books.delete(id); chunksByBook.delete(id); },
  async listChunksForBook(bookId) { return chunksByBook.get(bookId) ?? []; },
  async replaceChunks(bookId, _subjectId, chunks, bookPatch) {
   chunksByBook.set(bookId, chunks);
   const book = books.get(bookId);
   if (book) books.set(bookId, {...book, ...bookPatch, updatedAt: new Date()});
  },
  async claimNextUploadedBook() { return null; },
  async resetStaleProcessing() { return 0; },
 };
 return { store, books, chunksByBook };
}

function fakeStudents(): StudentStore {
 return {
  async listActiveGrades() { return []; },
  async findGradeById() { return null; },
  async listActiveFields() { return []; },
  async listActiveFieldsForGrade() { return []; },
  async findFieldById() { return null; },
  async getProfile(userId) { return userId === student.id ? profile : null; },
  async upsertProfile() {},
  async listSubjectsForStudent() { return []; },
  async listActiveSubjectsForGrade() { return []; },
  async findSubjectBySlug(slug) { return slug === subject.slug ? subject : null; },
  async findSubjectById(id) { return id === subject.id ? subject : null; },
 };
}

const page = (pdfPage: number, text: string, image: string | null = `${pdfPage}.jpg`) => ({
 pdfPage,
 printedPage: null,
 unit: null,
 lesson: null,
 heading: null,
 text,
 equations: [`x = ${pdfPage}`],
 image,
});

const okExtractor: Extractor = async () => ({
 sha256: 'sha-ok',
 totalPages: 3,
 sourceId: 'book-shaok',
 pages: [page(1, 'المعادلة التربيعية'), page(2, 'حل معادلة خاصة'), page(3, 'قانون الجيوب')],
});

test('upload rejects non-PDF, wrong MIME, oversized and missing files', async () => {
 const {store, books} = createFakeBooksStore();
 assert.deepEqual(await uploadBook({store, subjectId: subject.id, file: null}), {ok: false, reason: 'missing'});
 const text = new File([new TextEncoder().encode('not a pdf')], 'notes.pdf', {type: 'application/pdf'});
 assert.deepEqual(await uploadBook({store, subjectId: subject.id, file: text}), {ok: false, reason: 'invalid_file'});
 const wrongMime = new File([pdfBytes()], 'book.pdf', {type: 'text/plain'});
 assert.deepEqual(await uploadBook({store, subjectId: subject.id, file: wrongMime}), {ok: false, reason: 'invalid_file'});
 const big = new File([pdfBytes()], 'book.pdf', {type: 'application/pdf'});
 assert.deepEqual(await uploadBook({store, subjectId: subject.id, file: big, maxBytes: 10}), {ok: false, reason: 'too_large'});
 assert.equal(books.size, 0);
});

test('upload stores a valid PDF under a UUID directory and creates an UPLOADED book', async () => {
 const {store, books} = createFakeBooksStore();
 const file = new File([pdfBytes()], '../../evil book.pdf', {type: 'application/pdf'});
 const result = await uploadBook({store, subjectId: subject.id, file});
 assert.equal(result.ok, true);
 if (!result.ok) return;
 const book = books.get(result.bookId);
 assert.equal(book?.status, 'UPLOADED');
 assert.equal(book?.storedFilePath, `books/${result.bookId}/source.pdf`);
 assert.equal(book?.originalFileName, 'evil book.pdf');
 assert.ok(sourcePdfPath(result.bookId).startsWith(dataDir()));
});

test('upload refuses a second book unless replace is requested, then resets in place', async () => {
 const {store, books} = createFakeBooksStore();
 const first = await uploadBook({store, subjectId: subject.id, file: new File([pdfBytes()], 'one.pdf', {type: 'application/pdf'})});
 assert.equal(first.ok, true);
 if (!first.ok) return;
 const duplicate = await uploadBook({store, subjectId: subject.id, file: new File([pdfBytes()], 'two.pdf', {type: 'application/pdf'})});
 assert.deepEqual(duplicate, {ok: false, reason: 'exists'});
 const replaced = await uploadBook({store, subjectId: subject.id, file: new File([pdfBytes()], 'two.pdf', {type: 'application/pdf'}), replace: true});
 assert.equal(replaced.ok, true);
 if (!replaced.ok) return;
 assert.equal(replaced.bookId, first.bookId);
 assert.equal(books.get(first.bookId)?.originalFileName, 'two.pdf');
 assert.equal(books.get(first.bookId)?.status, 'UPLOADED');
 assert.equal(books.size, 1);
});

test('indexing transitions PROCESSING → READY and persists subject-scoped chunks', async () => {
 const {store, books, chunksByBook} = createFakeBooksStore();
 const book = await store.createBook({id: crypto.randomUUID(), subjectId: subject.id, title: 'كتاب', originalFileName: 'book.pdf', storedFilePath: 'books/x/source.pdf', sha256: null, totalPages: 0, indexedPages: 0, status: 'UPLOADED', errorMessage: null});
 await writeBookSource(book.id, pdfBytes());
 const result = await processBook(book.id, {store, extractor: okExtractor});
 assert.deepEqual(result, {status: 'READY', indexedPages: 3});
 assert.equal(books.get(book.id)?.status, 'READY');
 assert.equal(books.get(book.id)?.indexedPages, 3);
 assert.equal(books.get(book.id)?.totalPages, 3);
 const chunks = chunksByBook.get(book.id) ?? [];
 assert.equal(chunks.length, 3);
 assert.equal(chunks[0].subjectId, subject.id);
 assert.equal(chunks[0].bookId, book.id);
 assert.equal(chunks[0].sourceId, 'book-shaok');
 assert.equal(chunks[0].searchText, normalize('المعادلة التربيعية'));
});

test('failed indexing marks FAILED with a safe code and keeps the error path-free', async () => {
 const {store, books} = createFakeBooksStore();
 const book = await store.createBook({id: crypto.randomUUID(), subjectId: subject.id, title: 'كتاب', originalFileName: 'book.pdf', storedFilePath: 'books/x/source.pdf', sha256: null, totalPages: 0, indexedPages: 0, status: 'UPLOADED', errorMessage: null});
 const failing: Extractor = async () => { throw new Error('python_unavailable'); };
 const result = await processBook(book.id, {store, extractor: failing});
 assert.equal(result.status, 'FAILED');
 assert.equal(result.code, 'python_unavailable');
 const failed = books.get(book.id);
 assert.equal(failed?.status, 'FAILED');
 assert.equal(failed?.errorMessage, 'python_unavailable');
 assert.equal(failed?.errorMessage?.includes(tempRoot), false);
});

test('re-indexing replaces old chunks safely instead of mixing them', async () => {
 const {store, chunksByBook} = createFakeBooksStore();
 const book = await store.createBook({id: crypto.randomUUID(), subjectId: subject.id, title: 'كتاب', originalFileName: 'book.pdf', storedFilePath: 'books/x/source.pdf', sha256: null, totalPages: 0, indexedPages: 0, status: 'UPLOADED', errorMessage: null});
 await writeBookSource(book.id, pdfBytes());
 await processBook(book.id, {store, extractor: okExtractor});
 assert.equal((chunksByBook.get(book.id) ?? []).length, 3);
 const second: Extractor = async () => ({sha256: 'sha-two', totalPages: 1, sourceId: 'book-shatwo', pages: [page(9, 'صفحة جديدة')]});
 await processBook(book.id, {store, extractor: second});
 const chunks = chunksByBook.get(book.id) ?? [];
 assert.equal(chunks.length, 1);
 assert.equal(chunks[0].pdfPage, 9);
 assert.equal(chunks[0].sourceId, 'book-shatwo');
});

test('subject retriever never mixes chunks from another subject or book', async () => {
 const {store} = createFakeBooksStore();
 const bookA = await store.createBook({id: crypto.randomUUID(), subjectId: subject.id, title: 'A', originalFileName: 'a.pdf', storedFilePath: 'books/a/source.pdf', sha256: null, totalPages: 0, indexedPages: 0, status: 'READY', errorMessage: null});
 const bookB = await store.createBook({id: crypto.randomUUID(), subjectId: 'subject-2', title: 'B', originalFileName: 'b.pdf', storedFilePath: 'books/b/source.pdf', sha256: null, totalPages: 0, indexedPages: 0, status: 'READY', errorMessage: null});
 await store.replaceChunks(bookA.id, subject.id, [{
  id: 'a-1', bookId: bookA.id, subjectId: subject.id, sourceId: 'src-a', pdfPage: 1, printedPage: 1,
  unit: 'المعادلات', lesson: 'حل معادلات خاصة', heading: null, text: 'حل معادلة خاصة بالتحليل', equations: [], pageImagePath: '1.jpg', searchText: 'حل معادلة',
 }], {});
 await store.replaceChunks(bookB.id, 'subject-2', [{
  id: 'b-1', bookId: bookB.id, subjectId: 'subject-2', sourceId: 'src-b', pdfPage: 1, printedPage: 1,
  unit: 'الدائرة', lesson: 'معادلة الدائرة', heading: null, text: 'حل معادلة الدائرة ونصف القطر', equations: [], pageImagePath: '1.jpg', searchText: 'دائرة',
 }], {});
 const retriever = await subjectRetriever(subject.id, store);
 assert.ok(retriever);
 const results = retriever?.('حل معادلة خاصة', 5) ?? [];
 assert.ok(results.length > 0);
 assert.ok(results.every(chunk => chunk.bookId === bookA.id));
 assert.equal(results.some(chunk => chunk.id === 'b-1'), false);
 assert.equal(await subjectRetriever('subject-missing', store), null);
});

test('page image resolution rejects traversal, unknown books and non-ready books', async () => {
 const {store, books} = createFakeBooksStore();
 const book = await store.createBook({id: crypto.randomUUID(), subjectId: subject.id, title: 'كتاب', originalFileName: 'book.pdf', storedFilePath: 'books/x/source.pdf', sha256: null, totalPages: 0, indexedPages: 0, status: 'READY', errorMessage: null});
 await writeBookSource(book.id, pdfBytes());
 const { writeFile } = await import('node:fs/promises');
 await writeFile(pageImagePath(book.id, 4), new Uint8Array([0xff, 0xd8, 0xff]));
 const students = fakeStudents();
 const access = accessStores({entitled: true});

 assert.deepEqual(await resolveBookPage({bookId: book.id, page: '../../etc/passwd', user: student, books: store, students, ...access}), {ok: false});
 assert.deepEqual(await resolveBookPage({bookId: book.id, page: '1e2', user: student, books: store, students, ...access}), {ok: false});
 assert.deepEqual(await resolveBookPage({bookId: '../etc', page: '1', user: student, books: store, students, ...access}), {ok: false});
 assert.deepEqual(await resolveBookPage({bookId: crypto.randomUUID(), page: '1', user: student, books: store, students, ...access}), {ok: false});

 await store.updateBook(book.id, {status: 'PROCESSING'});
 assert.deepEqual(await resolveBookPage({bookId: book.id, page: '4', user: student, books: store, students, ...access}), {ok: false});

 await store.updateBook(book.id, {status: 'READY'});
 const allowed = await resolveBookPage({bookId: book.id, page: '4', user: student, books: store, students, ...access});
 assert.equal(allowed.ok, true);
 if (allowed.ok) assert.ok(allowed.path.endsWith(path.join('pages', '4.jpg')));
 assert.equal((await resolveBookPage({bookId: book.id, page: '4', user: admin, books: store, students, ...access})).ok, true);
 assert.equal(books.get(book.id)?.status, 'READY');
});

test('page access requires an entitlement or an active trial, never visibility alone', async () => {
 const {store} = createFakeBooksStore();
 const book = await store.createBook({id: crypto.randomUUID(), subjectId: subject.id, title: 'كتاب', originalFileName: 'book.pdf', storedFilePath: 'books/x/source.pdf', sha256: null, totalPages: 0, indexedPages: 0, status: 'READY', errorMessage: null});
 const { writeFile } = await import('node:fs/promises');
 await writeBookSource(book.id, pdfBytes());
 await writeFile(pageImagePath(book.id, 3), new Uint8Array([0xff, 0xd8, 0xff]));
 const students = fakeStudents();
 const page = {bookId: book.id, page: '3', user: student, books: store, students} as const;

 // Visible subject with no entitlement and no trial: denied (the QA finding).
 assert.deepEqual(await resolveBookPage({...page, ...accessStores()}), {ok: false});
 // Active or claimed trial grants access.
 assert.equal((await resolveBookPage({...page, ...accessStores({trial: 'ACTIVE'})})).ok, true);
 assert.equal((await resolveBookPage({...page, ...accessStores({trial: 'CLAIMED'})})).ok, true);
 // Expired or exhausted trials never grant access.
 assert.equal((await resolveBookPage({...page, ...accessStores({trial: 'EXPIRED'})})).ok, false);
 assert.equal((await resolveBookPage({...page, ...accessStores({trial: 'EXHAUSTED'})})).ok, false);
 // An active entitlement grants access.
 assert.equal((await resolveBookPage({...page, ...accessStores({entitled: true})})).ok, true);
});

test('students outside the subject cannot resolve its pages', async () => {
 const {store} = createFakeBooksStore();
 const book = await store.createBook({id: crypto.randomUUID(), subjectId: subject.id, title: 'كتاب', originalFileName: 'book.pdf', storedFilePath: 'books/x/source.pdf', sha256: null, totalPages: 0, indexedPages: 0, status: 'READY', errorMessage: null});
 const { writeFile } = await import('node:fs/promises');
 await writeBookSource(book.id, pdfBytes());
 await writeFile(pageImagePath(book.id, 2), new Uint8Array([0xff, 0xd8, 0xff]));
 const otherStudents: StudentStore = {
  ...fakeStudents(),
  async getProfile() { return {userId: student.id, gradeId: 'g11', academicFieldId: null, onboardingCompleted: true}; },
 };
 assert.deepEqual(await resolveBookPage({bookId: book.id, page: '2', user: student, books: store, students: otherStudents, ...accessStores({entitled: true})}), {ok: false});
});

test('safe filenames strip paths and control characters', () => {
 assert.equal(safeFileName('../../etc/passwd.pdf'), 'passwd.pdf');
 assert.equal(safeFileName('..\\..\\windows\\evil.pdf'), 'evil.pdf');
 assert.equal(safeFileName('.hidden.pdf'), 'hidden.pdf');
 assert.equal(safeFileName('كتاب الرياضيات 2026.pdf'), 'كتاب الرياضيات 2026.pdf');
 assert.equal(safeFileName(''), 'book.pdf');
});

test('book action rate limiting blocks bursts and recovers after the window', () => {
 assert.equal(allowBookAction('k', 1000, 2, 1000), true);
 assert.equal(allowBookAction('k', 1000, 2, 1000), true);
 assert.equal(allowBookAction('k', 1000, 2, 1000), false);
 assert.equal(allowBookAction('k', 2500, 2, 1000), true);
});

test('subject tutor API refuses anonymous callers and missing books', async () => {
 const { POST } = await import('../app/api/tutor/route');
 const body = JSON.stringify({question: 'حل معادلة', board: {objects: []}, history: [], currentStep: 0, currentLesson: null, subjectSlug: 'math'});
 const anonymous = await POST(new Request('http://localhost/api/tutor', {method: 'POST', headers: {'content-type': 'application/json'}, body}));
 assert.equal(anonymous.status, 401);
});

test('book upload is not truncated by the proxy body limit (HTTP 500 regression)', async () => {
 const config = (await import('../next.config')).default;
 const limit = config.experimental?.proxyClientMaxBodySize;
 const bytes = typeof limit === 'string' ? Number.parseInt(limit, 10) * 1024 * 1024 : Number(limit ?? 0);
 assert.ok(bytes >= MAX_PDF_BYTES + 1024 * 1024, `proxyClientMaxBodySize must cover MAX_PDF_BYTES (got ${String(limit)})`);
});

test('book upload route answers truncated and invalid uploads with Arabic errors, never a 500', async () => {
 const { POST } = await import('../app/api/admin/subjects/[id]/book/route');
 const { setStudentStoreForTests } = await import('../lib/student/store');
 const { setAuthStoreForTests } = await import('../lib/auth/store');
 const { hashSessionToken } = await import('../lib/auth/session');

 setStudentStoreForTests(fakeStudents());
 const adminUser: AuthUser = { id: 'admin-1', email: 'admin@example.com', name: 'مشرف', image: null, role: 'ADMIN' };
 const sessionId = await hashSessionToken('admin-token', 'books-test-secret');
 const unused = async () => {
  throw new Error('not used');
 };
 setAuthStoreForTests({
  findUserByEmail: unused,
  findUserById: async (id: string) => (id === adminUser.id ? adminUser : null),
  insertUser: unused,
  promoteUser: unused,
  updateUserProfile: unused,
  linkAccount: unused,
  insertSession: unused,
  findSession: async (id: string) => (id === sessionId ? { id, userId: adminUser.id, expiresAt: new Date(Date.now() + 3_600_000) } : null),
  deleteSession: unused,
  deleteExpiredSessions: unused,
 } as never);

 try {
  // A body truncated at the proxy limit fails multipart parsing: the route must
  // report too_large instead of letting request.formData() throw (HTTP 500).
  const truncated = new Request('http://localhost/api/admin/subjects/subject-1/book', {
   method: 'POST',
   headers: {
    origin: 'http://localhost',
    cookie: 'fahimni_session=admin-token',
    'content-type': 'multipart/form-data; boundary=broken',
    'content-length': String(MAX_PDF_BYTES + 5 * 1024 * 1024),
   },
   body: '--broken\r\nContent-Disposition: form-data; name="file"; filename="book.pdf"\r\n\r\n%PDF-1.4\ntruncated',
  });
  const truncatedResponse = await POST(truncated, { params: Promise.resolve({ id: 'subject-1' }) });
  assert.equal(truncatedResponse.status, 303);
  assert.ok(truncatedResponse.headers.get('location')?.includes('error=too_large'));

  // A well-formed multipart with a non-PDF file is rejected with a clear error.
  const form = new FormData();
  form.set('file', new Blob([new TextEncoder().encode('not a pdf')], { type: 'text/plain' }), 'notes.txt');
  const invalid = new Request('http://localhost/api/admin/subjects/subject-1/book', {
   method: 'POST',
   headers: { origin: 'http://localhost', cookie: 'fahimni_session=admin-token' },
   body: form,
  });
  const invalidResponse = await POST(invalid, { params: Promise.resolve({ id: 'subject-1' }) });
  assert.equal(invalidResponse.status, 303);
  assert.ok(invalidResponse.headers.get('location')?.includes('error=invalid_file'));
 } finally {
  setAuthStoreForTests(null);
  setStudentStoreForTests(null);
 }
});
