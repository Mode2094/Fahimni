import { authStore } from '../../../../lib/auth/store';
import { billingStore } from '../../../../lib/billing/store';
import { FreemiusConfigError, freemiusClient } from '../../../../lib/freemius/client';
import { billingEventStore } from '../../../../lib/freemius/events';
import { handleFreemiusWebhook } from '../../../../lib/freemius/webhook';

export const dynamic = 'force-dynamic';

// Freemius is the authoritative entitlement source. Signature verification,
// idempotency and license-to-subject mapping all happen server-side.
export async function POST(request: Request) {
  try {
    const client = await freemiusClient();
    return await handleFreemiusWebhook(request, {
      createListener: () =>
        client.webhook.createListener({
          onError: async () => {
            console.error('[freemius] webhook handler error');
          },
        }),
      processFetch: (listener, req) => client.webhook.processFetch(listener, req),
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
      store: billingStore(),
      findUserByEmail: (email) => authStore().findUserByEmail(email),
      events: billingEventStore(),
    });
  } catch (error) {
    if (error instanceof FreemiusConfigError) {
      return new Response('Service Unavailable', { status: 503 });
    }
    console.error('[freemius] webhook route failed');
    return new Response('Internal Server Error', { status: 500 });
  }
}
