import Link from 'next/link';
import { CalendarClock, Coins, Sparkles } from 'lucide-react';

import { FnBadge } from '@/components/fahimni';
import { formatTermDate } from '@/lib/billing/terms';
import type { SubscriptionWidget } from '@/lib/billing/student-view';

// Small, elegant subscription widget for the student dashboard. It never shows
// admin information and offers one clear next action per state.

const STATUS_LABELS: Record<SubscriptionWidget['status'], string> = {
  none: 'لا يوجد اشتراك',
  scheduled: 'يبدأ قريبًا',
  active: 'اشتراكك فعّال',
  expired: 'انتهى الاشتراك',
};

const STATUS_TONE: Record<SubscriptionWidget['status'], 'primary' | 'mint' | 'sky' | 'gold' | 'outline'> = {
  none: 'outline',
  scheduled: 'sky',
  active: 'mint',
  expired: 'gold',
};

export function SubscriptionWidgetCard({ widget }: { widget: SubscriptionWidget }) {
  const { status, credits } = widget;
  return (
    <section className="fn-card fn-card--tinted" aria-label="ملخص الاشتراك">
      <div className="fn-card__head">
        <div className="fn-row">
          <span className="fn-icon-tile fn-icon-tile--sky" aria-hidden>
            <Sparkles size={18} />
          </span>
          <div>
            <p className="fn-card__title">اشتراك فهمني الفصلي</p>
            <p className="fn-caption">{widget.semesterName ?? 'لا يوجد فصل متاح لصفك حاليًا'}</p>
          </div>
        </div>
        <FnBadge variant={STATUS_TONE[status]}>{STATUS_LABELS[status]}</FnBadge>
      </div>

      <div className="fn-grid fn-grid--2">
        <div className="fn-row">
          <CalendarClock size={16} aria-hidden />
          <span className="fn-caption">
            {widget.endsAt
              ? status === 'scheduled'
                ? `يبدأ خلال ${widget.daysRemaining} يومًا`
                : `ينتهي ${formatTermDate(widget.endsAt)} · ${widget.daysRemaining} يومًا متبقيًا`
              : 'غير محدد'}
          </span>
        </div>
        <div className="fn-row">
          <Coins size={16} aria-hidden />
          <span className="fn-caption">الرصيد المتاح: {credits.total} كريدت</span>
        </div>
      </div>

      <div className="fn-row fn-row--wrap">
        <span className="fn-chip" aria-hidden>فصلي: {credits.semesterBalance}</span>
        <span className="fn-chip" aria-hidden>مشترى: {credits.topupBalance}</span>
        <Link className="fn-btn fn-btn--soft fn-btn--sm" href={status === 'active' || status === 'expired' ? '/app/topup' : '/app/subscription'}>
          {status === 'active' ? 'شحن رصيد' : 'تفاصيل الاشتراك'}
        </Link>
      </div>
    </section>
  );
}
