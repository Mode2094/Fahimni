import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { eq } from 'drizzle-orm';

import { closeDb, getDb } from '../db/index';
import {
  academicFields,
  accounts,
  books,
  grades,
  semesters,
  studentProfiles,
  subjects,
  textbookChunks,
  topupOffers,
  users,
} from '../db/schema';
import { dataDir, ensureBookDirs, pageImagePath } from '../lib/books/storage';
import { normalize } from '../lib/textbook/retrieval';

// DEV-ONLY: prepares a fully working local environment — a semester, a top-up
// offer, a READY textbook for the seeded subject (with page images), and two
// test accounts (student + admin). Refuses to run in production.

type RawChunk = {
  id: string;
  sourceId: string;
  pdfPage: number;
  printedPage: number | null;
  unit: string | null;
  lesson: string | null;
  heading?: string | null;
  text: string;
  equations: string[];
  image: string;
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('dev-setup is disabled in production');
  const destination=new URL(process.env.DATABASE_URL||'');
  if(!['localhost','127.0.0.1','[::1]'].includes(destination.hostname)||!/dev|local|test|recovery/i.test(destination.pathname))throw new Error('dev-setup requires an explicitly named, loopback-only development database');
  const db = getDb();
  const now = new Date();

  const [grade] = await db.select().from(grades).where(eq(grades.slug, 'tawjihi')).limit(1);
  const [field] = await db.select().from(academicFields).limit(1);
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, 'tawjihi-math')).limit(1);
  if (!grade || !subject) throw new Error('seed the catalog first: pnpm db:seed');

  // 1) READY book for the subject, with page images copied into DATA_DIR.
  const bookId = crypto.randomUUID();
  await ensureBookDirs(bookId);
  await mkdir(path.join(dataDir(), 'books', bookId), { recursive: true });
  // A tiny placeholder PDF so the source path exists.
  await writeFile(path.join(dataDir(), 'books', bookId, 'source.pdf'), Buffer.from('%PDF-1.4\n%dev\n%%EOF'));
  const raw = (await import('../data/textbook.json', { with: { type: 'json' } })).default as unknown as RawChunk[];

  let copied = 0;
  for (const chunk of raw) {
    const name = path.basename(chunk.image || '');
    if (!name) continue;
    const src = path.join(process.cwd(), 'assets', 'legacy-textbook', name);
    const dest = pageImagePath(bookId, chunk.pdfPage);
    try {
      await copyFile(src, dest);
      copied += 1;
    } catch {
      /* page image may be absent; page rendering will 404 for that page only */
    }
  }

  await db.delete(books).where(eq(books.subjectId, subject.id));
  await db.insert(books).values({
    id: bookId, subjectId: subject.id, title: 'كتاب الرياضيات (تطوير)',
    originalFileName: 'math-dev.pdf', storedFilePath: `books/${bookId}/source.pdf`,
    sha256: 'dev', totalPages: raw.length, indexedPages: raw.length,
    status: 'READY', errorMessage: null, createdAt: now, updatedAt: now,
  });
  await db.insert(textbookChunks).values(
    raw.filter((c) => c.text?.trim()).map((c) => ({
      id: `${c.id}-${bookId.slice(0, 8)}`, bookId, subjectId: subject.id,
      sourceId: c.sourceId, pdfPage: c.pdfPage, printedPage: c.printedPage ?? null,
      unit: c.unit, lesson: c.lesson, heading: c.heading ?? null, text: c.text,
      equations: Array.isArray(c.equations) ? c.equations : [], pageImagePath: `${c.pdfPage}.jpg`,
      searchText: normalize([c.text, c.unit, c.lesson, c.heading].filter(Boolean).join(' ')),
      createdAt: now,
    })),
  );

  // 2) An active semester covering the subject's grade.
  const startsAt = new Date(now.getTime() - 7 * 86400000);
  const endsAt = new Date(now.getTime() + 120 * 86400000);
  const [existingSem] = await db.select().from(semesters).limit(1);
  if (!existingSem) {
    await db.insert(semesters).values({
      id: crypto.randomUUID(), name: 'الفصل الأول 2026/2027', academicYear: '2026/2027',
      gradeId: grade.id, academicFieldId: null, startsAt, endsAt,
      salesStartAt: new Date(now.getTime() - 30 * 86400000), salesEndAt: null,
      priceMinor: 29_000, currency: 'JOD', includedCredits: 300, status: 'ACTIVE',
      lateEnrollmentPolicy: 'FULL_PRICE', topUpEnabled: true, freemiusPlanId: null,
      adminNotes: 'فصل تطوير محلي', createdBy: null, createdAt: now, updatedAt: now,
    });
  }

  // 3) Top-up offers.
  const [existingTopup] = await db.select().from(topupOffers).limit(1);
  if (!existingTopup) {
    await db.insert(topupOffers).values([
      { id: crypto.randomUUID(), name: '100 كريدت', credits: 100, priceMinor: 5_000, currency: 'JOD', status: 'ACTIVE', sortOrder: 1, freemiusPlanId: null, createdAt: now, updatedAt: now },
      { id: crypto.randomUUID(), name: '250 كريدت', credits: 250, priceMinor: 11_000, currency: 'JOD', status: 'ACTIVE', sortOrder: 2, freemiusPlanId: null, createdAt: now, updatedAt: now },
    ]);
  }

  // 4) Test accounts.
  const people = [
    { key: 'admin', email: 'dev-admin@fahimni.local', name: 'مشرف تجريبي', role: 'ADMIN' as const },
    { key: 'student', email: 'dev-student@fahimni.local', name: 'طالب تجريبي', role: 'STUDENT' as const },
    { key: 'new-student', email: 'dev-new-student@fahimni.local', name: 'طالب جديد تجريبي', role: 'STUDENT' as const },
  ];
  for (const person of people) {
    await db.insert(users).values({ id: `dev-${person.key}-${crypto.randomUUID()}`, email: person.email, name: person.name, role: person.role, createdAt: now, updatedAt: now }).onConflictDoNothing({ target: users.email });
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, person.email)).limit(1);
    if (!row) continue;
    await db.insert(accounts).values({ id: crypto.randomUUID(), userId: row.id, provider: 'google', providerAccountId: `dev-${row.id}`, createdAt: now }).onConflictDoNothing();
    if (person.role === 'STUDENT'&&person.key!=='new-student') {
      await db.insert(studentProfiles).values({ userId: row.id, gradeId: grade.id, academicFieldId: field?.id ?? null, onboardingCompleted: true, createdAt: now, updatedAt: now }).onConflictDoNothing({ target: studentProfiles.userId });
    }
  }

  console.log(`✔ book READY (${raw.length} chunks, ${copied} page images copied)`);
  console.log('✔ active semester + 2 top-up offers');
  console.log('✔ accounts: dev-student@fahimni.local · dev-admin@fahimni.local');
  console.log('\nLogin:');
  console.log('  student: http://localhost:3000/api/auth/dev-login?target=student');
  console.log('  admin:   http://localhost:3000/api/auth/dev-login?target=admin');
}

main().catch((error: unknown) => {
  console.error('dev-setup failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => closeDb());
