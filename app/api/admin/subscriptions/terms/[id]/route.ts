import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../../lib/admin/http';
import { parseTermForm } from '../../../../../../lib/admin/subscriptions';
import { billingStore } from '../../../../../../lib/billing/store';
import { studentStore } from '../../../../../../lib/student/store';

export const dynamic = 'force-dynamic';

const BACK = '/admin/subscriptions';

// Updates a term or toggles its active flag. Date changes are blocked when
// purchases were already sold against the term unless the admin explicitly
// confirms; even then the entitlements keep their contractual boundaries.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;

  const { id } = await context.params;
  const billing = billingStore();
  const term = await billing.findAcademicTermById(id);
  if (!term) return withQuery(auth.origin, BACK, { error: 'missing' });

  const form = await request.formData();
  if (String(form.get('intent') ?? '') === 'toggle') {
    await billing.setAcademicTermActive(id, !term.isActive);
    return withQuery(auth.origin, BACK, { status: term.isActive ? 'term_deactivated' : 'term_activated' });
  }

  const parsed = parseTermForm(form);
  if (!parsed.ok) return withQuery(auth.origin, BACK, { error: parsed.error });

  const students = studentStore();
  const grade = await students.findGradeById(parsed.value.gradeId);
  if (!grade) return withQuery(auth.origin, BACK, { error: 'invalid_grade' });
  if (parsed.value.academicFieldId) {
    const field = await students.findFieldById(parsed.value.academicFieldId);
    if (!field || field.gradeId !== grade.id) return withQuery(auth.origin, BACK, { error: 'invalid_field' });
  }

  const datesChanged =
    parsed.value.startsAt.getTime() !== term.startsAt.getTime() ||
    parsed.value.endsAt.getTime() !== term.endsAt.getTime();
  if (datesChanged) {
    const sold = await billing.countSoldEntitlementsForTerm(id);
    const confirmed = form.get('confirmDates') === 'on';
    if (sold > 0 && !confirmed) return withQuery(auth.origin, BACK, { error: 'term_dates_locked' });
  }

  await billing.upsertAcademicTerm({ id, ...parsed.value });
  return withQuery(auth.origin, BACK, { status: 'term_saved' });
}
