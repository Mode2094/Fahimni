import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const cookie = `fahimni_session=${sessions.student}${sessions.deviceToken ? `; fahimni_device=${sessions.deviceToken}` : ''}`;
mkdirSync('qa/evidence/audio', { recursive: true });

async function turn(label, body) {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/tutor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, cookie },
    body: JSON.stringify({ board: { objects: [] }, history: [], currentStep: 0, currentLesson: null, subjectSlug: 'tawjihi-math', ...body }),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await response.json();
  console.log(JSON.stringify({ label, ms: Date.now() - started, status: response.status, error: data.error ?? null, code: data.code ?? null, segments: data.segments?.length ?? null, assessment: data.assessment ?? null, credits: data.credits?.balance ?? null }));
  return data;
}

// A) straightforward explanation (latency stages come from the dev log)
await turn('A-explain', { question: 'اشرح كيف نحلل المقدار س تربيع ناقص 5س زائد 6', mode: 'explain' });
// B) short ambiguous question — honest handling required
await turn('B-short', { question: 'حل', mode: 'explain' });
// C) paraphrased textbook exercise
await turn('C-paraphrased', { question: 'عندي مثلث أعرف طول ضلعين والزاوية بينهما، كيف أطلع مساحته؟', mode: 'explain' });
// H) correct answer written differently (deterministic verification)
const coach = await turn('H-coach-start', { question: 'خليني أحل: حلل المقدار س² - 5س + 6', mode: 'coach' });
const lesson = coach.segments ? { title: coach.title, goals: coach.segments.map((s) => s.goal), narrations: coach.segments.map((s) => s.narration) } : null;
await turn('H-correct-attempt', { question: 'جوابي: (س-2)(س-3)', mode: 'coach', history: [{ question: 'خليني أحل: حلل المقدار س² - 5س + 6', title: coach.title ?? '' }], currentLesson: lesson });

// L) TTS samples for human listening
const samples = [
  { name: 'equation-reading', text: 'إكس أس أربعة ناقص ثلاثة إكس تربيع زائد اثنين يساوي صفر. الحلول هي واحد، وناقص واحد، وجذر اثنين، وناقص جذر اثنين.' },
  { name: 'teaching-narration', text: 'خلينا نرسم المثلث أول شيء، وبعدها ننزل الارتفاع من الرأس ج إلى القاعدة. هذا الارتفاع مهم لحساب المساحة.' },
];
for (const sample of samples) {
  const speech = await fetch(`${BASE}/api/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, cookie },
    body: JSON.stringify({ text: sample.text, subjectSlug: 'tawjihi-math', requestId: `phase4-sample-${sample.name}` }),
  });
  const bytes = Buffer.from(await speech.arrayBuffer());
  writeFileSync(`qa/evidence/audio/${sample.name}.mp3`, bytes);
  console.log(JSON.stringify({ sample: sample.name, status: speech.status, bytes: bytes.length }));
  if (sample.name === 'equation-reading') {
    const form = new FormData();
    form.set('file', new Blob([bytes], { type: 'audio/mpeg' }), 'sample.mp3');
    form.set('subjectSlug', 'tawjihi-math');
    const stt = await fetch(`${BASE}/api/transcribe`, { method: 'POST', headers: { origin: BASE, cookie }, body: form });
    const data = await stt.json();
    console.log(JSON.stringify({ stt: stt.status, heard: String(data.question ?? '').slice(0, 200), hasLatex: /[\\^_{}]|frac|sqrt/.test(String(data.question ?? '')) }));
  }
}
