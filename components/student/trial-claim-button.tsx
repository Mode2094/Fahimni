'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { FnButton } from '@/components/fahimni';

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: { sitekey: string; action?: string; callback?: () => void; 'error-callback'?: () => void },
  ) => string;
  reset: (widgetId?: string) => void;
  getResponse: (widgetId?: string) => string | undefined;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = 'fahimni-turnstile';

// Turnstile is only rendered when a site key exists; the server still fails
// closed in production when the secret is missing. `afterClaimHref` continues
// the student journey (usually into the subject classroom) once the secure
// claim succeeds.
export function TrialClaimButton({
  siteKey,
  label = 'ابدأ تجربتك المجانية',
  afterClaimHref,
}: {
  siteKey: string | null;
  label?: string;
  afterClaimHref?: string;
}) {
  const router = useRouter();
  const container = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !container.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(container.current, { sitekey: siteKey, action: 'claim_trial' });
    };
    if (window.turnstile) {
      render();
      return () => {
        cancelled = true;
      };
    }
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', render);
    return () => {
      cancelled = true;
      script?.removeEventListener('load', render);
    };
  }, [siteKey]);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      const token = widgetId.current && window.turnstile ? window.turnstile.getResponse(widgetId.current) ?? '' : '';
      const response = await fetch('/api/trial/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnstileToken: token }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'تعذر تفعيل التجربة المجانية.');
      if (afterClaimHref) router.push(afterClaimHref);
      else router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تفعيل التجربة المجانية.');
      setBusy(false);
      if (window.turnstile) window.turnstile.reset(widgetId.current ?? undefined);
    }
  }

  return (
    <div className="fn-stack fn-stack--sm">
      {siteKey ? <div ref={container} className="trial-turnstile" /> : null}
      <FnButton type="button" block onClick={claim} disabled={busy}>
        {busy ? 'جاري التفعيل…' : label}
      </FnButton>
      {error ? (
        <span className="fn-alert fn-alert--error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
