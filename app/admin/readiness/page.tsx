import type { Metadata } from 'next';
import { CheckCircle2, CircleAlert, CircleHelp, OctagonAlert, Rocket } from 'lucide-react';

import { FnBadge } from '@/components/fahimni';
import { AdminPageHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/admin/guard';
import { launchReadiness, type ReadinessLevel } from '@/lib/admin/launch-readiness';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'جاهزية الإطلاق',
  robots: { index: false, follow: false },
} satisfies Metadata;

// Admin-only Launch Readiness panel. Every indicator is backed by a real,
// read-only check (health, credentials, provider connection, catalogue,
// wallet integrity). No fabricated green state; no secret values are shown.

const LEVEL_LABELS: Record<ReadinessLevel, string> = {
  ok: 'جاهز',
  warn: 'يحتاج انتباهًا',
  blocked: 'مانع للإطلاق',
  unknown: 'غير معروف',
};

const LEVEL_VARIANT: Record<ReadinessLevel, 'mint' | 'gold' | 'danger' | 'outline'> = {
  ok: 'mint',
  warn: 'gold',
  blocked: 'danger',
  unknown: 'outline',
};

function LevelIcon({ level }: { level: ReadinessLevel }) {
  if (level === 'ok') return <CheckCircle2 size={18} aria-hidden />;
  if (level === 'blocked') return <OctagonAlert size={18} aria-hidden />;
  if (level === 'warn') return <CircleAlert size={18} aria-hidden />;
  return <CircleHelp size={18} aria-hidden />;
}

export default async function AdminReadinessPage() {
  await requireAdmin('/admin/readiness');
  const report = await launchReadiness();

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title="جاهزية الإطلاق"
        description="فحوصات حقيقية لحالة المنصة قبل الإطلاق التجاري. لا تُعرض أي أسرار هنا."
        action={
          <FnBadge variant={LEVEL_VARIANT[report.overall]}>
            <Rocket size={14} aria-hidden /> {LEVEL_LABELS[report.overall]} · {report.blockers} مانع
          </FnBadge>
        }
      />

      <p className="fn-caption">
        البيئة: <span dir="ltr">{report.environment}</span> · آخر تحديث: <span dir="ltr">{report.generatedAt}</span>
      </p>

      <div className="fn-stack">
        {report.checks.map((check) => (
          <section className="fn-card" key={check.id} aria-label={check.label}>
            <div className="fn-card__head">
              <div className="fn-row">
                <span className="fn-icon-tile fn-icon-tile--sm" aria-hidden>
                  <LevelIcon level={check.level} />
                </span>
                <div>
                  <p className="fn-card__title">{check.label}</p>
                  <p className="fn-caption">{check.detail}</p>
                </div>
              </div>
              <FnBadge variant={LEVEL_VARIANT[check.level]}>{LEVEL_LABELS[check.level]}</FnBadge>
            </div>
            {check.action ? (
              <p className="fn-alert fn-alert--error" role="note">
                الإجراء المطلوب: {check.action}
              </p>
            ) : null}
          </section>
        ))}
      </div>

      <p className="fn-caption">
        هذه اللوحة تقيس الجاهزية التقنية. القرارات التجارية والقانونية وتراخيص المحتوى وحساب مزود الدفع تبقى من مسؤولية المالك.
      </p>
    </div>
  );
}
