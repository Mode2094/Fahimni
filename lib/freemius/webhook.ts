import type { Freemius, WebhookEvent } from '@freemius/sdk';

import { syncEntitlementFromPurchase, type PurchaseLike } from '../billing/entitlements';
import type { BillingStore } from '../billing/store';
import { provisionSemesterPurchase } from '../billing/subscription';
import type { SemesterStore } from '../billing/semester-store';
import type { PurchaseStore } from '../billing/purchase-store';
import type { TopupStore } from '../billing/topup-store';
import type { CreditWalletStore } from '../billing/wallet-store';
import { summaryForBillingEvent, type BillingEventStore } from './events';

type WebhookListener = ReturnType<Freemius['webhook']['createListener']>;

// Official Freemius guidance: license events are the definitive entitlement
// source; subscription events must not be used to sync entitlements.
export const LICENSE_EVENTS = [
  'license.created',
  'license.extended',
  'license.shortened',
  'license.updated',
  'license.cancelled',
  'license.expired',
  'license.plan.changed',
] as const;

// Payment-failure signals: recorded for admin visibility only. They never
// grant or revoke access — license events remain the entitlement source.
export const PAYMENT_FAILURE_EVENTS = ['subscription.renewal.failed', 'subscription.renewal.failed.last'] as const;

// Lifecycle events worth an admin-visible timeline entry after processing.
const AUDIT_EVENTS = ['license.cancelled', 'license.expired', 'license.shortened', 'license.plan.changed'] as const;

// The unified semester/top-up settlement surface. Optional so existing
// callers/tests that only exercise the legacy subject-plan path keep working.
export type UnifiedSettlementDeps = {
  semesters: SemesterStore;
  purchases: PurchaseStore;
  wallets: CreditWalletStore;
  topups: TopupStore;
};

export type FreemiusWebhookDeps = {
  createListener: () => WebhookListener;
  processFetch: (listener: WebhookListener, request: Request) => Promise<Response>;
  retrievePurchase: (licenseId: string) => Promise<PurchaseLike | null>;
  store: BillingStore;
  findUserByEmail: (email: string) => Promise<{ id: string } | null>;
  // Optional so existing callers/tests keep working; the route always passes it.
  events?: BillingEventStore;
  // When present, license events for a semester or top-up plan settle the
  // unified purchase + credit grant instead of the legacy subject path.
  unified?: UnifiedSettlementDeps;
  now?: () => Date;
};

function licenseIdFromEvent(event: WebhookEvent | { id: string; type: string }): string | null {
  const candidate = event as unknown as {
    objects?: { license?: { id?: string | number } };
    data?: { license_id?: string | number };
  };
  const raw = candidate.objects?.license?.id ?? candidate.data?.license_id;
  if (raw === undefined || raw === null || raw === '') return null;
  return String(raw);
}

function eventDetails(event: WebhookEvent | { id: string; type: string }): {
  licenseId: string | null;
  subscriptionId: string | null;
  email: string | null;
} {
  const candidate = event as unknown as {
    objects?: {
      license?: { id?: string | number };
      subscription?: { id?: string | number };
      user?: { email?: string };
    };
    data?: { license_id?: string | number; subscription_id?: string | number };
  };
  const licenseRaw = candidate.objects?.license?.id ?? candidate.data?.license_id;
  const subscriptionRaw = candidate.objects?.subscription?.id ?? candidate.data?.subscription_id;
  const email = candidate.objects?.user?.email;
  return {
    licenseId: licenseRaw === undefined || licenseRaw === null || licenseRaw === '' ? null : String(licenseRaw),
    subscriptionId: subscriptionRaw === undefined || subscriptionRaw === null || subscriptionRaw === '' ? null : String(subscriptionRaw),
    email: typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
  };
}

