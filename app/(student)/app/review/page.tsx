import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, Repeat2, Target } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { learningProgressStore, type ProgressState } from '@/lib/learning/progress';
import { requireOnboardedStudent } from '@/lib/student/guard';
import { studentStore } from '@/lib/student/store';
import { formatBookDate } from '@/lib/books/messages';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'راجع نقاط ضعفي',
  description: 'نقاط التدريب الخاصة بك مرتبة حسب موعد المراجعة.',
};

const STATE_LABELS: Record<ProgressState, string> = {
  NEEDS_PRACTICE: 'يحتاج تدريبًا',
  DEVELOPING: 'في تطوّر',
  DEMONSTRATED: 'أظهر فهمًا',
};

const STATE_BADGE: Record<ProgressState, 'gold' | 'sky' | 'mint'> = {
  NEEDS_PRACTICE: 'gold',
  DEVELOPING: 'sky',
  DEMONSTRATED: 'mint',
};

export default async function ReviewPage() {
  const { user, profile } = await requireOnboardedStudent('/app/review');
  const [records, subjects] = await Promise.all([
    learningProgressStore().listForUser(user.id).catch(() => []),
    studentStore().listSubjectsForStudent(profile.gradeId, profile.academicFieldId),
  ]);
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const now = Date.now();

  return (
    <div className="fn-container fn-stack fn-stack--lg">
      <header className="fn-stack fn-stack--sm">
        <h1 className="fn-display fn-display--xl">راجع نقاط ضعفي</h1>
        <p className="fn-subtitle">هذه نقاط التدريب التي رصدها معلّمك من إجاباتك الحقيقية — خاصة بحسابك أنت فقط.</p>
      </header>

      {records.length ? (
        <div className="fn-grid fn-grid--2">
          {records.map((record) => {
            const subject = subjectById.get(record.subjectId);
            const due = record.reviewDueAt ? record.reviewDueAt.getTime() <= now : true;
            return (
              <FnCard key={record.id} className="fn-stack">
                <div className="fn-card__head">
                  <span className="fn-card__title">{record.topic}</span>
                  <FnBadge variant={STATE_BADGE[record.state]}>{STATE_LABELS[record.state]}</FnBadge>
                </div>
                <p className="fn-card__text">{subject ? subject.name : 'مادة'}</p>
                <div className="fn-row fn-row--wrap">
                  <FnBadge variant={due ? 'gold' : 'outline'}>
                    <CalendarClock size={13} aria-hidden="true" />
                    {due ? 'المراجعة مستحقة الآن' : `المراجعة في ${formatBookDate(record.reviewDueAt as Date)}`}
                  </FnBadge>
                  <FnBadge variant="outline">
                    <Target size={13} aria-hidden="true" />
                    {record.correctCount} صحيح · {record.incorrectCount} خطأ
                  </FnBadge>
                </div>
                {record.lastMisconception ? <p className="fn-caption">آخر ملاحظة: {record.lastMisconception}</p> : null}
                {subject ? (
                  <FnButton asChild size="sm">
                    <Link href={`/app/subjects/${subject.slug}/tutor?mode=quiz&topic=${encodeURIComponent(record.topic)}`}>
                      <Repeat2 size={15} aria-hidden="true" />
                      تدرّب الآن
                    </Link>
                  </FnButton>
                ) : null}
              </FnCard>
            );
          })}
        </div>
      ) : (
        <FnCard variant="flat" className="fn-empty">
          <div className="fn-icon-tile fn-icon-tile--gold fn-icon-tile--lg">
            <Target size={26} aria-hidden="true" />
          </div>
          <p className="fn-empty__title">لا توجد نقاط تدريب بعد</p>
          <p className="fn-empty__text">جرّب وضع «اختبرني» في الصف الرقمي، وسيظهر هنا ما يحتاج مراجعة من إجاباتك الفعلية.</p>
          <FnButton asChild variant="soft" size="sm">
            <Link href="/app/subjects">تصفّح المواد</Link>
          </FnButton>
        </FnCard>
      )}

      <p className="fn-caption">يُبنى هذا السجل من تقييمات حقيقية فقط، ولا يُعد إجابة واحدة صحيحة إتقانًا كاملًا.</p>
    </div>
  );
}
