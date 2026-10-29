import Link from "next/link";

import { FnButton } from "@/components/fahimni";
import type { FieldRecord, GradeRecord } from "@/lib/admin/store";

export function FieldForm({
  action,
  field,
  grades,
}: {
  action: string;
  field?: FieldRecord;
  grades: GradeRecord[];
}) {
  return (
    <form action={action} method="post" className="fn-stack">
      <div className="fn-field">
        <label className="fn-field__label" htmlFor="gradeId">
          الصف
        </label>
        <select className="fn-select" id="gradeId" name="gradeId" defaultValue={field?.gradeId ?? ""} required>
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
        <label className="fn-field__label" htmlFor="name">
          اسم الحقل
        </label>
        <input
          className="fn-input"
          id="name"
          name="name"
          defaultValue={field?.name ?? ""}
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
          defaultValue={field?.slug ?? ""}
          required
          maxLength={60}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="scientific"
        />
        <p className="fn-field__hint">حروف إنجليزية صغيرة وأرقام وشرطات فقط.</p>
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
          defaultValue={field?.sortOrder ?? 0}
        />
      </div>
      <label className="fn-check">
        <input type="checkbox" name="isActive" defaultChecked={field ? field.isActive : true} />
        الحقل نشط ويظهر للطلاب
      </label>
      <div className="fn-row">
        <FnButton type="submit">حفظ</FnButton>
        <FnButton asChild variant="ghost">
          <Link href="/admin/fields">إلغاء</Link>
        </FnButton>
      </div>
    </form>
  );
}
