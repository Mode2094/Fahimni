import Link from 'next/link';
import { Gift, Sparkles, TimerReset } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import type { FreeTrialRecord } from '@/lib/trial/store';

import { TrialClaimButton } from './trial-claim-button';

// Server-rendered trial status card. The countdown only exists once the trial
// has actually started; before the first accepted AI request it stays CLAIMED.
export function formatTrialRemaining(expiresAt: Date | null, now = new Date()): string | null {
  if (!expiresAt) return null;
  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) return null;
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `يتبقى ${hours} س ${minutes} د`;
  return `يتبقى ${minutes} د`;
}

export function TrialCard({
  trial,
  enabled,
  siteKey,
  claimable,
  whiteboardHref,
  creditAllowance,
  durationHours,
}: {
  trial: FreeTrialRecord | null;
  enabled: boolean;
  siteKey: string | null;
  claimable: boolean;
  whiteboardHref: string;
  creditAllowance: number;
  durationHours: number;
}) {
  const now = new Date();
  if (!trial && (!enabled || !claimable)) return null;

  const disclosure = (
    <p className="fn-caption">
      التجربة متاحة مرة واحدة لكل حساب Google ولكل متصفح. نحتفظ بمعرّف متصفح مجهول (مشفّر) لمنع إعادة الاستخدام، دون أي
      بصمة جهاز. إذا كنت تشارك الجهاز مع طالب آخر، تواصل مع الدعم لمراجعة حالتك.
    </p>
  );

  if (!trial) {
    return (
      <FnCard variant="tinted" className="fn-stack trial-card">
        <div className="fn-card__head">
          <div className="fn-stack fn-stack--sm">
            <span className="fn-row">
              <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--gold">
                <Gift size={18} aria-hidden="true" />
              </span>
              <span className="fn-card__title">جرّب فهمني مجانًا</span>
            </span>
            <p className="fn-card__text">
              {creditAllowance} نقطة رصيد تجريبي خلال {durationHours} ساعة، تبدأ من أول طلب فعلي. تُستهلك النقاط حسب نوع
              الطلب (شرح، صورة، صوت)، وجرّب أي مادة متاحة لك.
            </p>
            <p className="fn-caption">بدون بطاقة ائتمان · بدون تجديد تلقائي · بدون رسائل تحقق.</p>
          </div>
          <FnBadge variant="gold">مجانًا</FnBadge>
        </div>
        {enabled && (siteKey || process.env.NODE_ENV !== 'production') ? (
          <TrialClaimButton siteKey={siteKey} />
        ) : (
          <p className="fn-caption">التجربة المجانية غير متاحة حاليًا. حاول لاحقًا.</p>
        )}
        {disclosure}
      </FnCard>
    );
  }

  if (trial.status === 'CLAIMED') {
    return (
      <FnCard variant="tinted" className="fn-stack trial-card">
        <div className="fn-card__head">
          <div className="fn-stack fn-stack--sm">
            <span className="fn-row">
              <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--gold">
                <Sparkles size={18} aria-hidden="true" />
              </span>
              <span className="fn-card__title">تجربتك جاهزة</span>
            </span>
            <p className="fn-card__text">
              لديك {trial.remainingCredits} نقطة رصيد تجريبي. تبدأ مدة الـ{durationHours} ساعة عند أول طلب مقبول — افتح
              السبورة وابدأ.
            </p>
          </div>
          <FnBadge variant="gold">لم تبدأ بعد</FnBadge>
        </div>
        <FnButton asChild>
          <Link href={whiteboardHref}>افتح السبورة وابدأ</Link>
        </FnButton>
        {disclosure}
      </FnCard>
    );
  }

  if (trial.status === 'ACTIVE') {
    const remaining = formatTrialRemaining(trial.expiresAt, now);
    return (
      <FnCard variant="tinted" className="fn-stack trial-card">
        <div className="fn-card__head">
          <div className="fn-stack fn-stack--sm">
            <span className="fn-row">
              <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--mint">
                <TimerReset size={18} aria-hidden="true" />
              </span>
              <span className="fn-card__title">تجربتك المجانية نشطة</span>
            </span>
            <p className="fn-card__text">
              رصيدك: <strong>{trial.remainingCredits}</strong> نقطة — مشتركة بين جميع المواد المتاحة لك.
              {remaining ? ` ${remaining}.` : ''}
            </p>
          </div>
          <FnBadge variant="mint">نشطة</FnBadge>
        </div>
        <FnButton asChild variant="soft">
          <Link href={whiteboardHref}>تابع التعلّم</Link>
        </FnButton>
      </FnCard>
    );
  }

  const exhausted = trial.status === 'EXHAUSTED';
  return (
    <FnCard variant="flat" className="fn-stack trial-card">
      <div className="fn-card__head">
        <div className="fn-stack fn-stack--sm">
          <span className="fn-card__title">{exhausted ? 'انتهى رصيد تجربتك المجانية' : 'انتهت تجربتك المجانية'}</span>
          <p className="fn-card__text">
            {exhausted
              ? 'استخدمت كل نقاط الرصيد التجريبي. اشترك في مادة أو باقة للاستمرار في التعلّم.'
              : `انقضت مدة الـ${durationHours} ساعة. اشترك في مادة أو باقة للاستمرار في التعلّم.`}
          </p>
        </div>
        <FnBadge variant="outline">منتهية</FnBadge>
      </div>
      <FnButton asChild>
        <Link href="/app/subscription">استكشف الاشتراكات</Link>
      </FnButton>
    </FnCard>
  );
}
