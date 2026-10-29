import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { FahimniMark, FahimniWordmark } from '@/components/fahimni/logo';
import { OnboardingForm } from '@/components/student/onboarding-form';
import { requireUser } from '@/lib/auth/server';
import { studentStore } from '@/lib/student/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إعداد حسابك',
  description: 'اختر صفك وحقلك الدراسي لعرض المواد المناسبة لك.',
};

const errorMessages: Record<string, string> = {
  invalid_grade: 'الرجاء اختيار صف دراسي صالح.',
  invalid_field: 'الرجاء اختيار حقل دراسي صالح تابع للصف المختار.',
  field_required: 'الرجاء اختيار الحقل الدراسي.',
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser('/onboarding');
  const store = studentStore();
  const profile = await store.getProfile(user.id);
  if (profile?.onboardingCompleted) redirect('/app');

  const [grades, fields] = await Promise.all([store.listActiveGrades(), store.listActiveFields()]);
  const gradeOptions = grades.map((grade) => ({
    id: grade.id,
    name: grade.name,
    fields: fields
      .filter((field) => field.gradeId === grade.id)
      .map((field) => ({ id: field.id, name: field.name })),
  }));

  const params = await searchParams;
  const error = params.error ? errorMessages[params.error] ?? 'تعذر حفظ اختيارك. حاول مرة أخرى.' : null;

  return (
    <div className="fn-root fn-page">
      <main className="fn-page__main">
        <div className="fn-container">
          <div className="fn-center fn-stack fn-stack--lg">
            <div className="fn-auth-brand">
              <FahimniMark size={64} />
              <FahimniWordmark />
            </div>
            <div className="fn-stack fn-stack--sm">
              <h1 className="fn-display fn-display--xl fn-auth-title">ابدأ باختيار صفك الدراسي</h1>
              <p className="fn-subtitle fn-auth-title">نحتاج هذا الاختيار لعرض المواد المناسبة لك.</p>
            </div>
            {error ? (
              <span className="fn-auth-error" role="alert">
                {error}
              </span>
            ) : null}
            {gradeOptions.length > 0 ? (
              <OnboardingForm grades={gradeOptions} />
            ) : (
              <p className="fn-empty__text">لا توجد صفوف متاحة حاليًا. حاول لاحقًا.</p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
