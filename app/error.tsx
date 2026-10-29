"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

import { FnButton, FnCard } from "@/components/fahimni";
import { FahimniMark } from "@/components/fahimni/logo";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Digest only: never surface stack traces or internal details to students.
    console.error("[app] rendering error", error.digest ?? "");
  }, [error]);

  return (
    <div className="fn-root fn-page">
      <main className="fn-page__main">
        <div className="fn-container">
          <FnCard variant="flat" className="fn-center fn-card--centered">
            <FahimniMark size={64} />
            <p className="fn-empty__title">حدث خطأ غير متوقع</p>
            <p className="fn-empty__text">حاول تحديث الصفحة، أو عد لاحقًا.</p>
            <div className="fn-row">
              <FnButton type="button" onClick={reset}>
                <RotateCcw size={16} aria-hidden="true" />
                إعادة المحاولة
              </FnButton>
              <FnButton asChild variant="ghost">
                <Link href="/">الرئيسية</Link>
              </FnButton>
            </div>
          </FnCard>
        </div>
      </main>
    </div>
  );
}
