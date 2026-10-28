import { CheckCircle2, CircleAlert, CreditCard, RefreshCw } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { AdminStatusBadge } from '@/components/admin/admin-ui';
import { OfferWizard, type WizardCatalog } from '@/components/admin/offer-wizard';
import { OFFER_ISSUE_LABELS, type OfferReadinessIssue } from '@/lib/admin/offer-readiness';
import { CHECKOUT_STATUS_LABELS, type CheckoutStatus } from '@/lib/freemius/readiness';
import { formatMinor, formatMinorAmount } from '@/lib/admin/money';
import type { SubscriptionOfferRecord } from '@/lib/billing/store';

const STATUS_BADGE: Record<CheckoutStatus, 'mint' | 'gold' | 'sky' | 'danger' | 'outline'> = {
  READY: 'mint',
  PENDING_LINK: 'gold',
  SYNCING: 'sky',
  SYNC_FAILED: 'danger',
  DRAFT: 'outline',
};

export type OfferAdminView = {
  offer: SubscriptionOfferRecord;
  title: string;
  readiness: { ready: boolean; issues: OfferReadinessIssue[] };
  bundleScope: string[];
  eligibleSubjects: { id: string; name: string }[];
  termLabel: string | null;
  coveredNames: string[];
  checkout: CheckoutStatus;
  link: {
    planId: string | null;
    currency: string | null;
    priceMinor: number | null;
    verified: boolean;
    lastSyncedAt: Date | null;
    lastError: string | null;
    attempts: number;
  } | null;
};

