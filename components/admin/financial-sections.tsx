import Link from 'next/link';
import { Download, Gauge, TrendingUp } from 'lucide-react';

import { FnBadge } from '@/components/fahimni';
import { formatMinor, formatMinorAmount } from '@/lib/admin/money';
import type { FinancialSummary, ProfitabilityResult } from '@/lib/admin/financials';
import { AI_SERVICE_KEYS, AI_SERVICE_LABELS, type AiServiceKey } from '@/lib/credits/costs';
import { microUsdToUsd } from '@/lib/trial/config';
import type { CreditLedgerRecord } from '@/lib/billing/wallet-store';

// Admin financial surfaces. Revenue, gross profit and margin are shown as
// separate, clearly labelled figures; nothing is labelled profit that is revenue.

function usd(microUsd: number): string {
  return `$${microUsdToUsd(microUsd).toFixed(2)}`;
}

export function FinancialOverview({ summary }: { summary: FinancialSummary }) {
  return (
    <div className="fn-stack">
      <section className="fn-grid fn-grid--4">
        <StatCard label="إيرادات الاشتراكات" value={formatMinor(summary.subscriptionRevenueMinor, summary.currency)} hint="إجمالي، وليس ربحًا" />
        <StatCard label="إيرادات الشحن" value={formatMinor(summary.topupRevenueMinor, summary.currency)} hint="إجمالي، وليس ربحًا" />
        <StatCard label="اشتراكات نشطة" value={String(summary.activeSubscribers)} hint={`مجدول ${summary.scheduledSubscribers} · منتهٍ ${summary.expiredSubscribers}`} />
        <StatCard label="كلفة الذكاء الاصطناعي (تقديرية)" value={usd(summary.estimatedProviderCostMicroUsd)} hint="حجز مسبق تقديري وليس مفوترًا" />
      </section>
      <section className="fn-grid fn-grid--4">
        <StatCard label="كريدت مُمنوح (فصل)" value={String(summary.creditsGrantedSemester)} />
        <StatCard label="كريدت مُمنوح (شحن)" value={String(summary.creditsGrantedTopup)} />
        <StatCard label="كريدت مُستهلك (فصل)" value={String(summary.creditsConsumedSemester)} />
        <StatCard label="التزام الكريدت المتبقي" value={String(summary.creditLiability)} hint="رصيد متبقٍ لدى الطلاب" />
      </section>
      <div className="fn-row fn-row--wrap">
        <a className="fn-btn fn-btn--outline fn-btn--sm" href={`/api/admin/subscriptions/reports/export?kind=ledger`}>
          <Download size={15} aria-hidden /> تصدير سجل الكريدت (CSV)
        </a>
        <a className="fn-btn fn-btn--outline fn-btn--sm" href={`/api/admin/subscriptions/reports/export?kind=subscribers`}>
          <Download size={15} aria-hidden /> تصدير المشتركين (CSV)
        </a>
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="fn-card fn-card--flat">
      <p className="fn-caption">{label}</p>
      <p className="fn-title">{value}</p>
      {hint ? <p className="fn-caption">{hint}</p> : null}
    </div>
  );
}

export function PaymentsSection({ summary }: { summary: FinancialSummary }) {
  return (
    <div className="fn-stack">
      <p className="fn-caption">
        تُعرض المدخلات المالية فقط من العمليات المُتحقق منها. لا تُطلق أي مدفوعات حقيقية من هذه اللوحة.
      </p>
      <div className="fn-grid fn-grid--4">
        <StatCard label="مدفوعات مُتحقق منها" value={String(summary.verifiedPayments)} />
        <StatCard label="مرتجعات" value={String(summary.refunds)} />
        <StatCard label="إيرادات الاشتراكات" value={formatMinor(summary.subscriptionRevenueMinor, summary.currency)} />
        <StatCard label="إيرادات الشحن" value={formatMinor(summary.topupRevenueMinor, summary.currency)} />
      </div>
    </div>
  );
}

