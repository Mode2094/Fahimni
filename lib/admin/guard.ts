import { redirect } from 'next/navigation';

import { requireUser } from '../auth/server';
import type { AuthUser } from '../auth/store';
import { loginPathFor } from '../auth/urls';

export type AdminAccess =
  | { kind: 'login'; loginPath: string }
  | { kind: 'forbidden' }
  | { kind: 'ok'; user: AuthUser };

// Role checks always run against the server-side session; the browser never
// supplies a role or user id.
export function adminAccessFor(user: AuthUser | null, returnTo: string): AdminAccess {
  if (!user) return { kind: 'login', loginPath: loginPathFor(returnTo) };
  if (user.role !== 'ADMIN') return { kind: 'forbidden' };
  return { kind: 'ok', user };
}

export async function requireAdmin(returnTo: string): Promise<AuthUser> {
  const user = await requireUser(returnTo);
  const access = adminAccessFor(user, returnTo);
  if (access.kind === 'login') redirect(access.loginPath);
  if (access.kind === 'forbidden') redirect('/app');
  return access.user;
}
