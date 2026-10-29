"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Light polling for the success page: the entitlement is only ever written by
// the verified Freemius webhook, so this simply refreshes server data.
export function EntitlementPoller({ intervalMs = 4000, maxAttempts = 15 }: { intervalMs?: number; maxAttempts?: number }) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (attempts >= maxAttempts) return;
    const timer = setTimeout(() => {
      router.refresh();
      setAttempts((value) => value + 1);
    }, intervalMs);
    return () => clearTimeout(timer);
  }, [attempts, intervalMs, maxAttempts, router]);

  if (attempts >= maxAttempts) {
    return <p className="fn-caption">لم يصل تأكيد الدفع بعد. حدّث الصفحة بعد قليل أو تواصل مع الدعم.</p>;
  }
  return <p className="fn-caption">يتم التحقق تلقائيًا من حالة الاشتراك…</p>;
}
