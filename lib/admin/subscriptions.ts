import { termWindowFromCalendarDates } from '../billing/terms';
import type { BillingStore, OfferKind, PlanType } from '../billing/store';
import type { StudentStore } from '../student/store';
import { DEFAULT_CURRENCY, parseMoneyToMinor } from './money';

export type TermFormValue = {
  name: string;
  academicYear: string;
  gradeId: string;
  academicFieldId: string | null;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
};

export type TermFormResult = { ok: true; value: TermFormValue } | { ok: false; error: string };

// Admin form parsing only; existence and scope checks happen against stores in
// the route so a forged id can never widen a term.
export function parseTermForm(form: FormData): TermFormResult {
  const name = String(form.get('name') ?? '').trim();
  const academicYear = String(form.get('academicYear') ?? '').trim();
  const gradeId = String(form.get('gradeId') ?? '').trim();
  const fieldRaw = String(form.get('academicFieldId') ?? '').trim();
  const startDate = String(form.get('startDate') ?? '').trim();
  const endDate = String(form.get('endDate') ?? '').trim();
  const isActive = form.get('isActive') === 'on';

  if (!name || name.length > 80 || !academicYear || academicYear.length > 20) return { ok: false, error: 'invalid' };
  if (!gradeId) return { ok: false, error: 'invalid_grade' };
  const window = termWindowFromCalendarDates(startDate, endDate);
  if (!window) return { ok: false, error: 'invalid_term_dates' };

  return {
    ok: true,
    value: {
      name,
      academicYear,
      gradeId,
      academicFieldId: fieldRaw || null,
      startsAt: window.startsAt,
      endsAt: window.endsAt,
      isActive,
    },
  };
}

export type OfferFormValue = {
  kind: OfferKind;
  type: PlanType;
  gradeId: string | null;
  academicFieldId: string | null;
  academicTermId: string | null;
  subjectId: string | null;
  priceMinor: number | null;
  monthlyCreditAllowance: number;
  currency: string;
  freemiusPlanId: string | null;
  isActive: boolean;
  bundleSubjectIds: string[];
};

export type OfferFormResult = { ok: true; value: OfferFormValue } | { ok: false; error: string };

export function parseOfferForm(form: FormData): OfferFormResult {
  const kindRaw = String(form.get('kind') ?? '').trim();
  const typeRaw = String(form.get('type') ?? '').trim();
  if (kindRaw !== 'SUBJECT' && kindRaw !== 'BUNDLE') return { ok: false, error: 'invalid' };
  if (typeRaw !== 'MONTHLY' && typeRaw !== 'SEMESTER') return { ok: false, error: 'invalid' };
  const kind = kindRaw as OfferKind;
  const type = typeRaw as PlanType;

  // The wizard submits an explicit intent: "publish" forces activation (and
  // the full readiness checks below), "draft" forces it off, and the legacy
  // checkbox remains the fallback for non-wizard callers.
  const intentRaw = String(form.get('intent') ?? '').trim();
  const isActive = intentRaw === 'publish' ? true : intentRaw === 'draft' ? false : form.get('isActive') === 'on';

  const gradeId = String(form.get('gradeId') ?? '').trim() || null;
  const fieldRaw = String(form.get('academicFieldId') ?? '').trim();
  const termRaw = String(form.get('academicTermId') ?? '').trim();
  const subjectRaw = String(form.get('subjectId') ?? '').trim();
  const freemiusPlanId = String(form.get('freemiusPlanId') ?? '').trim();
  const currency = (String(form.get('currency') ?? DEFAULT_CURRENCY).trim().toUpperCase() || DEFAULT_CURRENCY).slice(0, 3);
  const bundleSubjectIds = form
    .getAll('bundleSubjectIds')
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (freemiusPlanId.length > 64) return { ok: false, error: 'invalid' };
  const price = parseMoneyToMinor(String(form.get('price') ?? '').trim(), currency);
  if (price === 'invalid') return { ok: false, error: 'invalid_price' };

  const creditsRaw = String(form.get('credits') ?? '').trim();
  const credits = creditsRaw ? Number(creditsRaw) : 0;
  if (!Number.isInteger(credits) || credits < 0 || credits > 100_000) return { ok: false, error: 'invalid' };

  if (kind === 'SUBJECT' && !subjectRaw) return { ok: false, error: 'invalid_subject' };
  if (kind === 'BUNDLE' && !gradeId) return { ok: false, error: 'invalid_grade' };
  if (type === 'SEMESTER' && !termRaw) return { ok: false, error: 'term_required' };

  if (isActive && !freemiusPlanId) return { ok: false, error: 'plan_id_required' };
  if (isActive && price === null) return { ok: false, error: 'price_required' };

  return {
    ok: true,
    value: {
      kind,
      type,
      gradeId,
      academicFieldId: fieldRaw || null,
      academicTermId: type === 'SEMESTER' ? termRaw : null,
      subjectId: kind === 'SUBJECT' ? subjectRaw : null,
      priceMinor: price,
      monthlyCreditAllowance: credits,
      currency,
      freemiusPlanId: freemiusPlanId || null,
      isActive,
      bundleSubjectIds,
    },
  };
}

