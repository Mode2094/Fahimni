import { hmacHex, randomToken } from './crypto';
import type { AuthStore, AuthUser } from './store';

export const SESSION_COOKIE = 'fahimni_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
};

export function sessionCookieOptions(secure: boolean): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export async function hashSessionToken(token: string, secret: string): Promise<string> {
  return hmacHex(secret, `session:${token}`);
}

export async function createSession(
  store: AuthStore,
  userId: string,
  secret: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await store.insertSession({ id: await hashSessionToken(token, secret), userId, expiresAt });
  return { token, expiresAt };
}

export async function resolveSession(
  store: AuthStore,
  token: string,
  secret: string,
  now = new Date(),
): Promise<AuthUser | null> {
  if (!token) return null;
  const session = await store.findSession(await hashSessionToken(token, secret));
  if (!session) return null;
  if (session.expiresAt.getTime() <= now.getTime()) {
    await store.deleteSession(session.id).catch(() => undefined);
    return null;
  }
  return store.findUserById(session.userId);
}
