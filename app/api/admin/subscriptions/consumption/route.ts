import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../lib/admin/http';
import { formValuesGuard } from '../../../../../lib/admin/subscription-schemas';
import { AI_SERVICE_KEYS, isAiServiceKey, parseCreditCost, setCreditCost } from '../../../../../lib/credits/costs';

export const dynamic = 'force-dynamic';

// Save the per-service credit consumption table. Each field is validated
// against its safe bounds; an out-of-range value rejects the whole save so a
// misconfiguration can never drain a student wallet.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;
  const back = '/admin/subscriptions?section=consumption';

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withQuery(auth.origin, back, { error: 'invalid' });
  }
  const values = formValuesGuard(form);

  const updates: { service: (typeof AI_SERVICE_KEYS)[number]; value: number }[] = [];
  for (const service of AI_SERVICE_KEYS) {
    const key = `cost_${service}`;
    if (!(key in values)) continue;
    const parsed = parseCreditCost(service, values[key]);
    if (parsed === null) continue;
    if (parsed === 'invalid') return withQuery(auth.origin, back, { error: 'credit_cost_invalid' });
    updates.push({ service, value: parsed });
  }

  for (const update of updates) {
    if (!isAiServiceKey(update.service)) continue;
    await setCreditCost(update.service, update.value, { id: auth.user.id, email: auth.user.email });
  }
  return withQuery(auth.origin, back, { status: 'consumption_saved' });
}
