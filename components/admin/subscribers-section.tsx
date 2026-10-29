import { RefreshCw, Search, Users } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import type { AdminEntitlementRow, EntitlementRecord, PlanType, SubscriptionOfferRecord } from '@/lib/billing/store';
import { formatBookDate } from '@/lib/books/messages';
import { formatTermDate } from '@/lib/billing/terms';

const STATUS_LABELS: Record<EntitlementRecord['status'], string> = {
  ACTIVE: 'نشط',
  CANCELED: 'ملغي',
  EXPIRED: 'منتهي',
  REFUNDED: 'مسترجع',
  PENDING: 'قيد التفعيل',
};

const PLAN_LABELS: Record<PlanType, string> = { MONTHLY: 'شهري', SEMESTER: 'فصلي' };

export function SubscribersSection({
  rows,
  search,
  offers,
  subjectName,
  termName,
  scopes,
}: {
  rows: AdminEntitlementRow[];
  search: string;
  offers: SubscriptionOfferRecord[];
  subjectName: Map<string, string>;
  termName: Map<string, string>;
  scopes: Map<string, string[]>;
}) {
  return (
    <div className="fn-stack fn-stack--lg">
      <FnCard variant="flat" className="fn-stack">
        <div className="fn-row">
          <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--pink">
            <Users size={18} aria-hidden="true" />
          </span>
          <div className="fn-stack fn-stack--sm">
            <h2 className="fn-card__title">اشتراكات الطلاب</h2>
            <p className="fn-card__text">
              عرض للقراءة فقط لآخر الاشتراكات المسجلة من عمليات الدفع المؤكدة. التعديل والإلغاء يتمان من بوابة فريميوس
              وينعكسان تلقائيًا.
            </p>
          </div>
        </div>
        <form method="get" action="/admin/subscriptions" className="fn-row fn-row--wrap">
          <input type="hidden" name="section" value="subscribers" />
          <div className="fn-field fn-field--grow">
            <label className="fn-field__label" htmlFor="subscriber-search">
              بحث بالبريد الإلكتروني أو الاسم
            </label>
            <input className="fn-input" id="subscriber-search" name="q" type="search" defaultValue={search} placeholder="student@example.com" dir="ltr" />
          </div>
          <FnButton type="submit" variant="soft" size="sm">
            <Search size={15} aria-hidden="true" />
            بحث
          </FnButton>
        </form>
      </FnCard>

      {rows.length ? (
        <div className="fn-table-wrap">
          <table className="fn-table">
            <thead>
              <tr>
                <th>الطالب</th>
                <th>الاشتراك</th>
                <th>النوع</th>
                <th>الحالة</th>
                <th>البداية</th>
                <th>الانتهاء / التجديد</th>
                <th>الرصيد</th>
                <th>مزامنة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const offer = row.offerId ? offers.find((candidate) => candidate.id === row.offerId) ?? null : null;
                const isBundle = !row.subjectId;
                const covered = isBundle
                  ? (scopes.get(row.id) ?? []).map((id) => subjectName.get(id) ?? 'مادة').join('، ')
                  : subjectName.get(row.subjectId ?? '') ?? 'مادة';
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="fn-stack fn-stack--sm">
                        <span>{row.userName ?? 'طالب'}</span>
                        <span className="fn-caption" dir="ltr">
                          {row.userEmail}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="fn-stack fn-stack--sm">
                        <span>{isBundle ? `باقة: ${covered}` : covered}</span>
                        {row.academicTermId && termName.get(row.academicTermId) ? (
                          <span className="fn-caption">{termName.get(row.academicTermId)}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>{offer ? PLAN_LABELS[offer.type] : '—'}</td>
                    <td>
                      <div className="fn-row fn-row--wrap">
                        <FnBadge variant={row.status === 'ACTIVE' ? (row.renewalCanceled ? 'gold' : 'mint') : 'outline'}>
                          {STATUS_LABELS[row.status]}
                        </FnBadge>
                        {row.renewalCanceled ? <span className="fn-caption">التجديد ملغي</span> : null}
                      </div>
                    </td>
                    <td>{row.startsAt ? formatBookDate(row.startsAt) : '—'}</td>
                    <td>
                      {row.academicTermId && row.expiresAt
                        ? `نهاية الفصل · ${formatTermDate(row.expiresAt)}`
                        : row.expiresAt
                          ? formatBookDate(row.expiresAt)
                          : '—'}
                    </td>
                    <td dir="ltr">{row.creditBalance}</td>
                    <td>
                      {row.freemiusLicenseId ? (
                        <form action={`/api/admin/subscriptions/entitlements/${row.id}/resync`} method="post">
                          <FnButton type="submit" variant="ghost" size="sm" title="إعادة قراءة حالة الرخصة من فريميوس">
                            <RefreshCw size={14} aria-hidden="true" />
                            مزامنة
                          </FnButton>
                        </form>
                      ) : (
                        <span className="fn-caption">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <FnCard variant="flat" className="fn-empty">
          <p className="fn-empty__title">{search ? 'لا توجد نتائج مطابقة' : 'لا توجد اشتراكات مسجلة بعد'}</p>
          <p className="fn-empty__text">
            {search ? 'جرّب بريدًا إلكترونيًا آخر أو امسح البحث.' : 'ستظهر الاشتراكات هنا تلقائيًا بعد أول عملية دفع مؤكدة عبر فريميوس.'}
          </p>
        </FnCard>
      )}
    </div>
  );
}
