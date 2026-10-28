import type {Lesson, Segment, Source} from '../../schemas/lesson';
import {SUBJECT_PRESETS, type SubjectPresetKey} from './presets';

// Renderer fixtures for subjects that do NOT have an uploaded textbook yet.
// They are clearly labelled as demonstrations and are only reachable in
// development through an explicit ?fixture= query parameter — never in a normal
// student session and never in production. Their purpose is to exercise the
// generic visual renderers (graphs, vectors, diagrams, RTL text analysis).

const src = (chunkId: string, lessonName: string): Source => ({
  chunkId,
  sourceId: 'fixture',
  pdfPage: 0,
  printedPage: null,
  lesson: lessonName,
  image: '',
  bookId: null,
});

function fixtureLesson(key: SubjectPresetKey, title: string, goal: string, narration: string, extraSegments: {goal: string; narration: string; actions: Segment['actions']}[] = []): Lesson {
  const actions = SUBJECT_PRESETS[key]();
  const segments: Segment[] = [
    { id: `${key}-s1`, goal, narration, sourceChunkIds: ['fixture-1'], actions, sources: [src('fixture-1', title)] },
    ...extraSegments.map((segment, index) => ({
      id: `${key}-s${index + 2}`,
      goal: segment.goal,
      narration: segment.narration,
      sourceChunkIds: ['fixture-1'],
      actions: segment.actions,
      sources: [src('fixture-1', title)],
    })),
  ];
  return {
    id: `fixture-${key}`,
    question: title,
    title: `عرض تجريبي — ${title}`,
    mode: 'new',
    sufficientContext: true,
    assessment: null,
    message: 'عرض تجريبي للرسّامات فقط، وليس درسًا من كتاب حقيقي.',
    segments,
    sources: [src('fixture-1', title)],
  };
}

export const FIXTURE_LESSONS: Record<string, Lesson> = {
  geometry: fixtureLesson('geometry', 'مثلث وارتفاعه (رسم تجريبي)', 'نرسم مثلثًا وارتفاعه', 'نرسم مثلثًا وننزل ارتفاعًا من الرأس ج إلى القاعدة.'),
  physics: fixtureLesson('physics', 'قوتان متعامدتان (رسم تجريبي)', 'نرسم متجهي القوتين', 'قوتان متعامدتان: إحداهما شرقًا والأخرى شمالًا، ثم نرسم المحصلة.'),
  arabic: fixtureLesson('arabic', 'إعراب جملة (عرض تجريبي)', 'نحلل الجملة كلمة كلمة', 'نقرأ الجملة، ثم نحدد المبتدأ والخبر والفعل.'),
  chemistry: fixtureLesson('chemistry', 'جزيء الماء H₂O (رسم تجريبي)', 'نرسم الجزيء المبسط', 'ذرتا هيدروجين مرتبطتان بذرة أكسجين واحدة.'),
  history: fixtureLesson('history', 'خط زمني (رسم تجريبي)', 'نرتب الأحداث على خط الزمن', 'نرسم خط الزمن ثم نضع الأحداث الثلاثة عليه.'),
};

export const FIXTURE_KEYS = Object.keys(FIXTURE_LESSONS);
