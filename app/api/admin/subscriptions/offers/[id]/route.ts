import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../../lib/admin/http';
import { offerReadiness } from '../../../../../../lib/admin/offer-readiness';
import { parseOfferEditForm, validateOfferScope } from '../../../../../../lib/admin/subscriptions';
import { billingStore } from '../../../../../../lib/billing/store';
import { studentStore } from '../../../../../../lib/student/store';

export const dynamic = 'force-dynamic';

const BACK = '/admin/subscriptions?section=offers';

// Updates the editable fields of an offer or toggles it. Identity fields
// (kind/type/subject/grade/field/term) are fixed at creation.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const { id } = await context.params;
  const billing = billingStore();
  const offer = await billing.findSubscriptionOfferById(id);
  if (!offer) return withQuery(auth.origin, BACK, { error: 'offer_not_found' });

  const form = await request.formData();
  const students = studentStore();

  if (String(form.get('intent') ?? '') === 'toggle') {
    // Activation requires full provider readiness; deactivation is always
    // allowed so a broken offer can never get stuck active.
    if (!offer.isActive) {
      const scope = await billing.listBundleSubjectIds(offer.id);
      const term = offer.academicTermId ? await billing.findAcademicTermById(offer.academicTermId) : null;
      const readiness = offerReadiness({
        kind: offer.kind,
        type: offer.type,
        freemiusPlanId: offer.freemiusPlanId,
        priceMinor: offer.priceMinor,
        term,
        bundleSubjectIds: scope,
      });
      if (!readiness.ready) return withQuery(auth.origin, BACK, { error: readiness.issues[0] });
    }
    await billing.setSubscriptionOfferActive(id, !offer.isActive);
    return withQuery(auth.origin, BACK, { status: offer.isActive ? 'offer_deactivated' : 'offer_activated' });
  }

  const parsed = parseOfferEditForm(form);
  if (!parsed.ok) return withQuery(auth.origin, BACK, { error: parsed.error });

  const scopeResult = await validateOfferScope(
    {
      kind: offer.kind,
      type: offer.type,
      gradeId: offer.gradeId,
      academicFieldId: offer.academicFieldId,
      academicTermId: offer.academicTermId,
      subjectId: offer.subjectId,
      priceMinor: parsed.value.priceMinor,
      monthlyCreditAllowance: parsed.value.monthlyCreditAllowance,
      currency: parsed.value.currency,
      freemiusPlanId: parsed.value.freemiusPlanId,
      isActive: parsed.value.isActive,
      bundleSubjectIds: parsed.value.bundleSubjectIds,
    },
    { students, billing },
  );
  if (!scopeResult.ok) return withQuery(auth.origin, BACK, { error: scopeResult.error });

  if (parsed.value.isActive) {
    const term = offer.academicTermId ? await billing.findAcademicTermById(offer.academicTermId) : null;
    const readiness = offerReadiness({
      kind: offer.kind,
      type: offer.type,
      freemiusPlanId: parsed.value.freemiusPlanId,
      priceMinor: parsed.value.priceMinor,
      term,
      bundleSubjectIds: scopeResult.scope.bundleSubjectIds,
    });
    if (!readiness.ready) return withQuery(auth.origin, BACK, { error: readiness.issues[0] });
  }

  await billing.upsertSubscriptionOffer({
    id: offer.id,
    dedupeKey: offer.dedupeKey,
    kind: offer.kind,
    type: offer.type,
    subjectId: offer.subjectId,
    gradeId: offer.gradeId,
    academicFieldId: offer.academicFieldId,
    academicTermId: offer.academicTermId,
    freemiusPlanId: parsed.value.freemiusPlanId,
    priceMinor: parsed.value.priceMinor,
    monthlyCreditAllowance: parsed.value.monthlyCreditAllowance,
    currency: parsed.value.currency,
    isActive: parsed.value.isActive,
  });

  if (offer.kind === 'BUNDLE') {
    await billing.setBundleSubjects(offer.id, scopeResult.scope.bundleSubjectIds);
  }

  return withQuery(auth.origin, BACK, { status: 'offer_saved' });
}
