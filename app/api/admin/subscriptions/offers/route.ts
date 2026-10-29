import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../lib/admin/http';
import { offerReadiness } from '../../../../../lib/admin/offer-readiness';
import { parseOfferForm, validateOfferScope } from '../../../../../lib/admin/subscriptions';
import { billingStore, bundleOfferDedupeKey, subjectOfferDedupeKey } from '../../../../../lib/billing/store';
import { studentStore } from '../../../../../lib/student/store';

export const dynamic = 'force-dynamic';

const BACK = '/admin/subscriptions?section=offers';

// Creates or updates the single offer for a combination. Price, Freemius plan
// id, term and covered subjects are all validated against real catalog rows.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const form = await request.formData();
  const parsed = parseOfferForm(form);
  if (!parsed.ok) return withQuery(auth.origin, BACK, { error: parsed.error });

  const students = studentStore();
  const billing = billingStore();
  const scopeResult = await validateOfferScope(parsed.value, { students, billing });
  if (!scopeResult.ok) return withQuery(auth.origin, BACK, { error: scopeResult.error });
  const scope = scopeResult.scope;

  // Publishing requires a fully consistent provider configuration; a draft is
  // always saveable so the owner can finish setup later.
  if (parsed.value.isActive) {
    const term = scope.academicTermId ? await billing.findAcademicTermById(scope.academicTermId) : null;
    const readiness = offerReadiness({
      kind: parsed.value.kind,
      type: parsed.value.type,
      freemiusPlanId: parsed.value.freemiusPlanId,
      priceMinor: parsed.value.priceMinor,
      term,
      bundleSubjectIds: scope.bundleSubjectIds,
    });
    if (!readiness.ready) return withQuery(auth.origin, BACK, { error: readiness.issues[0] });
  }

  const dedupeKey =
    parsed.value.kind === 'SUBJECT'
      ? subjectOfferDedupeKey(scope.subjectId as string, parsed.value.type, scope.academicTermId)
      : bundleOfferDedupeKey(scope.gradeId as string, scope.academicFieldId, parsed.value.type, scope.academicTermId);

  const offer = await billing.upsertSubscriptionOffer({
    id: crypto.randomUUID(),
    dedupeKey,
    kind: parsed.value.kind,
    type: parsed.value.type,
    subjectId: scope.subjectId,
    gradeId: scope.gradeId,
    academicFieldId: scope.academicFieldId,
    academicTermId: scope.academicTermId,
    freemiusPlanId: parsed.value.freemiusPlanId,
    priceMinor: parsed.value.priceMinor,
    monthlyCreditAllowance: parsed.value.monthlyCreditAllowance,
    currency: parsed.value.currency,
    isActive: parsed.value.isActive,
  });

  if (parsed.value.kind === 'BUNDLE') {
    await billing.setBundleSubjects(offer.id, scope.bundleSubjectIds);
  }

  const status = String(form.get('intent') ?? '') === 'draft' ? 'offer_drafted' : 'offer_saved';
  return withQuery(auth.origin, BACK, { status });
}
