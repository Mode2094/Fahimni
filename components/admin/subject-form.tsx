import Link from "next/link";

import { FnButton } from "@/components/fahimni";
import { ImageField } from "@/components/admin/image-field";
import { DEFAULT_CURRENCY, formatMinorAmount } from "@/lib/admin/money";
import type { FieldRecord, GradeRecord, SubjectRecord } from "@/lib/admin/store";

export function SubjectForm({
  action,
  subject,
  grades,
  fields,
}: {
  action: string;
  subject?: SubjectRecord;
  grades: GradeRecord[];
  fields: FieldRecord[];
}) {
  const currency = subject?.currency ?? DEFAULT_CURRENCY;

  return (
    <form action={action} method="post" className="fn-stack">
      <div className="fn-field">
        <label className="fn-field__label" htmlFor="name">
          اسم المادة
        </label>
        <input
          className="fn-input"
          id="name"
          name="name"
          defaultValue={subject?.name ?? ""}
          required
          minLength={2}
          maxLength={80}
        />
      </div>
      <div className="fn-field">
        <label className="fn-field__label" htmlFor="slug">
          الرابط المختصر (slug)
        </label>
        <input
          className="fn-input"
          id="slug"
          name="slug"
          dir="ltr"
          defaultValue={subject?.slug ?? ""}
          required
          maxLength={60}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="tawjihi-math"
        />
      </div>
      <div className="fn-field">
        <label className="fn-field__label" htmlFor="shortDescription">
          الوصف المختصر
        </label>
        <textarea
          className="fn-textarea"
          id="shortDescription"
          name="shortDescription"
          maxLength={300}
          defaultValue={subject?.shortDescription ?? ""}
          rows={3}
        />
      </div>
      <ImageField
        name="image"
        label="صورة المادة"
        defaultValue={subject?.image ?? ""}
        hint="JPG أو PNG أو WebP — حتى 5 ميجابايت. اتركها فارغة لعرض أيقونة المادة الافتراضية."
      />
      <div className="fn-field">
        <label className="fn-field__label" htmlFor="gradeId">
          الصف
        </label>
        <select className="fn-select" id="gradeId" name="gradeId" defaultValue={subject?.gradeId ?? ""} required>
          <option value="" disabled>
            اختر الصف
          </option>
          {grades.map((grade) => (
            <option key={grade.id} value={grade.id}>
              {grade.name}
              {grade.isActive ? "" : " (معطّل)"}
            </option>
          ))}
        </select>
      </div>
      <div className="fn-field">
        <label className="fn-field__label" htmlFor="academicFieldId">
          الحقل الدراسي (اختياري)
        </label>
        <select className="fn-select" id="academicFieldId" name="academicFieldId" defaultValue={subject?.academicFieldId ?? ""}>
          <option value="">بدون حقل — تنطبق على كل حقول الصف</option>
          {fields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.gradeName} — {field.name}
            </option>
          ))}
        </select>
        <p className="fn-field__hint">يجب أن يتبع الحقل نفس الصف المختار، وإلا سيُرفض الحفظ.</p>
      </div>
      <div className="fn-field">
        <label className="fn-field__label" htmlFor="sortOrder">
          الترتيب
        </label>
        <input
          className="fn-input"
          id="sortOrder"
          name="sortOrder"
          type="number"
          min={0}
          max={9999}
          defaultValue={subject?.sortOrder ?? 0}
        />
      </div>

      <fieldset className="fn-fieldset">
        <legend className="fn-legend">الأسعار (تحضير للاشتراكات — بدون دفع)</legend>
        <div className="fn-field">
          <label className="fn-field__label" htmlFor="monthlyPrice">
            السعر الشهري
          </label>
          <input
            className="fn-input"
            id="monthlyPrice"
            name="monthlyPrice"
            inputMode="decimal"
            dir="ltr"
            defaultValue={formatMinorAmount(subject?.monthlyPriceMinor, currency)}
            placeholder="39"
          />
        </div>
        <div className="fn-field">
          <label className="fn-field__label" htmlFor="semesterPrice">
            سعر الفصل
          </label>
          <input
            className="fn-input"
            id="semesterPrice"
            name="semesterPrice"
            inputMode="decimal"
            dir="ltr"
            defaultValue={formatMinorAmount(subject?.semesterPriceMinor, currency)}
            placeholder="99"
          />
        </div>
        <div className="fn-field">
          <label className="fn-field__label" htmlFor="currency">
            العملة
          </label>
          <input
            className="fn-input"
            id="currency"
            name="currency"
            dir="ltr"
            maxLength={3}
            defaultValue={currency}
            placeholder="JOD"
          />
          <p className="fn-field__hint">تُخزَّن المبالغ كوحدات صغيرة صحيحة (فلس) بدون كسور عشرية.</p>
        </div>
      </fieldset>

      <label className="fn-check">
        <input type="checkbox" name="isActive" defaultChecked={subject ? subject.isActive : true} />
        المادة نشطة وتظهر للطلاب
      </label>
      <label className="fn-check">
        <input type="checkbox" name="isFeatured" defaultChecked={subject ? subject.isFeatured : false} />
        مادة مميزة
      </label>

      <div className="fn-row">
        <FnButton type="submit">حفظ</FnButton>
        <FnButton asChild variant="ghost">
          <Link href="/admin/subjects">إلغاء</Link>
        </FnButton>
      </div>
    </form>
  );
}
