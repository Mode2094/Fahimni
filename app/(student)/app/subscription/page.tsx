import type { Metadata } from 'next';
import Link from 'next/link';
import { Crown, Receipt } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import {
  SubscriptionPicker,
  type PickerLegacyPlan,
  type PickerOffer,
  type PickerOverlap,
} from '@/components/student/subscription-picker';
import { TrialCard } from '@/components/student/trial-card';
import { isEntitlementActive } from '@/lib/billing/entitlements';
import {
  billingStore,
  type EntitlementRecord,
  type PlanType,
  type SubjectPlanRecord,
} from '@/lib/billing/store';
import { daysRemaining, formatTermDate, termPhase } from '@/lib/billing/terms';
import { formatBookDate } from '@/lib/books/messages';
import { booksStore } from '@/lib/books/store';
import { ensureCreditPeriod } from '@/lib/credits/periods';
import { freemiusConfigured } from '@/lib/freemius/client';
import { offerProviderLinkStore } from '@/lib/freemius/links';
import { isCheckoutReady } from '@/lib/freemius/readiness';
import { requireOnboardedStudent } from '@/lib/student/guard';
import { studentStore, type CatalogSubject } from '@/lib/student/store';
import { trialStore } from '@/lib/trial/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'اشتراكي',
  description: 'اختر اشتراكك في مادة واحدة أو جميع المواد، شهريًا أو لفصل دراسي كامل.',
};

const PLAN_LABELS: Record<PlanType, string> = { MONTHLY: 'شهري', SEMESTER: 'فصلي' };
const STATUS_LABELS: Record<EntitlementRecord['status'], string> = {
  ACTIVE: 'نشط',
  CANCELED: 'ملغي',
  EXPIRED: 'منتهي',
  REFUNDED: 'مسترجع',
  PENDING: 'قيد التفعيل',
};

