import { CircleAlert, History, RefreshCw, ShieldCheck } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { PLAN_LABELS } from '@/lib/admin/offer-labels';
import { formatMinor } from '@/lib/admin/money';
import type { PlanType } from '@/lib/billing/store';
import { SUPPORTED_CHECKOUT_CURRENCIES } from '@/lib/freemius/verification';
import { CHECKOUT_STATUS_LABELS, type CheckoutStatus } from '@/lib/freemius/readiness';

export type FreemiusConnectionView = {
  configured: boolean;
  productId: string | null;
  productTitle: string | null;
  planCount: number;
  developerConfigured: boolean;
  lastVerifiedAt: string | null;
  lastVerifiedOk: boolean | null;
  syncEnabled: boolean;
  encryptionReady: boolean;
  webhookLast: string | null;
};

export type BillingEventView = {
  id: string;
  type: string;
  summary: string;
  userEmail: string | null;
  createdAt: string;
};

export type PlanConflictView = { planId: string; offerTitles: string[] };

export function FreemiusSection({
  connection,
  statusCounts,
  offers,
  legacyPlans,
  events,
  planConflicts,
}: {
  connection: FreemiusConnectionView;
  statusCounts: Record<CheckoutStatus, number>;
  offers: { id: string; title: string; status: CheckoutStatus }[];
  legacyPlans: { id: string; subjectName: string; type: PlanType; priceMinor: number | null; currency: string; planId: string | null; isActive: boolean }[];
  events: BillingEventView[];
  planConflicts: PlanConflictView[];
}) {
  const readyCount = statusCounts.READY;
  return (
    <div className="fn-stack fn-stack--lg">
      <FnCard variant="flat" className="fn-stack">
        <div className="fn-row">
          <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--mint">
            <ShieldCheck size={18} aria-hidden="true" />
          </span>
          <div className="fn-stack fn-stack--sm">
            <h2 className="fn-card__title">حالة الربط مع فريميوس</h2>
            <p className="fn-card__text">
              فريميوس هي بوابة الدفع الوحيدة. هذه الصفحة للعرض فقط — لا تُنشئ خططًا ولا تُعدّل أسعارًا تلقائيًا في هذه المرحلة.
            </p>
          </div>
          <FnBadge variant={connection.configured ? 'mint' : 'outline'}>{connection.configured ? 'الربط مكتمل' : 'الربط غير مكتمل'}</FnBadge>
        </div>
        <div className="fn-grid fn-grid--2">
          <div className="fn-row fn-row--wrap">
            <FnBadge variant={connection.lastVerifiedOk ? 'mint' : 'outline'}>
              {connection.lastVerifiedOk === null ? 'لم يُختبر بعد' : connection.lastVerifiedOk ? 'آخر تحقق ناجح' : 'آخر تحقق فاشل'}
            </FnBadge>
            <span className="fn-caption">
              {connection.productId
                ? `المنتج: ${connection.productTitle ?? connection.productId} · ${connection.planCount} خطة في فريميوس`
                : 'لا يوجد معرّف منتج محفوظ'}
            </span>
          </div>
          <div className="fn-row fn-row--wrap">
            <FnBadge variant={connection.developerConfigured ? 'sky' : 'outline'}>
              {connection.developerConfigured ? 'بيانات مطوّر محفوظة' : 'لا توجد بيانات مطوّر'}
            </FnBadge>
            <FnBadge variant={connection.syncEnabled ? 'gold' : 'outline'}>{connection.syncEnabled ? 'المزامنة الحية مفعّلة' : 'المزامنة الحية معطّلة'}</FnBadge>
            <FnBadge variant={connection.encryptionReady ? 'mint' : 'danger'}>{connection.encryptionReady ? 'التشفير مهيأ' : 'التشفير غير مهيأ'}</FnBadge>
          </div>
        </div>
        {connection.lastVerifiedAt ? <p className="fn-caption">آخر تحقق: {new Date(connection.lastVerifiedAt).toLocaleString('ar-JO')}</p> : null}
        {connection.webhookLast ? <p className="fn-caption">آخر ويبهوك: {connection.webhookLast}</p> : null}
        {!connection.lastVerifiedOk && connection.configured ? (
          <p className="fn-caption">اختبر الاتصال من الإعدادات ← فريميوس لعرض تفاصيل المنتج والخطط.</p>
        ) : null}
      </FnCard>

      <FnCard variant="flat" className="fn-stack">
        <h2 className="fn-card__title">جاهزية العروض للدفع</h2>
        <div className="fn-row fn-row--wrap">
          {(Object.keys(CHECKOUT_STATUS_LABELS) as CheckoutStatus[]).map((status) => (
            <FnBadge key={status} variant={status === 'READY' ? 'mint' : status === 'SYNC_FAILED' ? 'danger' : 'outline'}>
              {CHECKOUT_STATUS_LABELS[status]}: {statusCounts[status]}
            </FnBadge>
          ))}
        </div>
        {offers.length ? (
          <ul className="fn-readiness">
            {offers.map((offer) => (
              <li key={offer.id}>
                <a href={`/admin/subscriptions?section=offers#offer-${offer.id}`}>{offer.title}</a>
                <FnBadge variant={offer.status === 'READY' ? 'mint' : offer.status === 'SYNC_FAILED' ? 'danger' : 'outline'}>
                  {CHECKOUT_STATUS_LABELS[offer.status]}
                </FnBadge>
                <form action="/api/admin/settings/freemius/sync" method="post">
                  <input type="hidden" name="offerId" value={offer.id} />
                  <FnButton type="submit" variant="ghost" size="sm">
                    <RefreshCw size={14} aria-hidden="true" />
                    تحقق
                  </FnButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="fn-caption">لا توجد عروض بعد.</p>
        )}
        <p className="fn-caption">
          لا يصل الطالب إلى الدفع إلا عندما تكون الخطة والتسعير والعملة والدورة مؤكدة من فريميوس. الدفع يُحصَّل بعملة خطة
          فريميوس المعتمدة — السعر المحلي يطابقها تمامًا بعد التحقق، وإلا يبقى العرض غير جاهز.
        </p>
        {readyCount === 0 ? (
          <ul className="fn-readiness">
            <li>
              <CircleAlert size={15} aria-hidden="true" />
              لا يوجد أي عرض جاهز للدفع حاليًا. أكمل الربط من الإعدادات ثم شغّل «تحقق / مزامنة» لكل عرض.
            </li>
          </ul>
        ) : null}
      </FnCard>

      {planConflicts.length ? (
        <FnCard variant="flat" className="fn-stack">
          <div className="fn-row">
            <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--pink">
              <CircleAlert size={18} aria-hidden="true" />
            </span>
            <h2 className="fn-card__title">تعارض في ربط الخطط</h2>
          </div>
          <p className="fn-card__text">
            عرضان يشيران إلى نفس خطة فريميوس. توجيه الاشتراكات يعتمد على معرّف الخطة، لذلك يجب أن يكون الربط فريدًا — اربط
            كل عرض بخطة فريميوس مستقلة.
          </p>
          <ul className="fn-readiness">
            {planConflicts.map((conflict) => (
              <li key={conflict.planId}>
                <CircleAlert size={15} aria-hidden="true" />
                <span dir="ltr">{conflict.planId}</span>
                <span className="fn-caption">{conflict.offerTitles.join(' · ')}</span>
              </li>
            ))}
          </ul>
        </FnCard>
      ) : null}

      <FnCard variant="flat" className="fn-stack">
        <div className="fn-row">
          <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--gold">
            <History size={18} aria-hidden="true" />
          </span>
          <h2 className="fn-card__title">أحداث الفوترة الأخيرة</h2>
        </div>
        <p className="fn-card__text">
          سجل قراءة فقط لأحداث فريميوس المؤكدة (فشل تجديد، إلغاء، انتهاء، استرجاع). لا يغيّر الوصول — الوصول يُدار من حالة
          الرخصة الموثّقة فقط.
        </p>
        {events.length ? (
          <div className="fn-table-wrap">
            <table className="fn-table">
              <thead>
                <tr>
                  <th>الحدث</th>
                  <th>الطالب</th>
                  <th>النوع</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.summary}</td>
                    <td dir="ltr">{event.userEmail ?? '—'}</td>
                    <td className="fn-caption" dir="ltr">
                      {event.type}
                    </td>
                    <td>{new Date(event.createdAt).toLocaleString('ar-JO')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fn-caption">لا توجد أحداث مسجلة بعد. ستظهر هنا تلقائيًا بعد أول حدث فوترة موثّق.</p>
        )}
      </FnCard>

      <FnCard variant="flat" className="fn-stack">
        <h2 className="fn-card__title">قواعد فريميوس التشغيلية</h2>
        <ul className="fn-readiness">
          <li>
            <CircleAlert size={15} aria-hidden="true" />
            <span>
              <strong>اشتراك واحد لكل مستخدم:</strong> فريميوس تقيّد افتراضيًا اشتراكًا نشطًا واحدًا لكل مستخدم. لتمكين شراء
              مادتين مستقلتين يجب إيقاف خيار «Restrict Single Subscription Per User» من إعدادات منتج فريميوس. إن بقي
              مفعّلًا، فإن المسار المتوافق الوحيد هو الباقات.
            </span>
          </li>
          <li>
            <CircleAlert size={15} aria-hidden="true" />
            <span>
              <strong>العملات المدعومة للدفع:</strong> <span dir="ltr">{SUPPORTED_CHECKOUT_CURRENCIES.join(' · ')}</span> —
              الدينار الأردني غير مدعوم في فريميوس، وأي عرض بعملة غير مدعومة يبقى غير جاهز للدفع (بدون تحويل تلقائي).
            </span>
          </li>
          <li>
            <CircleAlert size={15} aria-hidden="true" />
            <span>
              <strong>الفصل الدراسي:</strong> فريميوس لا تدعم دورة فوترة مخصصة بطول فصل دراسي. الوصول الفصلي يُنفَّذ كدفعة
              واحدة (one-off) بنافذة صلاحية صريحة تنتهي بنهاية الفصل — وهو النموذج المعتمد هنا.
            </span>
          </li>
        </ul>
      </FnCard>

      {legacyPlans.length ? (
        <FnCard variant="flat" className="fn-stack">
          <h2 className="fn-card__title">خطط قديمة (نظام المواد المنفردة)</h2>
          <p className="fn-card__text">خطط سابقة تعمل كاحتياط عندما لا يوجد عرض موحّد مطابق. تبقى كما هي دون أي تغيير.</p>
          <div className="fn-table-wrap">
            <table className="fn-table">
              <thead>
                <tr>
                  <th>المادة</th>
                  <th>النوع</th>
                  <th>السعر</th>
                  <th>خطة فريميوس</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {legacyPlans.map((plan) => (
                  <tr key={plan.id}>
                    <td>{plan.subjectName}</td>
                    <td>{PLAN_LABELS[plan.type]}</td>
                    <td dir="ltr">{formatMinor(plan.priceMinor, plan.currency)}</td>
                    <td className="fn-caption" dir="ltr">
                      {plan.planId ?? '—'}
                    </td>
                    <td>
                      <FnBadge variant={plan.isActive ? 'mint' : 'outline'}>{plan.isActive ? 'مفعّلة' : 'معطّلة'}</FnBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FnCard>
      ) : null}

      <FnCard variant="flat" className="fn-stack">
        <h2 className="fn-card__title">ملاحظات المزامنة الآلية</h2>
        <ul className="fn-readiness">
          <li>
            <CircleAlert size={15} aria-hidden="true" />
            التحقق من الخطط والأسعار يتم عبر واجهات فريميوس الرسمية للقراءة فقط — لا كتابة ولا تعديل أسعار.
          </li>
          <li>
            <CircleAlert size={15} aria-hidden="true" />
            إنشاء الخطط وتعديل التسعير يتطلب صلاحيات مطوّر (developer scope) بمصادقة مفتاح سري — مفاتيح المنتج الحالية لا
            تمنح هذه الصلاحيات، لذلك تبقى الأتمتة الكاملة محجوبة حتى توفيرها.
          </li>
          <li>
            <CircleAlert size={15} aria-hidden="true" />
            عند تغيير سعر عرض مرتبط، تُنشأ نسخة تسعير جديدة بدل تعديل التسعير القائم، حفاظًا على أسعار المشتركين الحاليين.
          </li>
        </ul>
      </FnCard>
    </div>
  );
}
