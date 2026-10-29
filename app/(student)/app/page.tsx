import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import { FnBadge, FnButton, FnCard, FnLinkMore } from '@/components/fahimni';
import { CreditBadge } from '@/components/student/credit-badge';
import { SubjectCard } from '@/components/student/subject-card';
import { TrialCard } from '@/components/student/trial-card';
import { isTrialEnded, isTrialUsable, resolveSubjectAccess } from '@/lib/billing/access-map';
import { isEntitlementActive } from '@/lib/billing/entitlements';
import { billingStore } from '@/lib/billing/store';
import { booksStore } from '@/lib/books/store';
import { ensureCreditPeriod } from '@/lib/credits/periods';
import { requireOnboardedStudent } from '@/lib/student/guard';
import { fieldNameFor } from '@/lib/student/onboarding';
import { studentStore } from '@/lib/student/store';
import { whiteboardHrefFor } from '@/lib/student/tutor-link';
import { trialStore } from '@/lib/trial/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'الرئيسية',
  description: 'لوحة الطالب في فهمني.',
};

export default async function StudentDashboardPage() {
  const { user, profile } = await requireOnboardedStudent('/app');
  const store = studentStore();
  const billing = billingStore();
  const trials = trialStore();

  const [grade, fields, subjects, entitlements, trial, trialSettings] = await Promise.all([
    store.findGradeById(profile.gradeId),
    store.listActiveFieldsForGrade(profile.gradeId),
    store.listSubjectsForStudent(profile.gradeId, profile.academicFieldId),
    billing.listEntitlementsForUser(user.id),
    trials.findByUserId(user.id),
    trials.getSettings(),
  ]);

  const activeEntitlements = await Promise.all(
    entitlements.filter((entitlement) => isEntitlementActive(entitlement)).map((entitlement) => ensureCreditPeriod(billing, entitlement)),
  );
  const hasPaid = activeEntitlements.length > 0;
  const paidBalance = activeEntitlements.reduce((sum, entitlement) => sum + entitlement.creditBalance, 0);

  const readyBooks = await Promise.all(subjects.map((subject) => booksStore().findReadyBookBySubject(subject.id)));
  const readyBookIds = new Set(subjects.filter((_, index) => readyBooks[index] !== null).map((subject) => subject.id));

  const subjectStates = await resolveSubjectAccess({
    billing,
    userId: user.id,
    subjects,
    trial,
    trialEnabled: trialSettings.enabled,
    readyBookIds,
  });

  // "موادي" holds only real access: active subject entitlements, active bundle
  // coverage, and the subject the student actually used during a live trial.
  // The full catalog lives on /app/subjects — never duplicated here.
  const mySubjectIds = new Set(
    subjects.filter((subject) => ['paid', 'bundle'].includes(subjectStates.get(subject.id) ?? '')).map((subject) => subject.id),
  );
  const recentTrialSubjectId = trial && isTrialUsable(trial) ? await trials.latestUsageSubjectId(trial.id) : null;
  if (recentTrialSubjectId && subjectStates.get(recentTrialSubjectId) === 'trial') mySubjectIds.add(recentTrialSubjectId);
  const mySubjects = subjects.filter((subject) => mySubjectIds.has(subject.id));

  const trialSiteKey = ((process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? process.env.TURNSTILE_SITE_KEY) || '').trim() || null;
  const whiteboardHref = whiteboardHrefFor(subjects);
  const fieldName = fieldNameFor(fields, profile.academicFieldId);
  const firstName = user.name?.trim().split(/\s+/)[0] || 'طالبنا العزيز';

  // Subscription/trial status comes from the real records, never guessed.
  const status = hasPaid
    ? { variant: 'mint' as const, label: 'اشتراك نشط' }
    : trial?.status === 'ACTIVE'
      ? { variant: 'sky' as const, label: 'تجربة مجانية نشطة' }
      : trial?.status === 'CLAIMED'
        ? { variant: 'gold' as const, label: 'تجربة جاهزة — لم تبدأ' }
        : trial && isTrialEnded(trial)
          ? { variant: 'outline' as const, label: 'تجربة منتهية' }
          : { variant: 'outline' as const, label: 'لا يوجد اشتراك نشط' };

  return (
    <div className="fn-container fn-stack fn-stack--lg">
      <header className="dash-header">
        <h1 className="fn-display fn-display--xl">مرحبًا، {firstName} 👋</h1>
        <div className="fn-row fn-row--wrap">
          {grade ? (
            <FnBadge variant="outline">
              {grade.name}
              {fieldName ? ` · ${fieldName}` : ''}
            </FnBadge>
          ) : null}
          <FnBadge variant={status.variant}>{status.label}</FnBadge>
          {hasPaid ? (
            <CreditBadge balance={paidBalance} resetAt={activeEntitlements[0]?.creditPeriodEndsAt ?? null} />
          ) : trial?.status === 'ACTIVE' ? (
            <CreditBadge balance={trial.remainingCredits} resetAt={trial.expiresAt} label="رصيد التجربة" />
          ) : trial?.status === 'CLAIMED' ? (
            <CreditBadge balance={trial.remainingCredits} label="رصيد التجربة" hint="لم تبدأ" />
          ) : null}
        </div>
      </header>

      {!hasPaid && (trial || trialSettings.enabled) ? (
        <TrialCard
          trial={trial}
          enabled={trialSettings.enabled}
          siteKey={trialSiteKey}
          claimable={!hasPaid}
          whiteboardHref={whiteboardHref}
          creditAllowance={trialSettings.creditAllowance}
          durationHours={trialSettings.durationHours}
        />
      ) : null}

      <section className="fn-section">
        <div className="fn-section__head">
          <h2 className="fn-section__title">موادي</h2>
          {mySubjects.length > 0 ? (
            <FnLinkMore asChild>
              <Link href="/app/subjects">
                استعرض جميع المواد
                <ChevronLeft size={15} aria-hidden="true" />
              </Link>
            </FnLinkMore>
          ) : null}
        </div>
        {mySubjects.length > 0 ? (
          <div className="subjects-grid">
            {mySubjects.map((subject) => (
              <SubjectCard
                key={subject.id}
                subject={subject}
                state={subjectStates.get(subject.id) ?? 'none'}
                siteKey={trialSiteKey}
              />
            ))}
          </div>
        ) : (
          <FnCard variant="flat" className="dash-empty dash-empty--cta">
            <span className="dash-stat__body">
              <span className="dash-stat__value">ما عندك مواد مضافة بعد</span>
              <span className="fn-caption">تصفّح المواد المتاحة لصفك واختر ما تريد دراسته.</span>
            </span>
            <FnButton asChild variant="soft" size="sm">
              <Link href="/app/subjects">استعرض المواد</Link>
            </FnButton>
          </FnCard>
        )}
      </section>

      <section className="fn-section">
        <div className="fn-section__head">
          <h2 className="fn-section__title">آخر الجلسات</h2>
        </div>
        <FnCard variant="flat" className="dash-empty">
          <span className="dash-stat__body">
            <span className="fn-caption">لا توجد جلسات محفوظة بعد — تظهر هنا بعد أول شرح كامل على السبورة.</span>
          </span>
        </FnCard>
      </section>
    </div>
  );
}
