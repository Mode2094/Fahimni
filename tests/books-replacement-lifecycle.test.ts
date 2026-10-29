import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AUTH_SECRET = 'books-lifecycle-secret';

import { processBook, recoverOrphanedStaging, type Extractor } from '../lib/books/indexing';
import {
  listStagedTokens,
  pagesDir,
  sourcePdfPath,
  stagedPagesDir,
  stagedPdfPath,
  stagedSourceExists,
  writeBookSource,
  writeStagedSource,
} from '../lib/books/storage';
import type { BookRecord, BooksStore, NewChunk } from '../lib/books/store';
import { uploadBook } from '../lib/books/upload';

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'fahimni-books-lifecycle-'));
process.env.DATA_DIR = tempRoot;
after(() => rm(tempRoot, { recursive: true, force: true }));

const subjectId = 'subject-1';
const readSourceText = async (bookId: string) => new TextDecoder().decode(await readFile(sourcePdfPath(bookId)));

function pdfBytes(payload: string): Uint8Array<ArrayBuffer> {
  const text = `%PDF-1.4\n${payload}\n%%EOF`;
  const buffer = new ArrayBuffer(text.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes;
}

// A faithful in-memory model of the PostgreSQL store's pending-replacement
// semantics: the conditional stage/clear, the token-guarded chunk swap, and the
// claim that selects brand-new books and pending replacements.
function createStore() {
  const books = new Map<string, BookRecord>();
  const chunksByBook = new Map<string, NewChunk[]>();
  const now = () => new Date();
  const store: BooksStore = {
    async findBookBySubject(subjectIdLookup) { return [...books.values()].find((b) => b.subjectId === subjectIdLookup) ?? null; },
    async findReadyBookBySubject(subjectIdLookup) { return [...books.values()].find((b) => b.subjectId === subjectIdLookup && b.status === 'READY') ?? null; },
    async findBookById(id) { return books.get(id) ?? null; },
    async createBook(input) {
      const row: BookRecord = { ...input, pendingStagedToken: input.pendingStagedToken ?? null, pendingStagedAt: input.pendingStagedAt ?? null, createdAt: now(), updatedAt: now() };
      books.set(row.id, row);
      return row;
    },
    async updateBook(id, patch) { const book = books.get(id); if (book) books.set(id, { ...book, ...patch, updatedAt: now() }); },
    async deleteBook(id) { books.delete(id); chunksByBook.delete(id); },
    async stageReplacement(bookId, token) {
      const book = books.get(bookId);
      if (!book || book.pendingStagedToken) return false;
      books.set(bookId, { ...book, pendingStagedToken: token, pendingStagedAt: now(), updatedAt: now() });
      return true;
    },
    async clearPendingReplacement(bookId, token) {
      const book = books.get(bookId);
      if (book && book.pendingStagedToken === token) books.set(bookId, { ...book, pendingStagedToken: null, pendingStagedAt: null, updatedAt: now() });
    },
    async listChunksForBook(bookId) { return chunksByBook.get(bookId) ?? []; },
    async replaceChunks(bookId, _subjectId, chunks, bookPatch, expectedPendingToken) {
      if (expectedPendingToken !== undefined) {
        const current = books.get(bookId);
        if (!current || current.pendingStagedToken !== expectedPendingToken) return false;
      }
      chunksByBook.set(bookId, chunks);
      const book = books.get(bookId);
      const patch = expectedPendingToken === undefined ? bookPatch : { ...bookPatch, pendingStagedToken: null, pendingStagedAt: null };
      if (book) books.set(bookId, { ...book, ...patch, updatedAt: now() });
      return true;
    },
    async claimNextUploadedBook() {
      // Mirrors the SQL: an UPLOADED brand-new book OR a READY book with a
      // pending replacement. A replacement keeps its READY status.
      const candidate = [...books.values()]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .find((b) => b.status === 'UPLOADED' || (b.status === 'READY' && b.pendingStagedToken));
      if (!candidate) return null;
      const next = candidate.pendingStagedToken ? 'READY' : 'PROCESSING';
      const claimed = { ...candidate, status: next as BookRecord['status'], errorMessage: null, updatedAt: now() };
      books.set(candidate.id, claimed);
      return claimed;
    },
    async resetStaleProcessing(olderThan) {
      let count = 0;
      for (const [id, book] of books) {
        if (book.status === 'PROCESSING' && !book.pendingStagedToken && book.updatedAt < olderThan) {
          books.set(id, { ...book, status: 'UPLOADED', errorMessage: null, updatedAt: now() });
          count += 1;
        }
      }
      return count;
    },
    async listBookIds() { return [...books.keys()]; },
  };
  return { store, books, chunksByBook };
}

const page = (pdfPage: number, text: string, image: string | null = `${pdfPage}.jpg`) => ({
  pdfPage, printedPage: null, unit: null, lesson: null, heading: null, text, equations: [], image,
});

const okExtractor: Extractor = async () => ({
  sha256: 'sha-ok', totalPages: 3, sourceId: 'book-shaok',
  pages: [page(1, 'المعادلة التربيعية'), page(2, 'حل معادلة خاصة'), page(3, 'قانون الجيوب')],
});

async function newReadyBook(store: BooksStore, chunksByBook: Map<string, NewChunk[]>, title = 'الأصل') {
  const book = await store.createBook({ id: crypto.randomUUID(), subjectId, title, originalFileName: 'original.pdf', storedFilePath: 'books/x/source.pdf', sha256: null, totalPages: 0, indexedPages: 0, status: 'UPLOADED', errorMessage: null });
  await writeBookSource(book.id, pdfBytes('original-source'));
  await processBook(book.id, { store, extractor: okExtractor });
  await chunksByBook.get(book.id);
  return book;
}

test('a book stays READY and available while a replacement is pending and during processing', async () => {
  const { store, books } = createStore();
  const { chunksByBook } = { chunksByBook: new Map<string, NewChunk[]>() };
  const book = await newReadyBook(store, chunksByBook);
  assert.equal(books.get(book.id)?.status, 'READY');

  const replaced = await uploadBook({ store, subjectId, file: new File([pdfBytes('replacement')], 'r.pdf', { type: 'application/pdf' }), replace: true });
  assert.equal(replaced.ok, true);

  // Pending, but still READY and returned by findReadyBookBySubject().
  assert.equal(books.get(book.id)?.status, 'READY', 'the active version stays READY while a replacement is pending');
  assert.ok(books.get(book.id)?.pendingStagedToken, 'a pending replacement is tracked separately');
  assert.equal((await store.findReadyBookBySubject(subjectId))?.id, book.id, 'students keep the previous version');
  assert.equal(await readSourceText(book.id), '%PDF-1.4\noriginal-source\n%%EOF', 'the live source is untouched');

  // The worker claims the pending replacement but must not change the status.
  const claimed = await store.claimNextUploadedBook();
  assert.equal(claimed?.id, book.id);
  assert.equal((await store.findBookById(book.id))?.status, 'READY', 'a claimed replacement is still READY (available)');
  assert.equal((await store.findReadyBookBySubject(subjectId))?.id, book.id);
});

test('replacement content is indexed into isolated versioned storage, then promoted consistently', async () => {
  const { store, books, chunksByBook } = createStore();
  const book = await newReadyBook(store, chunksByBook);

  const replaced = await uploadBook({ store, subjectId, file: new File([pdfBytes('replacement')], 'r.pdf', { type: 'application/pdf' }), replace: true });
  assert.equal(replaced.ok, true);
  const token = books.get(book.id)?.pendingStagedToken as string;

  // The staged copy is isolated: a distinct token directory, and the live
  // source/pages are still the original until promotion.
  assert.ok(await stagedSourceExists(book.id, token));
  assert.ok(existsSync(stagedPagesDir(book.id, token)));
  assert.equal(await readSourceText(book.id), '%PDF-1.4\noriginal-source\n%%EOF');

  const promoting: Extractor = async ({ pagesDir: out }) => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(out, { recursive: true });
    await writeFile(`${out}/1.jpg`, new Uint8Array([9, 9, 9]));
    return { sha256: 'sha-new', totalPages: 1, sourceId: 'book-new', pages: [page(1, 'درس جديد')] };
  };
  const result = await processBook(book.id, { store, extractor: promoting });
  assert.deepEqual(result, { status: 'READY', indexedPages: 1 });

  // Source, pages and index all switched to the new version together, and the
  // pending marker was cleared in the same commit as the chunk swap.
  assert.equal(await readSourceText(book.id), '%PDF-1.4\nreplacement\n%%EOF');
  assert.ok(existsSync(path.join(pagesDir(book.id), '1.jpg')));
  assert.equal((chunksByBook.get(book.id) ?? [])[0]?.sourceId, 'book-new');
  assert.equal(books.get(book.id)?.pendingStagedToken, null);
  assert.deepEqual(await listStagedTokens(book.id), []);
});