export default async function SubscriptionPage() {
  const { user, profile } = await requireOnboardedStudent('/app/subscription');
  const students = studentStore();
  const billing = billingStore();
  const now = new Date();

  const [subjects, entitlements, offers, terms] = await Promise.all([
    students.listSubjectsForStudent(profile.gradeId, profile.academicFieldId),
    billing.listEntitlementsForUser(user.id),
    billing.listSubscriptionOffers(),
    billing.listAcademicTerms(),
  ]);

  const subjectById = new Map<string, CatalogSubject>(subjects.map((subject) => [subject.id, subject]));
  const termById = new Map(terms.map((term) => [term.id, term]));

  // Purchase readiness per subject: the tutor is unusable without a READY
  // textbook, so no-book subjects are never offered for purchase.
  const readyBookBySubject = new Map<string, boolean>();
  for (const subject of subjects) {
    readyBookBySubject.set(subject.id, (await booksStore().findReadyBookBySubject(subject.id)) !== null);
  }

  // Active access with its covered subjects (bundle scope resolved).
  const activeAccess: { record: EntitlementRecord; covered: string[] }[] = [];
  for (const entitlement of entitlements) {
    if (!isEntitlementActive(entitlement, now)) continue;
    const record = await ensureCreditPeriod(billing, entitlement, now);
    const covered = record.subjectId ? [record.subjectId] : await billing.listEntitlementSubjectIds(record.id);
    activeAccess.push({ record, covered });
  }

  const overlapFor = (subjectIds: string[]): PickerOverlap[] => {
    const wanted = new Set(subjectIds);
    const seen = new Set<string>();
    const overlaps: PickerOverlap[] = [];
    for (const { record, covered } of activeAccess) {
      for (const subjectId of covered) {
        if (!wanted.has(subjectId)) continue;
        const name = subjectById.get(subjectId)?.name ?? 'مادة';
        const until = record.expiresAt ? record.expiresAt.toISOString() : null;
        const key = `${name}|${until ?? 'open'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        overlaps.push({ subject: name, until });
      }
    }
    return overlaps;
  };

  const pickerOffers: PickerOffer[] = [];
  const offeredSubjectTypes = new Set<string>();
  const links = new Map((await offerProviderLinkStore().listAll()).map((link) => [link.offerId, link]));
  for (const offer of offers) {
    if (!offer.isActive || !offer.freemiusPlanId) continue;
    const link = links.get(offer.id) ?? null;

    let coveredIds: string[] = [];
    let title = '';
    if (offer.kind === 'SUBJECT') {
      const subject = offer.subjectId ? subjectById.get(offer.subjectId) : null;
      if (!subject) continue;
      coveredIds = [subject.id];
      title = subject.name;
      offeredSubjectTypes.add(`${subject.id}:${offer.type}`);
    } else {
      if (offer.gradeId !== profile.gradeId) continue;
      if (offer.academicFieldId !== profile.academicFieldId) continue;
      coveredIds = (await billing.listBundleSubjectIds(offer.id)).filter((id) => subjectById.has(id));
      if (!coveredIds.length) continue;
      // Hide bundles that include any subject without a READY textbook.
      if (coveredIds.some((id) => !readyBookBySubject.get(id))) continue;
      title = profile.academicFieldId ? 'باقة جميع مواد تخصصك' : 'باقة جميع مواد صفك';
    }

    // Only provider-verified offers reach students: the displayed amount and
    // currency are the exact verified provider values.
    if (!isCheckoutReady({ offerActive: offer.isActive, link })) continue;

    let term: PickerOffer['term'] = null;
    if (offer.type === 'SEMESTER') {
      const record = offer.academicTermId ? termById.get(offer.academicTermId) : null;
      if (!record || !record.isActive) continue;
      const phase = termPhase(record.startsAt, record.endsAt, now);
      if (phase === 'ended') continue;
      if (record.gradeId !== profile.gradeId) continue;
      if (record.academicFieldId !== null && record.academicFieldId !== profile.academicFieldId) continue;
      term = {
        name: record.name,
        startsAt: record.startsAt.toISOString(),
        endsAt: record.endsAt.toISOString(),
        phase: phase === 'upcoming' ? 'upcoming' : 'ongoing',
        daysRemaining: daysRemaining(record.endsAt, now),
      };
    }

    pickerOffers.push({
      id: offer.id,
      kind: offer.kind,
      type: offer.type,
      title,
      subjects: coveredIds.map((id) => subjectById.get(id)?.name ?? 'مادة'),
      priceMinor: link?.priceMinor ?? offer.priceMinor,
      currency: link?.currency ?? offer.currency,
      monthlyCreditAllowance: offer.monthlyCreditAllowance,
      term,
      overlaps: overlapFor(coveredIds),
      hasCoverage: overlapFor(coveredIds).length > 0,
    });
  }

  // Legacy per-subject plans remain available for any subject/type that has no
  // active unified offer yet.
  const planById = new Map<string, SubjectPlanRecord>();
  const pickerLegacy: PickerLegacyPlan[] = [];
  for (const subject of subjects) {
    const plans = await billing.listSubjectPlans(subject.id);
    for (const plan of plans) {
      planById.set(plan.id, plan);
      if (!plan.isActive || !plan.freemiusPlanId) continue;
      if (offeredSubjectTypes.has(`${subject.id}:${plan.type}`)) continue;
      // No-book subjects are never purchasable.
      if (!readyBookBySubject.get(subject.id)) continue;
      pickerLegacy.push({
        subjectId: subject.id,
        title: subject.name,
        type: plan.type,
        priceMinor: plan.priceMinor,
        currency: plan.currency,
        monthlyCreditAllowance: plan.monthlyCreditAllowance,
        overlaps: overlapFor([subject.id]),
        hasCoverage: overlapFor([subject.id]).length > 0,
      });
    }
  }

  const hasAnyOption = pickerOffers.length > 0 || pickerLegacy.length > 0;

  const currentSubscriptions = await Promise.all(
    entitlements.map(async (entitlement) => {
      const active = isEntitlementActive(entitlement, now);
      const record = active ? await ensureCreditPeriod(billing, entitlement, now) : entitlement;
      const offer = record.offerId ? offers.find((candidate) => candidate.id === record.offerId) ?? null : null;
      const plan = record.subjectPlanId ? planById.get(record.subjectPlanId) ?? null : null;
      const coveredIds = record.subjectId ? [record.subjectId] : await billing.listEntitlementSubjectIds(record.id);
      const term = record.academicTermId ? termById.get(record.academicTermId) ?? null : null;
      const kind: 'SUBJECT' | 'BUNDLE' = record.subjectId || plan ? 'SUBJECT' : 'BUNDLE';
      const title =
        kind === 'BUNDLE'
          ? 'باقة جميع المواد'
          : subjectById.get(record.subjectId ?? '')?.name ?? (plan ? 'مادة' : 'اشتراك');
      const type = offer?.type ?? plan?.type ?? null;
      return {
        id: record.id,
        title,
        kind,
        type,
        status: record.status,
        renewalCanceled: record.renewalCanceled,
        startsAt: record.startsAt,
        expiresAt: record.expiresAt,
        term,
        creditBalance: record.creditBalance,
        creditPeriodEndsAt: record.creditPeriodEndsAt,
        covered: coveredIds.map((id) => subjectById.get(id)?.name ?? 'مادة'),
        subjectSlug: record.subjectId ? subjectById.get(record.subjectId)?.slug ?? null : null,
        active,
      };
    }),
  );

  const hasActive = activeAccess.length > 0;

  // Free trial is clearly separated from paid offers: one-time, no renewal.
  const trials = trialStore();
  const [trial, trialSettings, freemiusReady] = await Promise.all([
    trials.findByUserId(user.id),
    trials.getSettings(),
    freemiusConfigured(),
  ]);
  const trialSiteKey = ((process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? process.env.TURNSTILE_SITE_KEY) || '').trim() || null;
  const firstSubject = subjects[0] ?? null;
  const trialWhiteboardHref = firstSubject ? `/app/subjects/${firstSubject.slug}/tutor` : '/app/subjects';

  return (
    <div className="fn-container fn-stack fn-stack--lg">
      <header className="fn-stack fn-stack--sm">
        <h1 className="fn-display fn-display--xl">
          اختر اشتراكك <Crown size={26} aria-hidden="true" className="sub-crown" />
        </h1>
        <p className="fn-subtitle">مادة واحدة أو جميع المواد، شهريًا أو لفصل كامل — بأسعار واضحة وبدون التزامات مخفية.</p>
      </header>

      {!hasActive && (trial || trialSettings.enabled) ? (
        <section className="fn-section">
          <div className="fn-section__head">
            <h2 className="fn-section__title">التجربة المجانية</h2>
            <FnBadge variant="gold">ليست اشتراكًا متكررًا</FnBadge>
          </div>
          <TrialCard
            trial={trial}
            enabled={trialSettings.enabled}
            siteKey={trialSiteKey}
            claimable={!hasActive}
            whiteboardHref={trialWhiteboardHref}
            creditAllowance={trialSettings.creditAllowance}
            durationHours={trialSettings.durationHours}
          />
        </section>
      ) : null}

      {hasAnyOption ? (
        <SubscriptionPicker offers={pickerOffers} legacyPlans={pickerLegacy} />
      ) : (
        <FnCard variant="flat" className="fn-empty">
          <div className="fn-icon-tile fn-icon-tile--gold fn-icon-tile--lg">
            <Crown size={26} aria-hidden="true" />
          </div>
          <p className="fn-empty__title">خطط الاشتراك قادمة قريبًا</p>
          <p className="fn-empty__text">نعمل حاليًا على تجهيز خطط الاشتراك لهذه المواد. لا توجد خطط مفعّلة حاليًا — تابعنا قريبًا.</p>
        </FnCard>
      )}

      <section className="fn-section">
        <div className="fn-section__head">
          <h2 className="fn-section__title">اشتراكك الحالي</h2>
          {freemiusReady && hasActive ? (
            <form action="/api/billing/portal" method="post">
              <FnButton type="submit" variant="soft" size="sm">
                <Receipt size={15} aria-hidden="true" />
                إدارة الاشتراك والفواتير
              </FnButton>
            </form>
          ) : null}
        </div>

        {currentSubscriptions.length > 0 ? (
          <div className="fn-grid fn-grid--2">
            {currentSubscriptions.map((subscription) => (
              <FnCard key={subscription.id} className="fn-stack sub-current">
                <div className="fn-card__head">
                  <span className="fn-card__title">{subscription.title}</span>
                  <FnBadge variant={subscription.active ? (subscription.renewalCanceled ? 'gold' : 'mint') : 'outline'}>
                    {subscription.active && subscription.renewalCanceled ? 'نشط — التجديد ملغي' : STATUS_LABELS[subscription.status]}
                  </FnBadge>
                </div>
                {subscription.kind === 'BUNDLE' ? (
                  <p className="fn-card__text">تشمل: {subscription.covered.join('، ') || '—'}</p>
                ) : null}
                <p className="fn-card__text">
                  {subscription.type ? `اشتراك ${PLAN_LABELS[subscription.type]}` : 'اشتراك'}
                  {subscription.startsAt ? ` · يبدأ في ${formatBookDate(subscription.startsAt)}` : ''}
                </p>
                {subscription.expiresAt ? (
                  <p className="fn-caption">
                    {subscription.type === 'SEMESTER' && subscription.term
                      ? `ينتهي بنهاية ${subscription.term.name} في ${formatTermDate(subscription.expiresAt)}`
                      : `ينتهي في ${formatBookDate(subscription.expiresAt)}`}
                  </p>
                ) : null}
                {subscription.active && subscription.renewalCanceled && subscription.expiresAt ? (
                  <p className="fn-caption">التجديد ملغي — يبقى وصولك حتى {formatBookDate(subscription.expiresAt)}.</p>
                ) : null}
                {subscription.active ? (
                  <p className="fn-caption">
                    رصيدك: <strong>{subscription.creditBalance}</strong>
                    {subscription.creditPeriodEndsAt ? ` · يتجدد في ${formatBookDate(subscription.creditPeriodEndsAt)}` : ''}
                  </p>
                ) : null}
                {subscription.subjectSlug ? (
                  <FnButton asChild variant="outline" size="sm">
                    <Link href={`/app/subjects/${subscription.subjectSlug}/tutor`}>ادخل السبورة</Link>
                  </FnButton>
                ) : subscription.kind === 'BUNDLE' && subscription.active ? (
                  <FnButton asChild variant="outline" size="sm">
                    <Link href="/app/subjects">تصفّح المواد المشمولة</Link>
                  </FnButton>
                ) : null}
              </FnCard>
            ))}
          </div>
        ) : (
          <FnCard variant="flat" className="dash-empty">
            <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--gold">
              <Crown size={18} aria-hidden="true" />
            </span>
            <span className="dash-stat__body">
              <span className="dash-stat__value">لا يوجد اشتراك بعد</span>
              <span className="fn-caption">اختر عرضًا من الأعلى وابدأ رحلتك مع فهمني.</span>
            </span>
          </FnCard>
        )}
      </section>
    </div>
  );
}
