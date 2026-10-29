export {};

// Owner-approved QA data cleanup — DRY RUN by default.
//
//   node --env-file-if-exists=.env.local --import tsx scripts/cleanup-qa-data.ts
//   node --env-file-if-exists=.env.local --import tsx scripts/cleanup-qa-data.ts --confirm
//
// Only clearly-marked test data is ever considered, and only after the owner
// reviews the dry-run list and passes --confirm:
//   - demo offers (freemius plan ids starting with plan_demo_)
//   - QA fixture accounts (@fahimni.local, audit-*) with NO active entitlement
//   - simulated billing-timeline rows (qa-simulated license ids)
//   - FAILED books only (never READY books; the real textbook is untouched)
// Real subjects, real books, owner accounts and any data with active
// entitlements are NEVER deleted by this script.
import { eq, like, or, sql } from 'drizzle-orm';

import { getDb } from '../db/index';
import { billingEvents, books, entitlements, subscriptionOffers, users } from '../db/schema';

const confirm = process.argv.includes('--confirm');
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const db = getDb();

const demoOffers = await db
  .select({ id: subscriptionOffers.id, kind: subscriptionOffers.kind, type: subscriptionOffers.type, planId: subscriptionOffers.freemiusPlanId })
  .from(subscriptionOffers)
  .where(like(subscriptionOffers.freemiusPlanId, 'plan_demo_%'));

const qaUsers = await db
  .select({ id: users.id, email: users.email })
  .from(users)
  .where(or(like(users.email, '%@fahimni.local'), like(users.email, 'audit-%')));

const qaUsersWithEntitlements: string[] = [];
for (const user of qaUsers) {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(entitlements).where(eq(entitlements.userId, user.id));
  if ((row?.value ?? 0) > 0) qaUsersWithEntitlements.push(user.email);
}
const deletableUsers = qaUsers.filter((user) => !qaUsersWithEntitlements.includes(user.email));

const failedBooks = await db.select({ id: books.id, subjectId: books.subjectId, title: books.title }).from(books).where(eq(books.status, 'FAILED'));

const simulatedEvents = await db
  .select({ id: billingEvents.id, licenseId: billingEvents.licenseId })
  .from(billingEvents)
  .where(like(billingEvents.licenseId, 'qa-simulated-%'));

const plan = { demoOffers, deletableUsers, skippedUsersWithEntitlements: qaUsersWithEntitlements, failedBooks, simulatedEvents };

if (!confirm) {
  console.log('DRY RUN — nothing deleted.');
  console.log(JSON.stringify(plan, null, 1));
  console.log('Re-run with --confirm to execute the deletions listed above.');
  process.exit(0);
}

await db.transaction(async (tx) => {
  for (const offer of demoOffers) {
    // Entitlements keep their history: offer_id is set to NULL by the FK.
    await tx.delete(subscriptionOffers).where(eq(subscriptionOffers.id, offer.id));
  }
  for (const user of deletableUsers) {
    await tx.delete(users).where(eq(users.id, user.id));
  }
  for (const book of failedBooks) {
    await tx.delete(books).where(eq(books.id, book.id));
  }
  for (const event of simulatedEvents) {
    await tx.delete(billingEvents).where(eq(billingEvents.id, event.id));
  }
});

console.log('deleted', JSON.stringify({
  demoOffers: demoOffers.length,
  qaUsers: deletableUsers.length,
  failedBooks: failedBooks.length,
  simulatedEvents: simulatedEvents.length,
}));
process.exit(0);
