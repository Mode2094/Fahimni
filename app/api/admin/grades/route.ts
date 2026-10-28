import { createGrade } from '../../../../lib/admin/actions';
import { authorizeAdminRequest, forbidden, withQuery } from '../../../../lib/admin/http';
import { formValues, gradeInputSchema } from '../../../../lib/admin/schemas';
import { adminStore } from '../../../../lib/admin/store';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const parsed = gradeInputSchema.safeParse(formValues(await request.formData()));
  if (!parsed.success) return withQuery(auth.origin, '/admin/grades/new', { error: 'invalid' });

  const result = await createGrade(adminStore(), parsed.data);
  if (!result.ok) return withQuery(auth.origin, '/admin/grades/new', { error: result.reason });
  return withQuery(auth.origin, '/admin/grades', { status: 'created' });
}
