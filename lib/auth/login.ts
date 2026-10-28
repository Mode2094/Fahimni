import { isAdminEmail } from './env';
import { AuthError } from './errors';
import type { GoogleProfile } from './oauth';
import { createSession } from './session';
import type { AuthRole, AuthStore, AuthUser } from './store';

export type SignInResult = {
  token: string;
  user: AuthUser;
  expiresAt: Date;
};

// ADMIN_EMAILS is the only source of admin privilege. A login can promote a
// user to ADMIN but never demotes one; the browser cannot influence the role.
export function roleForLogin(currentRole: AuthRole | null, admin: boolean): AuthRole {
  if (currentRole === 'ADMIN') return 'ADMIN';
  return admin ? 'ADMIN' : 'STUDENT';
}

export async function signInWithGoogleProfile(
  profile: GoogleProfile,
  options: {
    store: AuthStore;
    authSecret: string;
    adminEmails: readonly string[];
    now?: Date;
  },
): Promise<SignInResult> {
  const email = profile.email.trim().toLowerCase();
  const admin = isAdminEmail(email, options.adminEmails);

  let user = await options.store.findUserByEmail(email);
  if (!user) {
    await options.store.insertUser({
      id: crypto.randomUUID(),
      email,
      name: profile.name,
      image: profile.image,
      role: roleForLogin(null, admin),
    });
    user = await options.store.findUserByEmail(email);
  }
  if (!user) throw new AuthError('user_create_failed');

  const role = roleForLogin(user.role, admin);
  if (role !== user.role) {
    await options.store.promoteUser(user.id);
    user = { ...user, role };
  }

  await options.store.updateUserProfile(user.id, { name: profile.name, image: profile.image });
  await options.store.linkAccount({
    id: crypto.randomUUID(),
    userId: user.id,
    provider: 'google',
    providerAccountId: profile.providerAccountId,
  });

  const { token, expiresAt } = await createSession(options.store, user.id, options.authSecret, options.now);
  await options.store.deleteExpiredSessions(options.now ?? new Date()).catch(() => undefined);

  return { token, user, expiresAt };
}
