import { z } from 'zod';

import { DEFAULT_CURRENCY, parseMoneyToMinor } from './money';

// Admin form schemas for the unified semester subscription and top-up catalog.
// Prices are parsed to integer minor units; dates are Asia/Amman calendar dates
// converted server-side. Nothing here trusts a client-supplied price.

const checkbox = z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean());
const calendarDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalCalendarDate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() ? value.trim() : null),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
);
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() ? value.trim() : null),
    z.string().max(max).nullable(),
  );

export const semesterStatusSchema = z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'ARCHIVED']);
export const lateEnrollmentPolicySchema = z.enum(['FULL_PRICE', 'PRORATED']);

export const semesterInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  academicYear: z.string().trim().min(2).max(40),
  gradeId: z.string().uuid(),
  academicFieldId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() ? value.trim() : null),
    z.string().uuid().nullable(),
  ),
  startDate: calendarDate,
  endDate: calendarDate,
  salesStartDate: optionalCalendarDate,
  salesEndDate: optionalCalendarDate,
  price: z.string().trim().min(1).max(20),
  currency: z.string().trim().min(2).max(8).default(DEFAULT_CURRENCY),
  includedCredits: z.coerce.number().int().min(0).max(100_000),
  status: semesterStatusSchema,
  lateEnrollmentPolicy: lateEnrollmentPolicySchema,
  topUpEnabled: checkbox,
  freemiusPlanId: optionalText(120),
  adminNotes: optionalText(2000),
});
export type SemesterFormInput = z.infer<typeof semesterInputSchema>;

export const topupOfferInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  credits: z.coerce.number().int().min(1).max(100_000),
  price: z.string().trim().min(1).max(20),
  currency: z.string().trim().min(2).max(8).default(DEFAULT_CURRENCY),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  freemiusPlanId: optionalText(120),
});
export type TopupOfferFormInput = z.infer<typeof topupOfferInputSchema>;

export const creditAdjustmentSchema = z.object({
  userId: z.string().uuid(),
  bucket: z.enum(['SEMESTER', 'TOPUP']),
  // Non-zero integer delta; a mandatory reason is enforced by the handler.
  delta: z.coerce.number().int().min(-100_000).max(100_000).refine((value) => value !== 0, { message: 'delta_nonzero' }),
  reason: z.string().trim().min(3).max(500),
});
export type CreditAdjustmentInput = z.infer<typeof creditAdjustmentSchema>;

// Collects FormData string values into a plain object for schema parsing.
export function formValuesGuard(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

export function semesterFormToInput(form: SemesterFormInput): { ok: true; priceMinor: number; currency: string } | { ok: false } {  const priceMinor = parseMoneyToMinor(form.price, form.currency);
  if (priceMinor === 'invalid' || priceMinor === null || priceMinor <= 0) return { ok: false };
  return { ok: true, priceMinor, currency: form.currency.toUpperCase() };
}

export function topupFormToInput(form: TopupOfferFormInput): { ok: true; priceMinor: number; currency: string } | { ok: false } {
  const priceMinor = parseMoneyToMinor(form.price, form.currency);
  if (priceMinor === 'invalid' || priceMinor === null || priceMinor <= 0) return { ok: false };
  return { ok: true, priceMinor, currency: form.currency.toUpperCase() };
}