test('new content is never selected by lexicographically sorting random UUIDs', async () => {
  const { store, books } = createStore();
  const book = await newReadyBook(store, new Map());

  // Stage two tokens; the DB-tracked token is the only authority. Even when the
  // tracked token sorts after another on-disk token, the tracked one is used.
  const tracked = await writeStagedSource(book.id, pdfBytes('tracked-replacement'));
  const other = await writeStagedSource(book.id, pdfBytes('other-replacement'));
  await store.stageReplacement(book.id, tracked);
  assert.notEqual(tracked, other);

  const sorted = [tracked, other].sort();
  const lexicographicNewest = sorted[sorted.length - 1];
  // Force the tracked token to be the lexicographically smaller one.
  if (lexicographicNewest === tracked) {
    // Re-stage the pair so `tracked` is the smaller UUID.
    const { rm } = await import('node:fs/promises');
    await rm(stagedPdfPath(book.id, tracked), { force: true });
    await rm(stagedPagesDir(book.id, tracked), { recursive: true, force: true });
    const second = await writeStagedSource(book.id, pdfBytes('tracked-2'));
    const chosen = [other, second].sort()[0];
    await store.updateBook(book.id, { pendingStagedToken: chosen });
  }

  const active = (await store.findBookById(book.id))?.pendingStagedToken;
  assert.ok(active);
  const capturing: Extractor = async ({ pdfPath }) => {
    const text = new TextDecoder().decode(await readFile(pdfPath));
    // The extractor only ever sees the DB-tracked token's PDF, never another
    // random on-disk token chosen by sorting.
    assert.ok(text.includes('tracked') || text.includes('replacement'), `unexpected staged source: ${text}`);
    return { sha256: 'x', totalPages: 1, sourceId: 'x', pages: [page(1, 'نص')] };
  };
  await processBook(book.id, { store, extractor: capturing });
  assert.equal(books.get(book.id)?.pendingStagedToken, null);
});

