import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../../lib/admin/http';
import { removeBookFiles } from '../../../../../../lib/books/storage';
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

  await store.deleteBook(id);
  await removeBookFiles(id).catch(() => undefined);
  return withQuery(auth.origin, `/admin/subjects/${book.subjectId}`, { status: 'book_deleted' });
}
