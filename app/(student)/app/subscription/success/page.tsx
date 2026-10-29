import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';

import { FnButton, FnCard } from '@/components/fahimni';
import { EntitlementPoller } from '@/components/student/entitlement-poller';
import { successStateFor } from '@/lib/billing/entitlements';
import { billingStore } from '@/lib/billing/store';
import { requireOnboardedStudent } from '@/lib/student/guard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تم استلام الدفع',
  description: 'حالة تفعيل الاشتراك في فهمني.',
};

// Redirect parameters are never trusted for access: the page only reads local
// entitlements written by the verified Freemius webhook.
export default async function SubscriptionSuccessPage() {
  const { user } = await requireOnboardedStudent('/app/subscription/success');
  const entitlements = await billingStore().listEntitlementsForUser(user.id);
  const state = successStateFor(entitlements, new Date());

  return (
    <div className="fn-container">
      <FnCard variant="flat" className="fn-center fn-card--centered">
        <div className="fn-icon-tile fn-icon-tile--mint fn-icon-tile--lg">
          <CheckCircle2 size={28} aria-hidden="true" />
        </div>
        <p className="fn-empty__title">تم استلام عملية الدفع</p>
        {state === 'active' ? (
          <>
            <p className="fn-empty__text">اشتراكك مفعّل الآن. بالتوفيق في رحلتك مع فهمني.</p>
            <FnButton asChild>
              <Link href="/app/subscription">عرض اشتراكاتي</Link>
            </FnButton>
          </>
        ) : (
          <>
            <p className="fn-empty__text">جاري تفعيل اشتراكك… قد يستغرق التفعيل لحظات حتى يصل تأكيد الدفع.</p>
            <EntitlementPoller />
          </>
        )}
      </FnCard>
    </div>
  );
}
