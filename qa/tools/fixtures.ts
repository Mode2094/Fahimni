import { writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';

// Audit-only fixtures. Creates clearly isolated records in the LOCAL database
// and writes session tokens to /tmp (never printed, never committed).
// Usage: npx tsx qa/tools/fixtures.ts setup|cleanup
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://mrik@127.0.0.1:5432/fahimni_local';
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'local-visual-testing-secret-0123456789';

const mode = process.argv[2] ?? 'setup';
const { getDb, closeDb } = await import('../../db/index');
const schema = await import('../../db/schema');
const { authStore } = await import('../../lib/auth/store');
const { createSession } = await import('../../lib/auth/session');

const db = getDb();
const secret = process.env.AUTH_SECRET as string;

const GRADES = { tawjihi: 'ac160166-5f14-4234-80b8-a23c647294e7' };
const FIELDS = { scientific: '3233891a-640d-49b2-bcb3-ca1b108f9c12' };
const SUBJECTS = {
  math: 'b0285393-fc49-4573-833f-07b87b1cb628',
  physics: 'aaaaaaaa-0101-4000-8000-000000000101',
};
const AUDIT_USERS = ['audit-noprofile@fahimni.local', 'audit-bundle@fahimni.local', 'audit-trial@fahimni.local', 'audit-noaccess@fahimni.local'];
const AUDIT_DEVICES = ['audit-device-current', 'audit-device-old'];
// deterministic device token so the browser cookie can match the fixture row
export const AUDIT_DEVICE_TOKEN = 'audit-device-token-0000000000000000000000000000';

async function sessionFor(email: string) {
  const user = await authStore().findUserByEmail(email);
  if (!user) throw new Error(`missing user ${email}`);
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [user.id]));
  const session = await createSession(authStore(), user.id, secret);
  return session.token;
}

