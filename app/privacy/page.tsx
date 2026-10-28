import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية (مسودة)',
  description: 'مسودة سياسة الخصوصية لمنصة فهمني — بانتظار المراجعة القانونية.',
  alternates: { canonical: '/privacy' },
};

// Draft for legal review: clearly labelled, no claim of legal approval.
export default function PrivacyPage() {
  return (
    <div className="fn-root fn-page">
      <main className="fn-container fn-stack fn-stack--lg" style={{ paddingBlock: '3rem' }}>
        <p className="fn-alert fn-alert--error" role="status">
          مسودة غير معتمدة قانونيًا — هذه الصفحة قيد المراجعة القانونية وليست نصًا نهائيًا.
        </p>
        <h1 className="fn-display fn-display--xl">سياسة الخصوصية (مسودة)</h1>
        <div className="fn-stack">
          <p className="fn-subtitle">نجمع الحد الأدنى من البيانات لتشغيل المنصة التعليمية:</p>
          <ul className="fn-list">
            <li>بيانات الحساب: البريد الإلكتروني والاسم من تسجيل الدخول بجوجل، والصف والحقل الدراسي الذي يختاره الطالب.</li>
            <li>بيانات الاستخدام: الأسئلة التي يرسلها الطالب إلى المعلّم الذكي تُعالج لتوليد الشرح، وتُسجَّل أحداث الاستخدام لأغراض المحاسبة والأرصدة فقط.</li>
            <li>تقدّم التعلّم: نقاط التدريب وحالة الفهم خاصة بحساب الطالب ولا تظهر لأي طالب آخر.</li>
            <li>الملفات المرفوعة: صور الأسئلة والتسجيلات الصوتية تُستخدم لتحويل السؤال إلى نص ولا تُنشر.</li>
          </ul>
          <p className="fn-subtitle">لا نبيع بيانات الطلاب. تُعالج الطلبات عبر مزوّدي خدمة (مثل OpenAI) لأغراض التوليد فقط، وتُخزَّن بيانات المنصة لدى مزوّد الاستضافة.</p>
          <p className="fn-subtitle">لطلبات الخصوصية والتعديل والحذف: يُرجى التواصل عبر قناة الدعم المعلنة في الصفحة الرئيسية.</p>
        </div>
        <div className="fn-row">
          <Link className="fn-btn" href="/">العودة للرئيسية</Link>
          <Link className="fn-btn" href="/terms">الشروط والأحكام (مسودة)</Link>
        </div>
      </main>
    </div>
  );
}
