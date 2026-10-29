import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTeachingMode,
  progressPrompt,
  quizTurn,
  subjectLabel,
  subjectStrategy,
  teachingPolicy,
  tutorIdentity,
} from '../lib/ai/pedagogy';
import { assessmentSchema, generatedLessonSchema } from '../schemas/lesson';

test('teaching modes normalize safely and quiz turns are deterministic', () => {
  assert.equal(normalizeTeachingMode('coach'), 'coach');
  assert.equal(normalizeTeachingMode('quiz'), 'quiz');
  assert.equal(normalizeTeachingMode('explain'), 'explain');
  assert.equal(normalizeTeachingMode('anything-else'), 'explain');
  assert.equal(normalizeTeachingMode(null), 'explain');
  assert.equal(quizTurn('quiz', false), 'present');
  assert.equal(quizTurn('quiz', true), 'evaluate');
  assert.equal(quizTurn('coach', true), null);
  assert.equal(quizTurn('explain', false), null);
});

test('the teacher identity is built from trusted subject metadata, never hard-coded', () => {
  // Mathematics keeps working exactly as before.
  const math = tutorIdentity({ subjectName: 'رياضيات التوجيهي' });
  assert.ok(math.includes('رياضيات التوجيهي'), 'the catalogue subject name must appear');
  assert.equal(math.includes('Grade 10'), false, 'no hard-coded grade');
  assert.ok(math.includes('textbook context'), 'grounding is still stated');

  // A non-mathematics subject is never introduced as a mathematics teacher.
  const chemistry = tutorIdentity({ subjectName: 'كيمياء التوجيهي' });
  assert.ok(chemistry.includes('كيمياء التوجيهي'));
  assert.equal(chemistry.toLowerCase().includes('mathemat'), false, 'no mathematics identity for chemistry');
  assert.equal(chemistry.includes('Grade 10'), false);

  // Missing metadata degrades to a neutral Arabic teacher, never to maths.
  const unknown = tutorIdentity({ subjectName: null });
  assert.equal(unknown.toLowerCase().includes('mathemat'), false);
  assert.ok(unknown.includes('المواد المدرسية'));

  // The label is sanitised: single line, bounded length.
  const noisy = tutorIdentity({ subjectName: `  فيزياء\n${'طويل '.repeat(40)}  ` });
  assert.equal(noisy.includes('\n'), false);
  assert.equal(subjectLabel({ subjectName: '  عربي  ' }), 'عربي');
  assert.ok(subjectLabel({ subjectName: 'x'.repeat(200) }).length <= 60);
});

test('teaching policy carries the mode, the subject strategy and review points', () => {
  const explain = teachingPolicy({ mode: 'explain', subjectSlug: 'tawjihi-math' });
  assert.ok(explain.includes('فهمني الدرس'));
  assert.ok(explain.includes('الجذور') || explain.includes('graphs'));
  assert.ok(explain.includes('كمل الشرح'), 'student can always continue');
  const coach = teachingPolicy({ mode: 'coach', subjectSlug: 'tawjihi-physics' });
  assert.ok(coach.includes('ساعدني أحل'));
  assert.ok(coach.includes('units'));
  assert.ok(coach.includes('assessment block'));
  const quiz = teachingPolicy({ mode: 'quiz', subjectSlug: 'tawjihi-math', reviewTopics: ['التحليل إلى عوامل', ' ', 'إكمال المربع'] });
  assert.ok(quiz.includes('اختبرني'));
  assert.ok(quiz.includes('assessment'));
  assert.ok(quiz.includes('التحليل إلى عوامل'));
  assert.equal(progressPrompt([]), '');
  assert.equal(progressPrompt(['أ', 'ب', 'ج', 'د']).includes('د'), false, 'at most three topics');
  assert.equal(subjectStrategy('unknown-subject'), '');
});

test('assessment is part of the lesson contract and rejects malformed values', () => {
  const valid = { correct: true, topic: 'التحليل إلى عوامل', misconception: null, nextReviewInDays: 3 };
  assert.equal(assessmentSchema.safeParse(valid).success, true);
  assert.equal(assessmentSchema.safeParse({ ...valid, nextReviewInDays: 0 }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...valid, topic: '' }).success, false);
  assert.equal(assessmentSchema.safeParse({ ...valid, extra: 1 }).success, false);

  const lesson = {
    title: 'درس',
    mode: 'new',
    sufficientContext: true,
    message: '',
    assessment: valid,
    segments: [
      {
        id: 's1',
        narration: 'نبدأ بالخطوة الأولى.',
        goal: 'خطوة',
        sourceChunkIds: ['c-1'],
        actions: [
          { type: 'write_latex', id: 'eq1', content: 'x = 2', region: 'result-area', targets: [], points: [], color: 'ink', geometry: null, delayMs: 0 },
        ],
      },
    ],
  };
  assert.equal(generatedLessonSchema.safeParse(lesson).success, true);
  assert.equal(generatedLessonSchema.safeParse({ ...lesson, assessment: undefined }).success, false, 'assessment must be present (null when unused)');
});
