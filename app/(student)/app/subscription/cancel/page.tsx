import type { Metadata } from 'next';
import Link from 'next/link';
import { XCircle } from 'lucide-react';

import { FnButton, FnCard } from '@/components/fahimni';
import { requireOnboardedStudent } from '@/lib/student/guard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إلغاء الدفع',
  description: 'تم إلغاء عملية الدفع في فهمني.',
};

export default async function SubscriptionCancelPage() {
  await requireOnboardedStudent('/app/subscription/cancel');

  return (
    <div className="fn-container">
      <FnCard variant="flat" className="fn-center fn-card--centered">
        <div className="fn-icon-tile fn-icon-tile--lg">
          <XCircle size={28} aria-hidden="true" />
        </div>
        <p className="fn-empty__title">تم إلغاء عملية الدفع</p>
        <p className="fn-empty__text">لم يتم خصم أي مبلغ. يمكنك المحاولة مرة أخرى في أي وقت.</p>
        <FnButton asChild variant="soft">
          <Link href="/app/subscription">العودة للخطط</Link>
        </FnButton>
      </FnCard>
    </div>
  );
}
