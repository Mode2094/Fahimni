import { test } from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Regression tests for the independent financial-integrity review (PR #3).
// These MUST run against real PostgreSQL: every blocker is a transaction /
// concurrency / time-boundary defect that mocks cannot faithfully reproduce.
test('wallet financial integrity: top-up idempotency, negative adjustment, time-correct snapshot', {
  skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl as string;
  const { sql } = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { closeDb, getDb } = await import('../db/index');
  const { seedCatalog } = await import('../db/seed');
  const schema = await import('../db/schema');
  const { creditWalletStore, reconcileWallet } = await import('../lib/billing/wallet-store');

  const db = getDb();
  await migrate(db, { migrationsFolder: './drizzle' });
  await seedCatalog(db);

  const [grade] = await db.select().from(schema.grades).limit(1);
  const [subject] = await db.select().from(schema.subjects).limit(1);
  assert.ok(grade && subject);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const semesterId = crypto.randomUUID();
  const wallets = creditWalletStore();
  const users: string[] = [];

  const newUser = async (label: string) => {
    const userId = `${label}-${suffix}`;
    await db.insert(schema.users).values({ id: userId, email: `${userId}@example.com`, role: 'STUDENT' });
    users.push(userId);
    return userId;
  };

  try {
    await db.insert(schema.semesters).values({
      id: semesterId, name: `فصل ${suffix}`, academicYear: '2026/2027', gradeId: grade.id,
      startsAt: new Date('2026-09-01T00:00:00Z'), endsAt: new Date('2027-06-15T20:59:59.999Z'),
      salesStartAt: new Date('2026-01-01T00:00:00Z'), priceMinor: 29_000, currency: 'JOD',
      includedCredits: 300, status: 'ACTIVE', lateEnrollmentPolicy: 'FULL_PRICE', topUpEnabled: true,
    });

    /* -------------------- BLOCKER 1: top-up-only idempotency ---------------- */
    {
      const userId = await newUser('blocker1');
      await wallets.grantTopupCredits({ userId, credits: 100, topupPurchaseId: 'tp-b1', requestId: `b1-grant-${suffix}` });
      const requestId = `b1-spend-${suffix}`;
      const results = [];
      for (let i = 0; i < 20; i += 1) {
        results.push(await wallets.spend({ userId, entitlementId: null, subjectId: subject.id, requestId, credits: 10 }));
      }
      const charged = results.filter((r) => r.ok && r.charged).length;
      const duplicates = results.filter((r) => r.ok && r.duplicate).length;
      assert.equal(charged, 1, 'exactly one charge for 20 identical requests');
      assert.equal(duplicates, 19, 'every replay is reported as a duplicate');
      const snap = await wallets.getSnapshot(userId);
      assert.equal(snap.topupBalance, 90, 'top-up balance is 90, not -100');
    }

    /* ------------- BLOCKER 1b: concurrent replay (same request id) ---------- */
    {
      const userId = await newUser('blocker1c');
      await wallets.grantTopupCredits({ userId, credits: 100, topupPurchaseId: 'tp-b1c', requestId: `b1c-grant-${suffix}` });
      const requestId = `b1c-spend-${suffix}`;
      const results = await Promise.all(
        Array.from({ length: 12 }, () => wallets.spend({ userId, entitlementId: null, subjectId: subject.id, requestId, credits: 10 })),
      );
      assert.equal(results.filter((r) => r.ok && r.charged).length, 1, 'one charge under concurrent replay');
      assert.equal((await wallets.getSnapshot(userId)).topupBalance, 90);
    }

    /* --------- BLOCKER 1c: mixed semester + top-up, then refund once -------- */
    {
      const userId = await newUser('blocker1m');
      await wallets.grantSemesterCredits({ userId, credits: 5, semesterId, entitlementId: null, requestId: `b1m-sg-${suffix}`, expiresAt: new Date('2027-06-15T20:59:59.999Z') });
      await wallets.grantTopupCredits({ userId, credits: 100, topupPurchaseId: 'tp-b1m', requestId: `b1m-tg-${suffix}` });
      const requestId = `b1m-spend-${suffix}`;
      const first = await wallets.spend({ userId, entitlementId: null, subjectId: subject.id, requestId, credits: 10 });
      assert.equal(first.ok && first.charged, true);
      // Replay is a duplicate (mixed: 5 semester + 5 top-up).
      const replay = await wallets.spend({ userId, entitlementId: null, subjectId: subject.id, requestId, credits: 10 });
      assert.equal(replay.ok && replay.duplicate, true);
      const afterSpend = await wallets.getSnapshot(userId);
      assert.equal(afterSpend.semesterBalance, 0);
      assert.equal(afterSpend.topupBalance, 95);
      // Refund restores both buckets exactly once.
      const refund = await wallets.refund({ userId, requestId: `b1m-refund-${suffix}`, reversesRequestId: requestId });
      assert.equal(refund.ok && refund.refunded, 10);
      const afterRefund = await wallets.getSnapshot(userId);
      assert.equal(afterRefund.semesterBalance, 5);
      assert.equal(afterRefund.topupBalance, 100);
      const secondRefund = await wallets.refund({ userId, requestId: `b1m-refund2-${suffix}`, reversesRequestId: requestId });
      assert.equal(secondRefund.ok, false);
    }

    /* ---------------- BLOCKER 2: negative semester adjustment --------------- */
    {
      const userId = await newUser('blocker2');
      await wallets.grantSemesterCredits({ userId, credits: 100, semesterId, entitlementId: null, requestId: `b2-sg-${suffix}`, expiresAt: new Date('2027-06-15T20:59:59.999Z') });
      const before = await wallets.getSnapshot(userId);
      assert.equal(before.semesterBalance, 100);
      const adjusted = await wallets.adjust({ userId, bucket: 'SEMESTER', delta: -20, actorId: null, reason: 'تصحيح إداري', requestId: `b2-adj-${suffix}`, semesterId });
      assert.equal(adjusted.semesterBalance, 80, 'semester balance becomes 80');
      const recon = await reconcileWallet(userId);
      assert.deepEqual(recon.mismatches, [], 'ledger/grant reconciliation matches after negative adjustment');

      // Over-deduction beyond available credits is rejected.
      await assert.rejects(() => wallets.adjust({ userId, bucket: 'SEMESTER', delta: -1000, actorId: null, reason: 'اختبار', requestId: `b2-over-${suffix}`, semesterId }));
      // Missing semester context is rejected (never an arbitrary semester).
      await assert.rejects(() => wallets.adjust({ userId, bucket: 'SEMESTER', delta: -5, actorId: null, reason: 'اختبار', requestId: `b2-nosem-${suffix}` }));
    }

    /* ------------- BLOCKER 2b: concurrent adjustment + consumption ---------- */
    {
      const userId = await newUser('blocker2c');
      await wallets.grantSemesterCredits({ userId, credits: 100, semesterId, entitlementId: null, requestId: `b2c-sg-${suffix}`, expiresAt: new Date('2027-06-15T20:59:59.999Z') });
      await Promise.all([
        wallets.adjust({ userId, bucket: 'SEMESTER', delta: -20, actorId: null, reason: 'تصحيح', requestId: `b2c-adj-${suffix}`, semesterId }),
        wallets.spend({ userId, entitlementId: null, subjectId: subject.id, requestId: `b2c-spend-${suffix}`, credits: 30 }),
      ]);
      const snap = await wallets.getSnapshot(userId);
      assert.equal(snap.semesterBalance, 50, '100 - 20 (adjust) - 30 (spend) = 50');
      const recon = await reconcileWallet(userId);
      assert.deepEqual(recon.mismatches, []);
    }

    /* --------- BLOCKER 3: time-correct snapshot at a semester boundary ------ */
    {
      const userId = await newUser('blocker3');
      // A reserved grant that becomes spendable only after its start time.
      const futureStart = new Date(Date.now() + 2_000);
      await wallets.grantSemesterCredits({ userId, credits: 300, semesterId, entitlementId: null, requestId: `b3-sg-${suffix}`, startsAt: futureStart, expiresAt: new Date(Date.now() + 86_400_000) });
      // Before the start: not spendable.
      const before = await wallets.getSnapshot(userId);
      assert.equal(before.semesterBalance, 0, 'future grant is not spendable yet');
      // Wait past the start with NO intervening mutation, then read again.
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      const after = await wallets.getSnapshot(userId);
      assert.equal(after.semesterBalance, 300, 'newly available credits appear on the first read after the boundary');
    }

    /* ------------- BLOCKER 4: reconciliation covers the population ---------- */
    {
      const userId = await newUser('blocker4');
      await wallets.grantTopupCredits({ userId, credits: 50, topupPurchaseId: 'tp-b4', requestId: `b4-tg-${suffix}` });
      await wallets.spend({ userId, entitlementId: null, subjectId: subject.id, requestId: `b4-spend-${suffix}`, credits: 10 });
      const recon = await reconcileWallet(userId);
      assert.deepEqual(recon.mismatches, []);
      assert.equal(recon.walletTopupBalance, 40);
      assert.equal(recon.ledgerTopupBalance, 40);
    }

    /* --------- BLOCKER 5: unchanged top-up offer does not affect purchased --- */
    {
      // A settled top-up purchase keeps its snapshot; editing the offer later
      // never retroactively changes the granted credits.
      const userId = await newUser('blocker5');
      const purchaseId = crypto.randomUUID();
      await db.insert(schema.topupPurchases).values({
        id: purchaseId, userId, offerId: null, offerName: '100 كريدت', credits: 100,
        priceMinor: 5_000, currency: 'JOD', status: 'ACTIVE', provider: 'freemius',
        providerTransactionId: `tx-b5-${suffix}`, creditsGrantedAt: null,
      });
      const grant = await wallets.grantTopupCredits({ userId, credits: 100, topupPurchaseId: purchaseId, requestId: `b5-grant-${suffix}` });
      assert.equal(grant.granted, true);
      // Replay of the settlement grants nothing more.
      const replay = await wallets.grantTopupCredits({ userId, credits: 100, topupPurchaseId: purchaseId, requestId: `b5-grant-${suffix}` });
      assert.equal(replay.granted, false);
      assert.equal((await wallets.getSnapshot(userId)).topupBalance, 100);
    }
  } finally {
    for (const userId of users) {
      await db.execute(sql`delete from credit_operations where user_id = ${userId}`);
      await db.execute(sql`delete from credit_grant_debits where grant_id in (select id from semester_credit_grants where user_id = ${userId})`);
      await db.execute(sql`delete from semester_credit_grants where user_id = ${userId}`);
      await db.execute(sql`delete from credit_ledger where user_id = ${userId}`);
      await db.execute(sql`delete from topup_purchases where user_id = ${userId}`);
      await db.execute(sql`delete from credit_wallets where user_id = ${userId}`);
      await db.execute(sql`delete from subscription_purchases where user_id = ${userId}`);
    }
    await db.execute(sql`delete from semesters where id = ${semesterId}`);
    await db.execute(sql`delete from users where id = any(${sql.raw(`ARRAY[${users.map((u) => `'${u}'`).join(',')}]::text[]`)})`);
    await closeDb();
  }
});