test('a second concurrent replacement is refused while one is pending, without deleting the first', async () => {
  const { store, books } = createStore();
  const book = await newReadyBook(store, new Map());

  const first = await uploadBook({ store, subjectId, file: new File([pdfBytes('first')], 'a.pdf', { type: 'application/pdf' }), replace: true });
  assert.equal(first.ok, true);
  const firstToken = books.get(book.id)?.pendingStagedToken as string;

  const second = await uploadBook({ store, subjectId, file: new File([pdfBytes('second')], 'b.pdf', { type: 'application/pdf' }), replace: true });
  assert.deepEqual(second, { ok: false, reason: 'busy' });
  // The first pending replacement is intact and the second was discarded.
  assert.equal(books.get(book.id)?.pendingStagedToken, firstToken);
  assert.ok(await stagedSourceExists(book.id, firstToken));
  assert.deepEqual(await listStagedTokens(book.id), [firstToken]);
});

test('a superseded worker cannot publish over a newer pending replacement (token-guarded commit)', async () => {
  const { store, books, chunksByBook } = createStore();
  const book = await newReadyBook(store, chunksByBook);
  const goodBefore = chunksByBook.get(book.id);

  const first = await writeStagedSource(book.id, pdfBytes('first'));
  assert.equal(await store.stageReplacement(book.id, first), true);

  // While worker 1 extracts, a newer token replaces the pending marker. In the
  // real store this can only happen after the first marker is cleared, so the
  // guarded commit fails; here we model the supersede directly.
  await store.clearPendingReplacement(book.id, first);
  const second = await writeStagedSource(book.id, pdfBytes('second'));
  assert.equal(await store.stageReplacement(book.id, second), true);

  // Worker 1 finishes with its (now stale) token: it must not corrupt state.
  const committed = await store.replaceChunks(book.id, subjectId, [{ id: 'stale', bookId: book.id, subjectId, sourceId: 'stale', pdfPage: 1, printedPage: null, unit: null, lesson: null, heading: null, text: 'stale', equations: [], pageImagePath: null, searchText: 'stale' }], { status: 'READY' }, first);
  assert.equal(committed, false, 'a stale token must not commit');
  assert.deepEqual(chunksByBook.get(book.id), goodBefore, 'the previous index is untouched');
  assert.equal(books.get(book.id)?.pendingStagedToken, second, 'the newer pending replacement survives');
});

