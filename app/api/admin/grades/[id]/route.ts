import { deleteGrade, toggleGradeActive, updateGrade } from '../../../../../lib/admin/actions';
import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../lib/admin/http';
import { formValues, gradeInputSchema } from '../../../../../lib/admin/schemas';
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
    const result = await toggleGradeActive(store, id);
    if (!result.ok) return withQuery(auth.origin, '/admin/grades', { error: result.reason });
    return withQuery(auth.origin, '/admin/grades', { status: 'updated' });
  }

  if (intent === 'delete') {
    const result = await deleteGrade(store, id);
    if (!result.ok) return withQuery(auth.origin, '/admin/grades', { error: result.reason });
    return withQuery(auth.origin, '/admin/grades', { status: 'deleted' });
  }

  const parsed = gradeInputSchema.safeParse(formValues(form));
  if (!parsed.success) return withQuery(auth.origin, `/admin/grades/${id}`, { error: 'invalid' });

  const result = await updateGrade(store, id, parsed.data);
  if (!result.ok) return withQuery(auth.origin, `/admin/grades/${id}`, { error: result.reason });
  return withQuery(auth.origin, '/admin/grades', { status: 'updated' });
}
