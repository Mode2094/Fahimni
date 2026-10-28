import { and, asc, eq, lt } from 'drizzle-orm';

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
  createdAt: Date;
  updatedAt: Date;
};

export type BookPatch = Partial<
  Pick<
    BookRecord,
    'title' | 'originalFileName' | 'storedFilePath' | 'sha256' | 'totalPages' | 'indexedPages' | 'status' | 'errorMessage'
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
};

export type BooksStore = {
  findBookBySubject(subjectId: string): Promise<BookRecord | null>;
  findReadyBookBySubject(subjectId: string): Promise<BookRecord | null>;
  findBookById(id: string): Promise<BookRecord | null>;
  createBook(input: NewBook): Promise<BookRecord>;
  updateBook(id: string, patch: BookPatch): Promise<void>;
  deleteBook(id: string): Promise<void>;
  listChunksForBook(bookId: string): Promise<ChunkRecord[]>;
  replaceChunks(
    bookId: string,
    subjectId: string,
    chunks: NewChunk[],
    bookPatch: BookPatch,
  ): Promise<void>;
  claimNextUploadedBook(): Promise<BookRecord | null>;
  resetStaleProcessing(olderThan: Date): Promise<number>;
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
        .values({ ...input, createdAt: stamp, updatedAt: stamp })
        .returning(bookColumns);
      return row;
    },

    async updateBook(id, patch) {
      await db().update(books).set({ ...patch, updatedAt: now() }).where(eq(books.id, id));
    },

    async deleteBook(id) {
      await db().delete(books).where(eq(books.id, id));
    },

    async listChunksForBook(bookId) {
      return db()
        .select(chunkColumns)
        .from(textbookChunks)
        .where(eq(textbookChunks.bookId, bookId))
        .orderBy(asc(textbookChunks.pdfPage));
    },

    // Chunk swap is atomic: readers never see a mix of old and new pages.
    async replaceChunks(bookId, subjectId, chunks, bookPatch) {
      await db().transaction(async (tx) => {
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
        await tx
          .update(books)
          .set({ ...bookPatch, updatedAt: now() })
          .where(eq(books.id, bookId));
      });
    },

    // Atomic claim: SKIP LOCKED guarantees a book is processed by one worker only.
    async claimNextUploadedBook() {
      return db().transaction(async (tx) => {
        const [candidate] = await tx
          .select(bookColumns)
          .from(books)
          .where(eq(books.status, 'UPLOADED'))
          .orderBy(asc(books.createdAt))
          .limit(1)
          .for('update', { skipLocked: true });
        if (!candidate) return null;
        const [claimed] = await tx
          .update(books)
          .set({ status: 'PROCESSING', errorMessage: null, updatedAt: now() })
          .where(eq(books.id, candidate.id))
          .returning(bookColumns);
        return claimed ?? null;
      });
    },

    async resetStaleProcessing(olderThan) {
      const rows = await db()
        .update(books)
        .set({ status: 'UPLOADED', errorMessage: null, updatedAt: now() })
        .where(and(eq(books.status, 'PROCESSING'), lt(books.updatedAt, olderThan)))
        .returning({ id: books.id });
      return rows.length;
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
