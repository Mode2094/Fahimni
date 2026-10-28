import { FnBadge, FnCard } from "@/components/fahimni";
import { formatMinor } from "@/lib/admin/money";
import type { PlanType, SubjectPlanRecord } from "@/lib/billing/store";

import { CheckoutButton } from "./checkout-button";

const PLAN_LABELS: Record<PlanType, string> = {
  MONTHLY: "خطة شهرية",
  SEMESTER: "خطة فصلية",
};

const PLAN_DURATION: Record<PlanType, string> = {
  MONTHLY: "تُجدَّد كل شهر",
  SEMESTER: "لكل فصل دراسي",
};

const BENEFITS = [
  "وصول كامل لجميع وحدات المادة",
  "شرح خطوة بخطوة على السبورة",
  "أسئلة بالصوت والصورة",
  "أمثلة مشابهة لتثبيت الفهم",
];

export function PlansSection({
  subjectId,
  subjectName,
  plans,
  entitled,
}: {
  subjectId: string;
  subjectName?: string;
  plans: SubjectPlanRecord[];
  entitled: boolean;
}) {
  const available = plans.filter((plan) => plan.isActive && plan.freemiusPlanId);
  if (!available.length) return null;

  return (
    <section className="fn-section">
      <div className="fn-section__head">
        <h2 className="fn-section__title">{subjectName ?? "خطط الاشتراك"}</h2>
        {entitled ? <FnBadge variant="mint">مشترك</FnBadge> : null}
      </div>
      <div className="fn-grid fn-grid--2">
        {available.map((plan) => (
          <FnCard
            key={plan.id}
            variant={plan.type === "SEMESTER" ? "tinted" : "default"}
            className="pricing-card fn-stack"
          >
            {plan.type === "SEMESTER" ? <span className="pricing-card__ribbon">الأفضل قيمة</span> : null}
            <span className="pricing-card__name">{PLAN_LABELS[plan.type]}</span>
            <span className="pricing-card__price">{formatMinor(plan.priceMinor, plan.currency)}</span>
            <span className="fn-caption">{PLAN_DURATION[plan.type]}</span>
            {plan.monthlyCreditAllowance > 0 ? (
              <span>
                <FnBadge variant="sky">رصيد {plan.monthlyCreditAllowance} سؤال شهريًا</FnBadge>
              </span>
            ) : null}
            <ul className="fn-list">
              {BENEFITS.map((benefit) => (
                <li key={benefit}>{benefit}</li>
              ))}
            </ul>
            {entitled ? (
              <FnBadge variant="mint">اشتراكك نشط لهذه المادة</FnBadge>
            ) : (
              <CheckoutButton subjectId={subjectId} planType={plan.type} />
            )}
          </FnCard>
        ))}
      </div>
      {!entitled ? (
        <p className="fn-caption">الدفع يتم عبر بوابة Freemius الآمنة، ولا نخزّن بيانات بطاقتك.</p>
      ) : null}
    </section>
  );
}
