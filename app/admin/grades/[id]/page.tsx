import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { FnLinkMore } from '@/components/fahimni';
import { AdminMessage, AdminPageHeader } from '@/components/admin/admin-ui';
import { GradeForm } from '@/components/admin/grade-form';
import { requireAdmin } from '@/lib/admin/guard';
import { messageFromQuery } from '@/lib/admin/messages';
import { adminStore } from '@/lib/admin/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تعديل صف',
};

export default async function EditGradePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin('/admin/grades');
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const grade = await adminStore().findGrade(id);
  if (!grade) notFound();

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title={`تعديل: ${grade.name}`}
        action={
          <FnLinkMore asChild>
            <Link href="/admin/grades">العودة للصفوف</Link>
          </FnLinkMore>
        }
      />
      <AdminMessage message={messageFromQuery(undefined, query.error)} />
      <GradeForm action={`/api/admin/grades/${grade.id}`} grade={grade} />
    </div>
  );
}
