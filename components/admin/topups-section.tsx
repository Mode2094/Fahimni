import { FnBadge } from '@/components/fahimni';
import { formatMinor } from '@/lib/admin/money';
import type { TopupOfferRecord } from '@/lib/billing/topup-store';

// Top-up catalog management. Offers are drafts/paused until the admin activates
// them; activation does not itself start a live payment — the checkout is only
// reachable once the provider link is verified and the owner approves.

const STATUS_LABELS: Record<TopupOfferRecord['status'], string> = {
  DRAFT: 'مسودة',
  ACTIVE: 'نشط',
  PAUSED: 'موقوف',
  ARCHIVED: 'مؤرشف',
};

const STATUS_VARIANT: Record<TopupOfferRecord['status'], 'mint' | 'gold' | 'outline' | 'sky'> = {
  DRAFT: 'outline',
  ACTIVE: 'mint',
  PAUSED: 'gold',
  ARCHIVED: 'outline',
};

export function TopupsSection({ offers }: { offers: TopupOfferRecord[] }) {
  return (
    <div className="fn-stack">
      <form className="fn-card" action="/api/admin/subscriptions/topups" method="post">
        <div className="fn-card__head">
          <h2 className="fn-section__title">إضافة عرض شحن</h2>
        </div>
        <div className="fn-grid fn-grid--2">
          <label className="fn-field">
            <span className="fn-field__label">الاسم</span>
            <input className="fn-input" name="name" required maxLength={80} placeholder="100 كريدت" />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">عدد الكريدت</span>
            <input className="fn-input" name="credits" type="number" min={1} max={100000} required dir="ltr" />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">السعر</span>
            <input className="fn-input" name="price" required dir="ltr" placeholder="5" />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">العملة</span>
            <input className="fn-input" name="currency" defaultValue="JOD" dir="ltr" maxLength={8} />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">الحالة</span>
            <select className="fn-select" name="status" defaultValue="DRAFT">
              <option value="DRAFT">مسودة</option>
              <option value="ACTIVE">نشط</option>
              <option value="PAUSED">موقوف</option>
              <option value="ARCHIVED">مؤرشف</option>
            </select>
          </label>
          <label className="fn-field">
            <span className="fn-field__label">معرّف خطة فريميوس (اختياري)</span>
            <input className="fn-input" name="freemiusPlanId" dir="ltr" maxLength={120} placeholder="plan_..." />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">ترتيب العرض</span>
            <input className="fn-input" name="sortOrder" type="number" min={0} max={9999} defaultValue={0} dir="ltr" />
          </label>
        </div>
        <button className="fn-btn fn-btn--primary" type="submit">
          إضافة العرض
        </button>
      </form>

      <section className="fn-section">
        <h2 className="fn-section__title">عروض الشحن</h2>
        {offers.length ? (
          <div className="fn-table-wrap">
            <table className="fn-table">
              <thead>
                <tr>
                  <th scope="col">العرض</th>
                  <th scope="col">الكريدت</th>
                  <th scope="col">السعر</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">فريميوس</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((offer) => (
                  <tr key={offer.id}>
                    <td>{offer.name}</td>
                    <td dir="ltr">{offer.credits}</td>
                    <td>{formatMinor(offer.priceMinor, offer.currency)}</td>
                    <td>
                      <FnBadge variant={STATUS_VARIANT[offer.status]}>{STATUS_LABELS[offer.status]}</FnBadge>
                    </td>
                    <td className="fn-caption" dir="ltr">
                      {offer.freemiusPlanId ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fn-caption">لا توجد عروض شحن بعد.</p>
        )}
      </section>
    </div>
  );
}
