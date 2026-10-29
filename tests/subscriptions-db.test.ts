import { test } from 'node:test';
import assert from 'node:assert/strict';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Opt-in integration test: unified offers, academic terms, bundle scopes and
// the shared-wallet resolver against real PostgreSQL.
test('subscriptions on PostgreSQL: offers, terms, bundle scope, shared wallet, resolver order', {
  skip: testDatabaseUrl ? false : 'set TEST_DATABASE_URL to run the PostgreSQL integration test',
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl as string;
  const { eq, sql } = await import('drizzle-orm');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { closeDb, getDb } = await import('../db/index');
  const schema = await import('../db/schema');
  const { billingStore, bundleOfferDedupeKey, subjectOfferDedupeKey } = await import('../lib/billing/store');
  const { syncEntitlementFromPurchase } = await import('../lib/billing/entitlements');
  const { termWindowFromCalendarDates } = await import('../lib/billing/terms');

  const db = getDb();
  await migrate(db, { migrationsFolder: './drizzle' });

  const stamp = Date.now();
  const billing = billingStore();
  const userId = `subs-test-${stamp}`;
  const email = `${userId}@example.com`;
  const gradeId = `grade-${stamp}`;
  const otherGradeId = `grade-other-${stamp}`;
  const fieldId = `field-${stamp}`;
  const s1 = `subject-a-${stamp}`;
  const s2 = `subject-b-${stamp}`;
  const s3 = `subject-c-${stamp}`;
  const s4 = `subject-other-${stamp}`;
  const termId = `term-${stamp}`;
  const bundleKey = bundleOfferDedupeKey(gradeId, fieldId, 'MONTHLY', null);
  const subjectKey = subjectOfferDedupeKey(s1, 'MONTHLY', null);

  await db.insert(schema.grades).values([
    { id: gradeId, name: 'صف تجريبي', slug: `grade-${stamp}` },
    { id: otherGradeId, name: 'صف آخر', slug: `grade-other-${stamp}` },
  ]);
  await db.insert(schema.academicFields).values({ id: fieldId, gradeId, name: 'تخصص تجريبي', slug: `field-${stamp}` });
  await db.insert(schema.subjects).values([
    { id: s1, gradeId, academicFieldId: fieldId, name: 'مادة أ', slug: `subject-a-${stamp}` },
    { id: s2, gradeId, academicFieldId: fieldId, name: 'مادة ب', slug: `subject-b-${stamp}` },
    { id: s3, gradeId, academicFieldId: null, name: 'مادة ج', slug: `subject-c-${stamp}` },
    { id: s4, gradeId: otherGradeId, academicFieldId: null, name: 'مادة د', slug: `subject-other-${stamp}` },
  ]);
  await db.insert(schema.users).values({ id: userId, email, name: 'طالب', image: null, role: 'STUDENT' });

  const window = termWindowFromCalendarDates('2027-02-01', '2027-06-01');
  assert.ok(window);
  await billing.upsertAcademicTerm({
    id: termId,
    name: 'الفصل التجريبي',
    academicYear: '2026/2027',
    gradeId,
    academicFieldId: fieldId,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    isActive: true,
  });

  const bundleOffer = await billing.upsertSubscriptionOffer({
    id: crypto.randomUUID(),
    dedupeKey: bundleKey,
    kind: 'BUNDLE',
    type: 'MONTHLY',
    subjectId: null,
    gradeId,
    academicFieldId: fieldId,
    academicTermId: null,
    freemiusPlanId: `plan-bundle-${stamp}`,
    priceMinor: 49_000,
    monthlyCreditAllowance: 500,
    currency: 'JOD',
    isActive: true,
  });
  await billing.setBundleSubjects(bundleOffer.id, [s1, s2]);

  await billing.upsertSubscriptionOffer({
    id: crypto.randomUUID(),
    dedupeKey: subjectKey,
    kind: 'SUBJECT',
    type: 'MONTHLY',
    subjectId: s1,
    gradeId: null,
    academicFieldId: null,
    academicTermId: null,
    freemiusPlanId: `plan-subject-${stamp}`,
    priceMinor: 29_000,
    monthlyCreditAllowance: 200,
    currency: 'JOD',
    isActive: true,
  });

  const deps = { store: billing, findUserByEmail: async () => ({ id: userId }) };
  const purchase = (planId: string, overrides: Record<string, unknown> = {}) => ({
    email,
    planId,
    licenseId: `lic-${planId}`,
    subscriptionId: 'sub-1' as string | null,
    canceled: false,
    expiration: new Date(Date.now() + 30 * 24 * 3600_000) as Date | null,
    created: new Date(),
    billingCycle: 'monthly' as 'monthly' | 'yearly' | 'oneoff' | null,
    ...overrides,
  });

  try {
    // Bundle grant: one row, frozen scope, shared wallet across subjects.
    const bundlePurchase = purchase(`plan-bundle-${stamp}`);
    const bundleResult = await syncEntitlementFromPurchase(deps, bundlePurchase);
    assert.deepEqual(bundleResult, { ok: true });
    const bundleEntitlement = await billing.findEntitlementByLicenseId(`lic-plan-bundle-${stamp}`);
    assert.ok(bundleEntitlement);
    assert.equal(bundleEntitlement.subjectId, null);
    assert.equal(bundleEntitlement.offerId, bundleOffer.id);
    assert.equal(bundleEntitlement.creditBalance, 500);
    assert.deepEqual((await billing.listEntitlementSubjectIds(bundleEntitlement.id)).sort(), [s1, s2].sort());

    const now = new Date();
    assert.equal((await billing.findAccessibleEntitlement(userId, s1, now))?.id, bundleEntitlement.id);
    assert.equal((await billing.findAccessibleEntitlement(userId, s2, now))?.id, bundleEntitlement.id);
    assert.equal(await billing.findAccessibleEntitlement(userId, s3, now), null);
    assert.equal(await billing.findAccessibleEntitlement(userId, s4, now), null);

    // Scope freeze: widening the offer after the sale never widens sold access.
    await billing.setBundleSubjects(bundleOffer.id, [s1, s2, s3]);
    // A license re-sync always reports the same original creation date.
    await syncEntitlementFromPurchase(deps, { ...bundlePurchase, expiration: new Date(Date.now() + 40 * 24 * 3600_000) });
    assert.deepEqual((await billing.listEntitlementSubjectIds(bundleEntitlement.id)).sort(), [s1, s2].sort());
    assert.equal(await billing.findAccessibleEntitlement(userId, s3, now), null);

    // Shared wallet concurrency: 10 parallel charges of 1 against a balance of 5.
    await billing.updateCreditPeriod(bundleEntitlement.id, 5, new Date(), new Date(Date.now() + 86_400_000));
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        billing.chargeCredits({
          entitlementId: bundleEntitlement.id,
          userId,
          subjectId: index % 2 === 0 ? s1 : s2,
          operation: 'tutor',
          credits: 1,
          requestId: `bundle-concurrent-${index}-${stamp}`,
        }),
      ),
    );
    assert.equal(attempts.filter((attempt) => attempt.ok).length, 5);
    assert.equal((await billing.findEntitlementById(bundleEntitlement.id))?.creditBalance, 0);

    // Subject grant + deterministic resolver: subject wallet first, then the
    // soonest-expiring bundle.
    await syncEntitlementFromPurchase(deps, purchase(`plan-subject-${stamp}`));
    const subjectEntitlement = await billing.findEntitlementByLicenseId(`lic-plan-subject-${stamp}`);
    assert.ok(subjectEntitlement);
    const afterSubjectGrant = new Date();
    assert.equal((await billing.findAccessibleEntitlement(userId, s1, afterSubjectGrant))?.id, subjectEntitlement.id);

    await billing.upsertEntitlement({
      id: crypto.randomUUID(),
      userId,
      subjectId: null,
      subjectPlanId: null,
      offerId: bundleOffer.id,
      academicTermId: null,
      freemiusLicenseId: `lic-late-${stamp}`,
      freemiusSubscriptionId: null,
      status: 'ACTIVE',
      renewalCanceled: false,
      startsAt: null,
      expiresAt: new Date(Date.now() + 60 * 24 * 3600_000),
      creditBalance: 500,
      creditPeriodStartedAt: null,
      creditPeriodEndsAt: null,
    });
    const lateEntitlement = await billing.findEntitlementByLicenseId(`lic-late-${stamp}`);
    assert.ok(lateEntitlement);
    await billing.replaceEntitlementSubjects(lateEntitlement.id, [s1]);

    await billing.deleteEntitlementByLicenseId(`lic-plan-subject-${stamp}`);
    const earliestBundle = await billing.findAccessibleEntitlement(userId, s1, now);
    assert.equal(earliestBundle?.id, bundleEntitlement.id);
    await billing.deleteEntitlementByLicenseId(`lic-plan-bundle-${stamp}`);
    assert.equal((await billing.findAccessibleEntitlement(userId, s1, now))?.id, lateEntitlement.id);

    // A future-start semester purchase never shadows current access.
    const semesterOffer = await billing.upsertSubscriptionOffer({
      id: crypto.randomUUID(),
      dedupeKey: subjectOfferDedupeKey(s2, 'SEMESTER', termId),
      kind: 'SUBJECT',
      type: 'SEMESTER',
      subjectId: s2,
      gradeId: null,
      academicFieldId: null,
      academicTermId: termId,
      freemiusPlanId: `plan-semester-${stamp}`,
      priceMinor: 99_000,
      monthlyCreditAllowance: 300,
      currency: 'JOD',
      isActive: true,
    });
    const futureCreated = new Date('2027-01-01T00:00:00Z');
    const semesterResult = await syncEntitlementFromPurchase(
      deps,
      purchase(`plan-semester-${stamp}`, {
        licenseId: `lic-semester-${stamp}`,
        subscriptionId: null,
        expiration: null,
        billingCycle: 'oneoff',
        created: futureCreated,
      }),
    );
    assert.deepEqual(semesterResult, { ok: true });
    const semesterEntitlement = await billing.findEntitlementByLicenseId(`lic-semester-${stamp}`);
    assert.ok(semesterEntitlement);
    assert.equal(semesterEntitlement.academicTermId, termId);
    assert.equal(semesterEntitlement.startsAt?.getTime(), window.startsAt.getTime());
    assert.equal(semesterEntitlement.expiresAt?.getTime(), window.endsAt.getTime());
    assert.equal(semesterEntitlement.offerId, semesterOffer.id);
    // Before the term starts it is not accessible; the late bundle still serves s1.
    assert.equal(await billing.findAccessibleEntitlement(userId, s2, now), null);
    assert.equal((await billing.findAccessibleEntitlement(userId, s1, now))?.id, lateEntitlement.id);

    // The real sold-count query drives the admin date lock.
    assert.equal(await billing.countSoldEntitlementsForTerm(termId), 1);
    assert.equal(await billing.countSoldEntitlementsForTerm('missing-term'), 0);

    // Backfill statement: legacy subject plans migrate into offers idempotently.
    const legacyPlan = await billing.upsertSubjectPlan({
      subjectId: s3,
      type: 'MONTHLY',
      freemiusPlanId: `plan-legacy-${stamp}`,
      priceMinor: 19_000,
      monthlyCreditAllowance: 100,
      currency: 'JOD',
      isActive: true,
    });
    const backfill = () =>
      db.execute(sql`
        INSERT INTO "subscription_offers" (
          "id", "dedupe_key", "kind", "type", "subject_id", "freemius_plan_id", "price_minor",
          "monthly_credit_allowance", "currency", "is_active", "created_at", "updated_at"
        )
        SELECT
          "id",
          'SUBJECT:' || "subject_id" || ':' || "type"::text || ':-',
          'SUBJECT'::"offer_kind",
          "type",
          "subject_id",
          "freemius_plan_id",
          "price_minor",
          "monthly_credit_allowance",
          "currency",
          "is_active",
          "created_at",
          "updated_at"
        FROM "subject_plans"
        WHERE "id" = ${legacyPlan.id}
        ON CONFLICT ("dedupe_key") DO NOTHING
      `);
    await backfill();
    await backfill();
    const backfilled = await billing.findSubscriptionOfferByFreemiusPlanId(`plan-legacy-${stamp}`);
    assert.ok(backfilled);
    assert.equal(backfilled.id, legacyPlan.id);
    assert.equal(backfilled.kind, 'SUBJECT');
    const offerCount = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.subscriptionOffers)
      .where(eq(schema.subscriptionOffers.freemiusPlanId, `plan-legacy-${stamp}`));
    assert.equal(offerCount[0]?.value, 1);

    // Admin subscriber search matches by email substring and returns nothing
    // for unrelated needles.
    const matches = await billing.listEntitlementsWithUsers(10, email.slice(0, 12));
    assert.ok(matches.some((row) => row.userId === userId));
    assert.ok(matches.every((row) => row.userEmail.includes(email.slice(0, 12))));
    const empty = await billing.listEntitlementsWithUsers(10, `no-such-user-${stamp}`);
    assert.equal(empty.length, 0);

    // Billing timeline: verified webhook events are stored and listed newest
    // first, and never touch entitlement rows.
    const { billingEventStore } = await import('../lib/freemius/events');
    const eventStore = billingEventStore();
    await eventStore.record({
      type: 'subscription.renewal.failed.last',
      licenseId: 'lic-db-events',
      subscriptionId: 'sub-db-events',
      userEmail: email,
      summary: 'فشل تجديد الدفع في المحاولة الأخيرة.',
      createdAt: new Date(Date.now() - 1000),
    });
    await eventStore.record({
      type: 'license.cancelled',
      licenseId: 'lic-db-events',
      summary: 'تم إلغاء الاشتراك من بوابة الدفع.',
    });
    const events = await eventStore.list(10);
    const mine = events.filter((event) => event.licenseId === 'lic-db-events');
    assert.equal(mine.length, 2);
    assert.equal(mine[0]?.type, 'license.cancelled');
    assert.equal(mine[1]?.type, 'subscription.renewal.failed.last');
    assert.equal(mine[1]?.userEmail, email);
  } finally {
    await db.execute(sql`delete from billing_events where license_id = 'lic-db-events'`);
    await db.execute(sql`delete from users where id = ${userId}`);
    await db.execute(sql`delete from grades where id in (${gradeId}, ${otherGradeId})`);
    await closeDb();
  }
});
