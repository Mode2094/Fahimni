import Link from "next/link";

import { FnButton } from "@/components/fahimni";
import type { GradeRecord } from "@/lib/admin/store";

export function GradeForm({ action, grade }: { action: string; grade?: GradeRecord }) {
  return (
    <form action={action} method="post" className="fn-stack">
      <div className="fn-field">
        <label className="fn-field__label" htmlFor="name">
          اسم الصف
        </label>
        <input
          className="fn-input"
          id="name"
          name="name"
          defaultValue={grade?.name ?? ""}
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
          defaultValue={grade?.slug ?? ""}
          required
          maxLength={60}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="grade-12"
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
          defaultValue={grade?.sortOrder ?? 0}
        />
      </div>
      <label className="fn-check">
        <input type="checkbox" name="isActive" defaultChecked={grade ? grade.isActive : true} />
        الصف نشط ويظهر للطلاب
      </label>
      <div className="fn-row">
        <FnButton type="submit">حفظ</FnButton>
        <FnButton asChild variant="ghost">
          <Link href="/admin/grades">إلغاء</Link>
        </FnButton>
      </div>
    </form>
  );
}
