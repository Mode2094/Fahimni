import { authorizeAdminRequest, forbidden, redirectTo } from '../../../../../../lib/admin/http';
import { syncOffer } from '../../../../../../lib/freemius/sync';

export const dynamic = 'force-dynamic';

function back(origin: string, params: Record<string, string>): Response {
  const url = new URL('/admin/subscriptions', origin);
  url.searchParams.set('section', 'offers');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return redirectTo(url);
}

// Manual/automatic synchronization for one offer. Read-only verification runs
// whenever credentials exist; plan creation only happens in live mode.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const form = await request.formData();
  const offerId = String(form.get('offerId') ?? '').trim();
  if (!offerId) return back(auth.origin, { error: 'invalid' });

  const outcome = await syncOffer(offerId);
  if (outcome.ok) return back(auth.origin, { status: 'sync_done' });
  const codes: Record<typeof outcome.status, string> = {
    ALREADY_RUNNING: 'sync_running',
    NOT_CONFIGURED: 'sync_not_configured',
    PENDING: 'sync_pending',
    FAILED: 'sync_failed',
  };
  return back(auth.origin, { error: codes[outcome.status] });
}
