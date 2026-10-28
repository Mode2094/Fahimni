import { NextResponse, type NextRequest } from 'next/server';

import { AuthConfigError, authEnv } from '../../../../../lib/auth/env';
import { AuthError } from '../../../../../lib/auth/errors';
import { signInWithGoogleProfile } from '../../../../../lib/auth/login';
import { exchangeGoogleCode, OAUTH_STATE_COOKIE, verifyOAuthState } from '../../../../../lib/auth/oauth';
import { sessionCookieOptions, SESSION_COOKIE } from '../../../../../lib/auth/session';
import { authStore } from '../../../../../lib/auth/store';
import { timingSafeEqual } from '../../../../../lib/auth/crypto';
import { requestOrigin, safeReturnTo } from '../../../../../lib/auth/urls';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const secure = process.env.NODE_ENV === 'production';

  const fail = (code: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${code}`, origin));
    response.cookies.set(OAUTH_STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0 });
    return response;
  };

  try {
    const env = authEnv();
    const cookieValue = request.cookies.get(OAUTH_STATE_COOKIE)?.value ?? '';
    const state = url.searchParams.get('state') ?? '';
    const code = url.searchParams.get('code') ?? '';

    if (url.searchParams.get('error') || !cookieValue || !state || !code) return fail('oauth');

    const payload = await verifyOAuthState(cookieValue, env.authSecret);
    if (!payload || payload.exp <= Date.now() || !timingSafeEqual(payload.state, state)) return fail('oauth');

    const profile = await exchangeGoogleCode({
      code,
      codeVerifier: payload.verifier,
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      redirectUri: `${origin}/api/auth/google/callback`,
    });

    const { token, user } = await signInWithGoogleProfile(profile, {
      store: authStore(),
      authSecret: env.authSecret,
      adminEmails: env.adminEmails,
    });

    // Admins land on their dashboard by default; explicit safe returnTo values
    // are always preserved. Students keep the existing '/app' behavior.
    const target = user.role === 'ADMIN' && payload.returnTo === '/app' ? '/admin' : safeReturnTo(payload.returnTo);
    const response = NextResponse.redirect(new URL(target, origin));
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(env.secureCookies));
    response.cookies.set(OAUTH_STATE_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0 });
    return response;
  } catch (error) {
    if (error instanceof AuthConfigError) return fail('config');
    // AuthError codes and unexpected failures are logged without tokens or headers.
    console.error('[auth] google callback failed:', error instanceof AuthError ? error.code : 'unexpected');
    return fail('oauth');
  }
}
