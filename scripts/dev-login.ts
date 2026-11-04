import { eq } from 'drizzle-orm';

import { closeDb, getDb } from '../db/index';
import { accounts, studentProfiles, users } from '../db/schema';

// DEV-ONLY: creates an admin and a student (onboarded) with linked Google
// accounts so the platform can be exercised locally without a real Google OAuth
// client. Use /api/auth/dev-login?target=student|admin to start a session.
// Refuses to run in production.

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('dev-login seed is disabled in production');
  }
  const db = getDb();
  const now = new Date();

  const [grade] = await db.select({ id: studentProfiles.gradeId, name: studentProfiles.gradeId }).from(studentProfiles).limit(0);
  void grade;
  // Pick any real grade for the student profile.
  const { grades, academicFields } = await import('../db/schema');
  const [firstGrade] = await db.select({ id: grades.id }).from(grades).limit(1);
  const [firstField] = await db.select({ id: academicFields.id }).from(academicFields).limit(1);

  const people = [
    { key: 'admin', email: 'dev-admin@fahimni.local', name: 'مشرف تجريبي', role: 'ADMIN' as const },
    { key: 'student', email: 'dev-student@fahimni.local', name: 'طالب تجريبي', role: 'STUDENT' as const },
  ];

  for (const person of people) {
    const id = `dev-${person.key}-${crypto.randomUUID()}`;
    await db
      .insert(users)
      .values({ id, email: person.email, name: person.name, role: person.role, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: users.email });
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, person.email)).limit(1);
    const userId = row?.id ?? id;
    await db
      .insert(accounts)
      .values({ id: crypto.randomUUID(), userId, provider: 'google', providerAccountId: `dev-${userId}`, createdAt: now })
      .onConflictDoNothing();
    if (person.role === 'STUDENT' && firstGrade) {
      await db
        .insert(studentProfiles)
        .values({
          userId,
          gradeId: firstGrade.id,
          academicFieldId: firstField?.id ?? null,
          onboardingCompleted: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: studentProfiles.userId });
    }
    console.log(`seeded ${person.role}: ${person.email}`);
  }

  console.log('\nStart a session:');
  console.log('  student: http://localhost:3000/api/auth/dev-login?target=student');
  console.log('  admin:   http://localhost:3000/api/auth/dev-login?target=admin');
}

main()
  .catch((error: unknown) => {
    console.error('dev-login seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
