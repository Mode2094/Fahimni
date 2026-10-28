import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleAlert, Plus, Image as ImageIcon } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { AdminFeaturedBadge, AdminMessage, AdminPageHeader, AdminStatusBadge } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/admin/guard';
import { formatMinor } from '@/lib/admin/money';
import { messageFromQuery } from '@/lib/admin/messages';
import { adminStore } from '@/lib/admin/store';
import { booksStore } from '@/lib/books/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'المواد',
};

export default async function AdminSubjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  await requireAdmin('/admin/subjects');
  const [subjects, params] = await Promise.all([adminStore().listSubjects(), searchParams]);
  const message = messageFromQuery(params.status, params.error);

  // Content-readiness warnings: an active subject without a READY book cannot
  // teach from the curriculum. Never auto-fixes anything — admin decides.
  const activeSubjects = subjects.filter((subject) => subject.isActive);
  const bookIssues: { id: string; name: string; issue: 'missing' | 'not_ready' | 'low_text' }[] = [];
  for (const subject of activeSubjects) {
    const book = await booksStore().findBookBySubject(subject.id).catch(() => null);
    if (!book) {
      bookIssues.push({ id: subject.id, name: subject.name, issue: 'missing' });
    } else if (book.status !== 'READY') {
      bookIssues.push({ id: subject.id, name: subject.name, issue: 'not_ready' });
    } else if (book.errorMessage === 'low_text') {
      bookIssues.push({ id: subject.id, name: subject.name, issue: 'low_text' });
    }
  }

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title="المواد"
        description="إدارة المواد وربطها بالصفوف والحقول."
        action={
          <FnButton asChild size="sm">
            <Link href="/admin/subjects/new">
              <Plus size={16} aria-hidden="true" />
              إضافة مادة
            </Link>
          </FnButton>
        }
      />
      <AdminMessage message={message} />

      {bookIssues.length ? (
        <FnCard variant="flat" className="fn-stack">
          <div className="fn-row">
            <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--gold">
              <CircleAlert size={18} aria-hidden="true" />
            </span>
            <h2 className="fn-card__title">تنبيه: مواد مفعّلة بلا كتاب جاهز</h2>
          </div>
          <p className="fn-card__text">
            هذه المواد مفعّلة للطلاب لكن الشرح من الكتاب غير متاح فيها بعد. ارفع الكتاب المدرسي وفهرسه من صفحة المادة.
          </p>
          <ul className="fn-readiness">
            {bookIssues.map((issue) => (
              <li key={issue.id}>
                <CircleAlert size={15} aria-hidden="true" />
                <Link href={`/admin/subjects/${issue.id}`}>{issue.name}</Link>
                <FnBadge variant={issue.issue === 'missing' ? 'outline' : 'danger'}>
                  {issue.issue === 'missing' ? 'لا يوجد كتاب' : issue.issue === 'not_ready' ? 'الكتاب غير جاهز' : 'نص الكتاب قليل (يحتاج OCR)'}
                </FnBadge>
              </li>
            ))}
          </ul>
        </FnCard>
      ) : null}

      {subjects.length === 0 ? (
        <FnCard variant="flat" className="fn-empty">
          <p className="fn-empty__title">لا توجد مواد بعد</p>
          <p className="fn-empty__text">أضف أول مادة لتظهر للطلاب في صفهم.</p>
        </FnCard>
      ) : (
        <div className="fn-table-wrap">
          <table className="fn-table">
            <thead>
              <tr>
                <th>المادة</th>
                <th>الصف</th>
                <th>الحقل</th>
                <th>الشهري</th>
                <th>الفصل</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((subject) => (
                <tr key={subject.id}>
                  <td>
                    <div className="fn-row">
                      <span className="fn-admin-thumb">
                        {subject.image ? <img src={subject.image} alt="" loading="lazy" /> : <ImageIcon size={16} aria-hidden="true" />}
                      </span>
                      <div className="fn-stack fn-stack--sm">
                        <span>{subject.name}</span>
                        <span className="fn-caption" dir="ltr">
                          {subject.slug}
                        </span>
                        <span>
                          <AdminFeaturedBadge featured={subject.isFeatured} />
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>{subject.gradeName}</td>
                  <td>{subject.fieldName ?? <FnBadge variant="outline">كل الحقول</FnBadge>}</td>
                  <td className="fn-price">{formatMinor(subject.monthlyPriceMinor, subject.currency)}</td>
                  <td className="fn-price">{formatMinor(subject.semesterPriceMinor, subject.currency)}</td>
                  <td>
                    <AdminStatusBadge active={subject.isActive} />
                  </td>
                  <td>
                    <div className="fn-row fn-row--wrap">
                      <FnButton asChild size="sm" variant="soft">
                        <Link href={`/admin/subjects/${subject.id}`}>تعديل</Link>
                      </FnButton>
                      <form action={`/api/admin/subjects/${subject.id}`} method="post">
                        <input type="hidden" name="intent" value="toggle" />
                        <FnButton type="submit" size="sm" variant="ghost">
                          {subject.isActive ? 'تعطيل' : 'تفعيل'}
                        </FnButton>
                      </form>
                      <form action={`/api/admin/subjects/${subject.id}`} method="post">
                        <input type="hidden" name="intent" value="toggle-featured" />
                        <FnButton type="submit" size="sm" variant="ghost">
                          {subject.isFeatured ? 'إلغاء التمييز' : 'تمييز'}
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
