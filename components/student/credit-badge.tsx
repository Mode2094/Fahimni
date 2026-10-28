import Link from "next/link";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export function CreditBadge({
  balance,
  resetAt,
  label = "رصيدك",
  hint,
  href = "/app/subscription",
  className,
}: {
  balance: number;
  resetAt?: Date | null;
  label?: string;
  hint?: string;
  href?: string;
  className?: string;
}) {
  const title = resetAt ? `${label}: ${balance} · يتجدد في ${resetAt.toLocaleDateString("ar-JO")}` : `${label}: ${balance}`;
  return (
    <Link href={href} className={cn("credit-badge", className)} title={title}>
      <Sparkles size={14} aria-hidden="true" />
      <span>{label}</span>
      <strong>{balance}</strong>
      {hint ? <span className="credit-badge__hint">· {hint}</span> : null}
    </Link>
  );
}
