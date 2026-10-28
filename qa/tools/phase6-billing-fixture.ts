export {};

// Phase 6 QA fixture (SIMULATED): seeds one clearly-marked billing event so the
// admin timeline card can be verified in the browser, then cleans it up.
// Usage: node --import tsx qa/tools/phase6-billing-fixture.ts setup|cleanup
const mode = process.argv[2];

process.env.DATABASE_URL ??= 'postgresql://mrik@127.0.0.1:5432/fahimni_local';

const { billingEventStore } = await import('../../lib/freemius/events');
const { getDb } = await import('../../db/index');
const { sql } = await import('drizzle-orm');

const store = billingEventStore();

if (mode === 'setup') {
  await store.record({
    type: 'subscription.renewal.failed.last',
    licenseId: 'qa-simulated-lic-6',
    subscriptionId: 'qa-simulated-sub-6',
    userEmail: 'qa-simulated@example.com',
    summary: '[محاكاة اختبار] فشل تجديد الدفع في المحاولة الأخيرة — قد يُوقف الوصول عند انتهاء المدة المدفوعة.',
  });
  await store.record({
    type: 'license.cancelled',
    licenseId: 'qa-simulated-lic-6',
    subscriptionId: 'qa-simulated-sub-6',
    userEmail: 'qa-simulated@example.com',
    summary: '[محاكاة اختبار] تم إلغاء الاشتراك من بوابة الدفع.',
  });
  console.log('seeded');
} else if (mode === 'cleanup') {
  await getDb().execute(sql`delete from billing_events where license_id = 'qa-simulated-lic-6'`);
  console.log('cleaned');
} else if (mode === 'list-entitlements') {
  const rows = await getDb().execute(sql`select id, freemius_license_id from entitlements order by created_at desc limit 5`);
  console.log(JSON.stringify(rows.rows, null, 1));
} else if (mode === 'resync-check') {
  const { readFileSync } = await import('node:fs');
  const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
  const route = await import('../../app/api/admin/subscriptions/entitlements/[id]/resync/route');
  const request = new Request('http://localhost/api/admin/subscriptions/entitlements/33333333-3333-4333-8333-333333333333/resync', {
    method: 'POST',
    headers: { origin: 'http://localhost', cookie: `fahimni_session=${sessions.admin}` },
  });
  const response = await route.POST(request, { params: Promise.resolve({ id: '33333333-3333-4333-8333-333333333333' }) });
  console.log(JSON.stringify({ status: response.status, location: response.headers.get('location') }));
} else {
  console.error('usage: setup|cleanup');
  process.exit(1);
}
process.exit(0);
