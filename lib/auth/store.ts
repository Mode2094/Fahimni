import { eq, lt } from 'drizzle-orm';

import { getDb } from '../../db';
import { accounts, sessions, users } from '../../db/schema';
import type { AuthRole } from './types';

export type { AuthRole } from './types';

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: AuthRole;
};

export type NewAuthUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: AuthRole;
};

export type AuthSession = {
  id: string;
  userId: string;
  expiresAt: Date;
};

export type AuthStore = {
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  insertUser(user: NewAuthUser): Promise<void>;
  promoteUser(id: string): Promise<void>;
  updateUserProfile(id: string, profile: { name: string | null; image: string | null }): Promise<void>;
  linkAccount(account: { id: string; userId: string; provider: string; providerAccountId: string }): Promise<void>;
  insertSession(session: AuthSession): Promise<void>;
  findSession(id: string): Promise<AuthSession | null>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<void>;
};

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  image: users.image,
  role: users.role,
};

export function createDrizzleStore(): AuthStore {
  return {
    async findUserByEmail(email) {
      const [row] = await getDb().select(userColumns).from(users).where(eq(users.email, email)).limit(1);
      return row ?? null;
    },

    async findUserById(id) {
      const [row] = await getDb().select(userColumns).from(users).where(eq(users.id, id)).limit(1);
      return row ?? null;
    },

    async insertUser(user) {
      await getDb().insert(users).values(user).onConflictDoNothing({ target: users.email });
    },

    async promoteUser(id) {
      await getDb().update(users).set({ role: 'ADMIN', updatedAt: new Date() }).where(eq(users.id, id));
    },

    async updateUserProfile(id, profile) {
      const patch: { updatedAt: Date; name?: string; image?: string } = { updatedAt: new Date() };
      if (profile.name !== null) patch.name = profile.name;
      if (profile.image !== null) patch.image = profile.image;
      await getDb().update(users).set(patch).where(eq(users.id, id));
    },

    async linkAccount(account) {
      await getDb().insert(accounts).values(account).onConflictDoNothing();
    },

    async insertSession(session) {
      await getDb().insert(sessions).values(session);
    },

    async findSession(id) {
      const [row] = await getDb()
        .select({ id: sessions.id, userId: sessions.userId, expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(eq(sessions.id, id))
        .limit(1);
      return row ?? null;
    },

    async deleteSession(id) {
      await getDb().delete(sessions).where(eq(sessions.id, id));
    },

    async deleteExpiredSessions(now) {
      await getDb().delete(sessions).where(lt(sessions.expiresAt, now));
    },
  };
}

let override: AuthStore | null = null;

export function setAuthStoreForTests(store: AuthStore | null): void {
  override = store;
}

export function authStore(): AuthStore {
  return override ?? createDrizzleStore();
}
