process.env.DATABASE_URL ??= 'postgresql://mrik@127.0.0.1:5432/fahimni_local';
const { getDb } = await import('/Users/mrik/Desktop/fahimni/db/index.ts');
const schema = await import('/Users/mrik/Desktop/fahimni/db/schema.ts');
const { normalizeTopic } = await import('/Users/mrik/Desktop/fahimni/lib/learning/progress.ts');
const { eq } = await import('drizzle-orm');

const db = getDb();
const rows = await db.select().from(schema.learningProgress);
const groups = new Map();
for (const row of rows) {
  const key = `${row.userId}|${row.subjectId}|${normalizeTopic(row.topic)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}
let merged = 0;
let renamed = 0;
for (const [, group] of groups) {
  const canonical = normalizeTopic(group[0].topic);
  const rank = { NEEDS_PRACTICE: 0, DEVELOPING: 1, DEMONSTRATED: 2 };
  const strictest = group.reduce((worst, row) => (rank[row.state] < rank[worst.state] ? row : worst), group[0]);
  const latest = group.reduce((newest, row) => (row.lastPracticedAt > newest.lastPracticedAt ? row : newest), group[0]);
  const correctCount = group.reduce((sum, row) => sum + row.correctCount, 0);
  const incorrectCount = group.reduce((sum, row) => sum + row.incorrectCount, 0);
  const reviewDueAt = group.map((row) => row.reviewDueAt).filter(Boolean).sort((a, b) => a - b)[0] ?? null;
  const keeper = group[0];
  await db.update(schema.learningProgress).set({
    topic: canonical,
    state: strictest.state,
    correctCount,
    incorrectCount,
    lastMisconception: latest.lastMisconception,
    lastPracticedAt: latest.lastPracticedAt,
    reviewDueAt,
    updatedAt: new Date(),
  }).where(eq(schema.learningProgress.id, keeper.id));
  if (keeper.topic !== canonical) renamed += 1;
  for (const extra of group.slice(1)) {
    await db.delete(schema.learningProgress).where(eq(schema.learningProgress.id, extra.id));
    merged += 1;
  }
}
const after = await db.select({ topic: schema.learningProgress.topic }).from(schema.learningProgress);
console.log(JSON.stringify({ before: rows.length, after: after.length, renamed, merged, topics: [...new Set(after.map((row) => row.topic))] }, null, 1));
process.exit(0);