if (mode === 'cleanup') {
  const users = await db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.email, AUDIT_USERS));
  for (const user of users) await db.delete(schema.users).where(eq(schema.users.id, user.id));
  const student = await authStore().findUserByEmail('student@fahimni.local');
  if (student) await db.delete(schema.registeredDevices).where(inArray(schema.registeredDevices.id, AUDIT_DEVICES));
  await db.delete(schema.sessions).where(inArray(schema.sessions.userId, [student?.id ?? 'none']));
  await closeDb();
  console.log(JSON.stringify({ removedUsers: users.length, removedDevices: AUDIT_DEVICES.length }));
} else {
  await db.delete(schema.users).where(inArray(schema.users.email, AUDIT_USERS));
  await db.insert(schema.users).values(
    AUDIT_USERS.map((email) => ({ id: crypto.randomUUID(), email, name: 'مدقق', image: null, role: 'STUDENT' as const })),
  );
  const noProfile = await authStore().findUserByEmail('audit-noprofile@fahimni.local');
  const bundleUser = await authStore().findUserByEmail('audit-bundle@fahimni.local');
  const trialUser = await authStore().findUserByEmail('audit-trial@fahimni.local');
  const noAccess = await authStore().findUserByEmail('audit-noaccess@fahimni.local');
  if (!noProfile || !bundleUser || !trialUser || !noAccess) throw new Error('audit users missing');

  await db.insert(schema.studentProfiles).values([
    { userId: bundleUser.id, gradeId: GRADES.tawjihi, academicFieldId: FIELDS.scientific, onboardingCompleted: true },
    { userId: trialUser.id, gradeId: GRADES.tawjihi, academicFieldId: FIELDS.scientific, onboardingCompleted: true },
    // grade 11, no fields, no entitlements: denial-path evidence
    { userId: noAccess.id, gradeId: 'f933ed20-dde3-489d-9739-8939709c683c', academicFieldId: null, onboardingCompleted: true },
  ]);

  const entitlementId = crypto.randomUUID();
  await db.insert(schema.entitlements).values({
    id: entitlementId,
    userId: bundleUser.id,
    subjectId: null,
    offerId: null,
    status: 'ACTIVE',
    startsAt: new Date(Date.now() - 86_400_000),
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
    creditBalance: 300,
    creditPeriodStartedAt: new Date(),
    creditPeriodEndsAt: new Date(Date.now() + 30 * 86_400_000),
  });
  await db.insert(schema.entitlementSubjects).values([
    { entitlementId, subjectId: SUBJECTS.math },
    { entitlementId, subjectId: SUBJECTS.physics },
  ]);

  const trialId = crypto.randomUUID();
  await db.insert(schema.freeTrials).values({
    id: trialId,
    userId: trialUser.id,
    browserIdentityHash: `audit-trial-hash-${Date.now()}`,
    status: 'ACTIVE',
    totalCredits: 15,
    remainingCredits: 12,
    claimedAt: new Date(Date.now() - 3_600_000),
    startedAt: new Date(Date.now() - 1_800_000),
    expiresAt: new Date(Date.now() + 46 * 3_600_000),
  });
  await db.insert(schema.aiUsageEvents).values({
    id: crypto.randomUUID(),
    userId: trialUser.id,
    subjectId: SUBJECTS.math,
    entitlementId: null,
    trialId,
    operation: 'tutor',
    creditsCharged: 3,
    estimatedCostMicroUsd: 30_000,
    requestId: crypto.randomUUID(),
  });

  // devices for /app/account: one "current" (matches the browser cookie) + one old
  const student = await authStore().findUserByEmail('student@fahimni.local');
  if (!student) throw new Error('fixture student missing');
  await db.delete(schema.registeredDevices).where(eq(schema.registeredDevices.userId, student.id));
  const currentHash = await (await import('../../lib/devices/token')).hashDeviceToken(AUDIT_DEVICE_TOKEN, secret);
  await db.insert(schema.registeredDevices).values([
    {
      id: AUDIT_DEVICES[0],
      userId: student.id,
      deviceTokenHash: currentHash,
      name: 'Chrome · macOS',
      userAgentSummary: 'Chrome 154 · macOS (audit current)',
      lastSeenAt: new Date(),
    },
    {
      id: AUDIT_DEVICES[1],
      userId: student.id,
      deviceTokenHash: createHmac('sha256', secret).update('audit-old-device').digest('hex'),
      name: 'Safari · iOS',
      userAgentSummary: 'Safari · iOS (audit old)',
      lastSeenAt: new Date(Date.now() - 86_400_000),
    },
  ]);

  // restore trial2's trial state (from earlier claim tests) so eligibility fixtures stay clean
  const eligibleUser = await authStore().findUserByEmail('trial2@fahimni.local');
  if (eligibleUser) await db.delete(schema.freeTrials).where(eq(schema.freeTrials.userId, eligibleUser.id));

  const sessions = {
    student: await sessionFor('student@fahimni.local'),
    admin: await sessionFor('admin@fahimni.local'),
    noProfile: await sessionFor('audit-noprofile@fahimni.local'),
    noAccess: await sessionFor('audit-noaccess@fahimni.local'),
    bundle: await sessionFor(bundleUser.email),
    trialActive: await sessionFor(trialUser.email),
    trialEligible: await sessionFor('trial2@fahimni.local'),
    trialExpired: await sessionFor('trial@fahimni.local'),
    deviceToken: AUDIT_DEVICE_TOKEN,
    expiredSession: '',
    ids: {
      bundleEntitlement: entitlementId,
      auditTrial: trialId,
      noProfileUser: noProfile.id,
      bundleUser: bundleUser.id,
      trialUser: trialUser.id,
      noAccessUser: noAccess.id,
      mathBook: '11111111-1111-4111-8111-111111111111',
    },
  };

  // an already-expired session row for the no-profile audit user
  const expiredSessionId = (await import('../../lib/auth/session')).hashSessionToken('audit-expired-token', secret);
  const expiredId = await expiredSessionId;
  await db.insert(schema.sessions).values({
    id: expiredId,
    userId: noProfile.id,
    expiresAt: new Date(Date.now() - 60_000),
    createdAt: new Date(Date.now() - 120_000),
  });
  sessions.expiredSession = 'audit-expired-token';
  writeFileSync('/tmp/fahimni-audit-sessions.json', JSON.stringify(sessions), { mode: 0o600 });
  await closeDb();
  console.log(JSON.stringify({ created: true, users: AUDIT_USERS.length, devices: AUDIT_DEVICES.length, sessions: Object.keys(sessions).filter((k) => k !== 'ids' && k !== 'deviceToken') }));
}
