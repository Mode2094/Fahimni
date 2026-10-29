import type { Metadata } from 'next';
import { BookOpen } from 'lucide-react';

import { FnBadge, FnCard } from '@/components/fahimni';
import { SubjectCard } from '@/components/student/subject-card';
import { resolveSubjectAccess } from '@/lib/billing/access-map';
import { billingStore } from '@/lib/billing/store';
import { booksStore } from '@/lib/books/store';
import { requireOnboardedStudent } from '@/lib/student/guard';
import { fieldNameFor } from '@/lib/student/onboarding';
import { studentStore } from '@/lib/student/store';
import { trialStore } from '@/lib/trial/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'المواد',
  description: 'جميع المواد المتاحة لصفك الدراسي.',
};

export default async function SubjectsPage() {
  const { user, profile } = await requireOnboardedStudent('/app/subjects');
  const store = studentStore();
  const billing = billingStore();
  const trials = trialStore();

  const [grade, fields, subjects, trial, trialSettings] = await Promise.all([
    store.findGradeById(profile.gradeId),
    store.listActiveFieldsForGrade(profile.gradeId),
    store.listSubjectsForStudent(profile.gradeId, profile.academicFieldId),
    trials.findByUserId(user.id),
    trials.getSettings(),
  ]);
  const fieldName = fieldNameFor(fields, profile.academicFieldId);

  const readyBooks = await Promise.all(subjects.map((subject) => booksStore().findReadyBookBySubject(subject.id)));
  const readyBookIds = new Set(subjects.filter((_, index) => readyBooks[index] !== null).map((subject) => subject.id));
  const subjectStates = await resolveSubjectAccess({
    billing,
    userId: user.id,
    subjects,
    trial,
    trialEnabled: trialSettings.enabled,
    readyBookIds,
  });
  const trialSiteKey = ((process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? process.env.TURNSTILE_SITE_KEY) || '').trim() || null;

  return (
    <div className="fn-container fn-stack fn-stack--lg">
      <header className="fn-stack fn-stack--sm">
        <h1 className="fn-display fn-display--xl">المواد المتاحة</h1>
        <p className="fn-subtitle">اختر المادة التي تريد التعلم منها.</p>
        {grade ? (
          <span>
            <FnBadge variant="outline">
              {grade.name}
              {fieldName ? ` · ${fieldName}` : ''}
            </FnBadge>
          </span>
        ) : null}
      </header>

      {subjects.length > 0 ? (
        <div className="subjects-grid">
          {subjects.map((subject) => (
            <SubjectCard
              key={subject.id}
              subject={subject}
              state={subjectStates.get(subject.id) ?? 'none'}
              siteKey={trialSiteKey}
            />
          ))}
        </div>
      ) : (
        <FnCard variant="flat" className="fn-empty">
          <div className="fn-icon-tile fn-icon-tile--lg">
            <BookOpen size={26} aria-hidden="true" />
          </div>
          <p className="fn-empty__title">لا توجد مواد متاحة لهذا الصف حاليًا</p>
          <p className="fn-empty__text">نعمل على إضافة مواد صفك قريبًا.</p>
        </FnCard>
      )}
    </div>
  );
}
