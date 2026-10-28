import Link from "next/link";
import { BookOpen, Calculator, ChevronLeft } from "lucide-react";

import { FnButton } from "@/components/fahimni";
import type { SubjectAccessState } from "@/lib/billing/access-map";
import type { CatalogSubject } from "@/lib/student/store";
import { cn } from "@/lib/utils";

import { TrialClaimButton } from "./trial-claim-button";

const ACCESS_UI: Record<SubjectAccessState, { badge: string; action: string | null; mode: "tutor" | "claim" | "subscription" | "disabled" }> = {
  paid: { badge: "مشترك", action: "ادخل السبورة", mode: "tutor" },
  bundle: { badge: "ضمن باقتك", action: "ادخل السبورة", mode: "tutor" },
  trial: { badge: "تجربة مجانية", action: "جرّب السبورة", mode: "tutor" },
  "trial-eligible": { badge: "تجربة متاحة", action: "ابدأ التجربة المجانية", mode: "claim" },
  expired: { badge: "منتهي", action: "عرض الاشتراكات", mode: "subscription" },
  none: { badge: "غير مشترك", action: "عرض الاشتراكات", mode: "subscription" },
  book: { badge: "الكتاب قيد التجهيز", action: null, mode: "disabled" },
};

export function SubjectIcon({ slug, size = 22 }: { slug: string; size?: number }) {
  return slug.includes("math") ? <Calculator size={size} aria-hidden="true" /> : <BookOpen size={size} aria-hidden="true" />;
}

// One card per subject. Cards with a usable tutor are fully clickable links;
// other states expose their single contextual action (secure trial activation,
// subscription offers, or an honest book-not-ready notice).
export function SubjectCard({
  subject,
  state,
  siteKey,
  className,
}: {
  subject: CatalogSubject;
  state: SubjectAccessState;
  siteKey?: string | null;
  className?: string;
}) {
  const ui = ACCESS_UI[state];
  const tutorHref = `/app/subjects/${subject.slug}/tutor`;

  const head = (
    <>
      <span className={cn("subject-card__badge", `subject-card__badge--${state}`)}>{ui.badge}</span>
      {subject.image ? (
        <span className="subject-card__image">
          <img src={subject.image} alt={subject.name} />
        </span>
      ) : (
        <span className="subject-card__icon">
          <SubjectIcon slug={subject.slug} size={26} />
        </span>
      )}
      <span className="subject-card__title">{subject.name}</span>
      {subject.shortDescription ? <span className="subject-card__text">{subject.shortDescription}</span> : null}
    </>
  );

  if (ui.mode === "tutor") {
    return (
      <Link href={tutorHref} className={cn("subject-card", className)} aria-label={`${ui.action} — ${subject.name}`}>
        {head}
        <span className="subject-card__cta">
          {ui.action}
          <ChevronLeft size={16} aria-hidden="true" />
        </span>
      </Link>
    );
  }

  return (
    <div className={cn("subject-card subject-card--static", state === "book" && "subject-card--book", className)}>
      {head}
      {ui.mode === "claim" ? (
        <TrialClaimButton siteKey={siteKey ?? null} label={ui.action ?? undefined} afterClaimHref={tutorHref} />
      ) : ui.mode === "subscription" ? (
        <FnButton asChild block size="sm" variant="outline">
          <Link href="/app/subscription">{ui.action}</Link>
        </FnButton>
      ) : (
        <FnButton type="button" block size="sm" disabled>
          {ui.badge}
        </FnButton>
      )}
    </div>
  );
}
