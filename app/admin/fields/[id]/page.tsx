import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { FnLinkMore } from '@/components/fahimni';
import { AdminMessage, AdminPageHeader } from '@/components/admin/admin-ui';
import { FieldForm } from '@/components/admin/field-form';
import { requireAdmin } from '@/lib/admin/guard';
import { messageFromQuery } from '@/lib/admin/messages';
import { adminStore } from '@/lib/admin/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تعديل حقل',
};

export default async function EditFieldPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin('/admin/fields');
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const store = adminStore();
  const [field, grades] = await Promise.all([store.findField(id), store.listGrades()]);
  if (!field) notFound();

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title={`تعديل: ${field.name}`}
        action={
          <FnLinkMore asChild>
            <Link href="/admin/fields">العودة للحقول</Link>
          </FnLinkMore>
        }
      />
      <AdminMessage message={messageFromQuery(undefined, query.error)} />
      <FieldForm action={`/api/admin/fields/${field.id}`} field={field} grades={grades} />
    </div>
  );
}
