import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { AuthUser } from '../auth/store';
import { hasSubjectAccess } from '../billing/entitlements';
import { billingStore, type BillingStore } from '../billing/store';
import { subjectAppliesTo } from '../student/onboarding';
import type { StudentStore } from '../student/store';
import { trialAccessActive } from '../trial/access';
import { trialStore, type TrialStore } from '../trial/store';
import { isUuid, pageImagePath, pagesDir } from './storage';
import type { BooksStore } from './store';

export type PageResolution = { ok: true; path: string } | { ok: false };

// A page image is only served for a READY book whose subject is visible to the
// requesting student AND for which the student has active access (paid
// entitlement or an active trial). Admins may view any page. The page number is
// strictly numeric and the final path is verified to stay inside the book's
// pages directory.
export async function resolveBookPage(input: {
  bookId: string;
  page: string;
  user: AuthUser;
  books: BooksStore;
  students: StudentStore;
  billing?: BillingStore;
  trials?: TrialStore;
  now?: Date;
}): Promise<PageResolution> {
  if (!isUuid(input.bookId)) return { ok: false };

  const rawPage = input.page.trim();
  const page = Number(rawPage);
  if (!/^\d{1,6}$/.test(rawPage) || !Number.isInteger(page) || page < 1) return { ok: false };

  const book = await input.books.findBookById(input.bookId);
  if (!book || book.status !== 'READY') return { ok: false };

  if (input.user.role !== 'ADMIN') {
    const profile = await input.students.getProfile(input.user.id);
    if (!profile?.onboardingCompleted) return { ok: false };
    const subject = await input.students.findSubjectById(book.subjectId);
    if (!subject || !subjectAppliesTo(subject, profile.gradeId, profile.academicFieldId)) return { ok: false };

    const now = input.now ?? new Date();
    const billing = input.billing ?? billingStore();
    const entitled = await hasSubjectAccess(billing, input.user.id, subject.id, now);
    if (!entitled) {
      const trials = input.trials ?? trialStore();
      const trial = await trials.findByUserId(input.user.id);
      if (!trialAccessActive(trial, now)) return { ok: false };
    }
  }

  let filePath: string;
  try {
    filePath = pageImagePath(input.bookId, page);
  } catch {
    return { ok: false };
  }

  const directory = pagesDir(input.bookId);
  const resolvedDir = path.resolve(directory) + path.sep;
  if (!path.resolve(filePath).startsWith(resolvedDir)) return { ok: false };

  try {
    await stat(filePath);
  } catch {
    return { ok: false };
  }
  return { ok: true, path: filePath };
}
