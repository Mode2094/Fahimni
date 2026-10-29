import {test} from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test: plans, entitlement mapping, activity filtering and
// webhook idempotency against real PostgreSQL.
test('billing on PostgreSQL: plans, entitlements and webhook idempotency', {
 skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
 process.env.DATABASE_URL = testDatabaseUrl as string;
 const {count, eq, sql} = await import('drizzle-orm');
 const {migrate} = await import('drizzle-orm/node-postgres/migrator');
 const {closeDb, getDb} = await import('../db/index');
 const {seedCatalog} = await import('../db/seed');
 const schema = await import('../db/schema');
 const {hasSubjectAccess, syncEntitlementFromPurchase} = await import('../lib/billing/entitlements');
 const {billingStore} = await import('../lib/billing/store');

 const db = getDb();
 await migrate(db, {migrationsFolder: './drizzle'});
 await seedCatalog(db);

 const store = billingStore();
 const [math] = await db.select().from(schema.subjects).where(eq(schema.subjects.slug, 'tawjihi-math')).limit(1);
 assert.ok(math);

 const seeded = await store.listSubjectPlans(math.id);
 assert.equal(seeded.length, 2);
 assert.ok(seeded.every((plan) => plan.isActive === false && plan.priceMinor !== null));

 const plan = await store.upsertSubjectPlan({
  subjectId: math.id,
  type: 'MONTHLY',
  freemiusPlanId: `plan-test-${Date.now()}`,
  priceMinor: 39_000,
  monthlyCreditAllowance: 200,
  currency: 'JOD',
  isActive: true,
 });
 assert.equal(plan.isActive, true);
 assert.equal((await store.findSubjectPlanByFreemiusPlanId(plan.freemiusPlanId ?? ''))?.id, plan.id);

 const userId = `billing-test-${Date.now()}`;
 const email = `${userId}@example.com`;
 const licenseId = `lic-${Date.now()}`;
 await db.insert(schema.users).values({ id: userId, email, name: 'طالب', image: null, role: 'STUDENT' });
 const findUserByEmail = async (value: string) => (value === email ? { id: userId } : null);

 try {
  const unknownPlan = await syncEntitlementFromPurchase(
   { store, findUserByEmail },
   { email, planId: 'ghost', licenseId, subscriptionId: null, canceled: false, expiration: null, created: new Date() },
  );
  assert.deepEqual(unknownPlan, { ok: false, reason: 'unknown_plan' });

  const saved = await syncEntitlementFromPurchase(
   { store, findUserByEmail },
   { email, planId: plan.freemiusPlanId ?? '', licenseId, subscriptionId: 'sub-1', canceled: false, expiration: null, created: new Date() },
  );
  assert.deepEqual(saved, { ok: true });
  const entitlement = await store.findEntitlementByLicenseId(licenseId);
  assert.equal(entitlement?.userId, userId);
  assert.equal(entitlement?.subjectId, math.id);
  assert.equal(entitlement?.status, 'ACTIVE');
  assert.equal(await hasSubjectAccess(store, userId, math.id), true);
  assert.equal(await hasSubjectAccess(store, 'someone-else', math.id), false);

  await syncEntitlementFromPurchase(
   { store, findUserByEmail },
   { email, planId: plan.freemiusPlanId ?? '', licenseId, subscriptionId: 'sub-1', canceled: true, expiration: null, created: new Date() },
  );
  assert.equal((await store.findEntitlementByLicenseId(licenseId))?.status, 'CANCELED');
  assert.equal(await hasSubjectAccess(store, userId, math.id), false);

  await store.upsertEntitlement({
   id: entitlement?.id ?? crypto.randomUUID(),
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
   expiresAt: new Date(Date.now() - 1000),
   creditBalance: 5,
   creditPeriodStartedAt: null,
   creditPeriodEndsAt: null,
  });
  assert.equal(await store.findActiveEntitlement(userId, math.id, new Date()), null);

  const eventId = `evt-dup-${Date.now()}`;
  await store.recordWebhookEvent(eventId, 'license.created');
  await store.recordWebhookEvent(eventId, 'license.created');
  assert.equal(await store.hasWebhookEvent(eventId), true);
  const [eventCount] = await db
   .select({ value: count() })
   .from(schema.webhookEvents)
   .where(eq(schema.webhookEvents.externalEventId, eventId));
  assert.equal(Number(eventCount.value), 1);

  await store.deleteEntitlementByLicenseId(licenseId);
  assert.equal(await store.findEntitlementByLicenseId(licenseId), null);
 } finally {
  await db.execute(sql`delete from users where id = ${userId}`);
  await db.execute(sql`delete from webhook_events where external_event_id like 'evt-dup-%'`);
  await db.execute(sql`delete from subject_plans where freemius_plan_id = ${plan.freemiusPlanId}`);
  await closeDb();
 }
});
