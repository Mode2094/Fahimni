import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sql} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test: proves the generated migrations apply and that the
// real Drizzle store round-trips a Google login. Skipped unless TEST_DATABASE_URL
// points at a disposable PostgreSQL database.
test('postgres store: migrations apply and a Google login round-trips', {
 skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
 process.env.DATABASE_URL = testDatabaseUrl as string;
 const {closeDb, getDb} = await import('../db/index');
 const {signInWithGoogleProfile} = await import('../lib/auth/login');
 const {hashSessionToken, resolveSession} = await import('../lib/auth/session');
 const {authStore} = await import('../lib/auth/store');

 const db = getDb();
 await migrate(db, {migrationsFolder: './drizzle'});

 const email = `student-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
 try {
  const {user, token} = await signInWithGoogleProfile(
   {providerAccountId: `google-${email}`, email, name: 'طالب اختبار', image: null},
   {store: authStore(), authSecret: 'integration-secret', adminEmails: [email]},
  );
  assert.equal(user.role, 'ADMIN');
  assert.equal((await resolveSession(authStore(), token, 'integration-secret'))?.id, user.id);

  await authStore().deleteSession(await hashSessionToken(token, 'integration-secret'));
  assert.equal(await resolveSession(authStore(), token, 'integration-secret'), null);
 } finally {
  await db.execute(sql`delete from users where email = ${email}`);
  await closeDb();
 }
});
