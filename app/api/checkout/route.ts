import { z } from 'zod';

import { sessionTokenFromRequest, userFromToken } from '../../../lib/auth/request-user';
import { isEntitlementActive } from '../../../lib/billing/entitlements';
import { billingStore } from '../../../lib/billing/store';
import { semesterStore, isSellableSemester } from '../../../lib/billing/semester-store';
import { purchaseStore } from '../../../lib/billing/purchase-store';
import { topupStore } from '../../../lib/billing/topup-store';
import { findDuplicatePurchase } from '../../../lib/billing/subscription';
import { termPhase } from '../../../lib/billing/terms';
import { booksStore } from '../../../lib/books/store';
import { FreemiusConfigError, freemiusClient } from '../../../lib/freemius/client';
import { offerProviderLinkStore } from '../../../lib/freemius/links';
import { isCheckoutReady, isDemoPlanId } from '../../../lib/freemius/readiness';
import { sdkCheckoutCreator } from '../../../lib/freemius/checkout';
import { jsonBody, sameOrigin } from '../../../lib/http';
import { subjectAppliesTo } from '../../../lib/student/onboarding';
import { studentStore } from '../../../lib/student/store';

export const dynamic = 'force-dynamic';

// The browser sends only a safe local identifier. Price, Freemius plan id, user
// id, semester, credit allowance and scope are always resolved server-side.
// The unified semester path is the only publicly offered paid subscription;
// legacy offer/plan identifiers remain accepted only for grandfathered flows.
const schema = z.union([
  z.object({ kind: z.literal('semester'), semesterId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('topup'), offerId: z.string().uuid() }).strict(),
  z.object({ offerId: z.string().uuid() }).strict(),
  z.object({ subjectId: z.string().uuid(), planType: z.enum(['MONTHLY', 'SEMESTER']) }).strict(),
]);

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'طلب غير صالح.', code: 'forbidden' }, { status: 403 });
  }

  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) {
    return Response.json({ error: 'سجّل الدخول أولًا.', code: 'unauthorized' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await jsonBody(request, 20_000);
  } catch {
    return Response.json({ error: 'طلب غير صالح.', code: 'invalid_request' }, { status: 400 });
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: 'طلب غير صالح.', code: 'invalid_request' }, { status: 400 });
  }

  const students = studentStore();
  const profile = await students.getProfile(user.id);
  if (!profile?.onboardingCompleted) {
    return Response.json({ error: 'أكمل إعداد حسابك أولًا.', code: 'onboarding_required' }, { status: 403 });
  }

  // Unified semester subscription — the single publicly offered paid product.
  if ('kind' in parsed.data && parsed.data.kind === 'semester') {
    return semesterCheckout(parsed.data.semesterId, user, profile);
  }
  // One-time paid credit top-up.
  if ('kind' in parsed.data && parsed.data.kind === 'topup') {
    return topupCheckout(parsed.data.offerId, user);
  }

  const billing = billingStore();
  let freemiusPlanId: string | null = null;

  if ('offerId' in parsed.data) {
    const offer = await billing.findSubscriptionOfferById(parsed.data.offerId);
    if (!offer || !offer.isActive || !offer.freemiusPlanId) {
      return Response.json({ error: 'العرض غير متاح حاليًا.', code: 'offer_unavailable' }, { status: 409 });
    }


    let subject = null as Awaited<ReturnType<typeof students.findSubjectById>> | null;
    if (offer.kind === 'SUBJECT') {
      subject = offer.subjectId ? await students.findSubjectById(offer.subjectId) : null;
      if (!subject || !subjectAppliesTo(subject, profile.gradeId, profile.academicFieldId)) {
        return Response.json({ error: 'المادة غير متاحة.', code: 'subject_unavailable' }, { status: 404 });
      }
    } else {
      const scopeMatches = offer.gradeId === profile.gradeId && offer.academicFieldId === profile.academicFieldId;
      if (!scopeMatches) {
        return Response.json({ error: 'العرض غير متاح لصفك أو تخصصك.', code: 'offer_unavailable' }, { status: 404 });
      }
      const covered = await billing.listBundleSubjectIds(offer.id);
      if (!covered.length) {
        return Response.json({ error: 'الباقة غير مكتملة بعد.', code: 'offer_unavailable' }, { status: 409 });
      }
    }

    if (offer.type === 'SEMESTER') {
      const term = offer.academicTermId ? await billing.findAcademicTermById(offer.academicTermId) : null;
      if (!term || !term.isActive || termPhase(term.startsAt, term.endsAt) === 'ended') {
        return Response.json({ error: 'الفصل الدراسي غير متاح للاشتراك.', code: 'term_unavailable' }, { status: 409 });
      }
      // The term is a scheduling attribute of the student's cohort: it applies
      // when its grade matches and it either targets every field or the
      // student's own field. A grade-wide subject is fine for any field term.
      const termMatches =
        term.gradeId === profile.gradeId &&
        (term.academicFieldId === null || term.academicFieldId === profile.academicFieldId);
      if (!termMatches) {
        return Response.json({ error: 'الفصل الدراسي لا يطابق نطاق العرض.', code: 'term_unavailable' }, { status: 409 });
      }
    }

    // Content readiness: an offer is only sellable when every covered subject
    // has a READY textbook — the tutor is not usable without curriculum content.
    const coveredSubjectIds =
      offer.kind === 'BUNDLE' ? await billing.listBundleSubjectIds(offer.id) : offer.subjectId ? [offer.subjectId] : [];
    const readyBooks = await Promise.all(coveredSubjectIds.map((subjectId) => booksStore().findReadyBookBySubject(subjectId)));
    if (readyBooks.some((book) => book === null)) {
      return Response.json(
        { error: offer.kind === 'BUNDLE' ? 'بعض مواد الباقة قيد التجهيز ولا يمكن شراؤها بعد.' : 'المادة قيد التجهيز ولا يمكن الاشتراك فيها بعد.', code: 'offer_unavailable' },
        { status: 409 },
      );
    }

    // Checkout is only reachable for offers whose provider plan, pricing,
    // currency and cycle were verified against Freemius. Unverified or demo
    // mappings never count as ready.
    const link = await offerProviderLinkStore().findByOfferId(offer.id);
    if (!isCheckoutReady({ offerActive: offer.isActive, link })) {
      return Response.json({ error: 'العرض غير جاهز للدفع بعد.', code: 'offer_unavailable' }, { status: 409 });
    }

    // Exact duplicate guard: the same active offer is never charged twice.
    const existing = await billing.listEntitlementsForUser(user.id);
    const duplicate = existing.some((record) => record.offerId === offer.id && isEntitlementActive(record));
    if (duplicate) {
      return Response.json({ error: 'أنت مشترك في هذا العرض بالفعل.', code: 'already_subscribed' }, { status: 409 });
    }

    freemiusPlanId = offer.freemiusPlanId;
  } else {
    // Legacy per-subject plans stay fully supported.
    const subject = await students.findSubjectById(parsed.data.subjectId);
    if (!subject || !subject.isActive || !subjectAppliesTo(subject, profile.gradeId, profile.academicFieldId)) {
      return Response.json({ error: 'المادة غير متاحة.', code: 'subject_unavailable' }, { status: 404 });
    }
    // Never sell access to a subject whose textbook is not READY.
    const readyBook = await booksStore().findReadyBookBySubject(subject.id);
    if (!readyBook) {
      return Response.json({ error: 'المادة قيد التجهيز ولا يمكن الاشتراك فيها بعد.', code: 'subject_unavailable' }, { status: 409 });
    }
    const plan = await billing.findSubjectPlanBySubjectAndType(subject.id, parsed.data.planType);
    if (!plan || !plan.isActive || !plan.freemiusPlanId) {
      return Response.json({ error: 'الخطة غير متاحة حاليًا.', code: 'plan_unavailable' }, { status: 409 });
    }
    // Legacy plans share the offer verification source of truth: a plan id that
    // is not a verified provider mapping must never start a live checkout.
    if (isDemoPlanId(plan.freemiusPlanId)) {
      return Response.json({ error: 'الخطة غير جاهزة للدفع بعد.', code: 'plan_unavailable' }, { status: 409 });
    }
    const legacyLink = await offerProviderLinkStore().findByPlanId('freemius', plan.freemiusPlanId);
    if (!isCheckoutReady({ offerActive: plan.isActive, link: legacyLink })) {
      return Response.json({ error: 'الخطة غير جاهزة للدفع بعد.', code: 'plan_unavailable' }, { status: 409 });
    }
    freemiusPlanId = plan.freemiusPlanId;
  }

  try {
    const url = await sdkCheckoutCreator(await freemiusClient())({
      planId: freemiusPlanId,
      email: user.email,
      name: user.name,
    });
    return Response.json({ url });
  } catch (error) {
    if (error instanceof FreemiusConfigError) {
      return Response.json({ error: 'الدفع غير مُهيّأ بعد.', code: 'not_configured' }, { status: 503 });
    }
    console.error('[checkout] failed to create checkout link');
    return Response.json({ error: 'تعذر بدء عملية الدفع. حاول لاحقًا.', code: 'checkout_failed' }, { status: 502 });
  }
}