export function OffersSection({ catalog, views }: { catalog: WizardCatalog; views: OfferAdminView[] }) {
  const subjectOffers = views.filter((view) => view.offer.kind === 'SUBJECT');
  const bundleOffers = views.filter((view) => view.offer.kind === 'BUNDLE');

  const renderOffer = ({ offer, title, readiness, bundleScope, eligibleSubjects, termLabel, coveredNames, checkout, link }: OfferAdminView) => (
    <FnCard key={offer.id} id={`offer-${offer.id}`} variant="flat" className="fn-stack fn-offer-card">
      <div className="fn-card__head">
        <div>
          <span className="fn-card__title">{title}</span>
          <p className="fn-caption">
            {formatMinor(offer.priceMinor, offer.currency)} · رصيد {offer.monthlyCreditAllowance} شهريًا
            {termLabel ? ` · ${termLabel}` : ''}
          </p>
        </div>
        <div className="fn-row fn-row--wrap">
          <AdminStatusBadge active={offer.isActive} />
          <FnBadge variant={STATUS_BADGE[checkout]}>{CHECKOUT_STATUS_LABELS[checkout]}</FnBadge>
        </div>
      </div>

      {offer.kind === 'BUNDLE' && coveredNames.length ? (
        <span className="sub-covered__chips">
          {coveredNames.map((name) => (
            <span key={name} className="sub-chip">
              {name}
            </span>
          ))}
        </span>
      ) : null}

      {link?.verified && link.planId ? (
        <p className="fn-caption">
          فريميوس: خطة <span dir="ltr">{link.planId}</span>
          {link.currency && link.priceMinor !== null ? (
            <>
              {' '}
              · المبلغ المؤكد: <span dir="ltr">{formatMinor(link.priceMinor, link.currency)}</span>
            </>
          ) : null}
          {link.lastSyncedAt ? ` · آخر تحقق: ${new Date(link.lastSyncedAt).toLocaleString('ar-JO')}` : ''}
        </p>
      ) : null}
      {link?.lastError && !link.verified ? <p className="fn-caption">آخر نتيجة: {link.lastError}</p> : null}

      {!readiness.ready ? (
        <ul className="fn-readiness">
          {readiness.issues.map((issue) => (
            <li key={issue}>
              <CircleAlert size={15} aria-hidden="true" />
              {OFFER_ISSUE_LABELS[issue]}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="fn-row fn-row--wrap">
        <form action="/api/admin/settings/freemius/sync" method="post">
          <input type="hidden" name="offerId" value={offer.id} />
          <FnButton type="submit" variant="soft" size="sm">
            <RefreshCw size={15} aria-hidden="true" />
            تحقق / مزامنة مع فريميوس
          </FnButton>
        </form>
      </div>

      <details className="fn-details">
        <summary>تعديل العرض</summary>
        <form action={`/api/admin/subscriptions/offers/${offer.id}`} method="post" className="fn-stack fn-details__body">
          <div className="fn-grid fn-grid--2">
            <div className="fn-field">
              <label className="fn-field__label" htmlFor={`offer-price-${offer.id}`}>
                السعر
              </label>
              <input
                className="fn-input"
                id={`offer-price-${offer.id}`}
                name="price"
                inputMode="decimal"
                dir="ltr"
                defaultValue={formatMinorAmount(offer.priceMinor, offer.currency)}
              />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor={`offer-currency-${offer.id}`}>
                العملة
              </label>
              <select className="fn-input" id={`offer-currency-${offer.id}`} name="currency" dir="ltr" defaultValue={offer.currency}>
                <option value="JOD">JOD — دينار أردني</option>
                <option value="USD">USD — دولار أمريكي</option>
              </select>
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor={`offer-credits-${offer.id}`}>
                رصيد فهمني الشهري
              </label>
              <input
                className="fn-input"
                id={`offer-credits-${offer.id}`}
                name="credits"
                type="number"
                min={0}
                max={100000}
                dir="ltr"
                defaultValue={offer.monthlyCreditAllowance}
              />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor={`offer-plan-${offer.id}`}>
                رقم خطة الدفع في فريميوس
              </label>
              <input
                className="fn-input"
                id={`offer-plan-${offer.id}`}
                name="freemiusPlanId"
                dir="ltr"
                maxLength={64}
                defaultValue={offer.freemiusPlanId ?? ''}
              />
            </div>
          </div>
          {offer.kind === 'BUNDLE' ? (
            <fieldset className="fn-fieldset">
              <legend className="fn-legend">المواد المشمولة في الباقة</legend>
              <div className="fn-check-grid">
                {eligibleSubjects.map((subject) => (
                  <label className="fn-check" key={subject.id}>
                    <input type="checkbox" name="bundleSubjectIds" value={subject.id} defaultChecked={bundleScope.includes(subject.id)} />
                    {subject.name}
                  </label>
                ))}
              </div>
              <p className="fn-field__hint">تغيير المواد يؤثر على المشتريات الجديدة فقط؛ اشتراكات الطلاب الحالية تحتفظ بتغطيتها.</p>
            </fieldset>
          ) : null}
          <label className="fn-check">
            <input type="checkbox" name="isActive" defaultChecked={offer.isActive} />
            مفعّل ومعروض للطلاب
          </label>
          <div className="fn-row">
            <FnButton type="submit" size="sm">
              حفظ العرض
            </FnButton>
          </div>
        </form>
      </details>

      <form action={`/api/admin/subscriptions/offers/${offer.id}`} method="post">
        <input type="hidden" name="intent" value="toggle" />
        <FnButton type="submit" variant="soft" size="sm">
          {offer.isActive ? 'تعطيل العرض' : 'تفعيل العرض'}
        </FnButton>
      </form>
    </FnCard>
  );

  return (
    <div className="fn-stack fn-stack--lg">
      <OfferWizard catalog={catalog} />

      <div className="fn-stack">
        <div className="fn-row">
          <span className="fn-icon-tile fn-icon-tile--sm">
            <CreditCard size={18} aria-hidden="true" />
          </span>
          <div className="fn-stack fn-stack--sm">
            <h2 className="fn-card__title">اشتراكات المواد</h2>
            <p className="fn-card__text">عرض واحد لكل مادة ونوع دفع. المسودة تبقى مخفية حتى تنشرها.</p>
          </div>
        </div>
        {subjectOffers.length ? subjectOffers.map(renderOffer) : <p className="fn-caption">لا توجد عروض مواد بعد.</p>}
      </div>

      <div className="fn-stack">
        <div className="fn-row">
          <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--gold">
            <CheckCircle2 size={18} aria-hidden="true" />
          </span>
          <div className="fn-stack fn-stack--sm">
            <h2 className="fn-card__title">باقات جميع المواد</h2>
            <p className="fn-card__text">باقة واحدة تمنح وصولًا لجميع المواد المشمولة، برصيد شهري مشترك واحد.</p>
          </div>
        </div>
        {bundleOffers.length ? bundleOffers.map(renderOffer) : <p className="fn-caption">لا توجد باقات بعد.</p>}
      </div>
    </div>
  );
}
