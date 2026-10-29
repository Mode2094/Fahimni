import { toggleFieldActive, updateField } from '../../../../../lib/admin/actions';
import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../lib/admin/http';
import { fieldInputSchema, formValues } from '../../../../../lib/admin/schemas';
import { adminStore } from '../../../../../lib/admin/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const { id } = await context.params;
  const form = await request.formData();
  const intent = String(form.get('intent') ?? 'update');
  const store = adminStore();

  if (intent === 'toggle') {
    const result = await toggleFieldActive(store, id);
    if (!result.ok) return withQuery(auth.origin, '/admin/fields', { error: result.reason });
    return withQuery(auth.origin, '/admin/fields', { status: 'updated' });
  }

  const parsed = fieldInputSchema.safeParse(formValues(form));
  if (!parsed.success) return withQuery(auth.origin, `/admin/fields/${id}`, { error: 'invalid' });

  const result = await updateField(store, id, parsed.data);
  if (!result.ok) return withQuery(auth.origin, `/admin/fields/${id}`, { error: result.reason });
  return withQuery(auth.origin, '/admin/fields', { status: 'updated' });
}