type CheckoutUser = { id: string; email: string; name: string | null };
type CheckoutProfile = { gradeId: string; academicFieldId: string | null };

// Unified semester checkout: one product, all ready subjects, one wallet. The
// price is resolved from the semester row server-side and shown before payment.
async function semesterCheckout(semesterId: string, user: CheckoutUser, profile: CheckoutProfile): Promise<Response> {
  const semester = await semesterStore().findSemesterById(semesterId);
  if (!semester || semester.status === 'ARCHIVED' || semester.status === 'DRAFT') {
    return Response.json({ error: 'الاشتراك الفصلي غير متاح.', code: 'semester_unavailable' }, { status: 404 });
  }
  const scopeMatches =
    semester.gradeId === profile.gradeId &&
    (semester.academicFieldId === null || semester.academicFieldId === profile.academicFieldId);
  if (!scopeMatches) {
    return Response.json({ error: 'الاشتراك الفصلي غير متاح لصفك أو تخصصك.', code: 'semester_unavailable' }, { status: 404 });
  }
  if (!isSellableSemester(semester)) {
    return Response.json({ error: 'الاشتراك الفصلي غير متاح للبيع حاليًا.', code: 'semester_unavailable' }, { status: 409 });
  }
  if (!semester.freemiusPlanId) {
    return Response.json({ error: 'الاشتراك الفصلي غير جاهز للدفع بعد.', code: 'semester_unavailable' }, { status: 409 });
  }
  if (isDemoPlanId(semester.freemiusPlanId)) {
    return Response.json({ error: 'الاشتراك الفصلي غير جاهز للدفع بعد.', code: 'semester_unavailable' }, { status: 409 });
  }
  // The semester plan must be a verified provider mapping before it can sell.
  const link = await offerProviderLinkStore().findByPlanId('freemius', semester.freemiusPlanId);
  if (!isCheckoutReady({ offerActive: true, link })) {
    return Response.json({ error: 'الاشتراك الفصلي غير جاهز للدفع بعد.', code: 'semester_unavailable' }, { status: 409 });
  }
  // Duplicate guard: one live purchase per user + semester.
  const duplicate = await findDuplicatePurchase(purchaseStore(), user.id, semester.id);
  if (duplicate && duplicate.status !== 'EXPIRED' && duplicate.status !== 'CANCELED') {
    return Response.json({ error: 'أنت مشترك في هذا الفصل بالفعل.', code: 'already_subscribed' }, { status: 409 });
  }

  try {
    const url = await sdkCheckoutCreator(await freemiusClient())({
      planId: semester.freemiusPlanId,
      email: user.email,
      name: user.name,
    });
    return Response.json({ url });
  } catch (error) {
    if (error instanceof FreemiusConfigError) {
      return Response.json({ error: 'الدفع غير مُهيّأ بعد.', code: 'not_configured' }, { status: 503 });
    }
    console.error('[checkout] failed to create semester checkout link');
    return Response.json({ error: 'تعذر بدء عملية الدفع. حاول لاحقًا.', code: 'checkout_failed' }, { status: 502 });
  }
}

