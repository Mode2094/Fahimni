import type { PlanType, SubscriptionOfferRecord } from '../billing/store';

export const PLAN_LABELS: Record<PlanType, string> = { MONTHLY: 'شهري', SEMESTER: 'فصلي' };

export type OfferLabelContext = {
  subjectNames: Map<string, string>;
  gradeNames: Map<string, string>;
  fieldNames: Map<string, string>;
  termNames: Map<string, string>;
};

export function offerDisplayTitle(offer: SubscriptionOfferRecord, context: OfferLabelContext): string {
  const termLabel = offer.academicTermId ? ` · ${context.termNames.get(offer.academicTermId) ?? 'فصل'}` : '';
  if (offer.kind === 'SUBJECT') {
    return `${context.subjectNames.get(offer.subjectId ?? '') ?? 'مادة'} — ${PLAN_LABELS[offer.type]}${termLabel}`;
  }
  const fieldLabel = offer.academicFieldId ? ` / ${context.fieldNames.get(offer.academicFieldId) ?? ''}` : '';
  return `باقة جميع المواد — ${PLAN_LABELS[offer.type]}${termLabel} · ${context.gradeNames.get(offer.gradeId ?? '') ?? 'صف'}${fieldLabel}`;
}
