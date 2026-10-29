import { discardStagedSource, isPdfSignature, safeFileName, writeBookSource, writeStagedSource } from './storage';
import type { BooksStore } from './store';

export const MAX_PDF_BYTES = 100 * 1024 * 1024;

export type UploadFailure = 'missing' | 'invalid_file' | 'too_large' | 'exists' | 'storage' | 'busy';
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

  const title = (input.title?.trim() || originalFileName.replace(/\.pdf$/i, '')).slice(0, 120);

  if (existing) {
    // A replacement is staged in isolated versioned storage; the live
    // source.pdf, pages/ and index stay untouched and the book keeps its READY
    // status, so students can still use the previous version until the new PDF
    // is fully extracted, validated and promoted.
    let token: string;
    try {
      token = await writeStagedSource(existing.id, new Uint8Array(await file.arrayBuffer()));
    } catch {
      return { ok: false, reason: 'storage' };
    }
    if (existing.pendingStagedToken) {
      // Another replacement is already pending; do not supersede it silently.
      await discardStagedSource(existing.id, token).catch(() => undefined);
      return { ok: false, reason: 'busy' };
    }
    // Conditional claim: the row is only marked when no replacement is pending,
    // so two concurrent uploads cannot claim the same book.
    const claimed = await input.store
      .stageReplacement(existing.id, token)
      .catch((): boolean => false);
    if (!claimed) {
      await discardStagedSource(existing.id, token).catch(() => undefined);
      return { ok: false, reason: 'busy' };
    }
    await input.store
      .updateBook(existing.id, { title, originalFileName, errorMessage: null })
      .catch(() => undefined);
    return { ok: true, bookId: existing.id };
  }

  const bookId = crypto.randomUUID();
  try {
    await writeBookSource(bookId, new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { ok: false, reason: 'storage' };
  }

  const storedFilePath = `books/${bookId}/source.pdf`;
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
