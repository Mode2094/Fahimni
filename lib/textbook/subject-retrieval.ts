import type { BooksStore } from '../books/store';
import { buildRetriever, type RetrievalChunk, type Retriever } from './retrieval';

// Loads the READY book for a subject and returns a retriever scoped to that
// book's chunks only. Never touches another subject's or book's rows.
export async function subjectRetriever(subjectId: string, store: BooksStore): Promise<Retriever | null> {
  const book = await store.findReadyBookBySubject(subjectId);
  if (!book) return null;
  const rows = await store.listChunksForBook(book.id);
  if (!rows.length) return null;
  const chunks: RetrievalChunk[] = rows.map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    pdfPage: row.pdfPage,
    printedPage: row.printedPage,
    unit: row.unit,
    lesson: row.lesson,
    heading: row.heading,
    text: row.text,
    equations: row.equations,
    image: `/api/books/${book.id}/pages/${row.pdfPage}`,
    bookId: book.id,
  }));
  return buildRetriever(chunks);
}
