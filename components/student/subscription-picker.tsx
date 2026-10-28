'use client';

import { useState } from 'react';
import { BookOpen, CalendarDays, Layers, RefreshCw } from 'lucide-react';

import { FnBadge, FnButton, FnCard, FnSegmented, FnSegmentedItem } from '@/components/fahimni';
import { formatMinor } from '@/lib/admin/money';
import { cn } from '@/lib/utils';

export type PickerTerm = {
  name: string;
  startsAt: string;
  endsAt: string;
  phase: 'upcoming' | 'ongoing';
  daysRemaining: number;
};

export type PickerOverlap = { subject: string; until: string | null };

export type PickerOffer = {
  id: string;
  kind: 'SUBJECT' | 'BUNDLE';
  type: 'MONTHLY' | 'SEMESTER';
  title: string;
  subjects: string[];
  priceMinor: number | null;
  currency: string;
  monthlyCreditAllowance: number;
  term: PickerTerm | null;
  overlaps: PickerOverlap[];
  hasCoverage: boolean;
};

export type PickerLegacyPlan = {
  subjectId: string;
  title: string;
  type: 'MONTHLY' | 'SEMESTER';
  priceMinor: number | null;
  currency: string;
  monthlyCreditAllowance: number;
  overlaps: PickerOverlap[];
  hasCoverage: boolean;
};

type Pending = { kind: 'offer'; offer: PickerOffer } | { kind: 'legacy'; plan: PickerLegacyPlan };

const BILLING_LABELS: Record<PickerOffer['type'], string> = {
  MONTHLY: 'دفع شهري متكرر',
  SEMESTER: 'دفعة واحدة للفصل الدراسي',
};

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('ar-JO', { dateStyle: 'medium' }).format(new Date(iso));
}

function overlapsOf(pending: Pending): PickerOverlap[] {
  return pending.kind === 'offer' ? pending.offer.overlaps : pending.plan.overlaps;
}

