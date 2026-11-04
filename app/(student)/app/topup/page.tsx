import type { Metadata } from 'next';
import Link from 'next/link';
import { Coins, Receipt, Sparkles } from 'lucide-react';

import { FnBadge, FnCard } from '@/components/fahimni';
import { TopupCheckoutButton } from '@/components/student/semester-checkout';
import { loadStudentSubscription } from '@/lib/billing/student-view';
import { formatMinor } from '@/lib/admin/money';
import { formatTermDate } from '@/lib/billing/terms';
import { requireOnboardedStudent } from '@/lib/student/guard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'شحن رصيد إضافي',
  description: 'اشحن رصيدًا إضافيًا لمواصلة استخدام المعلم الذكي في جميع موادك.',
};

export default async function TopupPage() {
  const { user, profile } = await requireOnboardedStudent('/app/topup');
  const view = await loadStudentSubscription({ userId: user.id, gradeId: profile.gradeId, academicFieldId: profile.academicFieldId });
  const wallet = view.wallet ?? { semesterBalance: 0, topupBalance: 0, total: 0 };
  const hasActive = view.status === 'active';

  return (
    <div className="fn-container fn-stack" data-testid="topup-page">
      <header className="fn-section__head">
        <div>
          <p className="fn-eyebrow">الرصيد</p>
          <h1 className="fn-display fn-display--lg">شحن رصيد إضافي</h1>
          <p className="fn-subtitle">الرصيد المشترى يبقى في حسابك ولا ينتهي مع الفصل.</p>
        </div>
      </header>

      <section className="fn-card" aria-label="رصيدك">
        <div className="fn-card__head">
          <div className="fn-row">
            <span className="fn-icon-tile fn-icon-tile--gold" aria-hidden>
              <Coins size={18} />
            </span>
            <div>
              <p className="fn-card__title">الرصيد المتاح</p>
              <p className="fn-caption">إجمالي قابل للاستخدام: {wallet.total} كريدت</p>
            </div>
          </div>
          <FnBadge variant={wallet.total > 0 ? 'mint' : 'gold'}>{wallet.total} كريدت</FnBadge>
        </div>
        <div className="fn-grid fn-grid--2">
          <div>
            <p className="fn-caption">رصيد الفصل</p>
            <p className="fn-title">{wallet.semesterBalance}</p>
          </div>
          <div>
            <p className="fn-caption">رصيد مشترى</p>
            <p className="fn-title">{wallet.topupBalance}</p>
          </div>
        </div>
      </section>

      {!hasActive ? (
        <div className="fn-alert" role="status">
          <Sparkles size={16} aria-hidden />
          <span>لتفعيل استخدام الرصيد، يلزم اشتراك فصلي فعّال.</span>
          <Link className="fn-link-more" href="/app/subscription">
            عرض الاشتراك
          </Link>
        </div>
      ) : null}

      <section className="fn-section" aria-label="عروض الشحن">
        <div className="fn-section__head">
          <h2 className="fn-section__title">اختر رصيدًا</h2>
        </div>
        {view.topupOffers.length ? (
          <div className="fn-grid fn-grid--3">
            {view.topupOffers.map((offer) => (
              <FnCard key={offer.id} variant="elevated">
                <div className="fn-card__head">
                  <p className="fn-card__title">{offer.credits} كريدت</p>
                  <FnBadge variant="sky">{formatMinor(offer.priceMinor, offer.currency)}</FnBadge>
                </div>
                <p className="fn-caption">{offer.name}</p>
                <TopupCheckoutButton offerId={offer.id} />
              </FnCard>
            ))}
          </div>
        ) : (
          <p className="fn-caption">لا توجد عروض شحن متاحة حاليًا.</p>
        )}
      </section>

      <section className="fn-section" aria-label="آخر العمليات">
        <div className="fn-section__head">
          <h2 className="fn-section__title">آخر العمليات</h2>
        </div>
        {view.recentPurchases.length ? (
          <div className="fn-table-wrap">
            <table className="fn-table">
              <caption className="fn-caption">آخر عمليات الشراء المسجلة.</caption>
              <thead>
                <tr>
                  <th scope="col">النوع</th>
                  <th scope="col">التاريخ</th>
                  <th scope="col">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {view.recentPurchases.slice(0, 6).map((purchase) => (
                  <tr key={purchase.id}>
                    <td>{purchase.semesterName}</td>
                    <td>{formatTermDate(purchase.createdAt)}</td>
                    <td>{purchase.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fn-caption">لا توجد عمليات بعد.</p>
        )}
      </section>

      <p className="fn-caption">
        <Receipt size={14} aria-hidden /> يتم إضافة الرصيد فقط بعد تأكيد الدفع من المزود. لا يُفعّل أي دفع حقيقي قبل اعتماد المالك.
      </p>
    </div>
  );
}
