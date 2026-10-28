// Student data deletion (privacy request / DSAR) — explicit, guarded, auditable.
//
// Dry-run by default:
//   node --env-file-if-exists=.env.local --import tsx scripts/delete-student-data.ts --email student@example.com
// Execute only with --confirm (prints exactly what it will remove first):
//   node --env-file-if-exists=.env.local --import tsx scripts/delete-student-data.ts --email student@example.com --confirm
//
// Removes: sessions, devices, student profile, learning progress, free trial
// record, account email/name/avatar (anonymized to deleted-<id>@deleted.invalid).
// Keeps for financial integrity: entitlements and usage/billing ledgers; the
// billing timeline email is cleared. Needs legal review before public launch
// (see qa/PHASE7_FINAL_REPORT.md privacy section).
import { eq } from 'drizzle-orm';

import { getDb } from '../db/index';
import {
  billingEvents,
  freeTrials,
  learningProgress,
  registeredDevices,
  sessions,
  studentProfiles,
  users,
} from '../db/schema';

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const email = argValue('--email')?.trim().toLowerCase() ?? null;
const confirm = process.argv.includes('--confirm');

if (!email) {
  console.error('usage: --email <student email> [--confirm]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const db = getDb();
const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (!user) {
  console.error('no user with that email');
  process.exit(1);
}

const plan = {
  userId: user.id,
  email,
  sessions: (await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id))).length,
  devices: (await db.select({ id: registeredDevices.id }).from(registeredDevices).where(eq(registeredDevices.userId, user.id))).length,
  progressRows: (await db.select({ id: learningProgress.id }).from(learningProgress).where(eq(learningProgress.userId, user.id))).length,
  trialRows: (await db.select({ id: freeTrials.id }).from(freeTrials).where(eq(freeTrials.userId, user.id))).length,
  billingEventsForEmail: (await db.select({ id: billingEvents.id }).from(billingEvents).where(eq(billingEvents.userEmail, email))).length,
};

if (!confirm) {
  console.log('DRY RUN — nothing deleted. Plan:', JSON.stringify(plan, null, 1));
  console.log('Re-run with --confirm to execute.');
  process.exit(0);
}

await db.transaction(async (tx) => {
  await tx.delete(sessions).where(eq(sessions.userId, user.id));
  await tx.delete(registeredDevices).where(eq(registeredDevices.userId, user.id));
  await tx.delete(learningProgress).where(eq(learningProgress.userId, user.id));
  await tx.delete(freeTrials).where(eq(freeTrials.userId, user.id));
  await tx.delete(studentProfiles).where(eq(studentProfiles.userId, user.id));
  await tx.update(billingEvents).set({ userEmail: null }).where(eq(billingEvents.userEmail, email));
  await tx
    .update(users)
    .set({ email: `deleted-${user.id}@deleted.invalid`, name: null, image: null })
    .where(eq(users.id, user.id));
});

console.log('deleted', JSON.stringify(plan));
process.exit(0);
