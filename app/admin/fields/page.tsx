import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { FnButton, FnCard } from '@/components/fahimni';
import { AdminMessage, AdminPageHeader, AdminStatusBadge } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/admin/guard';
import { messageFromQuery } from '@/lib/admin/messages';
import { adminStore } from '@/lib/admin/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'الحقول',
};

export default async function AdminFieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  await requireAdmin('/admin/fields');
  const [fields, params] = await Promise.all([adminStore().listFields(), searchParams]);
  const message = messageFromQuery(params.status, params.error);

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title="الحقول"
        description="الحقول الدراسية التابعة لكل صف."
        action={
          <FnButton asChild size="sm">
            <Link href="/admin/fields/new">
              <Plus size={16} aria-hidden="true" />
              إضافة حقل
            </Link>
          </FnButton>
        }
      />
      <AdminMessage message={message} />

      {fields.length === 0 ? (
        <FnCard variant="flat" className="fn-empty">
          <p className="fn-empty__title">لا توجد حقول بعد</p>
          <p className="fn-empty__text">أضف حقولًا للصفوف التي تتطلب اختيارًا.</p>
        </FnCard>
      ) : (
        <div className="fn-table-wrap">
          <table className="fn-table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الصف</th>
                <th>الرابط</th>
                <th>الترتيب</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.id}>
                  <td>{field.name}</td>
                  <td>{field.gradeName}</td>
                  <td dir="ltr">{field.slug}</td>
                  <td>{field.sortOrder}</td>
                  <td>
                    <AdminStatusBadge active={field.isActive} />
                  </td>
                  <td>
                    <div className="fn-row fn-row--wrap">
                      <FnButton asChild size="sm" variant="soft">
                        <Link href={`/admin/fields/${field.id}`}>تعديل</Link>
                      </FnButton>
                      <form action={`/api/admin/fields/${field.id}`} method="post">
                        <input type="hidden" name="intent" value="toggle" />
                        <FnButton type="submit" size="sm" variant="ghost">
                          {field.isActive ? 'تعطيل' : 'تفعيل'}
                        </FnButton>
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
