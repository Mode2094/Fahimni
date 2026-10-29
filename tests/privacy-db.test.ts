import { test } from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test: retention pruning removes only rows past the policy
// cutoffs and never touches recent rows or learning progress.
test('retention on PostgreSQL: old operational rows are pruned, recent rows stay', {
  skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl as string;
  const { sql } = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { closeDb, getDb } = await import('../db/index');
  const schema = await import('../db/schema');
  const { pruneOldData, RETENTION_DAYS } = await import('../lib/privacy/retention');

  const db = getDb();
  await migrate(db, { migrationsFolder: './drizzle' });

  const stamp = Date.now();
  const userId = `privacy-test-${stamp}`;
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  await db.insert(schema.users).values({ id: userId, email: `${userId}@example.com`, name: 'طالب', image: null, role: 'STUDENT' });
  await db.insert(schema.webhookEvents).values([
    { id: `wh-old-${stamp}`, externalEventId: `evt-old-${stamp}`, type: 'license.created', processedAt: daysAgo(300), createdAt: daysAgo(300) },
    { id: `wh-new-${stamp}`, externalEventId: `evt-new-${stamp}`, type: 'license.created', processedAt: daysAgo(1), createdAt: daysAgo(1) },
    { id: `wh-unprocessed-${stamp}`, externalEventId: `evt-unprocessed-${stamp}`, type: 'license.created', processedAt: null, createdAt: daysAgo(300) },
  ]);
  await db.insert(schema.billingEvents).values([
    { id: `be-old-${stamp}`, type: 'license.cancelled', summary: 'قديم', createdAt: daysAgo(500) },
    { id: `be-new-${stamp}`, type: 'license.cancelled', summary: 'جديد', createdAt: daysAgo(1) },
  ]);
  await db.insert(schema.settingAuditLog).values([
    { id: `sa-old-${stamp}`, scope: 'freemius', key: 'apiKey', action: 'saved', createdAt: daysAgo(500) },
    { id: `sa-new-${stamp}`, scope: 'freemius', key: 'apiKey', action: 'saved', createdAt: daysAgo(1) },
  ]);
  await db.insert(schema.registeredDevices).values([
    { id: `dev-old-${stamp}`, userId, deviceTokenHash: `hash-old-${stamp}`, name: 'جهاز قديم', lastSeenAt: daysAgo(300), createdAt: daysAgo(300) },
    { id: `dev-new-${stamp}`, userId, deviceTokenHash: `hash-new-${stamp}`, name: 'جهاز جديد', lastSeenAt: daysAgo(1), createdAt: daysAgo(1) },
  ]);

  try {
    const report = await pruneOldData();
    assert.ok(report.webhookEvents >= 1);
    assert.ok(report.billingEvents >= 1);
    assert.ok(report.settingAuditLog >= 1);
    assert.ok(report.staleDevices >= 1);

    const remainingWebhooks = await db.execute(sql`select id from webhook_events where id in (${`wh-old-${stamp}`}, ${`wh-new-${stamp}`}, ${`wh-unprocessed-${stamp}`})`);
    const webhookIds = remainingWebhooks.rows.map((row) => (row as { id: string }).id).sort();
    // Old processed event removed; recent and unprocessed events kept.
    assert.deepEqual(webhookIds, [`wh-new-${stamp}`, `wh-unprocessed-${stamp}`].sort());

    const remainingBilling = await db.execute(sql`select id from billing_events where id in (${`be-old-${stamp}`}, ${`be-new-${stamp}`})`);
    assert.deepEqual(remainingBilling.rows.map((row) => (row as { id: string }).id), [`be-new-${stamp}`]);

    const remainingDevices = await db.execute(sql`select id from registered_devices where id in (${`dev-old-${stamp}`}, ${`dev-new-${stamp}`})`);
    assert.deepEqual(remainingDevices.rows.map((row) => (row as { id: string }).id), [`dev-new-${stamp}`]);

    // The policy constants are explicit and ordered (usage ledger kept longer).
    assert.ok(RETENTION_DAYS.aiUsageEvents >= RETENTION_DAYS.webhookEvents);
  } finally {
    await db.execute(sql`delete from webhook_events where external_event_id in (${`evt-old-${stamp}`}, ${`evt-new-${stamp}`}, ${`evt-unprocessed-${stamp}`})`);
    await db.execute(sql`delete from billing_events where id in (${`be-old-${stamp}`}, ${`be-new-${stamp}`})`);
    await db.execute(sql`delete from setting_audit_log where id in (${`sa-old-${stamp}`}, ${`sa-new-${stamp}`})`);
    await db.execute(sql`delete from users where id = ${userId}`);
    await closeDb();
  }
});
