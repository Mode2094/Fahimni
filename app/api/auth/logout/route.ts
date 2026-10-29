import { NextResponse, type NextRequest } from 'next/server';

import { AuthConfigError, authEnv } from '../../../../lib/auth/env';
import { hashSessionToken, SESSION_COOKIE, sessionCookieOptions } from '../../../../lib/auth/session';
import { authStore } from '../../../../lib/auth/store';
import { requestOrigin } from '../../../../lib/auth/urls';
import { sameOrigin } from '../../../../lib/http';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse('Forbidden', { status: 403 });

  const secure = process.env.NODE_ENV === 'production';
  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) {
      const env = authEnv();
      await authStore().deleteSession(await hashSessionToken(token, env.authSecret));
    }
  } catch (error) {
    // Logout stays best-effort; the cookie is cleared even if the store is unavailable.
    if (!(error instanceof AuthConfigError)) {
      console.error('[auth] logout failed:', error instanceof Error ? error.message : 'unexpected');
    }
  }

  const response = NextResponse.redirect(new URL('/login', requestOrigin(request)), 303);
  response.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(secure), maxAge: 0 });
  return response;
}

export async function GET() {
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}
