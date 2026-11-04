import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../../lib/admin/http';
import { formValuesGuard, semesterFormToInput, semesterInputSchema, semesterStatusSchema } from '../../../../../../lib/admin/subscription-schemas';
import { semesterStore, type SemesterPatch, type SemesterStatus } from '../../../../../../lib/billing/semester-store';
import { termWindowFromCalendarDates, isValidTermWindow, ammanDayStart, ammanDayEnd } from '../../../../../../lib/billing/terms';

export const dynamic = 'force-dynamic';

// Edit or archive a semester. Financial terms of a semester that already sold
// subscriptions are frozen (immutable purchase snapshots protect buyers; we
// also refuse to silently rewrite the live terms they were sold under).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;
  const { id } = await context.params;
  const back = `/admin/subscriptions?section=semesters`;

  const store = semesterStore();
  const existing = await store.findSemesterById(id);
  if (!existing) return withQuery(auth.origin, back, { error: 'semester_not_found' });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withQuery(auth.origin, back, { error: 'invalid' });
  }
  const values = formValuesGuard(form);

  // Toggle/archive intent path.
  const intent = values.intent;
  if (intent === 'status') {
    const status = semesterStatusSchema.safeParse(values.status);
    if (!status.success) return withQuery(auth.origin, back, { error: 'invalid' });
    await store.updateSemester(id, { status: status.data as SemesterStatus });
    if (status.data === 'ARCHIVED') return withQuery(auth.origin, back, { status: 'semester_archived' });
    return withQuery(auth.origin, back, { status: 'semester_saved' });
  }

  const sold = await store.listSubscribers(id);
  const parsed = semesterInputSchema.safeParse(values);
  if (!parsed.success) return withQuery(auth.origin, back, { error: 'invalid' });
  const money = semesterFormToInput(parsed.data);
  if (!money.ok) return withQuery(auth.origin, back, { error: 'semester_price_invalid' });

  const window = termWindowFromCalendarDates(parsed.data.startDate, parsed.data.endDate);
  if (!window || !isValidTermWindow(window.startsAt, window.endsAt)) {
    return withQuery(auth.origin, back, { error: 'semester_invalid_dates' });
  }

  // Freeze financial terms once subscriptions exist.
  if (sold.length > 0) {
    const financialChanged =
      money.priceMinor !== existing.priceMinor ||
      money.currency !== existing.currency ||
      parsed.data.includedCredits !== existing.includedCredits ||
      window.startsAt.getTime() !== existing.startsAt.getTime() ||
      window.endsAt.getTime() !== existing.endsAt.getTime();
    if (financialChanged) return withQuery(auth.origin, back, { error: 'semester_sold_locked' });
  }

  const status = parsed.data.status as SemesterStatus;
  if (status === 'SCHEDULED' || status === 'ACTIVE') {
    const overlapping = await store.findOverlapping({
      gradeId: parsed.data.gradeId,
      academicFieldId: parsed.data.academicFieldId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      excludeId: id,
    });
    if (overlapping.length) return withQuery(auth.origin, back, { error: 'semester_overlap' });
  }

  const patch: SemesterPatch = {
    name: parsed.data.name,
    academicYear: parsed.data.academicYear,
    gradeId: parsed.data.gradeId,
    academicFieldId: parsed.data.academicFieldId,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    salesStartAt: parsed.data.salesStartDate ? ammanDayStart(parsed.data.salesStartDate) : existing.salesStartAt,
    salesEndAt: parsed.data.salesEndDate ? ammanDayEnd(parsed.data.salesEndDate) : null,
    priceMinor: money.priceMinor,
    currency: money.currency,
    includedCredits: parsed.data.includedCredits,
    status,
    lateEnrollmentPolicy: parsed.data.lateEnrollmentPolicy,
    topUpEnabled: parsed.data.topUpEnabled,
    freemiusPlanId: parsed.data.freemiusPlanId,
    adminNotes: parsed.data.adminNotes,
  };
  await store.updateSemester(id, patch);
  return withQuery(auth.origin, back, { status: 'semester_saved' });
}
