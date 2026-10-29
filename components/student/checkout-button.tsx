"use client";

import { useState } from "react";

import { FnButton } from "@/components/fahimni";
import type { PlanType } from "@/lib/billing/store";

export function CheckoutButton({
  subjectId,
  planType,
  label = "اشترك الآن",
  variant = "primary",
}: {
  subjectId: string;
  planType: PlanType;
  label?: string;
  variant?: "primary" | "soft" | "outline";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, planType }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "تعذر بدء عملية الدفع.");
      window.location.href = data.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر بدء عملية الدفع.");
      setBusy(false);
    }
  }

  return (
    <div className="fn-stack fn-stack--sm">
      <FnButton type="button" block variant={variant} onClick={start} disabled={busy}>
        {busy ? "جاري التحويل إلى الدفع…" : label}
      </FnButton>
      {error ? (
        <span className="fn-alert fn-alert--error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