// One-time top-up checkout. Never grants credits here; credits are added only
// after a verified webhook settles the payment.
async function topupCheckout(offerId: string, user: CheckoutUser): Promise<Response> {
  const offer = await topupStore().findOfferById(offerId);
  if (!offer || offer.status !== 'ACTIVE') {
    return Response.json({ error: 'عرض شحن الرصيد غير متاح.', code: 'topup_unavailable' }, { status: 409 });
  }
  if (!offer.freemiusPlanId || isDemoPlanId(offer.freemiusPlanId)) {
    return Response.json({ error: 'عرض شحن الرصيد غير جاهز للدفع بعد.', code: 'topup_unavailable' }, { status: 409 });
  }
  const link = await offerProviderLinkStore().findByPlanId('freemius', offer.freemiusPlanId);
  if (!isCheckoutReady({ offerActive: true, link })) {
    return Response.json({ error: 'عرض شحن الرصيد غير جاهز للدفع بعد.', code: 'topup_unavailable' }, { status: 409 });
  }
  // Reuse an existing pending purchase rather than creating duplicates.
  const purchases = topupStore();
  const pending = await purchases.findPendingPurchaseForUser(user.id, offer.id);
  if (!pending) {
    await purchases.createPurchase({
      id: crypto.randomUUID(),
      userId: user.id,
      offerId: offer.id,
      offerName: offer.name,
      credits: offer.credits,
      priceMinor: offer.priceMinor,
      currency: offer.currency,
      status: 'PENDING',
      provider: 'freemius',
      providerTransactionId: null,
      providerLicenseId: null,
      providerPlanId: offer.freemiusPlanId,
      creditsGrantedAt: null,
    });
  }

  try {
    const url = await sdkCheckoutCreator(await freemiusClient())({
      planId: offer.freemiusPlanId,
      email: user.email,
      name: user.name,
    });
    return Response.json({ url });
  } catch (error) {
    if (error instanceof FreemiusConfigError) {
      return Response.json({ error: 'الدفع غير مُهيّأ بعد.', code: 'not_configured' }, { status: 503 });
    }
    console.error('[checkout] failed to create top-up checkout link');
    return Response.json({ error: 'تعذر بدء عملية الدفع. حاول لاحقًا.', code: 'checkout_failed' }, { status: 502 });
  }
}
