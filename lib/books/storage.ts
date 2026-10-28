import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
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
