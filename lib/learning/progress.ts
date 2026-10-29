import { and, asc, eq } from 'drizzle-orm';

import { getDb } from '../../db';
import { learningProgress } from '../../db/schema';

export type ProgressState = 'NEEDS_PRACTICE' | 'DEVELOPING' | 'DEMONSTRATED';

export type LearningAssessment = {
  correct: boolean;
  topic: string;
  misconception: string | null;
  nextReviewInDays: number;
};

export type ProgressRecord = {
  id: string;
  userId: string;
  subjectId: string;
  topic: string;
  state: ProgressState;
  correctCount: number;
  incorrectCount: number;
  lastMisconception: string | null;
  lastPracticedAt: Date;
  reviewDueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

// Stable topic identity: AI phrasing varies between sessions, so topics are
// canonicalized before storage (hamza/taa-marbuta folding, definite-article
// stripping, light suffix stemming). Unrelated topics stay separate because
// only surface morphology is folded — meaning is never merged.
export function normalizeTopic(topic: string): string {
  const folded = topic
    .normalize('NFKC')
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
  const words = folded.split(' ').map((word) => {
    let result = word;
    if (result.length >= 5 && result.startsWith('ال')) result = result.slice(2);
    for (const suffix of ['ات', 'ون', 'ين', 'ها', 'هم', 'يه', 'ه']) {
      if (result.length >= 5 && result.endsWith(suffix)) {
        result = result.slice(0, -suffix.length);
        break;
      }
    }
    return result;
  });
  return words.join(' ').slice(0, 80);
}

export function nextProgressState(input: {
  current: (Pick<ProgressRecord, 'state' | 'correctCount' | 'incorrectCount'> & { lastPracticedAt?: Date | null }) | null;
  assessment: Pick<LearningAssessment, 'correct' | 'nextReviewInDays'>;
  now: Date;
}): { state: ProgressState; correctCount: number; incorrectCount: number; reviewDueAt: Date } {
  const current = input.current;
  const correctCount = (current?.correctCount ?? 0) + (input.assessment.correct ? 1 : 0);
  const incorrectCount = (current?.incorrectCount ?? 0) + (input.assessment.correct ? 0 : 1);

  // A second correct answer only demonstrates understanding when it arrives as
  // later, independent evidence — not twice in the same session day.
  const previousDay = current?.lastPracticedAt ? current.lastPracticedAt.toISOString().slice(0, 10) : null;
  const today = input.now.toISOString().slice(0, 10);
  const independent = previousDay === null || previousDay !== today;

  let state: ProgressState;
  let days: number;
  if (!input.assessment.correct) {
    state = 'NEEDS_PRACTICE';
    days = 1;
  } else if (correctCount >= 2 && independent) {
    state = 'DEMONSTRATED';
    days = Math.max(3, Math.min(30, input.assessment.nextReviewInDays || 3));
  } else {
    state = 'DEVELOPING';
    days = Math.max(2, Math.min(30, input.assessment.nextReviewInDays || 3));
  }

  const reviewDueAt = new Date(input.now.getTime() + days * 24 * 60 * 60 * 1000);
  return { state, correctCount, incorrectCount, reviewDueAt };
}

export type LearningProgressStore = {
  listForUser(userId: string): Promise<ProgressRecord[]>;
  recordAssessment(input: { userId: string; subjectId: string; assessment: LearningAssessment; now?: Date }): Promise<ProgressRecord>;
};

function createDrizzleProgressStore(): LearningProgressStore {
  const db = () => getDb();
  return {
    async listForUser(userId) {
      const rows = await db()
        .select()
        .from(learningProgress)
        .where(eq(learningProgress.userId, userId))
        .orderBy(asc(learningProgress.reviewDueAt), asc(learningProgress.topic));
      return rows as ProgressRecord[];
    },
    async recordAssessment({ userId, subjectId, assessment, now = new Date() }) {
      const topic = normalizeTopic(assessment.topic);
      const existing = await db()
        .select()
        .from(learningProgress)
        .where(and(eq(learningProgress.userId, userId), eq(learningProgress.subjectId, subjectId), eq(learningProgress.topic, topic)))
        .limit(1);
      const current = (existing[0] as ProgressRecord | undefined) ?? null;
      const next = nextProgressState({ current: current ? { ...current, lastPracticedAt: current.lastPracticedAt } : null, assessment, now });
      const values = {
        userId,
        subjectId,
        topic,
        state: next.state,
        correctCount: next.correctCount,
        incorrectCount: next.incorrectCount,
        lastMisconception: assessment.misconception?.trim().slice(0, 200) || null,
        lastPracticedAt: now,
        reviewDueAt: next.reviewDueAt,
        updatedAt: now,
      };
      const rows = await db()
        .insert(learningProgress)
        .values({ id: crypto.randomUUID(), ...values })
        .onConflictDoUpdate({
          target: [learningProgress.userId, learningProgress.subjectId, learningProgress.topic],
          set: values,
        })
        .returning();
      return rows[0] as ProgressRecord;
    },
  };
}

let override: LearningProgressStore | null = null;
let cached: LearningProgressStore | null = null;

export function setLearningProgressStoreForTests(store: LearningProgressStore | null): void {
  override = store;
}

export function learningProgressStore(): LearningProgressStore {
  if (override) return override;
  cached ??= createDrizzleProgressStore();
  return cached;
}
