import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, CalendarClock, CheckCircle2, Coins, Crown, Sparkles } from 'lucide-react';

import { FnBadge, FnCard } from '@/components/fahimni';
import { SemesterCheckoutButton } from '@/components/student/semester-checkout';
import { loadStudentSubscription } from '@/lib/billing/student-view';
import { formatMinor } from '@/lib/admin/money';
import { formatTermDate } from '@/lib/billing/terms';
import { requireOnboardedStudent } from '@/lib/student/guard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'اشتراكي',
  description: 'اشتراك فهمني الفصلي: جميع مواد صفك الجاهزة في اشتراك واحد مع رصيد موحّد.',
};

const STATUS_LABELS = {
  none: 'غير مشترك',
  scheduled: 'يبدأ قريبًا',
  active: 'فعّال',
  expired: 'منتهي',
} as const;

const STATUS_VARIANT = {
  none: 'outline',
  scheduled: 'sky',
  active: 'mint',
  expired: 'gold',
} as const;

export default async function SubscriptionPage() {
  const { user, profile } = await requireOnboardedStudent('/app/subscription');
  const now = new Date();
  const view = await loadStudentSubscription({
    userId: user.id,
    gradeId: profile.gradeId,
    academicFieldId: profile.academicFieldId,
    now,
  });

  const semester = view.semester;
  const wallet = view.wallet;
  const canBuy = Boolean(semester) && view.status !== 'active' && view.phase !== 'ended';

  return (
    <div className="fn-container fn-stack" data-testid="subscription-page">
      <header className="fn-section__head">
        <div>
          <p className="fn-eyebrow">الاشتراك</p>
          <h1 className="fn-display fn-display--lg">اشتراك فهمني الفصلي</h1>
          <p className="fn-subtitle">
            اشتراك واحد يفتح جميع مواد صفك الجاهزة في الفصل الدراسي، مع رصيد موحّد تستخدمه في كل المواد.
          </p>
        </div>
      </header>

      {/* Wallet summary — the single unified balance experience. */}
      {wallet ? (
        <section className="fn-card" aria-label="رصيدك">
          <div className="fn-card__head">
            <div className="fn-row">
              <span className="fn-icon-tile fn-icon-tile--gold" aria-hidden>
                <Coins size={18} />
              </span>
              <div>
                <p className="fn-card__title">رصيدك الموحّد</p>
                <p className="fn-caption">يُستخدم عبر جميع المواد، والرصيد المشترى يبقى معك حتى بعد انتهاء الفصل.</p>
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
              <p className="fn-caption">رصيد مشترى (دائم)</p>
              <p className="fn-title">{wallet.topupBalance}</p>
            </div>
          </div>
          {wallet.total === 0 ? (
            <p className="fn-caption">
              {view.status === 'active'
                ? 'انتهى رصيدك الحالي. يمكنك شحن رصيد إضافي للمتابعة.'
                : 'يشمل اشتراك الفصل رصيدًا يُضاف عند تفعيل الاشتراك.'}
            </p>
          ) : null}
          {view.status === 'active' ? (
            <Link className="fn-btn fn-btn--soft" href="/app/topup">
              شحن رصيد إضافي
            </Link>
          ) : null}
        </section>
      ) : null}

      {/* The single semester offer. */}
      {semester ? (
        <FnCard variant="hero" className="fn-card--hero">
          <div className="fn-card__head">
            <div className="fn-row">
              <span className="fn-icon-tile fn-icon-tile--lg" aria-hidden>
                <Crown size={22} />
              </span>
              <div>
                <p className="fn-eyebrow">العرض الوحيد المتاح</p>
                <p className="fn-card__title">{semester.name}</p>
                <p className="fn-caption">العام الدراسي {semester.academicYear}</p>
              </div>
            </div>
            <FnBadge variant={STATUS_VARIANT[view.status]}>{STATUS_LABELS[view.status]}</FnBadge>
          </div>

          <div className="fn-grid fn-grid--3">
            <div>
              <p className="fn-caption">السعر</p>
              <p className="fn-title">{formatMinor(semester.priceMinor, semester.currency)}</p>
            </div>
            <div>
              <p className="fn-caption">الرصيد المُضمّن</p>
              <p className="fn-title">{semester.includedCredits} كريدت</p>
            </div>
            <div>
              <p className="fn-caption">المدة</p>
              <p className="fn-title">
                {formatTermDate(semester.startsAt)} – {formatTermDate(semester.endsAt)}
              </p>
            </div>
          </div>

          <ul className="fn-stack fn-stack--sm" style={{ listStyle: 'none', padding: 0 }}>
            <li className="fn-row">
              <CheckCircle2 size={16} aria-hidden />
              <span>جميع مواد صفك الجاهزة داخل اشتراك واحد.</span>
            </li>
            <li className="fn-row">
              <CheckCircle2 size={16} aria-hidden />
              <span>رصيد موحّد يعمل في كل المواد — لا رصيد منفصل لكل مادة.</span>
            </li>
            <li className="fn-row">
              <CalendarClock size={16} aria-hidden />
              <span>
                {view.phase === 'upcoming'
                  ? `يبدأ الوصول تلقائيًا في ${formatTermDate(semester.startsAt)}.`
                  : `ينتهي الوصول في ${formatTermDate(semester.endsAt)}.`}
              </span>
            </li>
            <li className="fn-row">
              <Coins size={16} aria-hidden />
              <span>
                {semester.includedCredits} كريدت مُضمّن، يُستخدم على الشرح النصي وتعرّف الصور وتحويل الصوت والشرح
                الصوتي — تُخصم أولًا، ثم يُستخدم الرصيد المشترى.
              </span>
            </li>
            <li className="fn-row">
              <Sparkles size={16} aria-hidden />
              <span>ينتهي رصيد الفصل بانتهاء الفصل، أما الرصيد المشترى فيبقى في حسابك.</span>
            </li>
          </ul>

          {view.status === 'active' ? (
            <p className="fn-caption">
              اشتراكك فعّال. ينتهي بعد {view.daysRemaining} يومًا بدون تجديد تلقائي.
            </p>
          ) : view.status === 'scheduled' ? (
            <p className="fn-caption">تم تسجيل اشتراكك، وسيبدأ الوصول تلقائيًا في موعد بداية الفصل.</p>
          ) : canBuy ? (
            <SemesterCheckoutButton semesterId={semester.id} label={`اشترك الآن · ${formatMinor(semester.priceMinor, semester.currency)}`} />
          ) : (
            <p className="fn-caption">الاشتراك غير متاح للبيع حاليًا. تحقق لاحقًا.</p>
          )}
        </FnCard>
      ) : (
        <FnCard variant="flat">
          <div className="fn-empty">
            <Sparkles size={22} aria-hidden />
            <p className="fn-title">لا يوجد اشتراك فصلي متاح لصفك حاليًا</p>
            <p className="fn-caption">سيظهر الاشتراك هنا بمجرد أن يفتح فريق فهمني فصلك الدراسي.</p>
          </div>
        </FnCard>
      )}

      {/* Subjects included in the subscription. */}
      <section className="fn-section" aria-label="المواد ضمن اشتراكك">
        <div className="fn-section__head">
          <h2 className="fn-section__title">المواد ضمن اشتراكك</h2>
          <p className="fn-caption">تُضاف تلقائيًا كل مادة جاهزة لصفك.</p>
        </div>
        {view.subjects.length ? (
          <div className="fn-grid fn-grid--3">
            {view.subjects.map((subject) => (
              <div className="fn-card fn-card--flat" key={subject.id}>
                <div className="fn-row">
                  <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--mint" aria-hidden>
                    <BookOpen size={16} />
                  </span>
                  <div>
                    <p className="fn-card__title">{subject.name}</p>
                    {subject.shortDescription ? <p className="fn-caption">{subject.shortDescription}</p> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="fn-caption">لا توجد مواد جاهزة ضمن نطاق صفك بعد.</p>
        )}
      </section>

      <p className="fn-caption" dir="auto">
        ملاحظة: تُعرض الأسعار والتواريخ بتوقيت عمّان. لا يتم تفعيل أي دفع حقيقي قبل اعتماد المالك لربط الدفع.
      </p>
    </div>
  );
}

