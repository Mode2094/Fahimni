import { authStore } from '../../../../lib/auth/store';
import { billingStore } from '../../../../lib/billing/store';
import { semesterStore } from '../../../../lib/billing/semester-store';
import { purchaseStore } from '../../../../lib/billing/purchase-store';
import { topupStore } from '../../../../lib/billing/topup-store';
import { creditWalletStore } from '../../../../lib/billing/wallet-store';
import { FreemiusConfigError, freemiusClient } from '../../../../lib/freemius/client';
import { billingEventStore } from '../../../../lib/freemius/events';
import { handleFreemiusWebhook } from '../../../../lib/freemius/webhook';

export const dynamic = 'force-dynamic';

// Freemius is the authoritative entitlement source. Signature verification,
// idempotency and license-to-subject mapping all happen server-side.

// Freemius one-off purchases carry no amount on the license; the authoritative
// settled amount lives in the payment records. This resolves the real payment
// for a purchase and returns its gross amount in MINOR units plus currency.
// It never invents data: when no matching, non-refunded payment is found the
// settlement layer fails closed.
async function resolveVerifiedPayment(
  client: Awaited<ReturnType<typeof freemiusClient>>,
  input: { licenseUserId: string | null; subscriptionId: string | null; email: string },
): Promise<{ paidAmountMinor: number | null; paidCurrency: string | null; providerPaymentId: string | null }> {
  try {
    const api = client.api as unknown as {
      user: { retrievePayments: (userId: string, filters?: Record<string, unknown>) => Promise<PaymentRecord[]> };
    };
    let payments: PaymentRecord[] = [];
    if (input.licenseUserId) {
      payments = await api.user.retrievePayments(input.licenseUserId, { filter: 'not_refunded', extended: true });
    }
    // Match by subscription when present, otherwise take the most recent
    // non-refunded payment for the user. Payments are only ever used when the
    // provider returned them for THIS user id.
    const matching = input.subscriptionId
      ? payments.filter((payment) => String(payment.subscription_id ?? '') === input.subscriptionId)
      : payments;
    const chosen = matching
      .filter((payment) => payment.type !== 'refund' && payment.type !== 'chargeback' && payment.type !== 'dispute')
      .sort((a, b) => {
        const aTime = a.created ? Date.parse(String(a.created)) : 0;
        const bTime = b.created ? Date.parse(String(b.created)) : 0;
        return bTime - aTime;
      })[0];
    if (!chosen || chosen.gross === undefined || chosen.gross === null || !chosen.currency) {
      return { paidAmountMinor: null, paidCurrency: null, providerPaymentId: null };
    }
    return {
      // gross is a major-unit decimal (e.g. 5.00); store minor units as an integer.
      paidAmountMinor: Math.round(Number(chosen.gross) * 1000),
      paidCurrency: String(chosen.currency),
      providerPaymentId: chosen.id !== undefined ? String(chosen.id) : null,
    };
  } catch {
    console.error('[freemius] verified payment lookup failed');
    return { paidAmountMinor: null, paidCurrency: null, providerPaymentId: null };
  }
}

type PaymentRecord = {
  id?: string | number;
  gross?: number | null;
  currency?: string | null;
  subscription_id?: string | number | null;
  type?: string | null;
  created?: string | null;
};

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
        const data = purchase.toData();
        // Resolve the authoritative settled payment (amount + currency). A
        // one-off purchase has no subscription amount, so this is the only
        // source of the real paid amount.
        const verified = await resolveVerifiedPayment(client, {
          licenseUserId: data.userId ?? null,
          subscriptionId: data.subscriptionId ?? null,
          email: data.email,
        });
        return {
          email: data.email,
          planId: data.planId,
          licenseId: data.licenseId,
          subscriptionId: data.subscriptionId,
          canceled: data.canceled,
          expiration: data.expiration,
          created: data.created,
          billingCycle: data.billingCycle ? (data.billingCycle as 'monthly' | 'yearly' | 'oneoff') : null,
          paidAmountMinor: verified.paidAmountMinor,
          paidCurrency: verified.paidCurrency,
          providerPaymentId: verified.providerPaymentId,
        };
      },
      store: billingStore(),
      findUserByEmail: (email) => authStore().findUserByEmail(email),
      events: billingEventStore(),
      unified: {
        semesters: semesterStore(),
        purchases: purchaseStore(),
        wallets: creditWalletStore(),
        topups: topupStore(),
      },
    });
  } catch (error) {
    if (error instanceof FreemiusConfigError) {
      return new Response('Service Unavailable', { status: 503 });
    }
    console.error('[freemius] webhook route failed');
    return new Response('Internal Server Error', { status: 500 });
  }
}
