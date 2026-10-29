import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';

type Db = NodePgDatabase<typeof schema>;

const GRADES = [
  { slug: 'grade-11', name: 'الصف الحادي عشر', sortOrder: 1 },
  { slug: 'tawjihi', name: 'الصف الثاني عشر (توجيهي)', sortOrder: 2 },
];

const FIELDS: Record<string, { slug: string; name: string; sortOrder: number }[]> = {
  tawjihi: [
    { slug: 'scientific-technological', name: 'الحقل العلمي والتكنولوجي', sortOrder: 1 },
    { slug: 'medical', name: 'الحقل الطبي', sortOrder: 2 },
    { slug: 'literary', name: 'الحقل الأدبي', sortOrder: 3 },
    { slug: 'business', name: 'حقل الأعمال', sortOrder: 4 },
  ],
};

const SUBJECTS = [
  {
    slug: 'tawjihi-math',
    gradeSlug: 'tawjihi',
    fieldSlug: null,
    name: 'رياضيات التوجيهي',
    shortDescription: 'شرح مفصل وواضح لجميع وحدات منهاج الرياضيات للتوجيهي، بأسلوب سهل ومبسط مع أمثلة وتطبيقات.',
    isFeatured: true,
    sortOrder: 1,
    // Launch pricing from the approved pricing screen; stored as JOD fils.
    monthlyPriceMinor: 39_000,
    semesterPriceMinor: 99_000,
    currency: 'JOD',
  },
];

export type SeedSummary = { grades: number; fields: number; subjects: number };

const DEFAULT_PLANS: Record<string, { type: 'MONTHLY' | 'SEMESTER'; priceMinor: number; monthlyCreditAllowance: number }[]> = {
  'tawjihi-math': [
    { type: 'MONTHLY', priceMinor: 39_000, monthlyCreditAllowance: 200 },
    { type: 'SEMESTER', priceMinor: 99_000, monthlyCreditAllowance: 600 },
  ],
};

// Idempotent: every row is upserted by its natural key, so re-running is safe.
export async function seedCatalog(db: Db): Promise<SeedSummary> {
  const now = new Date();
  const gradeIds = new Map<string, string>();
  for (const grade of GRADES) {
    const [row] = await db
      .insert(schema.grades)
      .values({ id: crypto.randomUUID(), ...grade, isActive: true, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.grades.slug,
        set: { name: grade.name, sortOrder: grade.sortOrder, isActive: true, updatedAt: now },
      })
      .returning({ id: schema.grades.id });
    gradeIds.set(grade.slug, row.id);
  }

  const fieldIds = new Map<string, string>();
  let fieldCount = 0;
  for (const [gradeSlug, fields] of Object.entries(FIELDS)) {
    const gradeId = gradeIds.get(gradeSlug);
    if (!gradeId) continue;
    for (const field of fields) {
      const [row] = await db
        .insert(schema.academicFields)
        .values({ id: crypto.randomUUID(), gradeId, ...field, isActive: true })
        .onConflictDoUpdate({
          target: [schema.academicFields.gradeId, schema.academicFields.slug],
          set: { name: field.name, sortOrder: field.sortOrder, isActive: true },
        })
        .returning({ id: schema.academicFields.id });
      fieldIds.set(`${gradeSlug}:${field.slug}`, row.id);
      fieldCount += 1;
    }
  }

  const subjectIds = new Map<string, string>();
  for (const subject of SUBJECTS) {
    const gradeId = gradeIds.get(subject.gradeSlug);
    if (!gradeId) continue;
    const academicFieldId = subject.fieldSlug ? fieldIds.get(`${subject.gradeSlug}:${subject.fieldSlug}`) ?? null : null;
    const [row] = await db
      .insert(schema.subjects)
      .values({
        id: crypto.randomUUID(),
        gradeId,
        academicFieldId,
        name: subject.name,
        slug: subject.slug,
        shortDescription: subject.shortDescription,
        image: null,
        isActive: true,
        isFeatured: subject.isFeatured,
        sortOrder: subject.sortOrder,
        monthlyPriceMinor: subject.monthlyPriceMinor,
        semesterPriceMinor: subject.semesterPriceMinor,
        currency: subject.currency,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.subjects.slug,
        set: {
          gradeId,
          academicFieldId,
          name: subject.name,
          shortDescription: subject.shortDescription,
          isActive: true,
          isFeatured: subject.isFeatured,
          sortOrder: subject.sortOrder,
          updatedAt: now,
        },
      })
      .returning({ id: schema.subjects.id });
    subjectIds.set(subject.slug, row.id);
  }

  // Default (disabled) subscription plans with local display prices. Admins
  // enable them and attach Freemius plan ids; existing rows are never touched.
  for (const [slug, plans] of Object.entries(DEFAULT_PLANS)) {
    const subjectId = subjectIds.get(slug);
    if (!subjectId) continue;
    for (const plan of plans) {
      await db
        .insert(schema.subjectPlans)
        .values({
          id: crypto.randomUUID(),
          subjectId,
          type: plan.type,
          freemiusPlanId: null,
          priceMinor: plan.priceMinor,
          monthlyCreditAllowance: plan.monthlyCreditAllowance,
          currency: 'JOD',
          isActive: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [schema.subjectPlans.subjectId, schema.subjectPlans.type] });
    }
  }

  return { grades: GRADES.length, fields: fieldCount, subjects: SUBJECTS.length };
}
