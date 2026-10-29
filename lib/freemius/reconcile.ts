import type { EntitlementStatus, BillingStore } from '../billing/store';
import { syncEntitlementFromPurchase, type PurchaseLike } from '../billing/entitlements';

export type ReconcileOutcome =
  | { ok: true; status: EntitlementStatus }
  | { ok: false; reason: 'not_found' | 'no_license' | 'provider_missing' | 'provider_error' | 'sync_failed' };

export type ReconcileDeps = {
  store: BillingStore;
  findUserByEmail: (email: string) => Promise<{ id: string } | null>;
  retrievePurchase: (licenseId: string) => Promise<PurchaseLike | null>;
  now?: () => Date;
};

// Admin-triggered reconciliation: re-reads the license from Freemius and
// re-applies the verified state through the same mapping the webhook uses.
// Idempotent by design; never grants access from anything but verified data.
export async function resyncEntitlementFromProvider(entitlementId: string, deps: ReconcileDeps): Promise<ReconcileOutcome> {
  const now = deps.now ?? (() => new Date());
  const entitlement = await deps.store.findEntitlementById(entitlementId);
  if (!entitlement) return { ok: false, reason: 'not_found' };
  if (!entitlement.freemiusLicenseId) return { ok: false, reason: 'no_license' };

  let purchase: PurchaseLike | null = null;
  try {
    purchase = await deps.retrievePurchase(entitlement.freemiusLicenseId);
  } catch {
    return { ok: false, reason: 'provider_error' };
  }
  if (!purchase) return { ok: false, reason: 'provider_missing' };

  const result = await syncEntitlementFromPurchase(
    { store: deps.store, findUserByEmail: deps.findUserByEmail },
    purchase,
    now(),
  );
  if (!result.ok) return { ok: false, reason: 'sync_failed' };

  const updated = await deps.store.findEntitlementById(entitlementId);
  return { ok: true, status: updated?.status ?? entitlement.status };
}

export const RECONCILE_MESSAGES: Record<string, string> = {
  not_found: 'الاشتراك غير موجود.',
  no_license: 'لا يوجد رقم رخصة فريميوس لهذا الاشتراك — لا يمكن المزامنة.',
  provider_missing: 'لم تُعثر الرخصة في فريميوس.',
  provider_error: 'تعذر الوصول إلى فريميوس. حاول لاحقًا.',
  sync_failed: 'تعذر تطبيق حالة الرخصة (خطة أو مستخدم غير معروف).',
  not_configured: 'فريميوس غير مهيأة على الخادم.',
  reconciled: 'تمت مزامنة حالة الاشتراك من فريميوس.',
};
