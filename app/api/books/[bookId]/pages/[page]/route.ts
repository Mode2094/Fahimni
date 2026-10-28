import { readFile } from 'node:fs/promises';

import { sessionTokenFromRequest, userFromToken } from '../../../../../../lib/auth/request-user';
import { billingStore } from '../../../../../../lib/billing/store';
import { resolveBookPage } from '../../../../../../lib/books/pages';
import { booksStore } from '../../../../../../lib/books/store';
import { studentStore } from '../../../../../../lib/student/store';
import { trialStore } from '../../../../../../lib/trial/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ bookId: string; page: string }> }) {
  const { bookId, page } = await context.params;

  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) return new Response('Unauthorized', { status: 401 });

  const resolved = await resolveBookPage({
    bookId,
    page,
    user,
    books: booksStore(),
    students: studentStore(),
    billing: billingStore(),
    trials: trialStore(),
  });
  if (!resolved.ok) return new Response('Not found', { status: 404 });

  try {
    const bytes = await readFile(resolved.path);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
