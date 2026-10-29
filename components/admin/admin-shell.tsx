"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Menu, PanelRightClose, PanelRightOpen, X } from "lucide-react";

import { AdminNav } from "./admin-nav";

const COLLAPSE_KEY = "fahimni.admin.collapsed";

// The sidebar preference lives in localStorage. A tiny external store keeps the
// read out of render (hydration-safe: the server snapshot is always false) and
// avoids the setState-in-effect pattern entirely.
const collapseListeners = new Set<() => void>();
function subscribeCollapse(listener: () => void) {
  collapseListeners.add(listener);
  return () => collapseListeners.delete(listener);
}
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(next: boolean) {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  } catch {
    // Storage can be unavailable (private mode); the preference is optional.
  }
  for (const listener of collapseListeners) listener();
}

export function AdminShell({
  brand,
  actions,
  children,
}: {
  brand: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const collapsed = useSyncExternalStore(subscribeCollapse, readCollapsed, () => false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    drawerRef.current?.querySelector<HTMLElement>("a")?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  function toggleCollapsed() {
    writeCollapsed(!collapsed);
  }

  return (
    <div className={collapsed ? "fn-admin is-collapsed" : "fn-admin"}>
      <header className="fn-navbar fn-admin__topbar">
        <div className="fn-admin__topbar-inner">
          <button
            ref={triggerRef}
            type="button"
            className="fn-icon-btn fn-admin__menu"
            aria-label="فتح قائمة الإدارة"
            aria-expanded={drawerOpen}
            aria-controls="admin-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="fn-admin__brand">{brand}</div>
          <div className="fn-navbar__actions">{actions}</div>
        </div>
      </header>

      <div className="fn-admin__body">
        <aside className="fn-admin__sidebar">
          <AdminNav collapsed={collapsed} />
          <div className="fn-admin__collapse">
            <button
              type="button"
              className="fn-icon-btn"
              aria-label={collapsed ? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"}
              aria-pressed={collapsed}
              onClick={toggleCollapsed}
            >
              {collapsed ? <PanelRightOpen size={18} aria-hidden="true" /> : <PanelRightClose size={18} aria-hidden="true" />}
            </button>
          </div>
        </aside>

        {drawerOpen ? (
          <>
            <div className="fn-admin__scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
            <div
              ref={drawerRef}
              id="admin-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="أقسام لوحة الإدارة"
              className="fn-admin__drawer"
            >
              <div className="fn-admin__drawer-head">
                <span className="fn-admin__drawer-title">لوحة الإدارة</span>
                <button type="button" className="fn-icon-btn" aria-label="إغلاق القائمة" onClick={() => setDrawerOpen(false)}>
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              <AdminNav onNavigate={() => setDrawerOpen(false)} />
            </div>
          </>
        ) : null}

        <main className="fn-admin__main">
          <div className="fn-admin__container">{children}</div>
        </main>
      </div>
    </div>
  );
}
