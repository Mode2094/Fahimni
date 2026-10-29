import { hmacHex, randomToken, sha256Base64Url, stringFromBase64Url, base64UrlFromString, timingSafeEqual } from './crypto';
import { AuthError } from './errors';

export const OAUTH_STATE_COOKIE = 'fahimni_oauth_state';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export type OAuthStatePayload = {
  state: string;
  verifier: string;
  returnTo: string;
  exp: number;
};

export type GoogleProfile = {
  providerAccountId: string;
  email: string;
  name: string | null;
  image: string | null;
};

export function oauthStateCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
  };
}

export async function createOAuthState(
  secret: string,
  returnTo: string,
  now = Date.now(),
): Promise<{ state: string; challenge: string; cookie: string }> {
  const state = randomToken(16);
  const verifier = randomToken(32);
  const challenge = await sha256Base64Url(verifier);
  const payload: OAuthStatePayload = { state, verifier, returnTo, exp: now + OAUTH_STATE_TTL_MS };
  return { state, challenge, cookie: await signOAuthState(payload, secret) };
}

export async function signOAuthState(payload: OAuthStatePayload, secret: string): Promise<string> {
  const body = base64UrlFromString(JSON.stringify(payload));
  return `${body}.${await hmacHex(secret, `oauth-state:${body}`)}`;
}

export async function verifyOAuthState(value: string, secret: string): Promise<OAuthStatePayload | null> {
  const [body, signature, ...rest] = value.split('.');
  if (!body || !signature || rest.length > 0) return null;
  if (!timingSafeEqual(signature, await hmacHex(secret, `oauth-state:${body}`))) return null;
  try {
    const parsed: unknown = JSON.parse(stringFromBase64Url(body));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.state !== 'string' ||
      typeof candidate.verifier !== 'string' ||
      typeof candidate.returnTo !== 'string' ||
      typeof candidate.exp !== 'number'
    ) {
      return null;
    }
    return {
      state: candidate.state,
      verifier: candidate.verifier,
      returnTo: candidate.returnTo,
      exp: candidate.exp,
    };
  } catch {
    return null;
  }
}

export function googleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTHORIZE_URL}?${search.toString()}`;
}

// Server-to-server only: the client secret and the exchanged tokens never leave
// this function. Only the minimal profile is returned.
export async function exchangeGoogleCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleProfile> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
      code_verifier: params.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri,
    }),
    cache: 'no-store',
  });
  if (!tokenResponse.ok) throw new AuthError('oauth_exchange_failed');

  const tokens = (await tokenResponse.json()) as { access_token?: unknown };
  if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
    throw new AuthError('oauth_exchange_failed');
  }

  const userResponse = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    cache: 'no-store',
  });
  if (!userResponse.ok) throw new AuthError('oauth_exchange_failed');

  const profile = (await userResponse.json()) as {
    sub?: unknown;
    email?: unknown;
    email_verified?: unknown;
    name?: unknown;
    picture?: unknown;
  };
  if (typeof profile.sub !== 'string' || !profile.sub || typeof profile.email !== 'string' || !profile.email) {
    throw new AuthError('missing_email');
  }
  if (profile.email_verified !== true) throw new AuthError('email_unverified');

  return {
    providerAccountId: profile.sub,
    email: profile.email.trim().toLowerCase(),
    name: typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : null,
    image: typeof profile.picture === 'string' && profile.picture.trim() ? profile.picture.trim() : null,
  };
}
