"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CreditCard, FolderTree, GraduationCap, LayoutDashboard, Settings, Users, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type AdminNavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin", label: "الرئيسية", icon: LayoutDashboard, exact: true },
  { href: "/admin/students", label: "الطلاب", icon: Users },
  { href: "/admin/grades", label: "الصفوف", icon: GraduationCap },
  { href: "/admin/fields", label: "الحقول", icon: FolderTree },
  { href: "/admin/subjects", label: "المواد", icon: BookOpen },
  { href: "/admin/subscriptions", label: "الاشتراكات", icon: CreditCard },
  { href: "/admin/settings", label: "الإعدادات", icon: Settings },
];

export function AdminNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className={cn("fn-admin-nav", collapsed && "is-collapsed")} aria-label="أقسام لوحة الإدارة">
      {ADMIN_NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn("fn-admin-nav__link", active && "is-active")}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            onClick={onNavigate}
          >
            <Icon size={18} aria-hidden="true" className="fn-admin-nav__icon" />
            <span className="fn-admin-nav__label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
