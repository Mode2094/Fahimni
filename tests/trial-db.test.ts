import { test } from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test: free-trial claims, unique-constraint races, shared
// wallet concurrency, refunds, settings and metrics against real PostgreSQL.
test('free trials on PostgreSQL: claims, races, wallet, refunds, metrics', {
  skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl as string;
  const { eq, inArray, sql } = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { closeDb, getDb } = await import('../db/index');
  const { seedCatalog } = await import('../db/seed');
  const schema = await import('../db/schema');
  const { trialStore } = await import('../lib/trial/store');

  const db = getDb();
  await migrate(db, { migrationsFolder: './drizzle' });
  await seedCatalog(db);

  const stamp = Date.now();
  const [math] = await db.select().from(schema.subjects).where(eq(schema.subjects.slug, 'tawjihi-math')).limit(1);
  assert.ok(math);

  const trials = trialStore();
  const userIds = [1, 2, 3, 4, 5, 6].map((index) => `trial-db-${index}-${stamp}`);
  await db.insert(schema.users).values(userIds.map((id) => ({ id, email: `${id}@example.com`, name: 'طالب', image: null, role: 'STUDENT' as const })));

  const claim = (userId: string, hash: string) =>
    trials.claim({ id: crypto.randomUUID(), userId, browserIdentityHash: hash, totalCredits: 15, claimedAt: new Date() });

  try {
    // Parallel claims for one account can never create two wallets.
    const [first, second] = await Promise.all([claim(userIds[0], `hash-a-${stamp}`), claim(userIds[0], `hash-b-${stamp}`)]);
    const kinds = [first.kind, second.kind].sort();
    assert.deepEqual(kinds, ['created', 'existing']);
    const [countRow] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.freeTrials)
      .where(eq(schema.freeTrials.userId, userIds[0]));
    assert.equal(countRow.value, 1);

    // A browser identity already bound to another account is refused.
    const bound = await claim(userIds[2], `hash-shared-${stamp}`);
    assert.equal(bound.kind, 'created');
    const conflict = await claim(userIds[3], `hash-shared-${stamp}`);
    assert.equal(conflict.kind, 'browser_conflict');
    const original = await claim(userIds[2], `hash-shared-${stamp}`);
    assert.equal(original.kind, 'existing');

    // Atomic start: parallel first requests converge on one ACTIVE window.
    const claimed = await claim(userIds[4], `hash-start-${stamp}`);
    assert.equal(claimed.kind, 'created');
    if (claimed.kind !== 'created') return;
    const nowA = new Date();
    const nowB = new Date(nowA.getTime() + 1000);
    await Promise.all([
      trials.start(claimed.trial.id, nowA, new Date(nowA.getTime() + 48 * 3600_000)),
      trials.start(claimed.trial.id, nowB, new Date(nowB.getTime() + 48 * 3600_000)),
    ]);
    const started = await trials.findByUserId(userIds[4]);
    assert.equal(started?.status, 'ACTIVE');
    // Exactly one of the racing starts wins; the window is 48h from its start.
    assert.ok([nowA.getTime(), nowB.getTime()].includes(started?.startedAt?.getTime() ?? 0));
    assert.equal(
      (started?.expiresAt as Date).getTime() - (started?.startedAt as Date).getTime(),
      48 * 3600_000,
    );

    // Shared wallet concurrency: bring the balance to 5, then 10 parallel
    // 1-credit charges — exactly 5 may succeed.
    const preCharge = await trials.chargeTrialCredits({
      trialId: claimed.trial.id,
      userId: userIds[4],
      subjectId: math.id,
      operation: 'tutor',
      credits: 10,
      requestId: `trial-prereset-${stamp}`,
      estimatedCostMicroUsd: 0,
    });
    assert.equal(preCharge.ok, true);
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        trials.chargeTrialCredits({
          trialId: claimed.trial.id,
          userId: userIds[4],
          subjectId: math.id,
          operation: 'tutor',
          credits: 1,
          requestId: `trial-concurrent-${index}-${stamp}`,
          estimatedCostMicroUsd: 30_000,
        }),
      ),
    );
    assert.equal(attempts.filter((attempt) => attempt.ok).length, 5);
    const afterCharges = await trials.findByUserId(userIds[4]);
    assert.equal(afterCharges?.remainingCredits, 0);
    assert.equal(afterCharges?.status, 'EXHAUSTED');

    // Refunds restore the wallet exactly once and reopen an exhausted trial.
    const refundTrial = await claim(userIds[5], `hash-refund-${stamp}`);
    if (refundTrial.kind !== 'created') return;
    await trials.start(refundTrial.trial.id, new Date(), new Date(Date.now() + 48 * 3600_000));
    const charged = await trials.chargeTrialCredits({
      trialId: refundTrial.trial.id,
      userId: userIds[5],
      subjectId: math.id,
      operation: 'vision',
      credits: 15,
      requestId: `trial-refund-${stamp}`,
      estimatedCostMicroUsd: 20_000,
    });
    assert.equal(charged.ok, true);
    assert.equal((await trials.findByUserId(userIds[5]))?.status, 'EXHAUSTED');
    const refunded = await trials.refundTrialCredits(`trial-refund-${stamp}`);
    assert.deepEqual(refunded, { ok: true, refunded: 15 });
    const reopened = await trials.findByUserId(userIds[5]);
    assert.equal(reopened?.remainingCredits, 15);
    assert.equal(reopened?.status, 'ACTIVE');
    assert.deepEqual(await trials.refundTrialCredits(`trial-refund-${stamp}`), { ok: false, reason: 'already_refunded' });

    // Trial usage is auditable through ai_usage_events.trial_id without any
    // fabricated paid entitlement.
    const [usageRow] = await db
      .select({ trialId: schema.aiUsageEvents.trialId, entitlementId: schema.aiUsageEvents.entitlementId })
      .from(schema.aiUsageEvents)
      .where(eq(schema.aiUsageEvents.requestId, `trial-refund-${stamp}`))
      .limit(1);
    assert.equal(usageRow.trialId, refundTrial.trial.id);
    assert.equal(usageRow.entitlementId, null);

    // Settings persist and drive metrics; refunded cost is excluded.
    await trials.setSettings({ enabled: false, creditAllowance: 20, durationHours: 24, dailyBudgetUsd: 7 });
    const settings = await trials.getSettings();
    assert.deepEqual(settings, { enabled: false, creditAllowance: 20, durationHours: 24, dailyBudgetUsd: 7 });

    const metrics = await trials.metrics();
    assert.ok(metrics.claimed >= 4);
    assert.ok(metrics.started >= 2);
    assert.ok(metrics.exhausted >= 1);
    assert.equal(metrics.creditsConsumed, 15); // 10 pre-charge + 5 concurrent; refunded usage restored
    assert.equal(metrics.estimatedCostMicroUsd, 150_000); // 5 × 30,000 (refunded vision reservation excluded)
  } finally {
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    await db.execute(sql`delete from system_settings where key in ('trialEnabled','trialCreditAllowance','trialDurationHours','trialDailyAiBudgetUsd')`);
    await closeDb();
  }
});
