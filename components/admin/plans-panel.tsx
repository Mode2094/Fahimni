import { FnButton, FnCard } from '@/components/fahimni';
import { formatMinorAmount } from '@/lib/admin/money';
import type { PlanType, SubjectPlanRecord } from '@/lib/billing/store';

const PLAN_LABELS: Record<PlanType, string> = {
  MONTHLY: 'الخطة الشهرية',
  SEMESTER: 'الخطة الفصلية',
};

export function PlansPanel({ subjectId, plans }: { subjectId: string; plans: SubjectPlanRecord[] }) {
  const currency = plans[0]?.currency ?? 'JOD';
  const byType = (type: PlanType) => plans.find((plan) => plan.type === type) ?? null;

  return (
    <FnCard variant="flat" className="fn-stack">
      <div>
        <h2 className="fn-card__title">خطط الاشتراك</h2>
        <p className="fn-card__text">
          حدّد السعر المعروض ومعرّف خطة Freemius لكل خطة. مفاتيح Freemius السرية تُضبط في إعدادات الخادم فقط ولا تُدخل هنا.
        </p>
      </div>
      <form action={`/api/admin/subjects/${subjectId}/plans`} method="post" className="fn-stack">
        <input type="hidden" name="currency" value={currency} />
        {(['MONTHLY', 'SEMESTER'] as const).map((type) => {
          const prefix = type === 'MONTHLY' ? 'monthly' : 'semester';
          const plan = byType(type);
          return (
            <fieldset key={type} className="fn-fieldset">
              <legend className="fn-legend">{PLAN_LABELS[type]}</legend>
              <label className="fn-check">
                <input type="checkbox" name={`${prefix}Enabled`} defaultChecked={plan?.isActive ?? false} />
                تفعيل الخطة
              </label>
              <div className="fn-grid fn-grid--2">
                <div className="fn-field">
                  <label className="fn-field__label" htmlFor={`${prefix}Price`}>
                    السعر المعروض ({currency})
                  </label>
                  <input
                    className="fn-input"
                    id={`${prefix}Price`}
                    name={`${prefix}Price`}
                    inputMode="decimal"
                    dir="ltr"
                    defaultValue={formatMinorAmount(plan?.priceMinor ?? null, currency)}
                    placeholder="39"
                  />
                </div>
                <div className="fn-field">
                  <label className="fn-field__label" htmlFor={`${prefix}PlanId`}>
                    معرّف خطة Freemius
                  </label>
                  <input
                    className="fn-input"
                    id={`${prefix}PlanId`}
                    name={`${prefix}PlanId`}
                    dir="ltr"
                    maxLength={64}
                    defaultValue={plan?.freemiusPlanId ?? ''}
                    placeholder="12345"
                  />
                </div>
                <div className="fn-field">
                  <label className="fn-field__label" htmlFor={`${prefix}Credits`}>
                    رصيد فهمني الشهري
                  </label>
                  <input
                    className="fn-input"
                    id={`${prefix}Credits`}
                    name={`${prefix}Credits`}
                    type="number"
                    min={0}
                    max={100000}
                    dir="ltr"
                    defaultValue={plan?.monthlyCreditAllowance ?? 0}
                    placeholder="200"
                  />
                  <p className="fn-field__hint">يُمنح هذا الرصيد كل فترة شهرية ولا يُرحَّل.</p>
                </div>
              </div>
            </fieldset>
          );
        })}
        <div className="fn-row">
          <FnButton type="submit" size="sm">
            حفظ الخطط
          </FnButton>
        </div>
      </form>
    </FnCard>
  );
}
