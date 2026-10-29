import { sessionTokenFromRequest, userFromToken } from '../../../lib/auth/request-user';
import { retrieve, sourceFor } from '../../../lib/textbook/retrieval';

// Legacy bundled-textbook excerpt endpoint (Grade-10 mathematics,
// `data/textbook.json`).
//
// It previously served excerpts to anyone, then to any signed-in user — but a
// session is not subject entitlement, so it still bypassed the paywall used by
// the protected `/api/books/...` endpoints. It is now development-only, exactly
// like the legacy classroom page it belongs to (`app/legacy/page.tsx`): in
// production it answers 404, so no legacy excerpt is reachable. The legacy path
// is being migrated to the entitlement-checked subject book pipeline; until
// then it is not a production surface. See
// `docs/reviews/phase-1-corrective-review.md` for the rights decision pending.
export async function GET(req: Request) {
  if (process.env.NODE_ENV === 'production') return new Response('Not found', { status: 404 });

  // Defence in depth: even in development only an authenticated session may
  // request excerpts. Anonymous callers never receive textbook content.
  const user = await userFromToken(sessionTokenFromRequest(req));
  if (!user) return new Response('Unauthorized', { status: 401 });
  const q = new URL(req.url).searchParams.get('q') || '';
  return Response.json({ results: retrieve(q.slice(0, 800)).map((c) => ({ ...sourceFor(c), excerpt: c.text.slice(0, 350) })) });
}
