import { CalendarRange, Plus } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { AdminStatusBadge } from '@/components/admin/admin-ui';
import { formatMinor } from '@/lib/admin/money';
import type { AcademicTermRecord } from '@/lib/billing/store';
import { calendarDateInAmman, formatTermDate, termPhase } from '@/lib/billing/terms';

const PHASE_LABELS = { upcoming: 'لم يبدأ', ongoing: 'جارٍ', ended: 'منتهٍ' } as const;

export type TermOfferSummary = {
  id: string;
  title: string;
  priceMinor: number | null;
  currency: string;
  isActive: boolean;
  ready: boolean;
};

export function TermsSection({
  terms,
  grades,
  fields,
  gradeName,
  soldCounts,
  offersByTerm,
  now,
}: {
  terms: AcademicTermRecord[];
  grades: { id: string; name: string }[];
  fields: { id: string; gradeId: string; name: string }[];
  gradeName: Map<string, string>;
  soldCounts: Map<string, number>;
  offersByTerm: Map<string, TermOfferSummary[]>;
  now: Date;
}) {
  return (
    <div className="fn-stack fn-stack--lg">
      <FnCard variant="flat" className="fn-stack">
        <div className="fn-row">
          <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--sky">
            <Plus size={18} aria-hidden="true" />
          </span>
          <div className="fn-stack fn-stack--sm">
            <h2 className="fn-card__title">إضافة فصل دراسي</h2>
            <p className="fn-card__text">
              تُفسَّر التواريخ بتوقيت الأردن (Asia/Amman). الاشتراك الفصلي ينتهي دائمًا بنهاية الفصل ولا يمتد بعده.
            </p>
          </div>
        </div>
        <form action="/api/admin/subscriptions/terms" method="post" className="fn-stack">
          <div className="fn-grid fn-grid--2">
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="new-term-name">
                اسم الفصل
              </label>
              <input className="fn-input" id="new-term-name" name="name" required maxLength={80} placeholder="الفصل الأول" />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="new-term-year">
                العام الدراسي
              </label>
              <input className="fn-input" id="new-term-year" name="academicYear" required maxLength={20} dir="ltr" placeholder="2026/2027" />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="new-term-grade">
                الصف
              </label>
              <select className="fn-input" id="new-term-grade" name="gradeId" required>
                {grades.map((grade) => (
                  <option key={grade.id} value={grade.id}>
                    {grade.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="new-term-field">
                التخصص (اختياري)
              </label>
              <select className="fn-input" id="new-term-field" name="academicFieldId">
                <option value="">بدون تخصص (كل الصف)</option>
                {fields.map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name} — {gradeName.get(field.gradeId) ?? ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="new-term-start">
                تاريخ البداية
              </label>
              <input className="fn-input" id="new-term-start" name="startDate" type="date" required dir="ltr" />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="new-term-end">
                تاريخ النهاية
              </label>
              <input className="fn-input" id="new-term-end" name="endDate" type="date" required dir="ltr" />
            </div>
          </div>
          <label className="fn-check">
            <input type="checkbox" name="isActive" defaultChecked />
            مفعّل
          </label>
          <div className="fn-row">
            <FnButton type="submit" size="sm">
              إضافة الفصل
            </FnButton>
          </div>
        </form>
      </FnCard>

      {terms.length ? (
        <div className="fn-stack">
          {terms.map((term) => {
            const phase = termPhase(term.startsAt, term.endsAt, now);
            const connected = offersByTerm.get(term.id) ?? [];
            const sold = soldCounts.get(term.id) ?? 0;
            return (
              <FnCard key={term.id} variant="flat" className="fn-stack fn-term-card">
                <div className="fn-card__head">
                  <div>
                    <span className="fn-card__title">
                      {term.name} · {term.academicYear}
                    </span>
                    <p className="fn-caption">
                      {gradeName.get(term.gradeId) ?? 'صف'}
                      {term.academicFieldId ? ` / ${fields.find((field) => field.id === term.academicFieldId)?.name ?? ''}` : ''} ·{' '}
                      {formatTermDate(term.startsAt)} — {formatTermDate(term.endsAt)}
                    </p>
                  </div>
                  <div className="fn-row fn-row--wrap">
                    <FnBadge variant={phase === 'ongoing' ? 'mint' : phase === 'upcoming' ? 'sky' : 'outline'}>{PHASE_LABELS[phase]}</FnBadge>
                    <AdminStatusBadge active={term.isActive} />
                  </div>
                </div>

                <div className="fn-row fn-row--wrap">
                  <FnBadge variant="outline">{sold} اشتراك مباع</FnBadge>
                  <FnBadge variant={connected.length ? 'sky' : 'outline'}>{connected.length} عرض مرتبط</FnBadge>
                  <form action={`/api/admin/subscriptions/terms/${term.id}`} method="post">
                    <input type="hidden" name="intent" value="toggle" />
                    <FnButton type="submit" variant="soft" size="sm">
                      {term.isActive ? 'تعطيل الفصل' : 'تفعيل الفصل'}
                    </FnButton>
                  </form>
                </div>

                <details className="fn-details">
                  <summary>تعديل بيانات الفصل</summary>
                  <form action={`/api/admin/subscriptions/terms/${term.id}`} method="post" className="fn-stack fn-details__body">
                    <div className="fn-grid fn-grid--2">
                      <div className="fn-field">
                        <label className="fn-field__label" htmlFor={`term-name-${term.id}`}>
                          اسم الفصل
                        </label>
                        <input className="fn-input" id={`term-name-${term.id}`} name="name" required maxLength={80} defaultValue={term.name} />
                      </div>
                      <div className="fn-field">
                        <label className="fn-field__label" htmlFor={`term-year-${term.id}`}>
                          العام الدراسي
                        </label>
                        <input className="fn-input" id={`term-year-${term.id}`} name="academicYear" required maxLength={20} dir="ltr" defaultValue={term.academicYear} />
                      </div>
                      <div className="fn-field">
                        <label className="fn-field__label" htmlFor={`term-grade-${term.id}`}>
                          الصف
                        </label>
                        <select className="fn-input" id={`term-grade-${term.id}`} name="gradeId" defaultValue={term.gradeId}>
                          {grades.map((grade) => (
                            <option key={grade.id} value={grade.id}>
                              {grade.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="fn-field">
                        <label className="fn-field__label" htmlFor={`term-field-${term.id}`}>
                          التخصص (اختياري)
                        </label>
                        <select className="fn-input" id={`term-field-${term.id}`} name="academicFieldId" defaultValue={term.academicFieldId ?? ''}>
                          <option value="">بدون تخصص (كل الصف)</option>
                          {fields.map((field) => (
                            <option key={field.id} value={field.id}>
                              {field.name} — {gradeName.get(field.gradeId) ?? ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="fn-field">
                        <label className="fn-field__label" htmlFor={`term-start-${term.id}`}>
                          تاريخ البداية
                        </label>
                        <input className="fn-input" id={`term-start-${term.id}`} name="startDate" type="date" required dir="ltr" defaultValue={calendarDateInAmman(term.startsAt)} />
                      </div>
                      <div className="fn-field">
                        <label className="fn-field__label" htmlFor={`term-end-${term.id}`}>
                          تاريخ النهاية
                        </label>
                        <input className="fn-input" id={`term-end-${term.id}`} name="endDate" type="date" required dir="ltr" defaultValue={calendarDateInAmman(term.endsAt)} />
                      </div>
                    </div>
                    {sold > 0 ? (
                      <>
                        <p className="fn-caption">
                          يوجد {sold} اشتراك مباع مرتبط بهذا الفصل. تغيير التواريخ يتطلب تأكيدًا صريحًا، وتبقى الحدود التعاقدية للاشتراكات المباعة
                          محفوظة كما هي.
                        </p>
                        <label className="fn-check">
                          <input type="checkbox" name="confirmDates" />
                          أؤكد تغيير التواريخ مع الحفاظ على الحدود التعاقدية للمشتركين الحاليين
                        </label>
                      </>
                    ) : null}
                    <label className="fn-check">
                      <input type="checkbox" name="isActive" defaultChecked={term.isActive} />
                      مفعّل
                    </label>
                    <div className="fn-row">
                      <FnButton type="submit" size="sm">
                        حفظ الفصل
                      </FnButton>
                    </div>
                  </form>
                </details>

                <details className="fn-details">
                  <summary>العروض المرتبطة ({connected.length})</summary>
                  <div className="fn-details__body">
                    {connected.length ? (
                      <ul className="fn-readiness">
                        {connected.map((offer) => (
                          <li key={offer.id}>
                            <CalendarRange size={15} aria-hidden="true" />
                            <a href={`/admin/subscriptions?section=offers#offer-${offer.id}`}>{offer.title}</a>
                            <span className="fn-caption" dir="ltr">
                              {formatMinor(offer.priceMinor, offer.currency)}
                            </span>
                            <FnBadge variant={offer.ready && offer.isActive ? 'mint' : 'outline'}>
                              {offer.ready ? (offer.isActive ? 'جاهز' : 'مسودة جاهزة') : 'يحتاج إعداد'}
                            </FnBadge>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="fn-caption">لا توجد عروض مرتبطة بهذا الفصل بعد.</p>
                    )}
                  </div>
                </details>
              </FnCard>
            );
          })}
        </div>
      ) : (
        <FnCard variant="flat" className="fn-empty">
          <p className="fn-empty__title">لا توجد فصول دراسية بعد</p>
          <p className="fn-empty__text">أضف فصلًا ليصبح الاشتراك الفصلي متاحًا للطلاب.</p>
        </FnCard>
      )}
    </div>
  );
}
