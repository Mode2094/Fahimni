import { authorizeAdminRequest, forbidden, withQuery } from '../../../../../lib/admin/http';
import { semesterFormToInput, semesterInputSchema, formValuesGuard } from '../../../../../lib/admin/subscription-schemas';
import { semesterStore, type SemesterInput, type SemesterStatus } from '../../../../../lib/billing/semester-store';
import { termWindowFromCalendarDates, isValidTermWindow, ammanDayStart, ammanDayEnd } from '../../../../../lib/billing/terms';

export const dynamic = 'force-dynamic';

// Create a semester. Validates the Amman calendar window, rejects invalid and
// overlapping active/scheduled semesters, and stores price in minor units.
export async function POST(request: Request) {
  const auth = await authorizeAdminRequest(request);
  if (auth.kind === 'forbidden') return forbidden();
  if (auth.kind === 'login') return auth.response;
  const back = '/admin/subscriptions?section=semesters';

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return withQuery(auth.origin, back, { error: 'invalid' });
  }
  const parsed = semesterInputSchema.safeParse(formValuesGuard(form));
  if (!parsed.success) return withQuery(auth.origin, back, { error: 'invalid' });
  const money = semesterFormToInput(parsed.data);
  if (!money.ok) return withQuery(auth.origin, back, { error: 'semester_price_invalid' });

  const window = termWindowFromCalendarDates(parsed.data.startDate, parsed.data.endDate);
  if (!window || !isValidTermWindow(window.startsAt, window.endsAt)) {
    return withQuery(auth.origin, back, { error: 'semester_invalid_dates' });
  }
  const salesStartAt = parsed.data.salesStartDate ? ammanDayStart(parsed.data.salesStartDate) : new Date();
  const salesEndAt = parsed.data.salesEndDate ? ammanDayEnd(parsed.data.salesEndDate) : null;
  if (salesEndAt && salesEndAt.getTime() <= salesStartAt.getTime()) {
    return withQuery(auth.origin, back, { error: 'semester_invalid_dates' });
  }

  const store = semesterStore();
  const status = parsed.data.status as SemesterStatus;
  if (status === 'SCHEDULED' || status === 'ACTIVE') {
    const overlapping = await store.findOverlapping({
      gradeId: parsed.data.gradeId,
      academicFieldId: parsed.data.academicFieldId,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
    });
    if (overlapping.length) return withQuery(auth.origin, back, { error: 'semester_overlap' });
  }

  const input: SemesterInput = {
    id: crypto.randomUUID(),
    name: parsed.data.name,
    academicYear: parsed.data.academicYear,
    gradeId: parsed.data.gradeId,
    academicFieldId: parsed.data.academicFieldId,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    salesStartAt,
    salesEndAt,
    priceMinor: money.priceMinor,
    currency: money.currency,
    includedCredits: parsed.data.includedCredits,
    status,
    lateEnrollmentPolicy: parsed.data.lateEnrollmentPolicy,
    topUpEnabled: parsed.data.topUpEnabled,
    freemiusPlanId: parsed.data.freemiusPlanId,
    adminNotes: parsed.data.adminNotes,
    createdBy: auth.user.id,
  };
  await store.createSemester(input);
  return withQuery(auth.origin, back, { status: 'semester_created' });
}
