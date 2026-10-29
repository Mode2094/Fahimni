import { z } from 'zod';

import { authorizeAdminRequest, forbidden, withQuery } from '../../../../lib/admin/http';
import { formValues } from '../../../../lib/admin/schemas';
import { MAX_DEVICES_LIMIT, deviceStore } from '../../../../lib/devices/store';

export const dynamic = 'force-dynamic';

const schema = z.object({
  maxDevices: z.coerce.number().int().min(1).max(MAX_DEVICES_LIMIT),
});

export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const parsed = schema.safeParse(formValues(await request.formData()));
  if (!parsed.success) return withQuery(auth.origin, '/admin/settings', { error: 'invalid' });

  await deviceStore().setMaxDevices(parsed.data.maxDevices);
  return withQuery(auth.origin, '/admin/settings', { status: 'updated' });
}
