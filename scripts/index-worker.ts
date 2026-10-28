import { closeDb } from '../db/index';
import { processBook } from '../lib/books/indexing';
import { booksStore } from '../lib/books/store';

const once = process.argv.includes('--once');
const pollMs = Number(process.env.WORKER_POLL_MS ?? 5000);
const STALE_MS = 30 * 60 * 1000;

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const store = booksStore();
  const reset = await store.resetStaleProcessing(new Date(Date.now() - STALE_MS));
  if (reset > 0) console.log(`[worker] reset ${reset} stale processing book(s)`);

  while (!stopping) {
    const book = await store.claimNextUploadedBook();
    if (!book) {
      if (once) break;
      await sleep(pollMs);
      continue;
    }
    console.log(`[worker] indexing book ${book.id}`);
    const result = await processBook(book.id, { store });
    console.log(`[worker] book ${book.id} -> ${result.status} (${result.indexedPages} pages)`);
  }
}

main()
  .catch((error: unknown) => {
    console.error('[worker] fatal', error instanceof Error ? error.message : 'error');
    process.exitCode = 1;
  })
  .finally(() => closeDb());
