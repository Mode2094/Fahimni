import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../lib/admin/http';
import { parseTermForm } from '../../../../../lib/admin/subscriptions';
import { billingStore } from '../../../../../lib/billing/store';
import { studentStore } from '../../../../../lib/student/store';

export const dynamic = 'force-dynamic';

const BACK = '/admin/subscriptions';

// Creates an academic term. Calendar dates arrive as YYYY-MM-DD and are
// converted to Asia/Amman day boundaries server-side.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const form = await request.formData();
  const parsed = parseTermForm(form);
  if (!parsed.ok) return withQuery(auth.origin, BACK, { error: parsed.error });

  const students = studentStore();
  const grade = await students.findGradeById(parsed.value.gradeId);
  if (!grade) return withQuery(auth.origin, BACK, { error: 'invalid_grade' });
  if (parsed.value.academicFieldId) {
    const field = await students.findFieldById(parsed.value.academicFieldId);
    if (!field || field.gradeId !== grade.id) return withQuery(auth.origin, BACK, { error: 'invalid_field' });
  }

  await billingStore().upsertAcademicTerm({ id: crypto.randomUUID(), ...parsed.value });
  return withQuery(auth.origin, BACK, { status: 'term_saved' });
}
