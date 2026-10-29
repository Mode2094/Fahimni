import { toggleSubjectActive, toggleSubjectFeatured, updateSubject } from '../../../../../lib/admin/actions';
import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../lib/admin/http';
import { formValues, subjectFormToInput, subjectInputSchema } from '../../../../../lib/admin/schemas';
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

  if (intent === 'toggle' || intent === 'toggle-featured') {
    const result = intent === 'toggle' ? await toggleSubjectActive(store, id) : await toggleSubjectFeatured(store, id);
    if (!result.ok) return withQuery(auth.origin, '/admin/subjects', { error: result.reason });
    return withQuery(auth.origin, '/admin/subjects', { status: 'updated' });
  }

  const parsed = subjectInputSchema.safeParse(formValues(form));
  if (!parsed.success) return withQuery(auth.origin, `/admin/subjects/${id}`, { error: 'invalid' });

  const result = await updateSubject(store, id, subjectFormToInput(parsed.data));
  if (!result.ok) return withQuery(auth.origin, `/admin/subjects/${id}`, { error: result.reason });
  return withQuery(auth.origin, '/admin/subjects', { status: 'updated' });
}
