import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Camera, ChevronLeft, ChevronRight, FileText, Images, Mic, Play } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { PlansSection } from '@/components/student/plans-section';
import { isEntitlementActive } from '@/lib/billing/entitlements';
import { billingStore } from '@/lib/billing/store';
import { fieldNameFor, visibleSubjectFor } from '@/lib/student/onboarding';
import { requireOnboardedStudent } from '@/lib/student/guard';
import { studentStore } from '@/lib/student/store';
import { SubjectIcon } from '@/components/student/subject-card';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'المادة',
  description: 'تفاصيل المادة في فهمني.',
};

const FEATURES = [
  { title: 'شرح خطوة بخطوة', text: 'حل مفصل وواضح لكل خطوة', icon: FileText, tile: 'fn-icon-tile' },
  { title: 'شرح بالصوت', text: 'استمع للشرح وتعلّم بصوتك', icon: Mic, tile: 'fn-icon-tile fn-icon-tile--mint' },
  { title: 'أسئلة من صور', text: 'التقط صورة السؤال واحصل على الشرح', icon: Camera, tile: 'fn-icon-tile fn-icon-tile--pink' },
  { title: 'أمثلة مشابهة', text: 'حل أمثلة إضافية لتثبيت الفهم', icon: Images, tile: 'fn-icon-tile fn-icon-tile--sky' },
];

export default async function SubjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { profile } = await requireOnboardedStudent('/app/subjects');
  const { slug } = await params;
  const store = studentStore();
  const subject = visibleSubjectFor(profile, await store.findSubjectBySlug(slug));
  if (!subject) notFound();

  const [grade, fields, plans, entitlement] = await Promise.all([
    store.findGradeById(subject.gradeId),
    store.listActiveFieldsForGrade(subject.gradeId),
    billingStore().listSubjectPlans(subject.id),
    billingStore().findAccessibleEntitlement(profile.userId, subject.id, new Date()),
  ]);
  const fieldName = fieldNameFor(fields, subject.academicFieldId);
  const entitled = isEntitlementActive(entitlement);

  return (
    <div className="fn-container fn-stack fn-stack--lg">
      <Link href="/app/subjects" className="fn-back">
        <ChevronRight size={16} aria-hidden="true" />
        كل المواد
      </Link>

      <FnCard variant="tinted" className="fn-subject-hero">
        <div className="fn-stack fn-stack--sm">
          {grade ? (
            <span className="fn-self-start">
              <FnBadge variant="primary">
                {grade.name}
                {fieldName ? ` · ${fieldName}` : ''}
              </FnBadge>
            </span>
          ) : null}
          <h1 className="fn-display fn-display--xl">{subject.name}</h1>
          {subject.shortDescription ? <p className="fn-subtitle">{subject.shortDescription}</p> : null}
        </div>
        <div className="fn-subject-art">
          {subject.image ? (
            <img src={subject.image} alt={subject.name} />
          ) : (
            <SubjectIcon slug={subject.slug} size={64} />
          )}
        </div>
      </FnCard>

      <section className="fn-grid fn-grid--4">
        {FEATURES.map((feature) => {
          const FeatureIcon = feature.icon;
          return (
            <FnCard key={feature.title} variant="flat" className="fn-card--centered">
              <span className={feature.tile}>
                <FeatureIcon size={22} aria-hidden="true" />
              </span>
              <span className="fn-card__title">{feature.title}</span>
              <span className="fn-card__text">{feature.text}</span>
            </FnCard>
          );
        })}
      </section>

      <FnButton asChild size="lg" block>
        <Link href={`/app/subjects/${subject.slug}/tutor`}>
          <Play size={19} aria-hidden="true" />
          ابدأ التجربة
          <ChevronLeft size={19} aria-hidden="true" />
        </Link>
      </FnButton>
      <PlansSection subjectId={subject.id} plans={plans} entitled={entitled} />
    </div>
  );
}
