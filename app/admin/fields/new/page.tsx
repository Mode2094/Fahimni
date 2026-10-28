import type { Metadata } from 'next';
import Link from 'next/link';

import { FnCard, FnLinkMore } from '@/components/fahimni';
import { AdminMessage, AdminPageHeader } from '@/components/admin/admin-ui';
import { FieldForm } from '@/components/admin/field-form';
import { requireAdmin } from '@/lib/admin/guard';
import { messageFromQuery } from '@/lib/admin/messages';
import { adminStore } from '@/lib/admin/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إضافة حقل',
};

export default async function NewFieldPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin('/admin/fields/new');
  const [grades, params] = await Promise.all([adminStore().listGrades(), searchParams]);

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title="إضافة حقل"
        action={
          <FnLinkMore asChild>
            <Link href="/admin/fields">العودة للحقول</Link>
          </FnLinkMore>
        }
      />
      <AdminMessage message={messageFromQuery(undefined, params.error)} />
      {grades.length === 0 ? (
        <FnCard variant="flat" className="fn-empty">
          <p className="fn-empty__title">أضف صفًا أولًا</p>
          <p className="fn-empty__text">لا يمكن إنشاء حقل بدون صف دراسي.</p>
        </FnCard>
      ) : (
        <FieldForm action="/api/admin/fields" grades={grades} />
      )}
    </div>
  );
}
