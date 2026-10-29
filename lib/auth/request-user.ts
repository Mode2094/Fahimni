import { AuthConfigError, authEnv } from './env';
import { resolveSession, SESSION_COOKIE } from './session';
import { authStore, type AuthUser } from './store';

export { SESSION_COOKIE };

export function sessionTokenFromRequest(request: Request): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

// Shared by server components and route handlers. Fails closed when auth is not
// configured; real store failures still surface.
export async function userFromToken(token: string | undefined | null): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const env = authEnv();
    return await resolveSession(authStore(), token, env.authSecret);
  } catch (error) {
    if (error instanceof AuthConfigError) return null;
    throw error;
  }
}
