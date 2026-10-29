import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// DATA_DIR lives outside the public web root in production.
export function dataDir(): string {
  const configured = process.env.DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), '.data');
}

export function bookDir(bookId: string): string {
  if (!isUuid(bookId)) throw new Error('invalid_book_id');
  return path.join(dataDir(), 'books', bookId);
}

export function sourcePdfPath(bookId: string): string {
  return path.join(bookDir(bookId), 'source.pdf');
}

export function pagesDir(bookId: string): string {
  return path.join(bookDir(bookId), 'pages');
}

export function pageImagePath(bookId: string, page: number): string {
  if (!isUuid(bookId)) throw new Error('invalid_book_id');
  if (!Number.isInteger(page) || page < 1 || page > 100_000) throw new Error('invalid_page');
  return path.join(pagesDir(bookId), `${page}.jpg`);
}

export async function ensureBookDirs(bookId: string): Promise<void> {
  await mkdir(pagesDir(bookId), { recursive: true });
}

export async function clearPages(bookId: string): Promise<void> {
  await rm(pagesDir(bookId), { recursive: true, force: true });
  await mkdir(pagesDir(bookId), { recursive: true });
}

export async function removeBookFiles(bookId: string): Promise<void> {
  if (!isUuid(bookId)) return;
  await rm(bookDir(bookId), { recursive: true, force: true });
}

export async function fileSize(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return null;
  }
}

// The stored path is always UUID-based; the original name is display-only and
// is stripped of any path separators or control characters.
export function safeFileName(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '_')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || 'book.pdf').slice(0, 120);
}

export function isPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

export async function writeBookSource(bookId: string, bytes: Uint8Array): Promise<void> {
  await ensureBookDirs(bookId);
  await writeFile(sourcePdfPath(bookId), bytes);
}

/* ---------------------------------------------------- staged replacement ---- */
// A replacement upload must never destroy the working book before the new PDF
// is extracted, validated and promoted. New sources are written to
// <book>/staging/<token>.pdf and extracted into <book>/staging/<token>-pages;
// only a successful run promotes them over the live source.pdf/pages.

export function stagingDir(bookId: string): string {
  if (!isUuid(bookId)) throw new Error('invalid_book_id');
  return path.join(bookDir(bookId), 'staging');
}

export function stagedPdfPath(bookId: string, token: string): string {
  if (!isUuid(token)) throw new Error('invalid_token');
  return path.join(stagingDir(bookId), `${token}.pdf`);
}

export function stagedPagesDir(bookId: string, token: string): string {
  if (!isUuid(token)) throw new Error('invalid_token');
  return path.join(stagingDir(bookId), `${token}-pages`);
}

// Writes a replacement PDF into staging and returns its token.
export async function writeStagedSource(bookId: string, bytes: Uint8Array): Promise<string> {
  const token = crypto.randomUUID();
  await mkdir(stagedPagesDir(bookId, token), { recursive: true });
  await writeFile(stagedPdfPath(bookId, token), bytes);
  return token;
}

// Whether a staged PDF for exactly this token is present on disk. The token is
// always the one recorded in the database, never the result of sorting random
// directory entries: two concurrent replacements have unrelated UUIDs whose
// lexicographic order carries no meaning.
export async function stagedSourceExists(bookId: string, token: string): Promise<boolean> {
  if (!isUuid(bookId) || !isUuid(token)) return false;
  return exists(stagedPdfPath(bookId, token));
}

// Every staged PDF token currently on disk. Used only for crash recovery and
// cleanup of orphaned staging directories, never to choose the active version.
export async function listStagedTokens(bookId: string): Promise<string[]> {
  if (!isUuid(bookId)) return [];
  try {
    const entries = await readdir(stagingDir(bookId));
    return entries
      .filter((name) => name.endsWith('.pdf'))
      .map((name) => name.slice(0, -4))
      .filter((token) => isUuid(token));
  } catch {
    return [];
  }
}

export async function discardStagedSource(bookId: string, token: string): Promise<void> {
  await rm(stagedPdfPath(bookId, token), { force: true }).catch(() => undefined);
  await rm(stagedPagesDir(bookId, token), { recursive: true, force: true }).catch(() => undefined);
}

// Atomically replaces source.pdf and pages/ with the staged versions. The
// previous files are moved aside first and restored if any step fails, so a
// failure can never leave the book without its working source and pages.
export async function promoteStagedSource(bookId: string, token: string): Promise<void> {
  const staging = stagingDir(bookId);
  const stagedPdf = stagedPdfPath(bookId, token);
  const stagedPages = stagedPagesDir(bookId, token);
  const previousPdf = path.join(staging, 'previous.pdf');
  const previousPages = path.join(staging, 'previous-pages');
  const livePdf = sourcePdfPath(bookId);
  const livePages = pagesDir(bookId);

  await mkdir(staging, { recursive: true });
  await rm(previousPdf, { force: true }).catch(() => undefined);
  await rm(previousPages, { recursive: true, force: true }).catch(() => undefined);

  const moved: string[] = [];
  try {
    if (await exists(livePdf)) {
      await rename(livePdf, previousPdf);
      moved.push('pdf');
    }
    if (await exists(livePages)) {
      await rename(livePages, previousPages);
      moved.push('pages');
    }
    await rename(stagedPdf, livePdf);
    await mkdir(livePages, { recursive: true });
    if (await exists(stagedPages)) {
      await rm(livePages, { recursive: true, force: true });
      await rename(stagedPages, livePages);
    }
  } catch (error) {
    // Roll back to exactly the previous state.
    if (moved.includes('pdf')) await rename(previousPdf, livePdf).catch(() => undefined);
    if (moved.includes('pages')) {
      await rm(livePages, { recursive: true, force: true }).catch(() => undefined);
      await rename(previousPages, livePages).catch(() => undefined);
    }
    throw error;
  }

  await rm(previousPdf, { force: true }).catch(() => undefined);
  await rm(previousPages, { recursive: true, force: true }).catch(() => undefined);
  await rm(staging, { recursive: true, force: true }).catch(() => undefined);
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
