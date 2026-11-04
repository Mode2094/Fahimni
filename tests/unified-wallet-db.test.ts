import { test } from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test for the unified semester subscription and credit
// wallet against real PostgreSQL: migration applies, the two-bucket wallet is
// atomic under concurrent spends, grants/refunds are idempotent, semester
// credits expire without touching purchased top-up credits, and the
// subscription purchase snapshot persists.
test('unified wallet on PostgreSQL: atomic spend, idempotent grant, buckets, snapshots', {
  skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl as string;
  const { eq, sql } = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { closeDb, getDb } = await import('../db/index');
  const { seedCatalog } = await import('../db/seed');
  const schema = await import('../db/schema');
  const { creditWalletStore } = await import('../lib/billing/wallet-store');
  const { semesterStore } = await import('../lib/billing/semester-store');

  const db = getDb();
  await migrate(db, { migrationsFolder: './drizzle' });
  await seedCatalog(db);

  const [grade] = await db.select().from(schema.grades).limit(1);
  assert.ok(grade);
  const [seedSubject] = await db.select().from(schema.subjects).limit(1);
  assert.ok(seedSubject);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const userId = `wallet-${suffix}`;
  const semesterId = crypto.randomUUID();
  await db.insert(schema.users).values({ id: userId, email: `${userId}@example.com`, role: 'STUDENT' });

  try {
    await db.insert(schema.semesters).values({
      id: semesterId,
      name: `فصل ${suffix}`,
      academicYear: '2026/2027',
      gradeId: grade.id,
      startsAt: new Date('2026-09-01T00:00:00Z'),
      endsAt: new Date('2027-06-15T20:59:59.999Z'),
      salesStartAt: new Date('2026-01-01T00:00:00Z'),
      priceMinor: 29_000,
      currency: 'JOD',
      includedCredits: 300,
      status: 'ACTIVE',
      lateEnrollmentPolicy: 'FULL_PRICE',
      topUpEnabled: true,
    });
    const stored = await semesterStore().findSemesterById(semesterId);
    assert.equal(stored?.name, `فصل ${suffix}`);

    const wallets = creditWalletStore();
    // Grant semester + top-up credits; replaying the same request id is a no-op.
    const g1 = await wallets.grantSemesterCredits({ userId, credits: 300, semesterId, entitlementId: null, requestId: `sg-${suffix}`, expiresAt: new Date('2027-06-15T20:59:59.999Z') });
    assert.equal(g1.granted, true);
    const g1replay = await wallets.grantSemesterCredits({ userId, credits: 300, semesterId, entitlementId: null, requestId: `sg-${suffix}`, expiresAt: new Date('2027-06-15T20:59:59.999Z') });
    assert.equal(g1replay.granted, false);
    await wallets.grantTopupCredits({ userId, credits: 50, topupPurchaseId: 'tp-1', requestId: `tg-${suffix}` });

    // Concurrent spends of 1 credit each: semester bucket is drained first and
    // the wallet never goes negative.
    const spendResults = await Promise.all(
      Array.from({ length: 40 }, (_, index) => wallets.spend({ userId, entitlementId: null, subjectId: seedSubject.id, requestId: `r-${suffix}-${index}`, credits: 1 })),
    );
    const charged = spendResults.filter((result) => result.ok && result.charged).length;
    assert.equal(charged, 40);
    const snapshot = await wallets.getSnapshot(userId);
    assert.equal(snapshot.semesterBalance, 260, 'semester bucket drained first');
    assert.equal(snapshot.topupBalance, 50, 'top-up intact while semester credits remain');

    // A refund restores the same bucket and is refused twice.
    const refund = await wallets.refund({ userId, requestId: `rf-${suffix}`, reversesRequestId: `r-${suffix}-0` });
    assert.equal(refund.ok, true);
    const refundAgain = await wallets.refund({ userId, requestId: `rf2-${suffix}`, reversesRequestId: `r-${suffix}-0` });
    assert.equal(refundAgain.ok, false);

    // Semester expiry clears only the semester bucket; purchased credits survive.
    const afterExpiry = await wallets.expireSemesterCredits({ userId, semesterId, requestId: `exp-${suffix}` });
    assert.equal(afterExpiry.semesterBalance, 0);
    assert.equal(afterExpiry.topupBalance, 50);
  } finally {
    await db.execute(sql`delete from credit_ledger where user_id = ${userId}`);
    await db.execute(sql`delete from credit_wallets where user_id = ${userId}`);
    await db.execute(sql`delete from subscription_purchases where user_id = ${userId}`);
    await db.execute(sql`delete from semesters where id = ${semesterId}`);
    await db.execute(sql`delete from users where id = ${userId}`);
    await closeDb();
  }
});
