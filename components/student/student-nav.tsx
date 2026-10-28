"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Crown, Home, Monitor, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { FnTabBar, FnTabBarItem } from "@/components/fahimni";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Home;
  whiteboard?: boolean;
};

// The whiteboard entry point is resolved server-side per student: exactly one
// visible subject opens its tutor, otherwise subject selection comes first.
function navItems(whiteboardHref: string): NavItem[] {
  return [
    { href: "/app", label: "الرئيسية", icon: Home },
    { href: "/app/subjects", label: "المواد", icon: BookOpen },
    { href: whiteboardHref, label: "السبورة", icon: Monitor, whiteboard: true },
    { href: "/app/subscription", label: "اشتراكي", icon: Crown },
    { href: "/app/account", label: "حسابي", icon: User },
  ];
}

function isTutorRoute(pathname: string): boolean {
  return pathname.endsWith('/tutor');
}

// On a classroom route only "السبورة" is active: "المواد" must not stay
// highlighted just because tutor routes live under /app/subjects/.
function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.whiteboard) return isTutorRoute(pathname);
  if (isTutorRoute(pathname)) return false;
  if (item.href === "/app") return pathname === "/app";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function StudentNavLinks({ whiteboardHref }: { whiteboardHref: string }) {
  const pathname = usePathname();
  return (
    <nav className="fn-nav-links" aria-label="التنقل الرئيسي">
      {navItems(whiteboardHref).map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.label}
            href={item.href}
            className={cn("fn-nav-link", isActivePath(pathname, item) && "is-active")}
          >
            <Icon size={16} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function StudentTabBar({ whiteboardHref }: { whiteboardHref: string }) {
  const pathname = usePathname();
  return (
    <FnTabBar className="fn-tabbar--mobile-only" aria-label="التنقل الرئيسي">
      {navItems(whiteboardHref).map((item) => {
        const Icon = item.icon;
        return (
          <FnTabBarItem key={item.label} asChild active={isActivePath(pathname, item)}>
            <Link href={item.href}>
              <Icon size={22} aria-hidden="true" />
              <span>{item.label}</span>
            </Link>
          </FnTabBarItem>
        );
      })}
    </FnTabBar>
  );
}
