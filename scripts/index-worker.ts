import { closeDb } from '../db/index';
import { processBook, recoverOrphanedStaging } from '../lib/books/indexing';
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

  // Crash recovery: drop staged replacement copies that no book is tracking, so
  // a crash between the staging file write and the database write cannot leak
  // orphaned files. Tracked (pending) replacements are kept for re-processing.
  const recovered = await recoverOrphanedStaging(store, await store.listBookIds()).catch(() => 0);
  if (recovered > 0) console.log(`[worker] removed ${recovered} orphaned staged source(s)`);

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
