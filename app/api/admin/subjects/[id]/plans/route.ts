import { parseMoneyToMinor } from '../../../../../../lib/admin/money';
import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../../lib/admin/http';
import { billingStore, subjectOfferDedupeKey } from '../../../../../../lib/billing/store';
import { studentStore } from '../../../../../../lib/student/store';

export const dynamic = 'force-dynamic';

const PLAN_TYPES = ['MONTHLY', 'SEMESTER'] as const;

// Admins configure local display price + Freemius plan id only. Freemius keys
// are global env credentials and are never entered or stored here.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const { id } = await context.params;
  const back = `/admin/subjects/${id}`;
  const subject = await studentStore().findSubjectById(id);
  if (!subject) return withQuery(auth.origin, '/admin/subjects', { error: 'not_found' });

  const form = await request.formData();
  const currency = (String(form.get('currency') ?? 'JOD').trim().toUpperCase() || 'JOD').slice(0, 3);
  const store = billingStore();
  const existingOffers = await store.listSubscriptionOffers();

  for (const type of PLAN_TYPES) {
    const prefix = type === 'MONTHLY' ? 'monthly' : 'semester';
    const isActive = form.get(`${prefix}Enabled`) === 'on';
    const planId = String(form.get(`${prefix}PlanId`) ?? '').trim();
    const price = parseMoneyToMinor(String(form.get(`${prefix}Price`) ?? '').trim(), currency);
    if (price === 'invalid') return withQuery(auth.origin, back, { error: 'invalid_price' });
    if (isActive && (!planId || planId.length > 64)) {
      return withQuery(auth.origin, back, { error: 'plan_id_required' });
    }
    const allowanceRaw = String(form.get(`${prefix}Credits`) ?? '').trim();
    const allowance = allowanceRaw ? Number(allowanceRaw) : 0;
    if (!Number.isInteger(allowance) || allowance < 0 || allowance > 100_000) {
      return withQuery(auth.origin, back, { error: 'invalid' });
    }
    await store.upsertSubjectPlan({
      subjectId: subject.id,
      type,
      freemiusPlanId: planId || null,
      priceMinor: price,
      monthlyCreditAllowance: allowance,
      currency,
      isActive,
    });

    // Keep the unified offer catalog in sync with legacy plan edits so the new
    // subscription page never shows a stale price. Term-based semester offers
    // are managed from /admin/subscriptions and are left untouched.
    const existingOffer = existingOffers.find(
      (offer) => offer.kind === 'SUBJECT' && offer.subjectId === subject.id && offer.type === type,
    );
    if (!existingOffer || existingOffer.academicTermId === null) {
      await store.upsertSubscriptionOffer({
        id: existingOffer?.id ?? crypto.randomUUID(),
        dedupeKey: subjectOfferDedupeKey(subject.id, type, null),
        kind: 'SUBJECT',
        type,
        subjectId: subject.id,
        gradeId: null,
        academicFieldId: null,
        academicTermId: null,
        freemiusPlanId: planId || null,
        priceMinor: price,
        monthlyCreditAllowance: allowance,
        currency,
        isActive,
      });
    }
  }

  return withQuery(auth.origin, back, { status: 'plans_saved' });
}
