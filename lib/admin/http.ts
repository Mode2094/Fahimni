import { sessionTokenFromRequest, userFromToken } from '../auth/request-user';
import type { AuthUser } from '../auth/store';
import { loginPathFor, requestOrigin } from '../auth/urls';
import { sameOrigin } from '../http';

export type AdminRequestAuth =
  | { kind: 'forbidden' }
  | { kind: 'login'; response: Response }
  | { kind: 'ok'; user: AuthUser; origin: string };

export function redirectTo(target: URL | string, status = 303): Response {
  return new Response(null, { status, headers: { Location: String(target) } });
}

export function forbidden(): Response {
  return new Response('Forbidden', { status: 403 });
}

export function withQuery(origin: string, path: string, params: Record<string, string>): Response {
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return redirectTo(url);
}

// Admin APIs trust only the server-side session; a STUDENT session is treated
// exactly like an anonymous caller.
export async function authorizeAdminRequest(request: Request): Promise<AdminRequestAuth> {
  if (!sameOrigin(request)) return { kind: 'forbidden' };
  const origin = requestOrigin(request);
  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) return { kind: 'login', response: redirectTo(new URL(loginPathFor('/admin'), origin)) };
  if (user.role !== 'ADMIN') return { kind: 'forbidden' };
  return { kind: 'ok', user, origin };
}
