import { readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const cookie = `fahimni_session=${sessions.student}; fahimni_device=${sessions.deviceToken}`;

const res = await fetch(`${BASE}/api/tutor`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE, cookie },
  body: JSON.stringify({
    question: 'حل معادلة خاصة بالتحليل إلى عوامل',
    board: { objects: [] },
    history: [],
    currentStep: 0,
    currentLesson: null,
    subjectSlug: 'tawjihi-math',
    requestId: crypto.randomUUID(),
  }),
  signal: AbortSignal.timeout(120_000),
});
const body = await res.json().catch(() => ({}));
writeFileSync('qa/evidence/lesson-real.json', JSON.stringify(body, null, 1));
console.log(JSON.stringify({
  status: res.status,
  title: body.title ?? null,
  sufficientContext: body.sufficientContext ?? null,
  message: (body.message ?? '').slice(0, 200),
  segments: (body.segments ?? []).map((s) => ({ goal: s.goal, narrationLen: (s.narration ?? '').length, narrationHead: (s.narration ?? '').slice(0, 120) })),
  boardKinds: [...new Set((body.board?.objects ?? []).map((o) => o.kind))],
  sources: (body.segments?.[0]?.sources ?? []).map((s) => ({ printed: s.printedPage ?? null, pdf: s.pdfPage })),
  credits: body.credits ?? null,
}, null, 1));
