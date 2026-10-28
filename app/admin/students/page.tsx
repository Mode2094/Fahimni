import type { Metadata } from 'next';
import { Search, Users } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { AdminPageHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/admin/guard';
import { adminStore } from '@/lib/admin/store';
import { formatBookDate } from '@/lib/books/messages';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'الطلاب',
};

// Read-only student roster: account facts only. Progress, lesson history and
// personal content are never listed here.
export default async function AdminStudentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin('/admin/students');
  const params = await searchParams;
  const search = (params.q ?? '').trim();
  const students = await adminStore().listStudents(50, search || null);

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title="الطلاب"
        description="سجل قراءة فقط لحسابات الطلاب وحالتها. التقدم والدروس تخص الطالب ولا تُعرض هنا."
      />

      <FnCard variant="flat" className="fn-stack">
        <div className="fn-row">
          <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--sky">
            <Users size={18} aria-hidden="true" />
          </span>
          <div className="fn-stack fn-stack--sm">
            <h2 className="fn-card__title">حسابات الطلاب</h2>
            <p className="fn-card__text">آخر 50 حسابًا، مع البحث بالبريد أو الاسم.</p>
          </div>
        </div>
        <form method="get" action="/admin/students" className="fn-row fn-row--wrap">
          <div className="fn-field fn-field--grow">
            <label className="fn-field__label" htmlFor="student-search">
              بحث بالبريد الإلكتروني أو الاسم
            </label>
            <input className="fn-input" id="student-search" name="q" type="search" defaultValue={search} placeholder="student@example.com" dir="ltr" />
          </div>
          <FnButton type="submit" variant="soft" size="sm">
            <Search size={15} aria-hidden="true" />
            بحث
          </FnButton>
        </form>
      </FnCard>

      {students.length ? (
        <div className="fn-table-wrap">
          <table className="fn-table">
            <thead>
              <tr>
                <th>الطالب</th>
                <th>الصف</th>
                <th>الحقل</th>
                <th>الحالة</th>
                <th>تاريخ الانضمام</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id}>
                  <td>
                    <div className="fn-stack fn-stack--sm">
                      <span>{student.name ?? 'طالب'}</span>
                      <span className="fn-caption" dir="ltr">
                        {student.email}
                      </span>
                    </div>
                  </td>
                  <td>{student.gradeName ?? '—'}</td>
                  <td>{student.fieldName ?? '—'}</td>
                  <td>
                    <FnBadge variant={student.onboardingCompleted ? 'mint' : 'gold'}>
                      {student.onboardingCompleted ? 'مكتمل الإعداد' : 'لم يكمل الإعداد'}
                    </FnBadge>
                  </td>
                  <td>{formatBookDate(student.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <FnCard variant="flat" className="fn-empty">
          <p className="fn-empty__title">{search ? 'لا توجد نتائج مطابقة' : 'لا يوجد طلاب بعد'}</p>
          <p className="fn-empty__text">{search ? 'جرّب بريدًا آخر أو امسح البحث.' : 'سيظهر الطلاب هنا بعد أول تسجيل دخول.'}</p>
        </FnCard>
      )}
    </div>
  );
}