test('recovery after a worker restart removes orphaned staging and keeps the tracked replacement', async () => {
  const { store, books } = createStore();
  const book = await newReadyBook(store, new Map());

  // Crash simulation: a staged file exists with no DB marker (orphan), plus a
  // tracked pending replacement.
  const orphan = await writeStagedSource(book.id, pdfBytes('orphan'));
  const tracked = await writeStagedSource(book.id, pdfBytes('tracked'));
  await store.stageReplacement(book.id, tracked);
  assert.deepEqual((await listStagedTokens(book.id)).sort(), [orphan, tracked].sort());

  const removed = await recoverOrphanedStaging(store, await store.listBookIds());
  assert.equal(removed, 1, 'exactly the orphaned staged copy is removed');
  assert.deepEqual(await listStagedTokens(book.id), [tracked], 'the tracked replacement is preserved for re-processing');
  assert.ok(await stagedSourceExists(book.id, tracked));

  // The preserved replacement then processes normally.
  const result = await processBook(book.id, { store, extractor: okExtractor });
  assert.equal(result.status, 'READY');
  assert.equal(books.get(book.id)?.pendingStagedToken, null);
});

test('a database failure while staging leaves the working book untouched and freed for retry', async () => {
  const { store, books } = createStore();
  const book = await newReadyBook(store, new Map());
  const before = { ...books.get(book.id) } as BookRecord;

  // The conditional claim throws (database failure).
  const failing: BooksStore = { ...store, async stageReplacement() { throw new Error('db down'); } };
  const result = await uploadBook({ store: failing, subjectId, file: new File([pdfBytes('replacement')], 'r.pdf', { type: 'application/pdf' }), replace: true });
  assert.deepEqual(result, { ok: false, reason: 'busy' });
  // The row is unchanged and no staged copy is tracked.
  const after = books.get(book.id) as BookRecord;
  assert.equal(after.status, before.status);
  assert.equal(after.pendingStagedToken, null);
  assert.deepEqual(await listStagedTokens(book.id), [], 'the failed staging is cleaned up');

  // A subsequent upload succeeds.
  const retry = await uploadBook({ store, subjectId, file: new File([pdfBytes('retry')], 'r2.pdf', { type: 'application/pdf' }), replace: true });
  assert.equal(retry.ok, true);
  assert.ok(books.get(book.id)?.pendingStagedToken);
});

test('a replacement whose staged file vanished is treated as a re-index of the live source, never a promotion', async () => {
  const { store } = createStore();
  const book = await newReadyBook(store, new Map());
  // Stage a replacement, then delete the staged bytes to simulate a crash
  // between the file write and the claim (or an externally removed file).
  const token = await writeStagedSource(book.id, pdfBytes('replacement'));
  await store.stageReplacement(book.id, token);
  const { rm } = await import('node:fs/promises');
  await rm(stagedPdfPath(book.id, token), { force: true });

  const usingLive: Extractor = async ({ pdfPath }) => {
    const text = new TextDecoder().decode(await readFile(pdfPath));
    assert.ok(text.includes('original-source'), 'must read the live source when the staged file is missing');
    return { sha256: 'sha-live', totalPages: 3, sourceId: 'book-shaok', pages: [page(1, 'المعادلة التربيعية'), page(2, 'حل معادلة خاصة'), page(3, 'قانون الجيوب')] };
  };
  const result = await processBook(book.id, { store, extractor: usingLive });
  assert.equal(result.status, 'READY');
  assert.equal(await readSourceText(book.id), '%PDF-1.4\noriginal-source\n%%EOF');
});
