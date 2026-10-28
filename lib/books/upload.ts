import { isPdfSignature, safeFileName, writeBookSource, writeStagedSource } from './storage';
import type { BooksStore } from './store';

export const MAX_PDF_BYTES = 100 * 1024 * 1024;

export type UploadFailure = 'missing' | 'invalid_file' | 'too_large' | 'exists' | 'storage';
export type UploadResult = { ok: true; bookId: string } | { ok: false; reason: UploadFailure };

const ALLOWED_MIME = new Set(['application/pdf', 'application/x-pdf', 'application/octet-stream', '']);

// Validation order: size → MIME → signature → filename. Storage paths are
// always UUID-derived, never taken from the browser.
export async function uploadBook(input: {
  store: BooksStore;
  subjectId: string;
  file: File | null;
  title?: string | null;
  replace?: boolean;
  maxBytes?: number;
}): Promise<UploadResult> {
  const file = input.file;
  if (!file || typeof file === 'string' || !file.size) return { ok: false, reason: 'missing' };

  const maxBytes = input.maxBytes ?? MAX_PDF_BYTES;
  if (file.size > maxBytes) return { ok: false, reason: 'too_large' };

  const type = (file.type || '').toLowerCase();
  if (!ALLOWED_MIME.has(type)) return { ok: false, reason: 'invalid_file' };

  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (!isPdfSignature(head)) return { ok: false, reason: 'invalid_file' };

  const originalFileName = safeFileName(file.name || 'book.pdf');
  const existing = await input.store.findBookBySubject(input.subjectId);
  if (existing && !input.replace) return { ok: false, reason: 'exists' };

  const bookId = existing?.id ?? crypto.randomUUID();
  // A replacement is staged: the live source.pdf and pages/ are only replaced
  // after the worker extracts, validates and promotes the new PDF. A failed
  // replacement therefore leaves the working book untouched.
  try {
    if (existing) await writeStagedSource(bookId, new Uint8Array(await file.arrayBuffer()));
    else await writeBookSource(bookId, new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { ok: false, reason: 'storage' };
  }

  const title = (input.title?.trim() || originalFileName.replace(/\.pdf$/i, '')).slice(0, 120);
  const storedFilePath = `books/${bookId}/source.pdf`;

  if (existing) {
    // Keep the previous page count and index until the new PDF is promoted, so
    // a failed replacement can restore the last known-good state exactly.
    await input.store.updateBook(bookId, {
      title,
      originalFileName,
      storedFilePath,
      status: 'UPLOADED',
      errorMessage: null,
    });
    return { ok: true, bookId };
  }

  await input.store.createBook({
    id: bookId,
    subjectId: input.subjectId,
    title,
    originalFileName,
    storedFilePath,
    sha256: null,
    totalPages: 0,
    indexedPages: 0,
    status: 'UPLOADED',
    errorMessage: null,
  });
  return { ok: true, bookId };
}
