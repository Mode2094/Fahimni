import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { FnButton, FnCard } from '@/components/fahimni';
import { AdminMessage, AdminPageHeader, AdminStatusBadge } from '@/components/admin/admin-ui';
import { ConfirmSubmit } from '@/components/admin/confirm-submit';
import { requireAdmin } from '@/lib/admin/guard';
import { messageFromQuery } from '@/lib/admin/messages';
import { adminStore } from '@/lib/admin/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'الصفوف',
};

export default async function AdminGradesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  await requireAdmin('/admin/grades');
  const [grades, params] = await Promise.all([adminStore().listGrades(), searchParams]);
  const message = messageFromQuery(params.status, params.error);

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title="الصفوف"
        description="إضافة وتعديل الصفوف الدراسية وترتيبها."
        action={
          <FnButton asChild size="sm">
            <Link href="/admin/grades/new">
              <Plus size={16} aria-hidden="true" />
              إضافة صف
            </Link>
          </FnButton>
        }
      />
      <AdminMessage message={message} />

      {grades.length === 0 ? (
        <FnCard variant="flat" className="fn-empty">
          <p className="fn-empty__title">لا توجد صفوف بعد</p>
          <p className="fn-empty__text">أضف أول صف دراسي ليظهر للطلاب.</p>
        </FnCard>
      ) : (
        <div className="fn-table-wrap">
          <table className="fn-table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الرابط</th>
                <th>الترتيب</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((grade) => (
                <tr key={grade.id}>
                  <td>{grade.name}</td>
                  <td dir="ltr">{grade.slug}</td>
                  <td>{grade.sortOrder}</td>
                  <td>
                    <AdminStatusBadge active={grade.isActive} />
                  </td>
                  <td>
                    <div className="fn-row fn-row--wrap">
                      <FnButton asChild size="sm" variant="soft">
                        <Link href={`/admin/grades/${grade.id}`}>تعديل</Link>
                      </FnButton>
                      <form action={`/api/admin/grades/${grade.id}`} method="post">
                        <input type="hidden" name="intent" value="toggle" />
                        <FnButton type="submit" size="sm" variant="ghost">
                          {grade.isActive ? 'تعطيل' : 'تفعيل'}
                        </FnButton>
                      </form>
                      <form action={`/api/admin/grades/${grade.id}`} method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <ConfirmSubmit
                          size="sm"
                          variant="danger"
                          message={`سيتم حذف الصف "${grade.name}" نهائيًا. هل أنت متأكد؟`}
                        >
                          حذف
                        </ConfirmSubmit>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
