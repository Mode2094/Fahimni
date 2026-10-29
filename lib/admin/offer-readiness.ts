import type { OfferKind, PlanType } from '../billing/store';

export type OfferReadinessIssue =
  | 'plan_id_required'
  | 'price_required'
  | 'term_required'
  | 'term_inactive'
  | 'term_ended'
  | 'bundle_subjects_required';

export const OFFER_ISSUE_LABELS: Record<OfferReadinessIssue, string> = {
  plan_id_required: 'أدخل رقم خطة الدفع في فريميوس',
  price_required: 'أدخل السعر',
  term_required: 'اختر فصلًا دراسيًا',
  term_inactive: 'الفصل الدراسي المختار معطّل',
  term_ended: 'الفصل الدراسي المختار انتهى',
  bundle_subjects_required: 'اختر مادة واحدة على الأقل للباقة',
};

export type OfferReadinessInput = {
  kind: OfferKind;
  type: PlanType;
  freemiusPlanId: string | null;
  priceMinor: number | null;
  term: { isActive: boolean; endsAt: Date } | null;
  bundleSubjectIds: readonly string[];
  now?: Date;
};

// A single source of truth for "can this offer be sold?". Used by the admin
// readiness page, the offer wizard review step and every publish/activate
// route so a half-configured offer can never reach checkout.
export function offerReadiness(input: OfferReadinessInput): { ready: boolean; issues: OfferReadinessIssue[] } {
  const issues: OfferReadinessIssue[] = [];
  if (!input.freemiusPlanId) issues.push('plan_id_required');
  if (input.priceMinor === null) issues.push('price_required');

  if (input.type === 'SEMESTER') {
    if (!input.term) {
      issues.push('term_required');
    } else {
      if (!input.term.isActive) issues.push('term_inactive');
      if (input.term.endsAt.getTime() < (input.now ?? new Date()).getTime()) issues.push('term_ended');
    }
  }

  if (input.kind === 'BUNDLE' && input.bundleSubjectIds.length === 0) issues.push('bundle_subjects_required');

  return { ready: issues.length === 0, issues };
}
