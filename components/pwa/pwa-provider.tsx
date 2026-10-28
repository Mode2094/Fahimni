"use client";

import { useEffect, useState } from "react";

import { FnButton, FnIconButton } from "@/components/fahimni";

// Safe static-asset-only service worker registration.
// Development: never register. A service worker caches stable dev URLs
// (/_next/static/* in next dev) cache-first, which serves stale CSS/JS after
// rebuilds and is the root cause of "styles randomly break until hard refresh".
// Any worker registered by an older build is unregistered and its caches are
// purged, then the page reloads once so the stale worker stops controlling it.
const DEV_RESET_KEY = "fahimni-sw-dev-reset";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        try {
          const hadController = Boolean(navigator.serviceWorker.controller);
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.filter((key) => key.startsWith("fahimni-")).map((key) => caches.delete(key)));
          }
          if (hadController) {
            let alreadyReset = false;
            try {
              alreadyReset = sessionStorage.getItem(DEV_RESET_KEY) === "1";
            } catch {
              // Storage unavailable: skip the one-time reload to avoid a loop.
            }
            if (!alreadyReset) {
              try {
                sessionStorage.setItem(DEV_RESET_KEY, "1");
              } catch {
                // Ignore.
              }
              window.location.reload();
            }
          }
        } catch {
          // Best effort cleanup only.
        }
      })();
      return;
    }

    try {
      sessionStorage.removeItem(DEV_RESET_KEY);
    } catch {
      // Ignore.
    }
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem("fahimni-install-dismissed") === "1");
    } catch {
      setDismissed(false);
    }
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed || !promptEvent) return null;

  const install = async () => {
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } catch {
      // The prompt may already have been consumed; nothing to do.
    }
    setPromptEvent(null);
  };

  const dismiss = () => {
    try {
      window.localStorage.setItem("fahimni-install-dismissed", "1");
    } catch {
      // Ignore storage failures.
    }
    setDismissed(true);
  };

  return (
    <div className="pwa-banner" role="region" aria-label="تثبيت التطبيق">
      <span className="fn-grow">ثبّت تطبيق فهمني على جهازك للوصول الأسرع.</span>
      <FnButton type="button" size="sm" onClick={install}>
        تثبيت
      </FnButton>
      <FnIconButton aria-label="إغلاق" onClick={dismiss}>
        ×
      </FnIconButton>
    </div>
  );
}
