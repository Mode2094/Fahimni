import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../../lib/admin/http';
import { creditAdjustmentSchema, formValuesGuard } from '../../../../../../lib/admin/subscription-schemas';
import { creditWalletStore } from '../../../../../../lib/billing/wallet-store';

export const dynamic = 'force-dynamic';

// Authorised manual credit adjustment. A mandatory reason is stored in the
// ledger with the acting admin's id; a negative result is refused.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;
  const back = '/admin/subscriptions?section=credits';

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withQuery(auth.origin, back, { error: 'invalid' });
  }
  const parsed = creditAdjustmentSchema.safeParse(formValuesGuard(form));
  if (!parsed.success) return withQuery(auth.origin, back, { error: 'credit_adjust_invalid' });

  // A semester adjustment must name the exact semester; never an arbitrary one.
  if (parsed.data.bucket === 'SEMESTER' && !parsed.data.semesterId) {
    return withQuery(auth.origin, back, { error: 'credit_adjust_invalid' });
  }

  try {
    await creditWalletStore().adjust({
      userId: parsed.data.userId,
      bucket: parsed.data.bucket,
      delta: parsed.data.delta,
      actorId: auth.user.id,
      reason: parsed.data.reason,
      semesterId: parsed.data.semesterId ?? null,
      requestId: `admin-adjust:${crypto.randomUUID()}`,
    });
  } catch {
    return withQuery(auth.origin, back, { error: 'credit_adjust_invalid' });
  }
  return withQuery(auth.origin, back, { status: 'credit_adjusted', user: parsed.data.userId });
}
