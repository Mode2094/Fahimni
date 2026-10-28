import { authSecret } from '../auth/env';
import { hmacHex, randomToken } from '../auth/crypto';

export const TRIAL_IDENTITY_COOKIE = 'fahimni_trial_identity';
// The anti-reuse record must outlive the 48h trial by a wide margin.
export const TRIAL_IDENTITY_TTL_MS = 180 * 24 * 60 * 60 * 1000;

// Cryptographically random, server-generated; only the HMAC hash is stored.
export function createTrialIdentityToken(): string {
  return randomToken(32);
}

export async function hashTrialIdentityToken(token: string, secret: string): Promise<string> {
  return hmacHex(secret, `trial-identity:${token}`);
}

export function trialIdentityFromRequest(request: Request): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === TRIAL_IDENTITY_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

// Secure/HttpOnly/SameSite: the raw token never reaches JavaScript and never
// appears in APIs.
export function trialIdentityCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${TRIAL_IDENTITY_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(TRIAL_IDENTITY_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Dedicated secret when configured, otherwise the existing auth secret.
export function trialIdentitySecret(): string {
  const dedicated = process.env.TRIAL_IDENTITY_SECRET?.trim();
  if (dedicated) return dedicated;
  return authSecret();
}
