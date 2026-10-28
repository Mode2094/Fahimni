import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../../lib/admin/http';
import { allowBookAction, bookActionKey } from '../../../../../../lib/books/rate-limit';
import { booksStore } from '../../../../../../lib/books/store';
import { MAX_PDF_BYTES, uploadBook } from '../../../../../../lib/books/upload';
import { studentStore } from '../../../../../../lib/student/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const { id } = await context.params;
  const back = `/admin/subjects/${id}`;
  if (!allowBookAction(`upload:${bookActionKey(request)}`)) {
    return withQuery(auth.origin, back, { error: 'rate_limited' });
  }

  const subject = await studentStore().findSubjectById(id);
  if (!subject) return withQuery(auth.origin, back, { error: 'not_found' });

  // A body larger than the proxy buffer is truncated before it reaches this
  // handler, so multipart parsing fails here instead of the size check below.
  // Report a clear Arabic error and keep the admin on the book screen — never
  // a generic HTTP 500 page.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    const declared = Number(request.headers.get('content-length') ?? '0');
    const oversized = Number.isFinite(declared) && declared > MAX_PDF_BYTES + 1_000_000;
    return withQuery(auth.origin, back, { error: oversized ? 'too_large' : 'invalid_file' });
  }

  const file = form.get('file');
  const title = typeof form.get('title') === 'string' ? String(form.get('title')) : null;
  const replace = form.get('replace') === 'on' || form.get('replace') === 'true';

  let result: Awaited<ReturnType<typeof uploadBook>>;
  try {
    result = await uploadBook({
      store: booksStore(),
      subjectId: subject.id,
      file: file instanceof File ? file : null,
      title,
      replace,
    });
  } catch {
    // Storage/DB failures must never surface as an unhandled 500. The existing
    // book row (and its indexed pages) is left untouched.
    return withQuery(auth.origin, back, { error: 'upload_failed' });
  }
  if (!result.ok) return withQuery(auth.origin, back, { error: result.reason });
  return withQuery(auth.origin, back, { status: 'book_uploaded' });
}
