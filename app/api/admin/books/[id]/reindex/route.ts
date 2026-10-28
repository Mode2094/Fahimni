import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../../lib/admin/http';
import { allowBookAction, bookActionKey } from '../../../../../../lib/books/rate-limit';
import { booksStore } from '../../../../../../lib/books/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const { id } = await context.params;
  const store = booksStore();
  const book = await store.findBookById(id);
  if (!book) return withQuery(auth.origin, '/admin/subjects', { error: 'not_found' });

  const back = `/admin/subjects/${book.subjectId}`;
  if (book.status === 'PROCESSING') return withQuery(auth.origin, back, { error: 'busy' });
  if (!allowBookAction(`reindex:${bookActionKey(request)}`)) {
    return withQuery(auth.origin, back, { error: 'rate_limited' });
  }

  await store.updateBook(id, { status: 'UPLOADED', indexedPages: 0, errorMessage: null });
  return withQuery(auth.origin, back, { status: 'book_reindexed' });
}
