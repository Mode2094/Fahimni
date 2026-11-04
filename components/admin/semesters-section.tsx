import { FnBadge } from '@/components/fahimni';
import { formatMinor } from '@/lib/admin/money';
import type { SemesterRecord, SemesterStatus } from '@/lib/billing/semester-store';
import { calendarDateInAmman, daysRemaining, formatTermDate, termPhase } from '@/lib/billing/terms';

// Semester management: create, schedule, pause and archive the admin-controlled
// calendar. Every date is shown in Asia/Amman; the stored boundary is UTC.

export type SemesterAdminView = {
  semester: SemesterRecord;
  subscribers: number;
  grantedCredits: number;
  consumedCredits: number;
};

const PHASE_LABELS = { upcoming: 'لم يبدأ', ongoing: 'جارٍ', ended: 'انتهى' } as const;

const STATUS_LABELS: Record<SemesterStatus, string> = {
  DRAFT: 'مسودة',
  SCHEDULED: 'مجدول',
  ACTIVE: 'نشط',
  ENDED: 'منتهٍ',
  ARCHIVED: 'مؤرشف',
};

const STATUS_VARIANT: Record<SemesterStatus, 'mint' | 'sky' | 'gold' | 'outline' | 'danger'> = {
  DRAFT: 'outline',
  SCHEDULED: 'sky',
  ACTIVE: 'mint',
  ENDED: 'gold',
  ARCHIVED: 'outline',
};

export function SemestersSection({
  semesters,
  grades,
  fields,
}: {
  semesters: SemesterAdminView[];
  grades: { id: string; name: string }[];
  fields: { id: string; name: string; gradeId: string }[];
}) {
  return (
    <div className="fn-stack">
      <form className="fn-card" action="/api/admin/subscriptions/semesters" method="post">
        <div className="fn-card__head">
          <h2 className="fn-section__title">إنشاء فصل دراسي</h2>
        </div>
        <div className="fn-grid fn-grid--2">
          <label className="fn-field">
            <span className="fn-field__label">اسم الفصل</span>
            <input className="fn-input" name="name" required maxLength={120} placeholder="الفصل الأول 2027/2028" />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">العام الدراسي</span>
            <input className="fn-input" name="academicYear" required maxLength={40} placeholder="2027/2028" />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">الصف</span>
            <select className="fn-select" name="gradeId" required defaultValue="">
              <option value="" disabled>
                اختر الصف
              </option>
              {grades.map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fn-field">
            <span className="fn-field__label">التخصص (اختياري)</span>
            <select className="fn-select" name="academicFieldId" defaultValue="">
              <option value="">كل التخصصات</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </label>
          <label className="fn-field">
            <span className="fn-field__label">تاريخ البداية</span>
            <input className="fn-input" name="startDate" type="date" required dir="ltr" />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">تاريخ النهاية</span>
            <input className="fn-input" name="endDate" type="date" required dir="ltr" />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">بداية البيع (اختياري)</span>
            <input className="fn-input" name="salesStartDate" type="date" dir="ltr" />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">نهاية البيع (اختياري)</span>
            <input className="fn-input" name="salesEndDate" type="date" dir="ltr" />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">السعر</span>
            <input className="fn-input" name="price" required dir="ltr" placeholder="29" />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">العملة</span>
            <input className="fn-input" name="currency" defaultValue="JOD" dir="ltr" maxLength={8} />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">الرصيد المُضمّن</span>
            <input className="fn-input" name="includedCredits" type="number" min={0} max={100000} defaultValue={300} required />
          </label>
          <label className="fn-field">
            <span className="fn-field__label">الحالة</span>
            <select className="fn-select" name="status" defaultValue="DRAFT">
              <option value="DRAFT">مسودة</option>
              <option value="SCHEDULED">مجدول</option>
              <option value="ACTIVE">نشط</option>
              <option value="ENDED">منتهٍ</option>
              <option value="ARCHIVED">مؤرشف</option>
            </select>
          </label>
          <label className="fn-field">
            <span className="fn-field__label">سياسة التسجيل المتأخر</span>
            <select className="fn-select" name="lateEnrollmentPolicy" defaultValue="FULL_PRICE">
              <option value="FULL_PRICE">السعر الكامل</option>
              <option value="PRORATED">تناسب مع الأيام المتبقية</option>
            </select>
          </label>
          <label className="fn-field">
            <span className="fn-field__label">معرّف خطة فريميوس (اختياري)</span>
            <input className="fn-input" name="freemiusPlanId" dir="ltr" maxLength={120} placeholder="plan_..." />
          </label>
        </div>
        <label className="fn-check">
          <input type="checkbox" name="topUpEnabled" defaultChecked />
          <span>السماح بشحن الرصيد الإضافي خلال هذا الفصل</span>
        </label>
        <label className="fn-field">
          <span className="fn-field__label">ملاحظات داخلية (اختياري)</span>
          <textarea className="fn-textarea" name="adminNotes" maxLength={2000} rows={2} />
        </label>
        <button className="fn-btn fn-btn--primary" type="submit">
          إنشاء الفصل
        </button>
      </form>

      <section className="fn-section">
        <h2 className="fn-section__title">الفصول الحالية</h2>
        {semesters.length ? (
          <div className="fn-table-wrap">
            <table className="fn-table">
              <thead>
                <tr>
                  <th scope="col">الفصل</th>
                  <th scope="col">المدة</th>
                  <th scope="col">السعر</th>
                  <th scope="col">الرصيد</th>
                  <th scope="col">المشتركون</th>
                  <th scope="col">الحالة</th>
                  <th scope="col">متبقٍ</th>
                </tr>
              </thead>
              <tbody>
                {semesters.map((view) => (
                  <tr key={view.semester.id}>
                    <td>
                      <strong>{view.semester.name}</strong>
                      <div className="fn-caption">{view.semester.academicYear}</div>
                    </td>
                    <td className="fn-caption">
                      {formatTermDate(view.semester.startsAt)} – {formatTermDate(view.semester.endsAt)}
                    </td>
                    <td>{formatMinor(view.semester.priceMinor, view.semester.currency)}</td>
                    <td>
                      {view.semester.includedCredits}
                      <div className="fn-caption">
                        مُمنوح {view.grantedCredits} · مُستهلك {view.consumedCredits}
                      </div>
                    </td>
                    <td>{view.subscribers}</td>
                    <td>
                      <FnBadge variant={STATUS_VARIANT[view.semester.status]}>{STATUS_LABELS[view.semester.status]}</FnBadge>
                      <div className="fn-caption">{PHASE_LABELS[termPhase(view.semester.startsAt, view.semester.endsAt)]}</div>
                    </td>
                    <td className="fn-caption">
                      {termPhase(view.semester.startsAt, view.semester.endsAt) === 'ended'
                        ? '—'
                        : `${daysRemaining(view.semester.endsAt)} يومًا`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="fn-caption">لا توجد فصول بعد. أنشئ فصلًا للبدء.</p>
        )}
      </section>
      <p className="fn-caption" dir="ltr">
        {calendarDateInAmman(new Date())} (Asia/Amman)
      </p>
    </div>
  );
}
