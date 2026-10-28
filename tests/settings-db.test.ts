import { test } from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test: encrypted settings service, audit trail without
// secret values, fail-closed decryption and the admin settings routes against
// real PostgreSQL.
test('settings service and admin routes on PostgreSQL', {
  skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl as string;
  process.env.AUTH_SECRET = 'settings-db-test-secret';
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
  delete process.env.FREEMIUS_PRODUCT_ID;
  delete process.env.FREEMIUS_API_KEY;
  delete process.env.FREEMIUS_SECRET_KEY;
  delete process.env.FREEMIUS_PUBLIC_KEY;

  const { eq } = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { closeDb, getDb } = await import('../db/index');
  const schema = await import('../db/schema');
  const { POST: generalPost } = await import('../app/api/admin/settings/general/route');
  const { POST: aiPost } = await import('../app/api/admin/settings/ai/route');
  const { POST: freemiusPost } = await import('../app/api/admin/settings/freemius/route');
  const { POST: syncPost } = await import('../app/api/admin/settings/freemius/sync/route');
  const { setAuthStoreForTests } = await import('../lib/auth/store');
  const { hashSessionToken } = await import('../lib/auth/session');
  const { aiRuntimeConfig } = await import('../lib/ai/runtime-config');
  const { billingStore, subjectOfferDedupeKey } = await import('../lib/billing/store');
  const { resolveWhatsAppNumber } = await import('../lib/contact/whatsapp');
  const { SETTING_KEYS, SECRET_KEYS } = await import('../lib/settings/keys');
  const { getPlainSetting, getSecretSetting, getSecretPresence, setPlainSetting, setSecretSetting } = await import('../lib/settings/service');

  const db = getDb();
  await migrate(db, { migrationsFolder: './drizzle' });

  const student = { id: `settings-student-${Date.now()}`, email: `settings-student-${Date.now()}@example.com`, name: null, image: null, role: 'STUDENT' as const };
  const admin = { id: `settings-admin-${Date.now()}`, email: `settings-admin-${Date.now()}@example.com`, name: null, image: null, role: 'ADMIN' as const };
  await db.insert(schema.users).values([student, admin]);
  const offerId = `settings-offer-${Date.now()}`;
  await db.insert(schema.subscriptionOffers).values({
    id: offerId,
    dedupeKey: subjectOfferDedupeKey(`settings-subject-${Date.now()}`, 'MONTHLY', null),
    kind: 'SUBJECT',
    type: 'MONTHLY',
    subjectId: null,
    gradeId: null,
    freemiusPlanId: 'plan-demo-settings',
    priceMinor: 1000,
    monthlyCreditAllowance: 10,
    currency: 'JOD',
    isActive: true,
  });

  async function installSession(user: typeof student | typeof admin | null, token: string) {
    const sessionId = await hashSessionToken(token, 'settings-db-test-secret');
    const unused = async () => {
      throw new Error('not used');
    };
    setAuthStoreForTests({
      findUserByEmail: unused,
      findUserById: async (id: string) => (user && id === user.id ? user : null),
      insertUser: unused,
      promoteUser: unused,
      updateUserProfile: unused,
      linkAccount: unused,
      insertSession: unused,
      findSession: async (id: string) => (user && id === sessionId ? { id, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) } : null),
      deleteSession: unused,
      deleteExpiredSessions: unused,
    } as never);
  }

  function formRequest(url: string, form: FormData, token?: string) {
    const headers: Record<string, string> = { origin: 'http://localhost' };
    if (token) headers.cookie = `fahimni_session=${token}`;
    return new Request(`http://localhost${url}`, { method: 'POST', headers, body: form });
  }

  const form = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  };

  try {
    // --- service round-trip ---
    await setPlainSetting('settingsTestPlain', 'قيمة عربية');
    assert.equal(await getPlainSetting('settingsTestPlain'), 'قيمة عربية');

    await setSecretSetting(SECRET_KEYS.openaiApiKey, 'sk-test-secret-123');
    assert.equal(await getSecretSetting(SECRET_KEYS.openaiApiKey), 'sk-test-secret-123');
    assert.equal(await getSecretPresence(SECRET_KEYS.openaiApiKey), true);

    const auditRows = await db.select().from(schema.settingAuditLog).where(eq(schema.settingAuditLog.key, SECRET_KEYS.openaiApiKey));
    assert.ok(auditRows.length >= 1);
    assert.equal(JSON.stringify(auditRows).includes('sk-test-secret-123'), false);
    assert.equal(auditRows.some((row) => row.action === 'set'), true);

    // Tampered ciphertext fails closed: treated as unconfigured, never thrown.
    await db.update(schema.secureSettings).set({ ciphertext: 'v1:AAAA:BBBB:CCCC' }).where(eq(schema.secureSettings.key, SECRET_KEYS.openaiApiKey));
    assert.equal(await getSecretSetting(SECRET_KEYS.openaiApiKey), null);
    await setSecretSetting(SECRET_KEYS.openaiApiKey, 'sk-rotated-456');
    assert.equal(await getSecretSetting(SECRET_KEYS.openaiApiKey), 'sk-rotated-456');

    // --- general route: whatsapp ---
    await installSession(admin, 'admin-token');
    const saved = await generalPost(formRequest('/api/admin/settings/general', form({ intent: 'whatsapp-save', whatsappNumber: '+962 79 000 0000' }), 'admin-token'));
    assert.equal(saved.status, 303);
    assert.ok(saved.headers.get('location')?.includes('status=whatsapp_saved'));
    assert.equal(await getPlainSetting(SETTING_KEYS.whatsappNumber), '962790000000');
    assert.equal(await resolveWhatsAppNumber(), '962790000000');

    const invalid = await generalPost(formRequest('/api/admin/settings/general', form({ intent: 'whatsapp-save', whatsappNumber: '123' }), 'admin-token'));
    assert.ok(invalid.headers.get('location')?.includes('error=whatsapp_invalid'));

    const disabled = await generalPost(formRequest('/api/admin/settings/general', form({ intent: 'whatsapp-disable' }), 'admin-token'));
    assert.ok(disabled.headers.get('location')?.includes('status=whatsapp_disabled'));
    assert.equal(await resolveWhatsAppNumber(), null);

    // --- authorization ---
    await installSession(student, 'student-token');
    const studentAttempt = await generalPost(formRequest('/api/admin/settings/general', form({ intent: 'whatsapp-save', whatsappNumber: '962790000000' }), 'student-token'));
    assert.equal(studentAttempt.status, 403);
    await installSession(admin, 'admin-token');

    // --- ai route ---
    const badBudget = await aiPost(formRequest('/api/admin/settings/ai', form({ intent: 'save', tutorModel: '', dailyBudgetUsd: 'abc' }), 'admin-token'));
    assert.ok(badBudget.headers.get('location')?.includes('error=ai_budget_invalid'));

    const aiSaved = await aiPost(formRequest('/api/admin/settings/ai', form({ intent: 'save', tutorModel: 'test-tutor-model', dailyBudgetUsd: '2.5' }), 'admin-token'));
    assert.ok(aiSaved.headers.get('location')?.includes('status=ai_settings_saved'));
    const runtime = await aiRuntimeConfig({} as unknown as NodeJS.ProcessEnv);
    assert.equal(runtime.tutorModel, 'test-tutor-model');
    assert.equal(runtime.dailyBudgetUsd, 2.5);
    assert.equal(runtime.apiKey, 'sk-rotated-456');

    // --- freemius route ---
    const badProduct = await freemiusPost(formRequest('/api/admin/settings/freemius', form({ intent: 'save', productId: 'abc' }), 'admin-token'));
    assert.ok(badProduct.headers.get('location')?.includes('error=freemius_product_invalid'));

    const incompleteTest = await freemiusPost(formRequest('/api/admin/settings/freemius', form({ intent: 'test' }), 'admin-token'));
    assert.ok(incompleteTest.headers.get('location')?.includes('error=freemius_not_configured'));

    // --- sync route without credentials stays blocked and pending ---
    const syncResponse = await syncPost(formRequest('/api/admin/settings/freemius/sync', form({ offerId }), 'admin-token'));
    assert.equal(syncResponse.status, 303);
    assert.ok(syncResponse.headers.get('location')?.includes('error=sync_not_configured'));
    const link = await billingStore().findSubscriptionOfferById(offerId);
    assert.ok(link);
    const linkRow = await db.select().from(schema.offerProviderLinks).where(eq(schema.offerProviderLinks.offerId, offerId));
    assert.equal(linkRow[0]?.status, 'PENDING');
    assert.equal(linkRow[0]?.verified, false);
  } finally {
    await db.delete(schema.settingAuditLog).where(eq(schema.settingAuditLog.key, SECRET_KEYS.openaiApiKey));
    await db.delete(schema.secureSettings).where(eq(schema.secureSettings.key, SECRET_KEYS.openaiApiKey));
    await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, 'settingsTestPlain'));
    await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, SETTING_KEYS.whatsappNumber));
    await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, SETTING_KEYS.aiTutorModel));
    await db.delete(schema.systemSettings).where(eq(schema.systemSettings.key, SETTING_KEYS.aiDailyBudgetUsd));
    await db.delete(schema.subscriptionOffers).where(eq(schema.subscriptionOffers.id, offerId));
    await db.delete(schema.users).where(eq(schema.users.id, student.id));
    await db.delete(schema.users).where(eq(schema.users.id, admin.id));
    setAuthStoreForTests(null);
    await closeDb();
  }
});
