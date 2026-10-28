import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../../../lib/admin/http';
import { authStore } from '../../../../../../../lib/auth/store';
import { billingStore } from '../../../../../../../lib/billing/store';
import { FreemiusConfigError, freemiusClient } from '../../../../../../../lib/freemius/client';
import { resyncEntitlementFromProvider } from '../../../../../../../lib/freemius/reconcile';

export const dynamic = 'force-dynamic';

const BACK = '/admin/subscriptions?section=subscribers';

// Manual reconciliation of one entitlement against the verified Freemius
// license. Read-only against Freemius; writes only through the standard
// verified mapping. Useful after support cases or missed webhooks.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const { id } = await params;

  try {
    const client = await freemiusClient();
    const outcome = await resyncEntitlementFromProvider(id, {
      store: billingStore(),
      findUserByEmail: (email) => authStore().findUserByEmail(email),
      retrievePurchase: async (licenseId) => {
        const purchase = await client.purchase.retrievePurchase(licenseId);
        if (!purchase) return null;
        return {
          email: purchase.email,
          planId: purchase.planId,
          licenseId: purchase.licenseId,
          subscriptionId: purchase.subscriptionId,
          canceled: purchase.canceled,
          expiration: purchase.expiration,
          created: purchase.created,
          billingCycle: purchase.billingCycle ? (purchase.billingCycle as 'monthly' | 'yearly' | 'oneoff') : null,
        };
      },
    });
    if (!outcome.ok) return withQuery(auth.origin, BACK, { error: `resync_${outcome.reason}` });
    return withQuery(auth.origin, BACK, { status: `resync_${outcome.status.toLowerCase()}` });
  } catch (error) {
    if (error instanceof FreemiusConfigError) return withQuery(auth.origin, BACK, { error: 'resync_not_configured' });
    console.error('[admin] entitlement resync failed');
    return withQuery(auth.origin, BACK, { error: 'resync_provider_error' });
  }
}
