"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { ImageIcon, Link2, Loader2, Trash2, Upload } from "lucide-react";

import { FnButton } from "@/components/fahimni";

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

const ERROR_MESSAGES: Record<string, string> = {
  missing: "اختر ملف صورة أولًا.",
  invalid_file: "الملف ليس صورة صالحة (JPG أو PNG أو WebP).",
  too_large: "حجم الصورة كبير جدًا (الحد 5 ميجابايت).",
  dimensions: "أبعاد الصورة غير مدعومة (بين 16 و6000 بكسل).",
  rate_limited: "محاولات رفع كثيرة. انتظر قليلًا ثم أعد المحاولة.",
  storage: "تعذر حفظ الصورة. حاول مرة أخرى.",
  network: "فشل الاتصال. تحقق من الشبكة ثم أعد المحاولة.",
  session: "انتهت الجلسة. أعد تسجيل الدخول ثم أعد المحاولة.",
};

export function ImageField({
  name,
  label,
  hint,
  defaultValue,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string | null;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showUrl, setShowUrl] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/admin/uploads/image", { method: "POST", body });
      const data = (await response.json().catch(() => null)) as { ok?: boolean; url?: string; error?: string } | null;
      if (response.status === 401) {
        setError(ERROR_MESSAGES.session);
        return;
      }
      if (!response.ok || !data?.ok || !data.url) {
        setError(ERROR_MESSAGES[data?.error ?? ""] ?? ERROR_MESSAGES.invalid_file);
        return;
      }
      setValue(data.url);
    } catch {
      setError(ERROR_MESSAGES.network);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fn-image-field">
      <span className="fn-field__label">{label}</span>
      <div className="fn-image-field__row">
        <div className="fn-image-field__preview">
          {value ? <img src={value} alt="معاينة الصورة" /> : <ImageIcon size={28} aria-hidden="true" />}
        </div>
        <div className="fn-image-field__controls">
          <div className="fn-image-field__actions">
            <FnButton type="button" variant="soft" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <Loader2 size={16} className="fn-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
              {busy ? "جارٍ الرفع…" : value ? "استبدال الصورة" : "رفع صورة"}
            </FnButton>
            {value ? (
              <FnButton
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setValue("");
                  setError(null);
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
                إزالة
              </FnButton>
            ) : null}
            <FnButton type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setShowUrl((open) => !open)} aria-expanded={showUrl}>
              <Link2 size={16} aria-hidden="true" />
              رابط صورة
            </FnButton>
          </div>
          {showUrl ? (
            <div className="fn-image-field__url">
              <label className="fn-field__label" htmlFor={`${name}-url`}>
                رابط أو مسار داخل الموقع
              </label>
              <input
                className="fn-input"
                id={`${name}-url`}
                dir="ltr"
                value={value}
                placeholder="/book/8.jpg أو https://…"
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
              />
            </div>
          ) : null}
          {hint ? <p className="fn-field__hint">{hint}</p> : null}
        </div>
      </div>
      {error ? (
        <p className="fn-alert fn-alert--error" role="alert">
          {error}
        </p>
      ) : null}
      <input ref={fileRef} type="file" accept={ACCEPTED_TYPES} className="fn-visually-hidden" onChange={onFileChange} tabIndex={-1} aria-hidden="true" />
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
