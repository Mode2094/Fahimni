import { z } from 'zod';

import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../lib/admin/http';
import { formValues } from '../../../../../lib/admin/schemas';
import { TRIAL_LIMITS } from '../../../../../lib/trial/config';
import { trialStore } from '../../../../../lib/trial/store';

export const dynamic = 'force-dynamic';

const checkbox = z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean());

const schema = z.object({
  trialEnabled: checkbox,
  creditAllowance: z.coerce.number().int().min(1).max(TRIAL_LIMITS.maxCreditAllowance),
  durationHours: z.coerce.number().int().min(TRIAL_LIMITS.minDurationHours).max(TRIAL_LIMITS.maxDurationHours),
  dailyBudgetUsd: z.coerce.number().min(0).max(TRIAL_LIMITS.maxDailyBudgetUsd),
});

// Settings apply to NEW trial claims only; existing trial wallets are never
// retroactively replenished.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const parsed = schema.safeParse(formValues(await request.formData()));
  if (!parsed.success) return withQuery(auth.origin, '/admin/settings', { error: 'invalid' });

  await trialStore().setSettings({
    enabled: parsed.data.trialEnabled,
    creditAllowance: parsed.data.creditAllowance,
    durationHours: parsed.data.durationHours,
    dailyBudgetUsd: parsed.data.dailyBudgetUsd,
  });
  return withQuery(auth.origin, '/admin/settings', { status: 'updated' });
}