// Signature verification, idempotency and entitlement sync. Entitlements are
// only written from data fetched from the Freemius API for a verified event.
export async function handleFreemiusWebhook(request: Request, deps: FreemiusWebhookDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const listener = deps.createListener();

  listener.on([...LICENSE_EVENTS], async (event) => {
    if (await deps.store.hasWebhookEvent(event.id)) return;
    const licenseId = licenseIdFromEvent(event);
    if (!licenseId) return;

    const purchase = await deps.retrievePurchase(licenseId);
    if (!purchase) return;

    // Unified settlement first: if the license's plan belongs to a semester or
    // a top-up offer, settle that purchase + credit grant (idempotent) instead
    // of the legacy per-subject path. Never both.
    const settled = await settleUnified(deps, purchase, licenseId, now());
    if (!settled) {
      const result = await syncEntitlementFromPurchase(
        { store: deps.store, findUserByEmail: deps.findUserByEmail },
        purchase,
        now(),
      );
      if (!result.ok) {
        // Safe diagnostic only: never log keys, tokens or full payment payloads.
        console.error('[freemius] entitlement sync skipped:', result.reason, event.type);
      }
    }
    if (deps.events && (AUDIT_EVENTS as readonly string[]).includes(event.type)) {
      const details = eventDetails(event);
      await deps.events.record({
        type: event.type,
        licenseId,
        subscriptionId: details.subscriptionId,
        userEmail: details.email,
        summary: summaryForBillingEvent(event.type),
        createdAt: now(),
      });
    }
    await deps.store.recordWebhookEvent(event.id, event.type);
  });

  listener.on('license.deleted', async (event) => {
    if (await deps.store.hasWebhookEvent(event.id)) return;
    const licenseId = licenseIdFromEvent(event);
    if (licenseId) await deps.store.deleteEntitlementByLicenseId(licenseId);
    if (deps.events) {
      const details = eventDetails(event);
      await deps.events.record({
        type: event.type,
        licenseId,
        subscriptionId: details.subscriptionId,
        userEmail: details.email,
        summary: summaryForBillingEvent(event.type),
        createdAt: now(),
      });
    }
    await deps.store.recordWebhookEvent(event.id, event.type);
  });

  listener.on([...PAYMENT_FAILURE_EVENTS], async (event) => {
    if (await deps.store.hasWebhookEvent(event.id)) return;
    if (deps.events) {
      const details = eventDetails(event);
      await deps.events.record({
        type: event.type,
        licenseId: details.licenseId,
        subscriptionId: details.subscriptionId,
        userEmail: details.email,
        summary: summaryForBillingEvent(event.type),
        createdAt: now(),
      });
    }
    await deps.store.recordWebhookEvent(event.id, event.type);
  });

  return deps.processFetch(listener, request);
}

// Settles a verified license against the unified semester/top-up model. Returns
// true when the plan was recognised (handled here), false to fall through to the
// legacy per-subject sync. All writes are idempotent: the wallet dedupes by
// request id, purchases are keyed by provider license/transaction id.
async function settleUnified(
  deps: FreemiusWebhookDeps,
  purchase: PurchaseLike,
  licenseId: string,
  now: Date,
): Promise<boolean> {
  if (!deps.unified) return false;
  const { semesters, purchases, wallets, topups } = deps.unified;

  const semester = await semesters.findSemesterByFreemiusPlanId(purchase.planId);
  if (semester) {
    const user = await deps.findUserByEmail(purchase.email);
    if (!user) {
      console.error('[freemius] unified settlement skipped: unknown user');
      return true;
    }
    // A canceled semester purchase is not provisioned; provisioning is idempotent.
    if (purchase.canceled) return true;
    await provisionSemesterPurchase({
      purchases,
      billing: deps.store,
      wallets,
      semester,
      userId: user.id,
      provider: { licenseId, subscriptionId: purchase.subscriptionId, planId: purchase.planId },
      purchasedAt: purchase.created,
      now,
    });
    return true;
  }

  const offer = await topups.findOfferByFreemiusPlanId(purchase.planId);
  if (offer) {
    const user = await deps.findUserByEmail(purchase.email);
    if (!user) {
      console.error('[freemius] top-up settlement skipped: unknown user');
      return true;
    }
    // Only grant credits for a settled, non-canceled one-time payment.
    if (purchase.canceled) return true;
    const transactionId = purchase.subscriptionId ?? licenseId;
    const existing = await topups.findPurchaseByProviderTransactionId(transactionId);
    let purchaseId = existing?.id ?? null;
    if (!purchaseId) {
      const pending = await topups.findPendingPurchaseForUser(user.id, offer.id);
      if (pending) {
        await topups.updatePurchase(pending.id, {
          status: 'ACTIVE',
          providerTransactionId: transactionId,
          providerLicenseId: licenseId,
          providerPlanId: purchase.planId,
        });
        purchaseId = pending.id;
      } else {
        const created = await topups.createPurchase({
          id: crypto.randomUUID(),
          userId: user.id,
          offerId: offer.id,
          offerName: offer.name,
          credits: offer.credits,
          priceMinor: offer.priceMinor,
          currency: offer.currency,
          status: 'ACTIVE',
          provider: 'freemius',
          providerTransactionId: transactionId,
          providerLicenseId: licenseId,
          providerPlanId: purchase.planId,
          creditsGrantedAt: null,
        });
        purchaseId = created.id;
      }
    }
    const grant = await wallets.grantTopupCredits({
      userId: user.id,
      credits: offer.credits,
      topupPurchaseId: purchaseId,
      requestId: `topup-grant:${transactionId}`,
    });
    if (grant.granted) {
      await topups.updatePurchase(purchaseId, { creditsGrantedAt: now });
    }
    return true;
  }

  return false;
}
