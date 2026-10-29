import { z } from 'zod';

import { DEFAULT_CURRENCY, parseMoneyToMinor } from './money';

const checkbox = z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean());
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const name = z.string().trim().min(2).max(80);
const sortOrder = z.coerce.number().int().min(0).max(9999);
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() ? value.trim() : null),
    z.string().max(max).nullable(),
  );

export const gradeInputSchema = z.object({
  name,
  slug,
  sortOrder,
  isActive: checkbox,
});

export const fieldInputSchema = z.object({
  gradeId: z.string().uuid(),
  name,
  slug,
  sortOrder,
  isActive: checkbox,
});

export const subjectInputSchema = z
  .object({
    gradeId: z.string().uuid(),
    academicFieldId: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() ? value.trim() : null),
      z.string().uuid().nullable(),
    ),
    name,
    slug,
    shortDescription: optionalText(300),
    image: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() ? value.trim() : null),
      z
        .union([z.string().regex(/^\/\S*$/), z.string().url().startsWith('https://')])
        .nullable(),
    ),
    isActive: checkbox,
    isFeatured: checkbox,
    sortOrder,
    monthlyPrice: z.string().trim().default(''),
    semesterPrice: z.string().trim().default(''),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default(DEFAULT_CURRENCY),
  })
  .superRefine((value, context) => {
    if (parseMoneyToMinor(value.monthlyPrice, value.currency) === 'invalid') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['monthlyPrice'], message: 'invalid_price' });
    }
    if (parseMoneyToMinor(value.semesterPrice, value.currency) === 'invalid') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['semesterPrice'], message: 'invalid_price' });
    }
  });

export type GradeFormInput = z.infer<typeof gradeInputSchema>;
export type FieldFormInput = z.infer<typeof fieldInputSchema>;
export type SubjectFormInput = z.infer<typeof subjectInputSchema>;

export function formValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') values[key] = value;
  }
  return values;
}

export function subjectFormToInput(form: SubjectFormInput) {
  const monthly = parseMoneyToMinor(form.monthlyPrice, form.currency);
  const semester = parseMoneyToMinor(form.semesterPrice, form.currency);
  return {
    gradeId: form.gradeId,
    academicFieldId: form.academicFieldId,
    name: form.name,
    slug: form.slug,
    shortDescription: form.shortDescription,
    image: form.image,
    isActive: form.isActive,
    isFeatured: form.isFeatured,
    sortOrder: form.sortOrder,
    currency: form.currency,
    monthlyPriceMinor: monthly === 'invalid' ? null : monthly,
    semesterPriceMinor: semester === 'invalid' ? null : semester,
  };
}
