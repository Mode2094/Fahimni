import type { OfferKind, PlanType } from '../billing/store';

export type ProviderPricingOption = {
  pricingId: string | null;
  currency: string;
  monthlyMinor: number | null;
  annualMinor: number | null;
  lifetimeMinor: number | null;
};

export type ProviderPlan = {
  planId: string;
  name: string | null;
  title: string | null;
  pricing: ProviderPricingOption[];
};

export type VerificationReason =
  | 'plan_missing'
  | 'pricing_missing'
  | 'currency_mismatch'
  | 'unsupported_currency'
  | 'price_mismatch'
  | 'cycle_mismatch'
  | 'provider_error';

// Official Freemius checkout currencies (multi-currency docs). JOD is NOT
// supported: a JOD-priced offer can never be verified and must be re-priced in
// a supported currency — never silently converted.
export const SUPPORTED_CHECKOUT_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'ILS', 'PLN', 'CHF', 'RSD'] as const;

export function isSupportedCheckoutCurrency(currency: string): boolean {
  return (SUPPORTED_CHECKOUT_CURRENCIES as readonly string[]).includes(currency.trim().toUpperCase());
}

export const VERIFICATION_MESSAGES: Record<VerificationReason, string> = {
  plan_missing: 'لا توجد خطة مطابقة في فريميوس لهذا العرض.',
  pricing_missing: 'الخطة موجودة لكن لا يوجد تسعير منشور يطابق نوع الاشتراك.',
  currency_mismatch: 'عملة التسعير في فريميوس لا تطابق عملة العرض.',
  unsupported_currency: `فريميوس لا تدعم الدفع بعملة العرض. العملات المدعومة: ${SUPPORTED_CHECKOUT_CURRENCIES.join('، ')} — أعد تسعير العرض بعملة مدعومة دون أي تحويل تلقائي.`,
  price_mismatch: 'سعر فريميوس لا يطابق سعر العرض المعتمد.',
  cycle_mismatch: 'دورة الفوترة في فريميوس لا تطابق نوع الاشتراك.',
  provider_error: 'تعذر التحقق من بيانات فريميوس. حاول لاحقًا.',
};

export type VerificationResult =
  | {
      ok: true;
      planId: string;
      pricingId: string | null;
      currency: string;
      priceMinor: number;
      billingCycle: 'monthly' | 'oneoff';
    }
  | { ok: false; reason: VerificationReason };

function toMinor(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

// Maps the official pricing-table payload (plans with embedded pricing) into a
// provider-neutral shape. Fields that are absent stay null so verification can
// fail with a precise reason instead of guessing.
export function plansFromPricingTable(data: unknown): ProviderPlan[] {
  const plans = (data as { plans?: unknown } | null)?.plans;
  if (!Array.isArray(plans)) return [];
  return plans
    .filter((plan): plan is Record<string, unknown> => typeof plan === 'object' && plan !== null)
    .map((plan) => {
      const pricing = Array.isArray(plan.pricing) ? (plan.pricing as Record<string, unknown>[]) : [];
      return {
        planId: String(plan.id ?? ''),
        name: typeof plan.name === 'string' ? plan.name : null,
        title: typeof plan.title === 'string' ? plan.title : null,
        pricing: pricing.map((entry) => ({
          pricingId: entry.id !== undefined && entry.id !== null ? String(entry.id) : null,
          currency: String(entry.currency ?? '').toUpperCase(),
          monthlyMinor: toMinor(entry.monthly_price as number | null | undefined),
          annualMinor: toMinor(entry.annual_price as number | null | undefined),
          lifetimeMinor: toMinor(entry.lifetime_price as number | null | undefined),
        })),
      };
    })
    .filter((plan) => plan.planId);
}

// Deterministic plan slug used when the platform creates plans itself, so a
// retried create can always find the plan it created instead of duplicating.
export function planSlugForOffer(offerId: string): string {
  return `fahimni-${offerId.toLowerCase()}`;
}

export function findPlanForOffer(plans: ProviderPlan[], offerId: string, linkedPlanId: string | null): ProviderPlan | null {
  if (linkedPlanId) return plans.find((plan) => plan.planId === linkedPlanId) ?? null;
  const slug = planSlugForOffer(offerId);
  return plans.find((plan) => plan.name === slug) ?? null;
}

export function verifyOfferAgainstProvider(input: {
  offer: { kind: OfferKind; type: PlanType; currency: string; priceMinor: number | null };
  plan: ProviderPlan | null;
}): VerificationResult {
  const { offer, plan } = input;
  if (!isSupportedCheckoutCurrency(offer.currency)) return { ok: false, reason: 'unsupported_currency' };
  if (!plan) return { ok: false, reason: 'plan_missing' };
  if (offer.priceMinor === null) return { ok: false, reason: 'price_mismatch' };

  const wanted = offer.currency.toUpperCase();
  const options = plan.pricing.filter((option) => option.currency === wanted);
  if (!options.length) return { ok: false, reason: 'currency_mismatch' };

  const cycle: 'monthly' | 'oneoff' = offer.type === 'MONTHLY' ? 'monthly' : 'oneoff';
  for (const option of options) {
    const amount = cycle === 'monthly' ? option.monthlyMinor : option.lifetimeMinor;
    if (amount === null) continue;
    if (amount === offer.priceMinor) {
      return { ok: true, planId: plan.planId, pricingId: option.pricingId, currency: wanted, priceMinor: amount, billingCycle: cycle };
    }
  }

  const anyAmount = options.some((option) => (cycle === 'monthly' ? option.monthlyMinor : option.lifetimeMinor) !== null);
  if (!anyAmount) return { ok: false, reason: 'cycle_mismatch' };
  return { ok: false, reason: 'price_mismatch' };
}

// Two local offers must never point at the same Freemius plan: the webhook maps
// a purchase by plan id, so a shared id makes entitlement routing ambiguous.
export function duplicatePlanIdMappings(offers: { id: string; freemiusPlanId: string | null }[]): { planId: string; offerIds: string[] }[] {
  const byPlan = new Map<string, string[]>();
  for (const offer of offers) {
    if (!offer.freemiusPlanId) continue;
    const list = byPlan.get(offer.freemiusPlanId) ?? [];
    list.push(offer.id);
    byPlan.set(offer.freemiusPlanId, list);
  }
  return [...byPlan.entries()]
    .filter(([, offerIds]) => offerIds.length > 1)
    .map(([planId, offerIds]) => ({ planId, offerIds }));
}
