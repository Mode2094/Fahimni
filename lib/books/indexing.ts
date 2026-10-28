import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { normalize } from '../textbook/retrieval';
import {
  discardStagedSource,
  findStagedToken,
  pagesDir,
  promoteStagedSource,
  sha256File,
  sourcePdfPath,
  stagedPagesDir,
  stagedPdfPath,
} from './storage';
import type { BooksStore, NewChunk } from './store';

export type ExtractedPage = {
  pdfPage: number;
  printedPage: number | null;
  unit: string | null;
  lesson: string | null;
  heading: string | null;
  text: string;
  equations: string[];
  image: string | null;
};

export type ExtractionResult = {
  sha256: string;
  totalPages: number;
  sourceId: string;
  pages: ExtractedPage[];
};

export type Extractor = (input: { pdfPath: string; pagesDir: string }) => Promise<ExtractionResult>;

export type ProcessResult = { status: 'READY' | 'FAILED'; indexedPages: number; code?: string };

function extractionFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'python_unavailable') return 'python_unavailable';
  if (message === 'timeout') return 'timeout';
  if (message === 'bad_output') return 'bad_output';
  return 'extraction_failed';
}

// Spawns the proven PyMuPDF pipeline. The child only receives filesystem paths
// as arguments; nothing from it is echoed to users.
export function createPythonExtractor(options?: {
  pythonBin?: string;
  scriptPath?: string;
  timeoutMs?: number;
}): Extractor {
  return async ({ pdfPath, pagesDir: outPagesDir }) => {
    const pythonBin = options?.pythonBin ?? process.env.INDEX_PYTHON_BIN?.trim() ?? 'python3';
    const scriptPath = options?.scriptPath ?? path.join(process.cwd(), 'scripts', 'ingest_book.py');
    const timeoutMs = options?.timeoutMs ?? Number(process.env.INDEX_TIMEOUT_MS ?? 10 * 60 * 1000);
    const outPath = path.join(path.dirname(pdfPath), 'extraction.json');

    await new Promise<void>((resolve, reject) => {
      const child = spawn(pythonBin, [scriptPath, '--pdf', pdfPath, '--pages-dir', outPagesDir, '--out', outPath], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('timeout'));
      }, timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('python_unavailable'));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`extraction_failed:${code ?? 'signal'}`));
      });
    });

    try {
      const raw = JSON.parse(await readFile(outPath, 'utf8')) as ExtractionResult;
      if (!raw || typeof raw.totalPages !== 'number' || !Array.isArray(raw.pages)) throw new Error('bad_output');
      return raw;
    } catch {
      throw new Error('bad_output');
    }
  };
}

// PROCESSING → READY/FAILED. A replacement is extracted from its staged copy
// and only promoted over the live source.pdf/pages after a fully successful
// run; a failure discards the staged files and restores the previous state, so
// a failed replacement never destroys a working book, its pages or its index.
export async function processBook(
  bookId: string,
  deps: { store: BooksStore; extractor?: Extractor; now?: () => Date },
): Promise<ProcessResult> {
  const store = deps.store;
  const book = await store.findBookById(bookId);
  if (!book) return { status: 'FAILED', indexedPages: 0, code: 'missing' };

  // The last known-good state, used to restore the book if a replacement fails.
  // The upload sets the status to UPLOADED before the worker runs, so a
  // surviving index is the authoritative signal that the book already had
  // working content that must be preserved.
  const existingChunks = await store.listChunksForBook(bookId).catch(() => []);
  const hadWorkingContent = existingChunks.length > 0 || book.status === 'READY';
  const previous = {
    status: hadWorkingContent ? ('READY' as const) : book.status,
    indexedPages: hadWorkingContent ? Math.max(book.indexedPages, existingChunks.length) : book.indexedPages,
    totalPages: book.totalPages || existingChunks.length,
    sha256: book.sha256,
    errorMessage: book.errorMessage,
  };
  const stagedToken = await findStagedToken(bookId);
  const isReplacement = stagedToken !== null;

  await store.updateBook(bookId, { status: 'PROCESSING', errorMessage: null });

  try {
    const extractor = deps.extractor ?? createPythonExtractor();
    const pdfPath = stagedToken ? stagedPdfPath(bookId, stagedToken) : sourcePdfPath(bookId);
    const outPagesDir = stagedToken ? stagedPagesDir(bookId, stagedToken) : pagesDir(bookId);
    const result = await extractor({ pdfPath, pagesDir: outPagesDir });

    // A replacement that extracts nothing usable must not be promoted: the
    // working book stays exactly as it was.
    if (!result.pages.length && previous.status === 'READY') throw new Error('empty_extraction');

    if (stagedToken) await promoteStagedSource(bookId, stagedToken);
    const localSha = await sha256File(sourcePdfPath(bookId)).catch(() => null);
    const sha256 = localSha ?? result.sha256;

    const chunks: NewChunk[] = result.pages
      .filter((page) => Number.isInteger(page.pdfPage) && page.pdfPage >= 1 && page.text.trim().length > 0)
      .map((page) => ({
        id: `${result.sourceId}-p${page.pdfPage}`,
        bookId,
        subjectId: book.subjectId,
        sourceId: result.sourceId,
        pdfPage: page.pdfPage,
        printedPage: page.printedPage ?? null,
        unit: page.unit ?? null,
        lesson: page.lesson ?? null,
        heading: page.heading ?? null,
        text: page.text,
        equations: Array.isArray(page.equations) ? page.equations.slice(0, 400) : [],
        pageImagePath: page.image ?? null,
        searchText: normalize([page.text, page.unit, page.lesson, page.heading].filter(Boolean).join(' ')),
      }));

    // Scanned books without a text layer are READY to browse but not searchable:
    // flag them clearly instead of pretending the extraction succeeded.
    const textlessRatio = result.pages.length ? result.pages.filter((page) => page.text.trim().length < 20).length / result.pages.length : 0;
    const lowText = textlessRatio > 0.5;
    await store.replaceChunks(bookId, book.subjectId, chunks, {
      sha256,
      totalPages: result.totalPages,
      indexedPages: chunks.length,
      status: 'READY',
      errorMessage: lowText ? 'low_text' : null,
    });
    return { status: 'READY', indexedPages: chunks.length };
  } catch (error) {
    const code = extractionFailureCode(error);
    if (isReplacement && stagedToken) {
      await discardStagedSource(bookId, stagedToken).catch(() => undefined);
    }
    // Restore the previous known-good state when the book had working content;
    // otherwise record the failure on the (never-promoted) book.
    if (previous.status === 'READY') {
      await store
        .updateBook(bookId, {
          status: 'READY',
          indexedPages: previous.indexedPages,
          totalPages: previous.totalPages,
          sha256: previous.sha256,
          errorMessage: 'replacement_failed',
        })
        .catch(() => undefined);
    } else {
      await store
        .updateBook(bookId, { status: 'FAILED', errorMessage: code, indexedPages: 0 })
        .catch(() => undefined);
    }
    console.error('[books] indexing failed', bookId, code);
    return { status: 'FAILED', indexedPages: 0, code };
  }
}
