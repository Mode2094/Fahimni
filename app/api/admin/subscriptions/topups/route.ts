import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../lib/admin/http';
import { formValuesGuard, topupFormToInput, topupOfferInputSchema } from '../../../../../lib/admin/subscription-schemas';
import { topupStore } from '../../../../../lib/billing/topup-store';

export const dynamic = 'force-dynamic';

// Create a top-up offer. Offers start in whatever status the admin chose
// (draft by default) and are never auto-activated: an offer only sells once its
// provider link is verified and the owner approves.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;
  const back = '/admin/subscriptions?section=topups';

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withQuery(auth.origin, back, { error: 'invalid' });
  }
  const parsed = topupOfferInputSchema.safeParse(formValuesGuard(form));
  if (!parsed.success) return withQuery(auth.origin, back, { error: 'invalid' });
  const money = topupFormToInput(parsed.data);
  if (!money.ok) return withQuery(auth.origin, back, { error: 'topup_price_invalid' });

  await topupStore().upsertOffer({
    id: crypto.randomUUID(),
    name: parsed.data.name,
    credits: parsed.data.credits,
    priceMinor: money.priceMinor,
    currency: money.currency,
    status: parsed.data.status,
    sortOrder: parsed.data.sortOrder,
    freemiusPlanId: parsed.data.freemiusPlanId,
  });
  return withQuery(auth.origin, back, { status: 'topup_created' });
}
