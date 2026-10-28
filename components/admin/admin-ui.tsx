import type { ReactNode } from "react";

import { FnBadge } from "@/components/fahimni";
import type { AdminMessage } from "@/lib/admin/messages";

export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="fn-page-header">
      <div>
        <h1 className="fn-page-header__title">{title}</h1>
        {description ? <p className="fn-page-header__text">{description}</p> : null}
      </div>
      {action ? <div className="fn-row">{action}</div> : null}
    </header>
  );
}

export function AdminMessage({ message }: { message: AdminMessage | null }) {
  if (!message) return null;
  return (
    <p className={`fn-alert ${message.type === "success" ? "fn-alert--success" : "fn-alert--error"}`} role="status">
      {message.text}
    </p>
  );
}

export function AdminStatusBadge({ active }: { active: boolean }) {
  return <FnBadge variant={active ? "mint" : "outline"}>{active ? "نشط" : "معطّل"}</FnBadge>;
}

export function AdminFeaturedBadge({ featured }: { featured: boolean }) {
  return <FnBadge variant={featured ? "gold" : "outline"}>{featured ? "مميزة" : "غير مميزة"}</FnBadge>;
}
