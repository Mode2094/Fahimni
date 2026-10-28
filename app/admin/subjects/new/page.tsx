import type { Metadata } from 'next';
import Link from 'next/link';

import { FnCard, FnLinkMore } from '@/components/fahimni';
import { AdminMessage, AdminPageHeader } from '@/components/admin/admin-ui';
import { SubjectForm } from '@/components/admin/subject-form';
import { requireAdmin } from '@/lib/admin/guard';
import { messageFromQuery } from '@/lib/admin/messages';
import { adminStore } from '@/lib/admin/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إضافة مادة',
};

export default async function NewSubjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin('/admin/subjects/new');
  const store = adminStore();
  const [grades, fields, params] = await Promise.all([store.listGrades(), store.listFields(), searchParams]);

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title="إضافة مادة"
        action={
          <FnLinkMore asChild>
            <Link href="/admin/subjects">العودة للمواد</Link>
          </FnLinkMore>
        }
      />
      <AdminMessage message={messageFromQuery(undefined, params.error)} />
      {grades.length === 0 ? (
        <FnCard variant="flat" className="fn-empty">
          <p className="fn-empty__title">أضف صفًا أولًا</p>
          <p className="fn-empty__text">لا يمكن إنشاء مادة بدون صف دراسي.</p>
        </FnCard>
      ) : (
        <SubjectForm action="/api/admin/subjects" grades={grades} fields={fields} />
      )}
    </div>
  );
}
