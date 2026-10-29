import { and, asc, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';

import { getDb } from '../../db';
import { books, textbookChunks } from '../../db/schema';

export type BookStatus = 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED';

export type BookRecord = {
  id: string;
  subjectId: string;
  title: string;
  originalFileName: string;
  storedFilePath: string;
  sha256: string | null;
  totalPages: number;
  indexedPages: number;
  status: BookStatus;
  errorMessage: string | null;
  // A replacement in progress is tracked here, independently of the active
  // version. The active fields above keep describing the live book until
  // promotion, so a pending replacement never removes it from the catalogue.
  pendingStagedToken: string | null;
  pendingStagedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BookPatch = Partial<
  Pick<
    BookRecord,
    | 'title'
    | 'originalFileName'
    | 'storedFilePath'
    | 'sha256'
    | 'totalPages'
    | 'indexedPages'
    | 'status'
    | 'errorMessage'
    | 'pendingStagedToken'
    | 'pendingStagedAt'
  >
>;

export type ChunkRecord = {
  id: string;
  bookId: string;
  subjectId: string;
  sourceId: string;
  pdfPage: number;
  printedPage: number | null;
  unit: string | null;
  lesson: string | null;
  heading: string | null;
  text: string;
  equations: string[];
  pageImagePath: string | null;
  searchText: string;
};

export type NewChunk = Omit<ChunkRecord, never>;

export type NewBook = {
  id: string;
  subjectId: string;
  title: string;
  originalFileName: string;
  storedFilePath: string;
  sha256: string | null;
  totalPages: number;
  indexedPages: number;
  status: BookStatus;
  errorMessage: string | null;
  pendingStagedToken?: string | null;
  pendingStagedAt?: Date | null;
};

export type BooksStore = {
  findBookBySubject(subjectId: string): Promise<BookRecord | null>;
  findReadyBookBySubject(subjectId: string): Promise<BookRecord | null>;
  findBookById(id: string): Promise<BookRecord | null>;
  createBook(input: NewBook): Promise<BookRecord>;
  updateBook(id: string, patch: BookPatch): Promise<void>;
  deleteBook(id: string): Promise<void>;
  // Records a pending replacement for an existing book. The conditional update
  // only succeeds when no other replacement is already pending, so two
  // concurrent replacements can never claim the same book. Returns false when
  // another replacement is already pending.
  stageReplacement(bookId: string, token: string): Promise<boolean>;
  // Clears the pending marker for exactly this token. A stale worker whose token
  // has already been superseded cannot clear a newer pending replacement.
  clearPendingReplacement(bookId: string, token: string): Promise<void>;
  listChunksForBook(bookId: string): Promise<ChunkRecord[]>;
  replaceChunks(
    bookId: string,
    subjectId: string,
    chunks: NewChunk[],
    bookPatch: BookPatch,
    expectedPendingToken?: string | null,
  ): Promise<boolean>;
  claimNextUploadedBook(): Promise<BookRecord | null>;
  resetStaleProcessing(olderThan: Date): Promise<number>;
  listBookIds(): Promise<string[]>;
};

const bookColumns = {
  id: books.id,
  subjectId: books.subjectId,
  title: books.title,
  originalFileName: books.originalFileName,
  storedFilePath: books.storedFilePath,
  sha256: books.sha256,
  totalPages: books.totalPages,
  indexedPages: books.indexedPages,
  status: books.status,
  errorMessage: books.errorMessage,
  pendingStagedToken: books.pendingStagedToken,
  pendingStagedAt: books.pendingStagedAt,
  createdAt: books.createdAt,
  updatedAt: books.updatedAt,
};

const chunkColumns = {
  id: textbookChunks.id,
  bookId: textbookChunks.bookId,
  subjectId: textbookChunks.subjectId,
  sourceId: textbookChunks.sourceId,
  pdfPage: textbookChunks.pdfPage,
  printedPage: textbookChunks.printedPage,
  unit: textbookChunks.unit,
  lesson: textbookChunks.lesson,
  heading: textbookChunks.heading,
  text: textbookChunks.text,
  equations: textbookChunks.equations,
  pageImagePath: textbookChunks.pageImagePath,
  searchText: textbookChunks.searchText,
};

function createDrizzleBooksStore(): BooksStore {
  const db = () => getDb();
  const now = () => new Date();

  return {
    async findBookBySubject(subjectId) {
      const [row] = await db().select(bookColumns).from(books).where(eq(books.subjectId, subjectId)).limit(1);
      return row ?? null;
    },

    async findReadyBookBySubject(subjectId) {
      const [row] = await db()
        .select(bookColumns)
        .from(books)
        .where(and(eq(books.subjectId, subjectId), eq(books.status, 'READY')))
        .limit(1);
      return row ?? null;
    },

    async findBookById(id) {
      const [row] = await db().select(bookColumns).from(books).where(eq(books.id, id)).limit(1);
      return row ?? null;
    },

    async createBook(input) {
      const stamp = now();
      const [row] = await db()
        .insert(books)
        .values({
          ...input,
          pendingStagedToken: input.pendingStagedToken ?? null,
          pendingStagedAt: input.pendingStagedAt ?? null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .returning(bookColumns);
      return row;
    },

    async updateBook(id, patch) {
      await db().update(books).set({ ...patch, updatedAt: now() }).where(eq(books.id, id));
    },

    async deleteBook(id) {
      await db().delete(books).where(eq(books.id, id));
    },

    // Conditional claim: only succeeds while no replacement is pending, so a
    // second concurrent replacement can never silently supersede the first.
    async stageReplacement(bookId, token) {
      const rows = await db()
        .update(books)
        .set({ pendingStagedToken: token, pendingStagedAt: now(), updatedAt: now() })
        .where(and(eq(books.id, bookId), isNull(books.pendingStagedToken)))
        .returning({ id: books.id });
      return rows.length === 1;
    },

    // Clears the marker only when it still belongs to this token, so a slow
    // worker cannot erase a newer pending replacement staged meanwhile.
    async clearPendingReplacement(bookId, token) {
      await db()
        .update(books)
        .set({ pendingStagedToken: null, pendingStagedAt: null, updatedAt: now() })
        .where(and(eq(books.id, bookId), eq(books.pendingStagedToken, token)));
    },

    async listChunksForBook(bookId) {
      return db()
        .select(chunkColumns)
        .from(textbookChunks)
        .where(eq(textbookChunks.bookId, bookId))
        .orderBy(asc(textbookChunks.pdfPage));
    },

    // Chunk swap is atomic: readers never see a mix of old and new pages.
    // When `expectedPendingToken` is supplied the update is conditional on the
    // book still carrying that pending token: a stale worker whose replacement
    // was superseded commits nothing, so new content is never published on top
    // of a newer pending version.
    async replaceChunks(bookId, subjectId, chunks, bookPatch, expectedPendingToken) {
      return db().transaction(async (tx) => {
        if (expectedPendingToken !== undefined) {
          const guard =
            expectedPendingToken === null
              ? isNull(books.pendingStagedToken)
              : eq(books.pendingStagedToken, expectedPendingToken);
          const claimed = await tx
            .select({ id: books.id })
            .from(books)
            .where(and(eq(books.id, bookId), guard))
            .for('update')
            .limit(1);
          if (!claimed.length) return false;
        }
        await tx.delete(textbookChunks).where(eq(textbookChunks.bookId, bookId));
        if (chunks.length > 0) {
          await tx.insert(textbookChunks).values(
            chunks.map((chunk) => ({
              id: chunk.id,
              bookId,
              subjectId,
              sourceId: chunk.sourceId,
              pdfPage: chunk.pdfPage,
              printedPage: chunk.printedPage,
              unit: chunk.unit,
              lesson: chunk.lesson,
              heading: chunk.heading,
              text: chunk.text,
              equations: chunk.equations,
              pageImagePath: chunk.pageImagePath,
              searchText: chunk.searchText,
              createdAt: now(),
            })),
          );
        }
        const patch =
          expectedPendingToken === undefined
            ? bookPatch
            : { ...bookPatch, pendingStagedToken: null, pendingStagedAt: null };
        await tx
          .update(books)
          .set({ ...patch, updatedAt: now() })
          .where(eq(books.id, bookId));
        return true;
      });
    },

    // Atomic claim: SKIP LOCKED guarantees a book is processed by one worker
    // only. Two kinds of work are claimed:
    //   - a brand-new book (status UPLOADED, nothing staged), and
    //   - a book with a pending replacement (pending_staged_token set), whose
    //     status stays READY so students keep using the previous version while
    //     the replacement is processed.
    async claimNextUploadedBook() {
      return db().transaction(async (tx) => {
        const [candidate] = await tx
          .select(bookColumns)
          .from(books)
          .where(
            or(
              eq(books.status, 'UPLOADED'),
              and(eq(books.status, 'READY'), isNotNull(books.pendingStagedToken)),
            ),
          )
          .orderBy(asc(books.createdAt))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!candidate) return null;
        // A replacement keeps its READY status (students keep the old version);
        // only a brand-new book moves to PROCESSING.
        const nextStatus = candidate.pendingStagedToken ? 'READY' : 'PROCESSING';
        const [claimed] = await tx
          .update(books)
          .set({ status: nextStatus, errorMessage: null, updatedAt: now() })
          .where(eq(books.id, candidate.id))
          .returning(bookColumns);
        return claimed ?? null;
      });
    },

    // A brand-new book stuck in PROCESSING is reset to UPLOADED. A replacement
    // never leaves the book in PROCESSING (its status stays READY), so only
    // NULL pending tokens are recovered here; a stuck pending replacement is
    // re-claimable because it already satisfies claimNextUploadedBook().
    async resetStaleProcessing(olderThan) {
      const rows = await db()
        .update(books)
        .set({ status: 'UPLOADED', errorMessage: null, updatedAt: now() })
        .where(
          and(
            eq(books.status, 'PROCESSING'),
            isNull(books.pendingStagedToken),
            lt(books.updatedAt, olderThan),
          ),
        )
        .returning({ id: books.id });
      return rows.length;
    },

    async listBookIds() {
      const rows = await db().select({ id: books.id }).from(books);
      return rows.map((row) => row.id);
    },
  };
}

let override: BooksStore | null = null;

export function setBooksStoreForTests(store: BooksStore | null): void {
  override = store;
}

export function booksStore(): BooksStore {
  return override ?? createDrizzleBooksStore();
}