export function SubscriptionPicker({
  offers,
  legacyPlans,
}: {
  offers: PickerOffer[];
  legacyPlans: PickerLegacyPlan[];
}) {
  const [coverage, setCoverage] = useState<'single' | 'all'>('single');
  const [billing, setBilling] = useState<'MONTHLY' | 'SEMESTER'>('MONTHLY');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const visibleOffers = offers.filter(
    (offer) => offer.type === billing && (coverage === 'single' ? offer.kind === 'SUBJECT' : offer.kind === 'BUNDLE'),
  );
  const visibleLegacy = coverage === 'single' ? legacyPlans.filter((plan) => plan.type === billing) : [];
  const empty = visibleOffers.length === 0 && visibleLegacy.length === 0;

  async function checkout(selection: Pending) {
    const key = selection.kind === 'offer' ? selection.offer.id : selection.plan.subjectId;
    setBusyKey(key);
    setError(null);
    try {
      const body =
        selection.kind === 'offer'
          ? { offerId: selection.offer.id }
          : { subjectId: selection.plan.subjectId, planType: selection.plan.type };
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || 'تعذر بدء عملية الدفع.');
      window.location.href = data.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر بدء عملية الدفع.');
      setBusyKey(null);
      setPending(null);
    }
  }

  function begin(selection: Pending) {
    if (overlapsOf(selection).length > 0) {
      setPending(selection);
      return;
    }
    void checkout(selection);
  }

  return (
    <div className="fn-stack fn-stack--lg">
      <div className="sub-choice" role="group" aria-label="نوع الاشتراك">
        <button
          type="button"
          className={cn('sub-choice__tile', coverage === 'single' && 'is-active')}
          aria-pressed={coverage === 'single'}
          onClick={() => setCoverage('single')}
        >
          <span className="sub-choice__icon">
            <BookOpen size={22} aria-hidden="true" />
          </span>
          <span className="sub-choice__copy">
            <strong>مادة واحدة</strong>
            <small>اشترك في مادة محددة</small>
          </span>
        </button>
        <button
          type="button"
          className={cn('sub-choice__tile', coverage === 'all' && 'is-active')}
          aria-pressed={coverage === 'all'}
          onClick={() => setCoverage('all')}
        >
          <span className="sub-choice__icon">
            <Layers size={22} aria-hidden="true" />
          </span>
          <span className="sub-choice__copy">
            <strong>جميع المواد</strong>
            <small>كل مواد صفك في باقة واحدة</small>
          </span>
        </button>
      </div>

      <div className="sub-billing">
        <FnSegmented aria-label="نوع الدفع">
          <FnSegmentedItem active={billing === 'MONTHLY'} onClick={() => setBilling('MONTHLY')}>
            <RefreshCw size={15} aria-hidden="true" />
            شهري
          </FnSegmentedItem>
          <FnSegmentedItem active={billing === 'SEMESTER'} onClick={() => setBilling('SEMESTER')}>
            <CalendarDays size={15} aria-hidden="true" />
            فصلي
          </FnSegmentedItem>
        </FnSegmented>
      </div>

      {error ? (
        <p className="fn-alert fn-alert--error" role="alert">
          {error}
        </p>
      ) : null}

      {empty ? (
        <FnCard variant="flat" className="fn-empty">
          <p className="fn-empty__title">لا توجد عروض متاحة هنا حاليًا</p>
          <p className="fn-empty__text">جرّب النوع الآخر من الدفع أو تحقق لاحقًا — نضيف عروضًا جديدة باستمرار.</p>
        </FnCard>
      ) : (
        <div className="fn-grid fn-grid--2">
          {visibleOffers.map((offer) => (
            <FnCard
              key={offer.id}
              variant={offer.type === 'SEMESTER' ? 'tinted' : 'default'}
              className="pricing-card fn-stack sub-card"
            >
              {offer.type === 'SEMESTER' ? <span className="pricing-card__ribbon">الأفضل قيمة</span> : null}
              <span className="pricing-card__name">{offer.title}</span>
              {offer.hasCoverage ? <FnBadge variant="mint">لديك وصول ساري يغطي هذا العرض</FnBadge> : null}
              <span className="pricing-card__price">{formatMinor(offer.priceMinor, offer.currency)}</span>
              <span className="fn-caption">{BILLING_LABELS[offer.type]}</span>
              {offer.monthlyCreditAllowance > 0 ? (
                <span>
                  <FnBadge variant="sky">رصيد {offer.monthlyCreditAllowance} نقطة شهريًا</FnBadge>
                </span>
              ) : null}
              {offer.kind === 'BUNDLE' ? (
                <div className="sub-covered">
                  <span className="sub-covered__label">تشمل الباقة:</span>
                  <span className="sub-covered__chips">
                    {offer.subjects.map((name) => (
                      <span key={name} className="sub-chip">
                        {name}
                      </span>
                    ))}
                  </span>
                </div>
              ) : null}
              {offer.term ? (
                <div className="sub-term">
                  <strong>{offer.term.name}</strong>
                  <span>
                    {offer.term.phase === 'upcoming'
                      ? `يبدأ في ${formatDay(offer.term.startsAt)}`
                      : `بدأ في ${formatDay(offer.term.startsAt)} · يتبقى ${offer.term.daysRemaining} يوم`}
                  </span>
                  <span>ينتهي بنهاية الفصل في {formatDay(offer.term.endsAt)}</span>
                </div>
              ) : null}
              {offer.overlaps.length > 0 ? (
                <p className="sub-overlap-note">لديك اشتراك ساري يغطي بعض مواد هذا العرض — سنوضح لك قبل الدفع.</p>
              ) : null}
              <FnButton block onClick={() => begin({ kind: 'offer', offer })} disabled={busyKey !== null}>
                {busyKey === offer.id ? 'جاري التحويل إلى الدفع…' : 'اشترك الآن'}
              </FnButton>
            </FnCard>
          ))}
          {visibleLegacy.map((plan) => (
            <FnCard
              key={plan.subjectId}
              variant={plan.type === 'SEMESTER' ? 'tinted' : 'default'}
              className="pricing-card fn-stack sub-card"
            >
              {plan.type === 'SEMESTER' ? <span className="pricing-card__ribbon">الأفضل قيمة</span> : null}
              <span className="pricing-card__name">{plan.title}</span>
              {plan.hasCoverage ? <FnBadge variant="mint">لديك وصول ساري في هذه المادة</FnBadge> : null}
              <span className="pricing-card__price">{formatMinor(plan.priceMinor, plan.currency)}</span>
              <span className="fn-caption">{BILLING_LABELS[plan.type]}</span>
              {plan.monthlyCreditAllowance > 0 ? (
                <span>
                  <FnBadge variant="sky">رصيد {plan.monthlyCreditAllowance} نقطة شهريًا</FnBadge>
                </span>
              ) : null}
              {plan.overlaps.length > 0 ? (
                <p className="sub-overlap-note">لديك اشتراك ساري في هذه المادة — سنوضح لك قبل الدفع.</p>
              ) : null}
              <FnButton block onClick={() => begin({ kind: 'legacy', plan })} disabled={busyKey !== null}>
                {busyKey === plan.subjectId ? 'جاري التحويل إلى الدفع…' : 'اشترك الآن'}
              </FnButton>
            </FnCard>
          ))}
        </div>
      )}

      {pending ? (
        <div className="sub-confirm" role="alertdialog" aria-modal="true" aria-label="تنبيه الاشتراكات المتداخلة">
          <div className="sub-confirm__panel">
            <strong>لديك اشتراك ساري يغطي هذا العرض</strong>
            <ul className="sub-confirm__list">
              {overlapsOf(pending).map((overlap) => (
                <li key={`${overlap.subject}-${overlap.until ?? 'open'}`}>
                  {overlap.subject}
                  {overlap.until ? ` — حتى ${formatDay(overlap.until)}` : ''}
                </li>
              ))}
            </ul>
            <p className="fn-caption">
              لن نلغي اشتراكك الحالي ولن ندمج الأرصدة تلقائيًا. الاشتراك الجديد يضيف وصولًا مستقلًا، وقد تتكرر الفاتورة إذا كان
              اشتراكك الحالي متكررًا. لا توجد خصومات تناسبية مضمونة.
            </p>
            <div className="sub-confirm__actions">
              <FnButton onClick={() => void checkout(pending)} disabled={busyKey !== null}>
                {busyKey !== null ? 'جاري التحويل إلى الدفع…' : 'أفهم ذلك، تابع للدفع'}
              </FnButton>
              <FnButton variant="soft" onClick={() => setPending(null)} disabled={busyKey !== null}>
                إلغاء
              </FnButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
