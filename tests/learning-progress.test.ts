import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nextProgressState, normalizeTopic, type ProgressRecord } from '../lib/learning/progress';

const base: Pick<ProgressRecord, 'state' | 'correctCount' | 'incorrectCount'> & { lastPracticedAt: Date | null } = {
  state: 'NEEDS_PRACTICE',
  correctCount: 0,
  incorrectCount: 0,
  lastPracticedAt: null,
};

test('spaced review: mistakes bring the topic back tomorrow and mark it weak', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const next = nextProgressState({ current: base, assessment: { correct: false, nextReviewInDays: 5 }, now });
  assert.equal(next.state, 'NEEDS_PRACTICE');
  assert.equal(next.correctCount, 0);
  assert.equal(next.incorrectCount, 1);
  assert.equal(next.reviewDueAt.getTime(), now.getTime() + 24 * 60 * 60 * 1000);
});

test('one correct answer is never mastery; a second correct answer on a later day reaches demonstrated', () => {
  const dayOne = new Date('2026-10-09T10:00:00Z');
  const first = nextProgressState({ current: base, assessment: { correct: true, nextReviewInDays: 3 }, now: dayOne });
  assert.equal(first.state, 'DEVELOPING');
  assert.equal(first.correctCount, 1);

  // Same day: still developing — one session cannot demonstrate mastery.
  const sameDay = nextProgressState({
    current: { state: first.state, correctCount: first.correctCount, incorrectCount: first.incorrectCount, lastPracticedAt: dayOne },
    assessment: { correct: true, nextReviewInDays: 7 },
    now: new Date('2026-10-09T18:00:00Z'),
  });
  assert.equal(sameDay.state, 'DEVELOPING');
  assert.equal(sameDay.correctCount, 2);

  // Later day: independent evidence demonstrates understanding.
  const laterDay = nextProgressState({
    current: { state: sameDay.state, correctCount: sameDay.correctCount, incorrectCount: sameDay.incorrectCount, lastPracticedAt: dayOne },
    assessment: { correct: true, nextReviewInDays: 7 },
    now: new Date('2026-10-12T10:00:00Z'),
  });
  assert.equal(laterDay.state, 'DEMONSTRATED');
  assert.equal(laterDay.correctCount, 3);
  assert.equal(laterDay.reviewDueAt.getTime(), new Date('2026-10-12T10:00:00Z').getTime() + 7 * 24 * 60 * 60 * 1000);

  // Intervals are clamped to a sane window.
  const clamped = nextProgressState({
    current: { state: 'DEMONSTRATED', correctCount: 3, incorrectCount: 0, lastPracticedAt: dayOne },
    assessment: { correct: true, nextReviewInDays: 999 },
    now: new Date('2026-10-20T10:00:00Z'),
  });
  assert.equal(clamped.reviewDueAt.getTime(), new Date('2026-10-20T10:00:00Z').getTime() + 30 * 24 * 60 * 60 * 1000);
});

test('topic normalization folds phrasing variants without merging unrelated topics', () => {
  assert.equal(normalizeTopic('تحليل كثيرات الحدود'), normalizeTopic('تحليل كثير الحدود'));
  assert.equal(normalizeTopic('التحليل إلى عوامل'), normalizeTopic('تحليل إلى عوامل'));
  assert.equal(normalizeTopic('التحليل إلى عوامل'), normalizeTopic('  التحليل   إلى عوامل '));
  assert.notEqual(normalizeTopic('تحليل كثيرات الحدود'), normalizeTopic('قانون الجيوب'));
  assert.notEqual(normalizeTopic('المعادلات الخطية'), normalizeTopic('المتباينات'));
});

test('a later mistake resets the interval even after strong performance', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  const next = nextProgressState({
    current: { state: 'DEMONSTRATED', correctCount: 4, incorrectCount: 0 },
    assessment: { correct: false, nextReviewInDays: 1 },
    now,
  });
  assert.equal(next.state, 'NEEDS_PRACTICE');
  assert.equal(next.incorrectCount, 1);
  assert.equal(next.reviewDueAt.getTime(), now.getTime() + 24 * 60 * 60 * 1000);
});
