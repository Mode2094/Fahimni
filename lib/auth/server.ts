import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { userFromToken, SESSION_COOKIE } from './request-user';
import type { AuthUser } from './store';
import { loginPathFor } from './urls';

export async function currentUser(): Promise<AuthUser | null> {
  const jar = await cookies();
  return userFromToken(jar.get(SESSION_COOKIE)?.value);
}

export async function requireUser(returnTo: string): Promise<AuthUser> {
  const user = await currentUser();
  if (!user) redirect(loginPathFor(returnTo));
  return user;
}
