'use client';

import { useState } from 'react';

import { FnButton } from '@/components/fahimni';

// Client checkout launchers. They POST only a safe local identifier to
// /api/checkout; the server resolves price, plan and scope. No price or plan id
// is ever trusted from the browser.

type Props = { semesterId: string; label?: string; className?: string };

export function SemesterCheckoutButton({ semesterId, label = 'اشترك الآن', className }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'semester', semesterId }),
      });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        setError(payload.error ?? 'تعذر بدء عملية الدفع. حاول لاحقًا.');
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setError('تعذر الاتصال. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fn-stack fn-stack--sm">
      <FnButton type="button" variant="primary" size="lg" onClick={start} disabled={busy} className={className}>
        {busy ? 'جارٍ فتح الدفع…' : label}
      </FnButton>
      {error ? (
        <p className="fn-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TopupCheckoutButton({ offerId, label = 'اشحن الآن' }: { offerId: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'topup', offerId }),
      });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        setError(payload.error ?? 'تعذر بدء عملية الدفع. حاول لاحقًا.');
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setError('تعذر الاتصال. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fn-stack fn-stack--sm">
      <FnButton type="button" variant="soft" onClick={start} disabled={busy}>
        {busy ? 'جارٍ فتح الدفع…' : label}
      </FnButton>
      {error ? (
        <p className="fn-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
