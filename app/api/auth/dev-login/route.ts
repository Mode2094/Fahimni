import { createSession, SESSION_COOKIE, sessionCookieOptions } from '../../../../lib/auth/session';
import { authSecret } from '../../../../lib/auth/env';
import { authStore } from '../../../../lib/auth/store';
import { requestOrigin } from '../../../../lib/auth/urls';

export const dynamic = 'force-dynamic';

// DEV-ONLY login shortcut for local work without a real Google OAuth client.
// It is disabled in production and refuses unless DEV_LOGIN_ENABLED=true.
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.DEV_LOGIN_ENABLED !== 'true') {
    return new Response('Not found', { status: 404 });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get('target') === 'admin' ? 'admin' : 'student';
  const email = target === 'admin' ? 'dev-admin@fahimni.local' : 'dev-student@fahimni.local';

  const store = authStore();
  const user = await store.findUserByEmail(email);
  if (!user) {
    return new Response('Dev user not found. Run: pnpm dev:seed-login', { status: 404 });
  }

  const { token } = await createSession(store, user.id, authSecret());
  const secure = (process.env.NODE_ENV as string | undefined) === 'production';
  const cookie = sessionCookieOptions(secure);
  const header = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=${cookie.path}; Max-Age=${cookie.maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

  const origin = requestOrigin(request);
  const destination = target === 'admin' ? '/admin' : '/app';
  return new Response(null, {
    status: 303,
    headers: { Location: new URL(destination, origin).toString(), 'Set-Cookie': header },
  });
}
