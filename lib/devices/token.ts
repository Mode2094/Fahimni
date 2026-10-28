import { hmacHex, randomToken } from '../auth/crypto';

export const DEVICE_COOKIE = 'fahimni_device';
export const DEVICE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export function createDeviceToken(): string {
  return randomToken(32);
}

export async function hashDeviceToken(token: string, secret: string): Promise<string> {
  return hmacHex(secret, `device:${token}`);
}

export function deviceTokenFromRequest(request: Request): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === DEVICE_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

// The raw device token lives only in this HttpOnly cookie; the database keeps
// an HMAC hash.
export function deviceCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${DEVICE_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(DEVICE_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
