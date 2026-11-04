import { billingStore } from './store';
import { semesterStore } from './semester-store';
import { purchaseStore } from './purchase-store';
import { topupStore, type TopupOfferRecord } from './topup-store';
import { creditWalletStore, type WalletSnapshot } from './wallet-store';
import { includedSubjectIds, subscriptionStatusFor, type StudentSubscriptionView } from './subscription';
import { booksStore } from '../books/store';
import { studentStore, type CatalogSubject } from '../student/store';
import { daysRemaining, termPhase } from './terms';

// Assembles the single student-facing subscription view: the semester offer
// for their grade/track, their live purchase, remaining time and unified wallet.
// Read-only; never grants access.
export type StudentSubscription = StudentSubscriptionView & {
  subjects: CatalogSubject[];
  topupOffers: TopupOfferRecord[];
  recentPurchases: Awaited<ReturnType<ReturnType<typeof purchaseStore>['listPurchasesForUser']>>;
};

export async function loadStudentSubscription(input: {
  userId: string;
  gradeId: string;
  academicFieldId: string | null;
  now?: Date;
}): Promise<StudentSubscription> {
  const now = input.now ?? new Date();
  const semesters = semesterStore();
  const purchases = purchaseStore();

  const semester = await semesters.findCurrentSemesterForScope({
    gradeId: input.gradeId,
    academicFieldId: input.academicFieldId,
    now,
  });

  const purchase = semester
    ? await purchases.findLatestPurchaseForUserSemester(input.userId, semester.id)
    : null;

  const subjects = await studentStore().listSubjectsForStudent(input.gradeId, input.academicFieldId);
  const readySubjectIds = new Set<string>();
  for (const subject of subjects) {
    if (await booksStore().findReadyBookBySubject(subject.id)) readySubjectIds.add(subject.id);
  }
  const coveredIds = semester
    ? includedSubjectIds(subjects, readySubjectIds, { gradeId: semester.gradeId, academicFieldId: semester.academicFieldId })
    : includedSubjectIds(subjects, readySubjectIds, { gradeId: input.gradeId, academicFieldId: input.academicFieldId });

  const wallet = await creditWalletStore().getSnapshot(input.userId);
  const topupOffers = semester?.topUpEnabled ? await topupStore().listActiveOffers() : [];
  const recentPurchases = await purchases.listPurchasesForUser(input.userId);

  return {
    semester,
    purchase,
    sellable: semester ? termPhase(semester.startsAt, semester.endsAt, now) !== 'ended' : false,
    phase: semester ? termPhase(semester.startsAt, semester.endsAt, now) : 'none',
    daysRemaining: semester ? daysRemaining(semester.endsAt, now) : 0,
    priceMinor: semester?.priceMinor ?? 0,
    currency: semester?.currency ?? 'JOD',
    includedCredits: semester?.includedCredits ?? 0,
    startsAt: semester?.startsAt ?? null,
    endsAt: semester?.endsAt ?? null,
    includedSubjectIds: coveredIds,
    status: subscriptionStatusFor({ semester, purchase, now }),
    wallet,
    subjects: subjects.filter((subject) => coveredIds.includes(subject.id)),
    topupOffers,
    recentPurchases,
  };
}

// The dashboard widget's small data shape.
export type SubscriptionWidget = {
  status: 'none' | 'scheduled' | 'active' | 'expired';
  semesterName: string | null;
  endsAt: Date | null;
  daysRemaining: number;
  credits: WalletSnapshot;
};

export async function loadSubscriptionWidget(userId: string, gradeId: string, academicFieldId: string | null, now = new Date()): Promise<SubscriptionWidget> {
  const view = await loadStudentSubscription({ userId, gradeId, academicFieldId, now });
  return {
    status: view.status,
    semesterName: view.semester?.name ?? null,
    endsAt: view.endsAt,
    daysRemaining: view.daysRemaining,
    credits: view.wallet ?? { userId, semesterBalance: 0, topupBalance: 0, semesterGrantedAt: null, semesterExpiresAt: null, updatedAt: now, total: 0 },
  };
}

export { billingStore };
