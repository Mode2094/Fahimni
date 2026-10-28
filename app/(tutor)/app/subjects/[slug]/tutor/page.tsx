import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BookOpen, Crown } from 'lucide-react';

import Classroom from '@/components/classroom/Classroom';
import { FnButton, FnCard } from '@/components/fahimni';
import { isEntitlementActive } from '@/lib/billing/entitlements';
import { billingStore } from '@/lib/billing/store';
import { booksStore } from '@/lib/books/store';
import { ensureCreditPeriod } from '@/lib/credits/periods';
import { requireOnboardedStudent } from '@/lib/student/guard';
import { visibleSubjectFor } from '@/lib/student/onboarding';
import { studentStore } from '@/lib/student/store';
import { trialStore } from '@/lib/trial/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'السبورة',
  description: 'سبورة المادة التفاعلية في فهمني.',
};

export default async function SubjectTutorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { user, profile } = await requireOnboardedStudent('/app/subjects');
  const { slug } = await params;
  const subject = visibleSubjectFor(profile, await studentStore().findSubjectBySlug(slug));
  if (!subject) notFound();

  const book = await booksStore().findReadyBookBySubject(subject.id);
  if (!book) {
    return (
      <div className="fn-root fn-page">
        <main className="fn-page__main">
          <div className="fn-container">
            <FnCard variant="flat" className="fn-center fn-card--centered">
              <div className="fn-icon-tile fn-icon-tile--lg">
                <BookOpen size={28} aria-hidden="true" />
              </div>
              <p className="fn-empty__title">الكتاب غير جاهز بعد.</p>
              <p className="fn-empty__text">نعمل على تجهيز كتاب هذه المادة. عد قريبًا.</p>
              <FnButton asChild variant="soft">
                <Link href={`/app/subjects/${subject.slug}`}>العودة للمادة</Link>
              </FnButton>
            </FnCard>
          </div>
        </main>
      </div>
    );
  }

  const billing = billingStore();
  const now = new Date();
  let entitlement = await billing.findAccessibleEntitlement(user.id, subject.id, now);
  const paidActive = Boolean(entitlement && isEntitlementActive(entitlement, now));
  const trial = paidActive ? null : await trialStore().findByUserId(user.id);
  const trialUsable = Boolean(
    trial &&
      (trial.status === 'CLAIMED' || trial.status === 'ACTIVE') &&
      trial.remainingCredits > 0 &&
      (trial.status === 'CLAIMED' || (trial.expiresAt && trial.expiresAt.getTime() > now.getTime())),
  );

  if (!paidActive && !trialUsable) {
    const expiredByTime = Boolean(
      trial &&
        (trial.status === 'EXPIRED' ||
          (trial.status === 'ACTIVE' && trial.expiresAt && trial.expiresAt.getTime() <= now.getTime())),
    );
    const trialEnded = expiredByTime || Boolean(trial && (trial.status === 'EXHAUSTED' || trial.remainingCredits <= 0));
    const title = trialEnded
      ? expiredByTime
        ? 'انتهت تجربتك المجانية'
        : 'انتهى رصيد تجربتك المجانية'
      : 'تحتاج للاشتراك في المادة للمتابعة';
    const text = trialEnded
      ? 'اشترك في مادة أو باقة للاستمرار في التعلّم — حسابك وكل تقدّمك محفوظان.'
      : `اشترك في ${subject.name} للوصول إلى الشرح الكامل على السبورة، أو جرّب فهمني مجانًا أولًا.`;
    return (
      <div className="fn-root fn-page">
        <main className="fn-page__main">
          <div className="fn-container">
            <FnCard variant="flat" className="fn-center fn-card--centered">
              <div className="fn-icon-tile fn-icon-tile--gold fn-icon-tile--lg">
                <Crown size={28} aria-hidden="true" />
              </div>
              <p className="fn-empty__title">{title}</p>
              <p className="fn-empty__text">{text}</p>
              <FnButton asChild>
                <Link href="/app/subscription">{trialEnded ? 'استكشف الاشتراكات' : 'اشترك الآن'}</Link>
              </FnButton>
              {!trialEnded ? (
                <FnButton asChild variant="soft">
                  <Link href="/app/subscription">جرّب فهمني مجانًا</Link>
                </FnButton>
              ) : null}
            </FnCard>
          </div>
        </main>
      </div>
    );
  }

  if (paidActive && entitlement) {
    entitlement = await ensureCreditPeriod(billing, entitlement, now);
    return <Classroom subject={{ slug: subject.slug, name: subject.name }} creditBalance={entitlement.creditBalance} />;
  }

  // Trial access: the 48h countdown starts on the first accepted AI request.
  return (
    <Classroom
      subject={{ slug: subject.slug, name: subject.name }}
      creditBalance={trial?.remainingCredits ?? 0}
      trial={{ expiresAt: trial?.expiresAt ? trial.expiresAt.toISOString() : null }}
    />
  );
}
