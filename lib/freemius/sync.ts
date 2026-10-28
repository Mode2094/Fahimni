import { billingStore, type BillingStore } from '../billing/store';
import { getPlainSetting } from '../settings/service';
import { SETTING_KEYS } from '../settings/keys';
import { sdkAutomationApi, type FreemiusAutomationApi } from './automation';
import { freemiusClient } from './client';
import { offerProviderLinkStore, type OfferProviderLinkStore } from './links';
import { findPlanForOffer, planSlugForOffer, VERIFICATION_MESSAGES, verifyOfferAgainstProvider, type ProviderPlan } from './verification';

export type SyncOutcome =
  | { ok: true; status: 'SYNCED'; message: string }
  | { ok: true; status: 'DRY_RUN'; message: string }
  | { ok: false; status: 'PENDING' | 'FAILED' | 'ALREADY_RUNNING' | 'NOT_CONFIGURED'; message: string };

export type SyncDeps = {
  links: OfferProviderLinkStore;
  billing: BillingStore;
  api: FreemiusAutomationApi | null;
  liveEnabled: boolean;
  dryRun: boolean;
};

async function defaultDeps(): Promise<SyncDeps> {
  let api: FreemiusAutomationApi | null = null;
  try {
    api = sdkAutomationApi(await freemiusClient());
  } catch {
    api = null;
  }
  const liveSetting = await getPlainSetting(SETTING_KEYS.freemiusSyncEnabled).catch(() => null);
  return { links: offerProviderLinkStore(), billing: billingStore(), api, liveEnabled: liveSetting === 'true', dryRun: false };
}

const DEVELOPER_REQUIRED = 'إنشاء الخطط تلقائيًا يتطلب صلاحيات مطوّر من فريميوس (developer scope). أنشئ الخطة من لوحة فريميوس أو انتظر تفعيل المزامنة الآمنة.';

// Idempotent, compare-and-set guarded synchronization. Read-only verification
// runs whenever credentials exist; plan creation only runs in live mode with a
// provider API that officially supports it.
export async function syncOffer(offerId: string, overrides: Partial<SyncDeps> = {}): Promise<SyncOutcome> {
  const deps = { ...(await defaultDeps()), ...overrides };
  const offer = await deps.billing.findSubscriptionOfferById(offerId);
  if (!offer) return { ok: false, status: 'FAILED', message: 'العرض غير موجود.' };

  const claim = await deps.links.claimSync(offerId);
  if (!claim) return { ok: false, status: 'ALREADY_RUNNING', message: 'هناك مزامنة قيد التنفيذ لهذا العرض. حاول بعد قليل.' };

  if (!deps.api) {
    await deps.links.markPending(offerId, 'ربط فريميوس غير مهيأ. أكمل بيانات الربط ثم أعد المزامنة.', claim.planId ?? offer.freemiusPlanId);
    return { ok: false, status: 'NOT_CONFIGURED', message: 'ربط فريميوس غير مهيأ. أكمل بيانات الربط أولًا.' };
  }

  let plans: ProviderPlan[];
  try {
    plans = await deps.api.listPlans();
  } catch {
    await deps.links.markFailed(offerId, 'تعذر قراءة الخطط من فريميوس. تحقق من الاتصال والمفاتيح.');
    return { ok: false, status: 'FAILED', message: 'تعذر قراءة الخطط من فريميوس. تحقق من الاتصال والمفاتيح.' };
  }

  const linkedPlanId = claim.planId ?? offer.freemiusPlanId ?? null;
  const plan = findPlanForOffer(plans, offerId, linkedPlanId);
  if (plan) {
    const verification = verifyOfferAgainstProvider({
      offer: { kind: offer.kind, type: offer.type, currency: offer.currency, priceMinor: offer.priceMinor },
      plan,
    });
    if (verification.ok) {
      await deps.links.completeSync(offerId, {
        planId: verification.planId,
        pricingId: verification.pricingId,
        currency: verification.currency,
        priceMinor: verification.priceMinor,
        billingCycle: verification.billingCycle,
      });
      return { ok: true, status: 'SYNCED', message: 'تم التحقق من الخطة والتسعير لدى فريميوس. العرض جاهز للدفع.' };
    }
    const message = VERIFICATION_MESSAGES[verification.reason];
    await deps.links.markFailed(offerId, message);
    return { ok: false, status: 'FAILED', message };
  }

  // No matching provider plan yet.
  if (deps.dryRun || !deps.liveEnabled || !deps.api.capabilities.createPlan) {
    const message = deps.api.capabilities.createPlan
      ? 'المزامنة الحية غير مفعّلة. لن يتم إنشاء أي خطة حتى تفعّلها من الإعدادات.'
      : DEVELOPER_REQUIRED;
    await deps.links.markPending(offerId, message, linkedPlanId);
    return { ok: false, status: 'PENDING', message };
  }

  try {
    const created = await deps.api.createPlan({
      name: planSlugForOffer(offerId),
      title: `Fahimni ${offerId}`,
      currency: offer.currency,
      monthlyPrice: offer.type === 'MONTHLY' && offer.priceMinor !== null ? offer.priceMinor / 100 : null,
      lifetimePrice: offer.type === 'SEMESTER' && offer.priceMinor !== null ? offer.priceMinor / 100 : null,
    });
    const refreshed = await deps.api.listPlans();
    const createdPlan = refreshed.find((candidate) => candidate.planId === created.planId) ?? null;
    const verification = verifyOfferAgainstProvider({
      offer: { kind: offer.kind, type: offer.type, currency: offer.currency, priceMinor: offer.priceMinor },
      plan: createdPlan,
    });
    if (!verification.ok) {
      const message = VERIFICATION_MESSAGES[verification.reason];
      await deps.links.markFailed(offerId, message);
      return { ok: false, status: 'FAILED', message };
    }
    await deps.links.completeSync(offerId, {
      planId: verification.planId,
      pricingId: verification.pricingId ?? created.pricingId,
      currency: verification.currency,
      priceMinor: verification.priceMinor,
      billingCycle: verification.billingCycle,
    });
    return { ok: true, status: 'SYNCED', message: 'تم إنشاء الخطة والتحقق منها لدى فريميوس. العرض جاهز للدفع.' };
  } catch {
    await deps.links.markFailed(offerId, 'فشل إنشاء الخطة في فريميوس. أعد المحاولة لاحقًا.');
    return { ok: false, status: 'FAILED', message: 'فشل إنشاء الخطة في فريميوس. أعد المحاولة لاحقًا.' };
  }
}