export type OfferEditValue = {
  priceMinor: number | null;
  monthlyCreditAllowance: number;
  currency: string;
  freemiusPlanId: string | null;
  isActive: boolean;
  bundleSubjectIds: string[];
};

export type OfferEditResult = { ok: true; value: OfferEditValue } | { ok: false; error: string };

// Editable fields only: an offer's identity (kind/type/subject/grade/field/term)
// is fixed at creation so an edit can never silently re-scope sold offers.
export function parseOfferEditForm(form: FormData): OfferEditResult {
  const freemiusPlanId = String(form.get('freemiusPlanId') ?? '').trim();
  const currency = (String(form.get('currency') ?? DEFAULT_CURRENCY).trim().toUpperCase() || DEFAULT_CURRENCY).slice(0, 3);
  const isActive = form.get('isActive') === 'on';
  const bundleSubjectIds = form
    .getAll('bundleSubjectIds')
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (freemiusPlanId.length > 64) return { ok: false, error: 'invalid' };
  const price = parseMoneyToMinor(String(form.get('price') ?? '').trim(), currency);
  if (price === 'invalid') return { ok: false, error: 'invalid_price' };

  const creditsRaw = String(form.get('credits') ?? '').trim();
  const credits = creditsRaw ? Number(creditsRaw) : 0;
  if (!Number.isInteger(credits) || credits < 0 || credits > 100_000) return { ok: false, error: 'invalid' };

  if (isActive && !freemiusPlanId) return { ok: false, error: 'plan_id_required' };
  if (isActive && price === null) return { ok: false, error: 'price_required' };

  return {
    ok: true,
    value: { priceMinor: price, monthlyCreditAllowance: credits, currency, freemiusPlanId: freemiusPlanId || null, isActive, bundleSubjectIds },
  };
}

export type OfferScope = {
  // SUBJECT offers derive scope from the subject; BUNDLE offers from grade/field.
  gradeId: string | null;
  academicFieldId: string | null;
  academicTermId: string | null;
  subjectId: string | null;
  bundleSubjectIds: string[];
};

export type ScopeResult = { ok: true; scope: OfferScope } | { ok: false; error: string };

// Existence + scope validation against real catalog data: a forged form can
// never attach subjects from another grade/field or a mismatched term.
export async function validateOfferScope(
  value: OfferFormValue,
  deps: { students: StudentStore; billing: BillingStore },
): Promise<ScopeResult> {
  let scopeGradeId: string | null = null;
  let scopeFieldId: string | null = null;

  if (value.kind === 'SUBJECT') {
    const subject = await deps.students.findSubjectById(value.subjectId as string);
    if (!subject) return { ok: false, error: 'invalid_subject' };
    scopeGradeId = subject.gradeId;
    scopeFieldId = subject.academicFieldId;
  } else {
    const grade = await deps.students.findGradeById(value.gradeId as string);
    if (!grade) return { ok: false, error: 'invalid_grade' };
    scopeGradeId = grade.id;
    if (value.academicFieldId) {
      const field = await deps.students.findFieldById(value.academicFieldId);
      if (!field || field.gradeId !== grade.id) return { ok: false, error: 'invalid_field' };
      scopeFieldId = field.id;
    }
  }

  if (value.type === 'SEMESTER' && value.academicTermId) {
    const term = await deps.billing.findAcademicTermById(value.academicTermId);
    if (!term || term.gradeId !== scopeGradeId) return { ok: false, error: 'invalid_term' };
    // A grade-wide subject/bundle accepts any field-specific term; a
    // field-scoped one only accepts a matching or whole-grade term.
    const fieldMatches =
      term.academicFieldId === null ||
      term.academicFieldId === scopeFieldId ||
      (value.kind === 'SUBJECT' && scopeFieldId === null);
    if (!fieldMatches) return { ok: false, error: 'invalid_term' };
  }

  if (value.kind === 'BUNDLE') {
    if (!value.bundleSubjectIds.length) return { ok: false, error: 'bundle_subjects_required' };
    const unique = [...new Set(value.bundleSubjectIds)];
    for (const id of unique) {
      const subject = await deps.students.findSubjectById(id);
      if (!subject) return { ok: false, error: 'invalid_subject' };
      if (subject.gradeId !== scopeGradeId) return { ok: false, error: 'invalid_offer_scope' };
      const eligible =
        scopeFieldId === null
          ? subject.academicFieldId === null
          : subject.academicFieldId === null || subject.academicFieldId === scopeFieldId;
      if (!eligible) return { ok: false, error: 'invalid_offer_scope' };
    }
    return {
      ok: true,
      scope: {
        gradeId: scopeGradeId,
        academicFieldId: scopeFieldId,
        academicTermId: value.academicTermId,
        subjectId: null,
        bundleSubjectIds: unique,
      },
    };
  }

  return {
    ok: true,
    scope: {
      gradeId: null,
      academicFieldId: null,
      academicTermId: value.academicTermId,
      subjectId: value.subjectId,
      bundleSubjectIds: [],
    },
  };
}
