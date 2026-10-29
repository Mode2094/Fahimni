import { NextResponse, type NextRequest } from 'next/server';

import { AuthConfigError, authEnv } from '../../../../lib/auth/env';
import { createOAuthState, googleAuthUrl, OAUTH_STATE_COOKIE, oauthStateCookieOptions } from '../../../../lib/auth/oauth';
import { requestOrigin, safeReturnTo } from '../../../../lib/auth/urls';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  try {
    const env = authEnv();
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
    const { state, challenge, cookie } = await createOAuthState(env.authSecret, returnTo);
    const response = NextResponse.redirect(
      googleAuthUrl({
        clientId: env.googleClientId,
        redirectUri: `${origin}/api/auth/google/callback`,
        state,
        codeChallenge: challenge,
      }),
    );
    response.cookies.set(OAUTH_STATE_COOKIE, cookie, oauthStateCookieOptions(env.secureCookies));
    return response;
  } catch (error) {
    if (!(error instanceof AuthConfigError)) {
      console.error('[auth] google start failed:', error instanceof Error ? error.message : 'unexpected');
    }
    return NextResponse.redirect(new URL(`/login?error=${error instanceof AuthConfigError ? 'config' : 'oauth'}`, origin));
  }
}
