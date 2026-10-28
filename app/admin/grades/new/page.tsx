import type { Metadata } from 'next';
import Link from 'next/link';

import { FnLinkMore } from '@/components/fahimni';
import { AdminMessage, AdminPageHeader } from '@/components/admin/admin-ui';
import { GradeForm } from '@/components/admin/grade-form';
import { requireAdmin } from '@/lib/admin/guard';
import { messageFromQuery } from '@/lib/admin/messages';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إضافة صف',
};

export default async function NewGradePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin('/admin/grades/new');
  const params = await searchParams;

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title="إضافة صف"
        action={
          <FnLinkMore asChild>
            <Link href="/admin/grades">العودة للصفوف</Link>
          </FnLinkMore>
        }
      />
      <AdminMessage message={messageFromQuery(undefined, params.error)} />
      <GradeForm action="/api/admin/grades" />
    </div>
  );
}
