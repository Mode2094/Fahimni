import { sessionTokenFromRequest, userFromToken } from '../../../lib/auth/request-user';
import { retrieve, sourceFor } from '../../../lib/textbook/retrieval';

// Textbook excerpts are protected content: this endpoint requires an
// authenticated session. It previously served excerpts to anyone, which
// bypassed the entitlement checks on the protected book endpoints.
export async function GET(req: Request) {
  const user = await userFromToken(sessionTokenFromRequest(req));
  if (!user) return new Response('Unauthorized', { status: 401 });
  const q = new URL(req.url).searchParams.get('q') || '';
  return Response.json({ results: retrieve(q.slice(0, 800)).map((c) => ({ ...sourceFor(c), excerpt: c.text.slice(0, 350) })) });
}