export function ProfitabilityPanel({ result, assumptionsSummary }: { result: ProfitabilityResult; assumptionsSummary: string[] }) {
  return (
    <div className="fn-stack">
      <div className="fn-alert" role="note">
        <TrendingUp size={16} aria-hidden />
        <span>هذه توقعات مبنية على مدخلات يحددها المشرف، وليست إيرادات مضمونة.</span>
      </div>
      <section className="fn-grid fn-grid--4">
        <StatCard label="إجمالي الإيراد المتوقع" value={formatMinor(result.grossRevenueMinor)} />
        <StatCard label="التكاليف المتغيرة" value={formatMinor(result.totalVariableMinor)} />
        <StatCard label="هامش المساهمة" value={formatMinor(result.contributionMarginMinor)} hint="إيراد − تكاليف متغيرة" />
        <StatCard label="عدد المشتركين للتعادل" value={String(result.breakEvenSubscribers)} />
      </section>
      <section className="fn-grid fn-grid--4">
        <StatCard label="تكلفة الذكاء الاصطناعي المتغيرة" value={formatMinor(result.variableAiCostMinor)} />
        <StatCard label="رسوم الدفع" value={formatMinor(result.paymentFeesMinor)} />
        <StatCard label="تكلفة الاستقطاب" value={formatMinor(result.acquisitionCostMinor)} />
        <StatCard label={result.projectedSurplusMinor >= 0 ? 'فائض تشغيلي متوقع' : 'عجز تشغيلي متوقع'} value={formatMinor(result.projectedSurplusMinor)} />
      </section>
      <section className="fn-card fn-card--flat">
        <p className="fn-card__title">الافتراضات</p>
        <ul className="fn-stack fn-stack--sm" style={{ listStyle: 'disc', paddingInlineStart: '1.25rem' }}>
          {assumptionsSummary.map((line) => (
            <li className="fn-caption" key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ConsumptionSection({ costs, saved }: { costs: Record<AiServiceKey, number>; saved: boolean }) {
  return (
    <form className="fn-card" action="/api/admin/subscriptions/consumption" method="post">
      <div className="fn-card__head">
        <div className="fn-row">
          <Gauge size={18} aria-hidden />
          <h2 className="fn-section__title">كلفة الاستهلاك لكل خدمة</h2>
        </div>
        {saved ? <FnBadge variant="mint">محفوظ</FnBadge> : null}
      </div>
      <p className="fn-caption">
        الحدود المسموحة لكل خدمة محدودة بعوامل الأمان. تُستخدم هذه القيم في خصم رصيد الطالب لكل عملية ذكاء اصطناعي.
      </p>
      <div className="fn-grid fn-grid--2">
        {AI_SERVICE_KEYS.map((service) => (
          <label className="fn-field" key={service}>
            <span className="fn-field__label">{AI_SERVICE_LABELS[service]}</span>
            <input
              className="fn-input"
              type="number"
              name={`cost_${service}`}
              min={1}
              max={50}
              defaultValue={costs[service]}
              dir="ltr"
            />
          </label>
        ))}
      </div>
      <button className="fn-btn fn-btn--primary" type="submit">
        حفظ إعدادات الاستهلاك
      </button>
    </form>
  );
}

export function LedgerTable({ rows }: { rows: CreditLedgerRecord[] }) {
  const KIND_LABELS: Record<string, string> = {
    GRANT: 'منح',
    CONSUME: 'استهلاك',
    REFUND: 'استرجاع',
    TOPUP_PURCHASE: 'شراء رصيد',
    ADMIN_ADJUSTMENT: 'تعديل إداري',
    REVERSAL: 'عكس',
    EXPIRE: 'انتهاء',
  };
  return (
    <div className="fn-table-wrap">
      <table className="fn-table">
        <thead>
          <tr>
            <th scope="col">النوع</th>
            <th scope="col">الدفتر</th>
            <th scope="col">المقدار</th>
            <th scope="col">الرصيد بعد</th>
            <th scope="col">ملاحظة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{KIND_LABELS[row.kind] ?? row.kind}</td>
              <td>{row.bucket === 'SEMESTER' ? 'فصلي' : 'مشترى'}</td>
              <td dir="ltr">{row.delta > 0 ? `+${row.delta}` : row.delta}</td>
              <td dir="ltr">{row.balanceAfter}</td>
              <td className="fn-caption">{row.note ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CreditAdjustForm({ semesters = [] }: { semesters?: { id: string; name: string }[] }) {
  return (
    <form className="fn-card" action="/api/admin/subscriptions/credits/adjust" method="post">
      <div className="fn-card__head">
        <h2 className="fn-section__title">تعديل رصيد طالب</h2>
      </div>
      <div className="fn-grid fn-grid--2">
        <label className="fn-field">
          <span className="fn-field__label">معرّف الطالب</span>
          <input className="fn-input" name="userId" required dir="ltr" placeholder="uuid" />
        </label>
        <label className="fn-field">
          <span className="fn-field__label">الدفتر</span>
          <select className="fn-select" name="bucket" defaultValue="TOPUP">
            <option value="TOPUP">رصيد مشترى</option>
            <option value="SEMESTER">رصيد فصلي</option>
          </select>
        </label>
        <label className="fn-field">
          <span className="fn-field__label">المقدار (±)</span>
          <input className="fn-input" name="delta" type="number" required dir="ltr" placeholder="10 أو -10" />
        </label>
        <label className="fn-field">
          <span className="fn-field__label">الفصل (مطلوب لتعديل الرصيد الفصلي)</span>
          <select className="fn-select" name="semesterId" defaultValue="">
            <option value="">— اختر الفصل —</option>
            {semesters.map((semester) => (
              <option key={semester.id} value={semester.id}>
                {semester.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fn-field">
          <span className="fn-field__label">السبب (إلزامي)</span>
          <input className="fn-input" name="reason" required maxLength={500} placeholder="سبب التعديل" />
        </label>
      </div>
      <button className="fn-btn fn-btn--outline" type="submit">
        تطبيق التعديل
      </button>
    </form>
  );
}

export { formatMinorAmount, Link };
