import {test} from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test: transactional credit accounting (including parallel
// charges), idempotent charge/refund, lazy period reset and device storage.
test('credits on PostgreSQL: concurrency, idempotency, refunds, devices', {
 skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
 process.env.DATABASE_URL = testDatabaseUrl as string;
 const {count, eq, sql} = await import('drizzle-orm');
 const {migrate} = await import('drizzle-orm/node-postgres/migrator');
 const {closeDb, getDb} = await import('../db/index');
 const {seedCatalog} = await import('../db/seed');
 const schema = await import('../db/schema');
 const {billingStore} = await import('../lib/billing/store');
 const {ensureCreditPeriod} = await import('../lib/credits/periods');
 const {deviceStore, DEFAULT_MAX_DEVICES} = await import('../lib/devices/store');

 const db = getDb();
 await migrate(db, {migrationsFolder: './drizzle'});
 await seedCatalog(db);

 const billing = billingStore();
 const devices = deviceStore();
 const [math] = await db.select().from(schema.subjects).where(eq(schema.subjects.slug, 'tawjihi-math')).limit(1);
 assert.ok(math);

 const userId = `credits-test-${Date.now()}`;
 const email = `${userId}@example.com`;
 const plan = await billing.upsertSubjectPlan({
  subjectId: math.id,
  type: 'MONTHLY',
  freemiusPlanId: `plan-credits-${Date.now()}`,
  priceMinor: 39_000,
  monthlyCreditAllowance: 200,
  currency: 'JOD',
  isActive: true,
 });
 await db.insert(schema.users).values({ id: userId, email, name: 'طالب', image: null, role: 'STUDENT' });
 const entitlementId = crypto.randomUUID();
 const licenseId = `lic-credits-${Date.now()}`;
  await billing.upsertEntitlement({
   id: entitlementId,
   userId,
   subjectId: math.id,
   subjectPlanId: plan.id,
   offerId: null,
   academicTermId: null,
   freemiusLicenseId: licenseId,
   freemiusSubscriptionId: null,
   status: 'ACTIVE',
   renewalCanceled: false,
   startsAt: null,
   expiresAt: null,
   creditBalance: 5,
   creditPeriodStartedAt: null,
   creditPeriodEndsAt: null,
  });

 try {
  // Lazy period reset initializes the allowance (no accumulation).
  const entitlement = await billing.findEntitlementById(entitlementId);
  assert.ok(entitlement);
  const initialized = await ensureCreditPeriod(billing, entitlement);
  assert.equal(initialized.creditBalance, 200);
  await billing.updateCreditPeriod(entitlementId, 3, new Date(Date.now() - 60_000), new Date(Date.now() - 1000));
  const rolled = await ensureCreditPeriod(billing, (await billing.findEntitlementById(entitlementId))!);
  assert.equal(rolled.creditBalance, 200);

  // Concurrency: 10 parallel single-credit charges on a balance of 5.
  await billing.updateCreditPeriod(entitlementId, 5, new Date(), new Date(Date.now() + 86_400_000));
  const attempts = await Promise.all(
   Array.from({ length: 10 }, (_, index) =>
    billing.chargeCredits({
     entitlementId,
     userId,
     subjectId: math.id,
     operation: 'tutor',
     credits: 1,
     requestId: `concurrent-${index}-${userId}`,
    }),
   ),
  );
  const succeeded = attempts.filter((attempt) => attempt.ok).length;
  assert.equal(succeeded, 5);
  assert.equal((await billing.findEntitlementById(entitlementId))?.creditBalance, 0);
  const [usageCount] = await db.select({ value: count() }).from(schema.aiUsageEvents).where(eq(schema.aiUsageEvents.userId, userId));
  assert.equal(Number(usageCount.value), 5);

  // Idempotent requestId: charging twice deducts once.
  await billing.updateCreditPeriod(entitlementId, 5, new Date(), new Date(Date.now() + 86_400_000));
  const first = await billing.chargeCredits({ entitlementId, userId, subjectId: math.id, operation: 'tutor', credits: 2, requestId: `idem-${userId}` });
  assert.equal(first.ok && first.duplicate === false, true);
  const second = await billing.chargeCredits({ entitlementId, userId, subjectId: math.id, operation: 'tutor', credits: 2, requestId: `idem-${userId}` });
  assert.equal(second.ok && second.duplicate === true, true);
  assert.equal((await billing.findEntitlementById(entitlementId))?.creditBalance, 3);

  // Refund once.
  assert.deepEqual(await billing.refundCredits(`idem-${userId}`), { ok: true, refunded: 2 });
  assert.equal((await billing.findEntitlementById(entitlementId))?.creditBalance, 5);
  assert.deepEqual(await billing.refundCredits(`idem-${userId}`), { ok: false, reason: 'already_refunded' });
  assert.equal((await billing.findEntitlementById(entitlementId))?.creditBalance, 5);

  // A different user can never spend this entitlement's credits.
  const crossUser = await billing.chargeCredits({ entitlementId, userId: 'someone-else', subjectId: math.id, operation: 'tutor', credits: 1, requestId: `cross-${userId}` });
  assert.deepEqual(crossUser, { ok: false, reason: 'insufficient' });
  assert.equal((await billing.findEntitlementById(entitlementId))?.creditBalance, 5);

  // Devices: unique hashes, limit setting, revoke.
  assert.equal(await devices.getMaxDevices(), DEFAULT_MAX_DEVICES);
  await devices.setMaxDevices(3);
  assert.equal(await devices.getMaxDevices(), 3);
  const deviceOne = await devices.createDevice({ id: crypto.randomUUID(), userId, deviceTokenHash: `hash-a-${userId}`, name: 'Chrome · Mac', userAgentSummary: null });
  await devices.createDevice({ id: crypto.randomUUID(), userId, deviceTokenHash: `hash-b-${userId}`, name: 'Safari · iOS', userAgentSummary: null });
  assert.equal(await devices.countActiveDevices(userId), 2);
  await assert.rejects(() => devices.createDevice({ id: crypto.randomUUID(), userId, deviceTokenHash: `hash-a-${userId}`, name: 'dup', userAgentSummary: null }));
  assert.equal(await devices.revokeDevice(userId, deviceOne.id), true);
  assert.equal(await devices.revokeDevice(userId, deviceOne.id), false);
  assert.equal(await devices.countActiveDevices(userId), 1);
  assert.equal(await devices.revokeDevice('someone-else', (await devices.listDevices(userId))[0]?.id ?? ''), false);
 } finally {
  await db.execute(sql`delete from users where id = ${userId}`);
  await db.execute(sql`delete from subject_plans where freemius_plan_id = ${plan.freemiusPlanId}`);
  await db.execute(sql`delete from system_settings where key = 'maxDevicesPerUser'`);
  await closeDb();
 }
});
