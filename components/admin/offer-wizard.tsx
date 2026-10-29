'use client';

import { useMemo, useState } from 'react';
import { BadgeCheck, CalendarDays, CircleAlert, RefreshCw } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { cn } from '@/lib/utils';

export type WizardTerm = {
  id: string;
  name: string;
  gradeId: string;
  academicFieldId: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  phase: 'upcoming' | 'ongoing' | 'ended';
};

export type WizardCatalog = {
  grades: { id: string; name: string }[];
  fields: { id: string; gradeId: string; name: string }[];
  subjects: { id: string; gradeId: string; academicFieldId: string | null; name: string }[];
  terms: WizardTerm[];
};

const STEPS = ['نطاق الباقة', 'المدة', 'السعر والرصيد', 'المراجعة والنشر'] as const;

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('ar-JO', { dateStyle: 'medium' }).format(new Date(iso));
}

// The wizard is convenience only: every scope rule, price and provider check
// is re-validated server-side before anything is saved or published.
export function OfferWizard({ catalog }: { catalog: WizardCatalog }) {
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<'SUBJECT' | 'BUNDLE'>('SUBJECT');
  const [gradeId, setGradeId] = useState(catalog.grades[0]?.id ?? '');
  const [fieldId, setFieldId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [bundleIds, setBundleIds] = useState<string[]>([]);
  const [type, setType] = useState<'MONTHLY' | 'SEMESTER'>('MONTHLY');
  const [termId, setTermId] = useState('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('JOD');
  const [credits, setCredits] = useState('200');
  const [planId, setPlanId] = useState('');

  const fields = catalog.fields.filter((field) => field.gradeId === gradeId);

  const eligibleForBundle = useMemo(
    () =>
      catalog.subjects.filter((subject) => {
        if (subject.gradeId !== gradeId) return false;
        if (fieldId) return subject.academicFieldId === null || subject.academicFieldId === fieldId;
        return subject.academicFieldId === null;
      }),
    [catalog.subjects, gradeId, fieldId],
  );

  const selectableSubjects = useMemo(
    () =>
      catalog.subjects.filter((subject) => {
        if (subject.gradeId !== gradeId) return false;
        if (fieldId) return subject.academicFieldId === null || subject.academicFieldId === fieldId;
        return true;
      }),
    [catalog.subjects, gradeId, fieldId],
  );

  const selectableTerms = catalog.terms.filter((term) => {
    if (term.gradeId !== gradeId) return false;
    if (fieldId) return term.academicFieldId === null || term.academicFieldId === fieldId;
    return term.academicFieldId === null;
  });

  const selectedTerm = selectableTerms.find((term) => term.id === termId) ?? null;
  const selectedSubject = selectableSubjects.find((subject) => subject.id === subjectId) ?? null;
  const bundleSubjects = eligibleForBundle.filter((subject) => bundleIds.includes(subject.id));
  const gradeName = catalog.grades.find((grade) => grade.id === gradeId)?.name ?? '';
  const fieldName = fields.find((field) => field.id === fieldId)?.name ?? '';

  const publishIssues: string[] = [];
  if (kind === 'SUBJECT' && !selectedSubject) publishIssues.push('اختر المادة');
  if (kind === 'BUNDLE' && bundleSubjects.length === 0) publishIssues.push('اختر مادة واحدة على الأقل للباقة');
  if (type === 'SEMESTER') {
    if (!selectedTerm) publishIssues.push('اختر فصلًا دراسيًا');
    else {
      if (!selectedTerm.isActive) publishIssues.push('الفصل الدراسي المختار معطّل');
      if (selectedTerm.phase === 'ended') publishIssues.push('الفصل الدراسي المختار انتهى');
    }
  }
  if (!price.trim()) publishIssues.push('أدخل السعر');
  if (!planId.trim()) publishIssues.push('أدخل رقم خطة الدفع في فريميوس');

  const stepReady = (target: number): boolean => {
    if (target <= 1) return true;
    if (step === 1) return kind === 'BUNDLE' ? bundleSubjects.length > 0 : Boolean(selectedSubject);
    return true;
  };

  const canGoNext =
    step === 1 ? (kind === 'BUNDLE' ? bundleSubjects.length > 0 : Boolean(subjectId)) : step === 2 ? type === 'MONTHLY' || Boolean(termId) : true;

  function changeScope(nextGrade: string, nextField: string) {
    setGradeId(nextGrade);
    setFieldId(nextField);
    setSubjectId('');
    setTermId('');
    const eligible = catalog.subjects.filter((subject) => {
      if (subject.gradeId !== nextGrade) return false;
      if (nextField) return subject.academicFieldId === null || subject.academicFieldId === nextField;
      return subject.academicFieldId === null;
    });
    setBundleIds(eligible.map((subject) => subject.id));
  }

  return (
    <FnCard variant="flat" className="fn-wizard">
      <div>
        <h2 className="fn-card__title">إنشاء باقة جديدة</h2>
        <p className="fn-card__text">أربع خطوات بسيطة — بدون أي معرّفات تقنية.</p>
      </div>

      <ol className="fn-wizard__steps">
        {STEPS.map((label, index) => {
          const number = index + 1;
          return (
            <li key={label} className={cn('fn-wizard__step', number === step && 'is-active', number < step && 'is-done')}>
              <button
                type="button"
                className="fn-wizard__step-btn"
                onClick={() => {
                  if (number < step || (number === step + 1 && stepReady(number))) setStep(number);
                }}
                disabled={number > step + 1}
                aria-current={number === step ? 'step' : undefined}
              >
                <span className="fn-wizard__step-num">{number}</span>
                <span className="fn-wizard__step-label">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <form action="/api/admin/subscriptions/offers" method="post" className="fn-wizard__form">
        <div hidden={step !== 1} className="fn-wizard__panel">
          <span className="fn-field__label">ما الذي تشمله الباقة؟</span>
          <div className="fn-wizard__choices">
            <label className={cn('fn-choice', kind === 'SUBJECT' && 'is-chosen')}>
              <input type="radio" name="kind" value="SUBJECT" checked={kind === 'SUBJECT'} onChange={() => setKind('SUBJECT')} />
              <span className="fn-choice__body">
                <span className="fn-choice__title">مادة واحدة</span>
                <span className="fn-caption">اشتراك في مادة محددة</span>
              </span>
              <BadgeCheck className="fn-choice__check" size={18} aria-hidden="true" />
            </label>
            <label className={cn('fn-choice', kind === 'BUNDLE' && 'is-chosen')}>
              <input type="radio" name="kind" value="BUNDLE" checked={kind === 'BUNDLE'} onChange={() => setKind('BUNDLE')} />
              <span className="fn-choice__body">
                <span className="fn-choice__title">جميع المواد</span>
                <span className="fn-caption">باقة واحدة تغطي مواد الصف أو التخصص</span>
              </span>
              <BadgeCheck className="fn-choice__check" size={18} aria-hidden="true" />
            </label>
          </div>

          <div className="fn-grid fn-grid--2">
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="wizard-grade">
                الصف الدراسي
              </label>
              <select className="fn-input" id="wizard-grade" name="gradeId" value={gradeId} onChange={(event) => changeScope(event.target.value, '')}>
                {catalog.grades.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="wizard-field">
                التخصص (اختياري)
              </label>
              <select className="fn-input" id="wizard-field" name="academicFieldId" value={fieldId} onChange={(event) => changeScope(gradeId, event.target.value)}>
                <option value="">بدون تخصص (كل الصف)</option>
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {kind === 'SUBJECT' ? (
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="wizard-subject">
                المادة
              </label>
              <select className="fn-input" id="wizard-subject" name="subjectId" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                <option value="">اختر المادة…</option>
                {selectableSubjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
              {selectableSubjects.length === 0 ? <p className="fn-field__hint">لا توجد مواد لهذا الصف/التخصص.</p> : null}
            </div>
          ) : (
            <div className="fn-field">
              <span className="fn-field__label">المواد التي ستغطيها الباقة</span>
              {eligibleForBundle.length ? (
                <div className="fn-check-grid">
                  {eligibleForBundle.map((subject) => (
                    <label className="fn-check" key={subject.id}>
                      <input
                        type="checkbox"
                        name="bundleSubjectIds"
                        value={subject.id}
                        checked={bundleIds.includes(subject.id)}
                        onChange={(event) =>
                          setBundleIds((previous) =>
                            event.target.checked ? [...previous, subject.id] : previous.filter((id) => id !== subject.id),
                          )
                        }
                      />
                      {subject.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="fn-field__hint">لا توجد مواد مطابقة لهذا الصف/التخصص.</p>
              )}
            </div>
          )}
        </div>

        <div hidden={step !== 2} className="fn-wizard__panel">
          <span className="fn-field__label">نوع الدفع</span>
          <div className="fn-wizard__choices">
            <label className={cn('fn-choice', type === 'MONTHLY' && 'is-chosen')}>
              <input type="radio" name="type" value="MONTHLY" checked={type === 'MONTHLY'} onChange={() => setType('MONTHLY')} />
              <span className="fn-choice__body">
                <span className="fn-choice__title">شهري</span>
                <span className="fn-caption">يتجدد كل شهر — يظهر للمشترك أن التجديد تلقائي.</span>
              </span>
              <RefreshCw className="fn-choice__check" size={18} aria-hidden="true" />
            </label>
            <label className={cn('fn-choice', type === 'SEMESTER' && 'is-chosen')}>
              <input type="radio" name="type" value="SEMESTER" checked={type === 'SEMESTER'} onChange={() => setType('SEMESTER')} />
              <span className="fn-choice__body">
                <span className="fn-choice__title">فصلي</span>
                <span className="fn-caption">دفعة واحدة حتى نهاية الفصل الدراسي المحدد — بدون تجديد تلقائي.</span>
              </span>
              <CalendarDays className="fn-choice__check" size={18} aria-hidden="true" />
            </label>
          </div>

          {type === 'SEMESTER' ? (
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="wizard-term">
                الفصل الدراسي
              </label>
              <select className="fn-input" id="wizard-term" name="academicTermId" value={termId} onChange={(event) => setTermId(event.target.value)}>
                <option value="">اختر الفصل…</option>
                {selectableTerms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name} ({term.phase === 'ongoing' ? 'جارٍ' : term.phase === 'upcoming' ? 'لم يبدأ' : 'منتهٍ'}
                    {term.isActive ? '' : ' · معطّل'})
                  </option>
                ))}
              </select>
              {selectedTerm ? (
                <p className="fn-field__hint">
                  يبدأ في {formatDay(selectedTerm.startsAt)} وينتهي في {formatDay(selectedTerm.endsAt)} — لا يمتد الوصول بعد نهاية
                  الفصل.
                </p>
              ) : (
                <p className="fn-field__hint">لا يمكن نشر باقة فصلية بدون فصل دراسي محدد.</p>
              )}
              {selectableTerms.length === 0 ? <p className="fn-field__hint">لا يوجد فصل مطابق — أنشئ فصلًا من قسم الفصول الدراسية.</p> : null}
            </div>
          ) : null}
        </div>

        <div hidden={step !== 3} className="fn-wizard__panel">
          <div className="fn-grid fn-grid--2">
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="wizard-price">
                السعر
              </label>
              <input className="fn-input" id="wizard-price" name="price" inputMode="decimal" dir="ltr" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="39" />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="wizard-currency">
                العملة المعروضة
              </label>
              <select className="fn-input" id="wizard-currency" name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)} dir="ltr">
                <option value="JOD">JOD — دينار أردني</option>
                <option value="USD">USD — دولار أمريكي</option>
              </select>
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="wizard-credits">
                رصيد فهمني الشهري (كريدت)
              </label>
              <input className="fn-input" id="wizard-credits" name="credits" type="number" min={0} max={100000} dir="ltr" value={credits} onChange={(event) => setCredits(event.target.value)} />
              <p className="fn-field__hint">يُمنح هذا الرصيد كل شهر، ويُشارَك بين كل مواد الباقة عند وجود أكثر من مادة.</p>
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="wizard-plan">
                رقم خطة الدفع في فريميوس
              </label>
              <input className="fn-input" id="wizard-plan" name="freemiusPlanId" dir="ltr" maxLength={64} value={planId} onChange={(event) => setPlanId(event.target.value)} placeholder="من لوحة فريميوس → الخطط" />
              <p className="fn-field__hint">مطلوب للنشر. إنشاء الخطط تلقائيًا يأتي في مرحلة لاحقة.</p>
            </div>
          </div>
          <p className="fn-caption">
            يُحصَّل الدفع عبر فريميوس بعملة خطة الدفع؛ إذا اختلفت عن العملة المعروضة أعلاه فقد يظهر للمشترك مبلغ مختلف عند الدفع.
          </p>
        </div>

        <div hidden={step !== 4} className="fn-wizard__panel">
          <div className="fn-wizard__summary">
            <div className="fn-wizard__summary-row">
              <span className="fn-caption">النطاق</span>
              <strong>
                {kind === 'SUBJECT' ? `مادة واحدة — ${selectedSubject?.name ?? '—'}` : `جميع المواد — ${gradeName}${fieldName ? ` / ${fieldName}` : ''}`}
              </strong>
            </div>
            {kind === 'BUNDLE' ? (
              <div className="fn-wizard__summary-row">
                <span className="fn-caption">المواد المشمولة</span>
                <span className="sub-covered__chips">
                  {bundleSubjects.map((subject) => (
                    <span key={subject.id} className="sub-chip">
                      {subject.name}
                    </span>
                  ))}
                  {bundleSubjects.length === 0 ? <span>—</span> : null}
                </span>
              </div>
            ) : null}
            <div className="fn-wizard__summary-row">
              <span className="fn-caption">المدة</span>
              <strong>
                {type === 'MONTHLY' ? 'شهري متكرر' : `فصلي — ${selectedTerm?.name ?? 'بدون فصل'}`}
                {type === 'SEMESTER' && selectedTerm ? ` (${formatDay(selectedTerm.startsAt)} → ${formatDay(selectedTerm.endsAt)})` : ''}
              </strong>
            </div>
            <div className="fn-wizard__summary-row">
              <span className="fn-caption">السعر</span>
              <strong dir="ltr">
                {price || '—'} {currency}
              </strong>
            </div>
            <div className="fn-wizard__summary-row">
              <span className="fn-caption">الرصيد الشهري</span>
              <strong>{credits || '0'} كريدت</strong>
            </div>
            <div className="fn-wizard__summary-row">
              <span className="fn-caption">خطة فريميوس</span>
              <strong dir="ltr">{planId || 'غير مضبوط'}</strong>
            </div>
            <div className="fn-wizard__summary-row">
              <span className="fn-caption">حالة النشر</span>
              {publishIssues.length === 0 ? (
                <FnBadge variant="mint">جاهز للنشر</FnBadge>
              ) : (
                <FnBadge variant="gold">يحتاج استكمالًا — يمكن حفظه كمسودة</FnBadge>
              )}
            </div>
          </div>
          {publishIssues.length ? (
            <ul className="fn-readiness">
              {publishIssues.map((issue) => (
                <li key={issue}>
                  <CircleAlert size={15} aria-hidden="true" />
                  {issue}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="fn-wizard__footer">
          <div className="fn-row">
            {step > 1 ? (
              <FnButton type="button" variant="ghost" onClick={() => setStep((current) => current - 1)}>
                السابق
              </FnButton>
            ) : null}
            {step < 4 ? (
              <FnButton type="button" onClick={() => setStep((current) => current + 1)} disabled={!canGoNext}>
                التالي
              </FnButton>
            ) : null}
          </div>
          {step === 4 ? (
            <div className="fn-row">
              <FnButton type="submit" name="intent" value="draft" variant="soft">
                حفظ كمسودة
              </FnButton>
              <FnButton type="submit" name="intent" value="publish" disabled={publishIssues.length > 0}>
                نشر الباقة
              </FnButton>
            </div>
          ) : null}
        </div>
      </form>
    </FnCard>
  );
}
