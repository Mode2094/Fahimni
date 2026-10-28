import { RefreshCw, Trash2, Upload } from "lucide-react";

import { FnBadge, FnButton, FnCard } from "@/components/fahimni";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";
import { bookErrorText, bookStatusLabel, formatBookDate, formatFileSize } from "@/lib/books/messages";
import type { BookRecord, BookStatus } from "@/lib/books/store";

const STATUS_BADGE: Record<BookStatus, "mint" | "sky" | "outline" | "danger"> = {
  READY: "mint",
  PROCESSING: "sky",
  UPLOADED: "outline",
  FAILED: "danger",
};

export function BookPanel({
  subjectId,
  book,
  sizeBytes,
}: {
  subjectId: string;
  book: BookRecord | null;
  sizeBytes: number | null;
}) {
  const processing = book?.status === "PROCESSING" || book?.status === "UPLOADED";
  const percent = book && book.totalPages > 0 ? Math.min(100, Math.round((book.indexedPages / book.totalPages) * 100)) : 0;

  return (
    <FnCard variant="flat" className="fn-stack">
      <div className="fn-card__head">
        <div>
          <h2 className="fn-card__title">الكتاب</h2>
          <p className="fn-card__text">
            ارفع كتاب المادة مرة واحدة؛ يخزّنه النظام ويفهرسه، ثم يستخدمه المعلّم الذكي لجميع طلاب المادة.
          </p>
        </div>
        {book ? <FnBadge variant={STATUS_BADGE[book.status]}>{bookStatusLabel(book.status)}</FnBadge> : null}
      </div>

      {book ? (
        <>
          {processing ? <AutoRefresh /> : null}

          <div className="fn-grid fn-grid--2">
            <div className="fn-stack fn-stack--sm">
              <span className="fn-caption">الملف</span>
              <span dir="ltr">{book.originalFileName}</span>
            </div>
            <div className="fn-stack fn-stack--sm">
              <span className="fn-caption">الحجم</span>
              <span>{formatFileSize(sizeBytes)}</span>
            </div>
            <div className="fn-stack fn-stack--sm">
              <span className="fn-caption">الصفحات المفهرسة</span>
              <span>
                {book.indexedPages} / {book.totalPages || "؟"}
              </span>
            </div>
            <div className="fn-stack fn-stack--sm">
              <span className="fn-caption">تاريخ الرفع</span>
              <span>{formatBookDate(book.createdAt)}</span>
            </div>
          </div>

          {processing ? (
            <div className="fn-stack fn-stack--sm">
              <div className="fn-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                <div className="fn-progress__bar" style={{ inlineSize: `${percent}%` }} />
              </div>
              <span className="fn-caption">{book.status === "PROCESSING" ? "جاري تجهيز الكتاب…" : "بانتظار بدء الفهرسة…"}</span>
            </div>
          ) : null}

          {book.status === "READY" ? <p className="fn-alert fn-alert--success">الكتاب جاهز للاستخدام.</p> : null}
          {book.status === "READY" && book.errorMessage === "low_text" ? (
            <p className="fn-alert fn-alert--error">{bookErrorText("low_text")}</p>
          ) : null}
          {book.status === "FAILED" ? (
            <p className="fn-alert fn-alert--error">{bookErrorText(book.errorMessage)}</p>
          ) : null}

          <div className="fn-row fn-row--wrap">
            <form action={`/api/admin/books/${book.id}/reindex`} method="post">
              <FnButton type="submit" variant="soft" size="sm" disabled={book.status === "PROCESSING"}>
                <RefreshCw size={15} aria-hidden="true" />
                إعادة الفهرسة
              </FnButton>
            </form>
            <form action={`/api/admin/books/${book.id}/delete`} method="post">
              <ConfirmSubmit
                size="sm"
                variant="danger"
                message="سيتم حذف الكتاب المفهرس وصور صفحاته نهائيًا. هل أنت متأكد؟"
              >
                <Trash2 size={15} aria-hidden="true" />
                حذف الكتاب
              </ConfirmSubmit>
            </form>
          </div>

          <form
            action={`/api/admin/subjects/${subjectId}/book`}
            method="post"
            encType="multipart/form-data"
            className="fn-stack"
          >
            <input type="hidden" name="replace" value="on" />
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="replace-file">
                استبدال الكتاب (PDF بحد أقصى ١٠٠ ميغابايت)
              </label>
              <input className="fn-input" id="replace-file" name="file" type="file" accept="application/pdf,.pdf" required />
              <p className="fn-field__hint">يُعاد رفع الملف ثم تُستبدل الفهارس القديمة بعد نجاح الفهرسة.</p>
            </div>
            <div className="fn-row">
              <FnButton type="submit" variant="outline" size="sm">
                <Upload size={15} aria-hidden="true" />
                استبدال الكتاب
              </FnButton>
            </div>
          </form>
        </>
      ) : (
        <form
          action={`/api/admin/subjects/${subjectId}/book`}
          method="post"
          encType="multipart/form-data"
          className="fn-stack"
        >
          <div className="fn-field">
            <label className="fn-field__label" htmlFor="book-file">
              ملف PDF (بحد أقصى ١٠٠ ميغابايت)
            </label>
            <input className="fn-input" id="book-file" name="file" type="file" accept="application/pdf,.pdf" required />
          </div>
          <div className="fn-field">
            <label className="fn-field__label" htmlFor="book-title">
              عنوان الكتاب (اختياري)
            </label>
            <input className="fn-input" id="book-title" name="title" maxLength={120} />
          </div>
          <div className="fn-row">
            <FnButton type="submit">
              <Upload size={16} aria-hidden="true" />
              رفع الكتاب
            </FnButton>
          </div>
        </form>
      )}
    </FnCard>
  );
}
