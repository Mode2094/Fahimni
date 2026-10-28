import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'الشروط والأحكام (مسودة)',
  description: 'مسودة شروط الاستخدام لمنصة فهمني — بانتظار المراجعة القانونية.',
  alternates: { canonical: '/terms' },
};

// Draft for legal review: clearly labelled, no claim of legal approval.
export default function TermsPage() {
  return (
    <div className="fn-root fn-page">
      <main className="fn-container fn-stack fn-stack--lg" style={{ paddingBlock: '3rem' }}>
        <p className="fn-alert fn-alert--error" role="status">
          مسودة غير معتمدة قانونيًا — هذه الصفحة قيد المراجعة القانونية وليست نصًا نهائيًا.
        </p>
        <h1 className="fn-display fn-display--xl">الشروط والأحكام (مسودة)</h1>
        <div className="fn-stack">
          <ul className="fn-list">
            <li>فهمني منصة تعليمية مساندة؛ الشرح المولَّد بالذكاء الاصطناعي قد يخطئ ويجب مراجعته مع الكتاب المدرسي.</li>
            <li>التجربة المجانية محدودة بالرصيد والمدة المعلنة، وتُحتسب من أول طلب فعلي.</li>
            <li>الاشتراكات المدفوعة تُدار عبر بوابة فريميوس، وتخضع لسياسات الدفع والاسترجاع الخاصة بها.</li>
            <li>يُمنع استخدام المنصة لرفع محتوى غير مصرّح به أو محاولة تجاوز حدود الوصول والاستخدام.</li>
            <li>قد تتوقف الخدمة مؤقتًا لأعمال الصيانة أو تحديثات المزوّدين.</li>
          </ul>
          <p className="fn-subtitle">هذه مسودة أولية وسيُستكمل النص القانوني الكامل (بما يشمل الفوترة والضرائب وحقوق المحتوى) قبل الإطلاق العام.</p>
        </div>
        <div className="fn-row">
          <Link className="fn-btn" href="/">العودة للرئيسية</Link>
          <Link className="fn-btn" href="/privacy">سياسة الخصوصية (مسودة)</Link>
        </div>
      </main>
    </div>
  );
}
