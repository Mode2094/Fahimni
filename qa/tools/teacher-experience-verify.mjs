import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
mkdirSync('qa/screenshots/teacher-experience', { recursive: true });

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const consoleErrors = [];
const tutorResponses = [];
const pendingTutor = new Map();
ws.onmessage = async (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(String(message.params.args[0]?.value ?? '').slice(0, 150));
  }
  if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/tutor')) {
    pendingTutor.set(message.params.requestId, Date.now());
  }
  if (message.method === 'Network.loadingFinished' && pendingTutor.has(message.params.requestId)) {
    pendingTutor.delete(message.params.requestId);
    try {
      const body = await send('Network.getResponseBody', { requestId: message.params.requestId });
      tutorResponses.push(JSON.parse(body.result.body));
    } catch { /* body capture is best-effort */ }
  }
};
const send = (method, params = {}) => new Promise((resolve) => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 250));
  return result.result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, timeoutMs = 120000, interval = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(interval);
  }
  return null;
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`qa/screenshots/teacher-experience/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
const clickText = (selector, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
const marks = () => evaluate(`JSON.stringify(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('seg:')).map((m) => ({ n: m.name, t: Math.round(m.startTime) })))`);

const out = { before: {}, after: {}, interruption: {}, desktop: {}, mobile: {}, consoleErrors: [] };
await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.student, domain: 'localhost', path: '/' });
if (sessions.deviceToken) await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });

// ---------- desktop 1440: full lesson + timing + interruption ----------
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
await waitFor('!!document.querySelector(".classroom")');
await sleep(500);
const tSubmit = Date.now();
await evaluate(`(() => { const el = document.querySelector('[aria-label="سؤالك للمعلم"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, 'اشرح حل معادلة بالتحليل إلى عوامل: x^4 - 3x^2 + 2 = 0'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await evaluate(`document.querySelector('[aria-label="أرسل السؤال"]')?.click(); true`);
await waitFor('!!window.__lesson_ready', 1000).catch(() => {});
await waitFor(`document.querySelector('.hud-step') !== null`, 120000);
out.after.timeToLessonMs = Date.now() - tSubmit;
await sleep(2000);
out.after.marksEarly = JSON.parse(await marks());
out.desktop.lesson = JSON.parse(await evaluate(`JSON.stringify({
  step: document.querySelector('.hud-step')?.textContent ?? null,
  teacherActions: [...document.querySelectorAll('.teacher-action')].map((b) => b.textContent.trim()),
  narration: document.querySelector('.narration-copy p')?.textContent?.slice(0, 160) ?? null,
  demoBadge: document.body.innerText.includes('وضع تجريبي'),
})`));
await shot('desktop-lesson-playing');

// Wait for the whole lesson to finish (or timeout) to measure gaps.
await waitFor(`document.querySelector('.hud-status')?.textContent?.includes('اكتمل')`, 180000);
await sleep(500);
const allMarks = JSON.parse(await marks());
out.after.marks = allMarks;
out.desktop.completed = JSON.parse(await evaluate(`JSON.stringify({ status: document.querySelector('.hud-status')?.textContent ?? null })`));
await shot('desktop-lesson-completed');

// Tutor response checks: LaTeX-free narration + correct roots.
const lesson = tutorResponses[0];
if (lesson) {
  const narrations = (lesson.segments ?? []).map((s) => s.narration);
  out.after.response = {
    title: lesson.title,
    segments: lesson.segments?.length ?? null,
    latexInNarration: narrations.filter((n) => /[\\^_{}$]/.test(n)).length,
    mentionsRoots: /1/.test(narrations.at(-1) ?? '') && /-1|ناقص 1/.test(narrations.at(-1) ?? '') && /جذر 2/.test(narrations.at(-1) ?? ''),
    finalNarration: (narrations.at(-1) ?? '').slice(0, 240),
  };
}

// ---------- interruption flow ----------
await evaluate(`document.querySelector('.playback .play-button')?.click(); true`); // replay from start
await sleep(2500);
const beforeInterruptStep = await evaluate(`document.querySelector('.hud-step')?.textContent ?? null`);
await clickText('.teacher-action', 'وقف، عندي سؤال');
await sleep(500);
out.interruption.pausedForQuestion = JSON.parse(await evaluate(`JSON.stringify({
  playButtonLabel: document.querySelector('.playback .play-button')?.getAttribute('aria-label') ?? null,
  hudStatus: document.querySelector('.hud-status')?.textContent ?? null,
  resumeChip: [...document.querySelectorAll('.teacher-action')].some((b) => b.textContent.includes('كمل الشرح')),
})`));
await shot('desktop-interrupted');

const responsesBefore = tutorResponses.length;
await clickText('.teacher-action', 'ليش عملنا هيك؟');
await waitFor(`document.querySelector('.hud-status')?.textContent?.includes('يشرح')`, 90000);
await sleep(1500);
out.interruption.followup = JSON.parse(await evaluate(`JSON.stringify({
  newResponses: 0,
  step: document.querySelector('.hud-step')?.textContent ?? null,
  narration: document.querySelector('.narration-copy p')?.textContent?.slice(0, 160) ?? null,
  resumeChip: [...document.querySelectorAll('.teacher-action')].some((b) => b.textContent.includes('كمل الشرح')),
})`));
out.interruption.followup.newResponses = tutorResponses.length - responsesBefore;
await shot('desktop-followup-answer');

await clickText('.teacher-action', 'كمل الشرح');
await sleep(2000);
out.interruption.resumed = JSON.parse(await evaluate(`JSON.stringify({
  step: document.querySelector('.hud-step')?.textContent ?? null,
  status: document.querySelector('.hud-status')?.textContent ?? null,
  rememberedStep: ${JSON.stringify(beforeInterruptStep)},
})`));
await shot('desktop-resumed');

// ---------- mobile 390: layout + chips + interruption ----------
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
await waitFor('!!document.querySelector(".classroom")');
await sleep(500);
await evaluate(`(() => { const el = document.querySelector('[aria-label="سؤالك للمعلم"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, 'اشرح حل معادلة بالتحليل إلى عوامل: x^4 - 3x^2 + 2 = 0'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await evaluate(`document.querySelector('[aria-label="أرسل السؤال"]')?.click(); true`);
await waitFor(`document.querySelector('.hud-step') !== null`, 120000);
await sleep(2500);
out.mobile.state = JSON.parse(await evaluate(`JSON.stringify({
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  teacherActions: [...document.querySelectorAll('.teacher-action')].map((b) => b.textContent.trim()).length,
  step: document.querySelector('.hud-step')?.textContent ?? null,
  composer: !!document.querySelector('[aria-label="سؤالك للمعلم"]'),
})`));
await shot('mobile-lesson');

out.consoleErrors = consoleErrors.slice(0, 8);
writeFileSync('qa/screenshots/teacher-experience/results.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();
