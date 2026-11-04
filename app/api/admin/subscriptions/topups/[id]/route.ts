import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../../lib/admin/http';
import { formValuesGuard, topupFormToInput, topupOfferInputSchema } from '../../../../../../lib/admin/subscription-schemas';
import { topupStore, type TopupOfferStatus } from '../../../../../../lib/billing/topup-store';

export const dynamic = 'force-dynamic';

const STATUSES: TopupOfferStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'];

// Edit or change the status of a top-up offer. Identity is immutable; pausing
// and reactivating are always allowed.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;
  const { id } = await context.params;
  const back = '/admin/subscriptions?section=topups';

  const store = topupStore();
  const existing = await store.findOfferById(id);
  if (!existing) return withQuery(auth.origin, back, { error: 'topup_not_found' });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withQuery(auth.origin, back, { error: 'invalid' });
  }
  const values = formValuesGuard(form);
  if (values.intent === 'status') {
    const status = values.status as TopupOfferStatus;
    if (!STATUSES.includes(status)) return withQuery(auth.origin, back, { error: 'invalid' });
    await store.setOfferStatus(id, status);
    return withQuery(auth.origin, back, { status: 'topup_status_saved' });
  }

  const parsed = topupOfferInputSchema.safeParse(values);
  if (!parsed.success) return withQuery(auth.origin, back, { error: 'invalid' });
  const money = topupFormToInput(parsed.data);
  if (!money.ok) return withQuery(auth.origin, back, { error: 'topup_price_invalid' });

  await store.upsertOffer({
    id,
    name: parsed.data.name,
    credits: parsed.data.credits,
    priceMinor: money.priceMinor,
    currency: money.currency,
    status: parsed.data.status,
    sortOrder: parsed.data.sortOrder,
    freemiusPlanId: parsed.data.freemiusPlanId,
  });
  return withQuery(auth.origin, back, { status: 'topup_saved' });
}
