import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { FnLinkMore } from '@/components/fahimni';
import { AdminMessage, AdminPageHeader } from '@/components/admin/admin-ui';
import { BookPanel } from '@/components/admin/book-panel';
import { PlansPanel } from '@/components/admin/plans-panel';
import { SubjectForm } from '@/components/admin/subject-form';
import { requireAdmin } from '@/lib/admin/guard';
import { messageFromQuery } from '@/lib/admin/messages';
import { adminStore } from '@/lib/admin/store';
import { billingStore } from '@/lib/billing/store';
import { bookMessageFromQuery } from '@/lib/books/messages';
import { fileSize, sourcePdfPath } from '@/lib/books/storage';
import { booksStore } from '@/lib/books/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'تعديل مادة',
};

export default async function EditSubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; status?: string }>;
}) {
  await requireAdmin('/admin/subjects');
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const store = adminStore();
  const [subject, grades, fields, book, plans] = await Promise.all([
    store.findSubject(id),
    store.listGrades(),
    store.listFields(),
    booksStore().findBookBySubject(id),
    billingStore().listSubjectPlans(id),
  ]);
  if (!subject) notFound();

  let sizeBytes: number | null = null;
  if (book) {
    try {
      sizeBytes = await fileSize(sourcePdfPath(book.id));
    } catch {
      sizeBytes = null;
    }
  }

  const message = bookMessageFromQuery(query.status, query.error) ?? messageFromQuery(query.status, query.error);

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title={`تعديل: ${subject.name}`}
        action={
          <FnLinkMore asChild>
            <Link href="/admin/subjects">العودة للمواد</Link>
          </FnLinkMore>
        }
      />
      <AdminMessage message={message} />
      <SubjectForm action={`/api/admin/subjects/${subject.id}`} subject={subject} grades={grades} fields={fields} />
      <PlansPanel subjectId={subject.id} plans={plans} />
      <BookPanel subjectId={subject.id} book={book} sizeBytes={sizeBytes} />
    </div>
  );
}
