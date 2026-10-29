import type { OfferProviderLink } from './links';

export type CheckoutStatus = 'DRAFT' | 'PENDING_LINK' | 'SYNCING' | 'SYNC_FAILED' | 'READY';

export const CHECKOUT_STATUS_LABELS: Record<CheckoutStatus, string> = {
  DRAFT: 'مسودة',
  PENDING_LINK: 'بانتظار الربط',
  SYNCING: 'جارٍ المزامنة',
  SYNC_FAILED: 'فشلت المزامنة',
  READY: 'جاهزة للدفع',
};

// Demo identifiers must never be treated as verified provider plans.
export function isDemoPlanId(planId: string | null | undefined): boolean {
  return Boolean(planId && /^plan_demo/i.test(planId));
}

export function checkoutStatus(input: {
  offerActive: boolean;
  link: Pick<OfferProviderLink, 'status' | 'verified' | 'planId'> | null;
}): CheckoutStatus {
  if (!input.offerActive) return 'DRAFT';
  const link = input.link;
  if (!link) return 'PENDING_LINK';
  if (isDemoPlanId(link.planId)) return 'PENDING_LINK';
  if (link.status === 'SYNCING') return 'SYNCING';
  if (link.status === 'FAILED') return 'SYNC_FAILED';
  if (link.status === 'SYNCED' && link.verified) return 'READY';
  return 'PENDING_LINK';
}

export function isCheckoutReady(input: {
  offerActive: boolean;
  link: Pick<OfferProviderLink, 'status' | 'verified' | 'planId'> | null;
}): boolean {
  return checkoutStatus(input) === 'READY';
}
