import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const OUT = 'qa/screenshots/visual-quality';
mkdirSync(`${OUT}/recording`, { recursive: true });

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const consoleIssues = [];
let frames = [];
let recording = false;
const tutorResponses = [];
const pendingTutor = new Set();

ws.onmessage = async (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
    consoleIssues.push(`${message.params.type}: ${String(message.params.args[0]?.value ?? '').slice(0, 140)}`);
  }
  if (message.method === 'Page.screencastFrame' && recording) {
    frames.push({ data: message.params.data, t: message.params.metadata.timestamp });
    send('Page.screencastFrameAck', { sessionId: message.params.sessionId });
  }
  if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/tutor')) {
    pendingTutor.add(message.params.requestId);
  }
  if (message.method === 'Network.loadingFinished' && pendingTutor.has(message.params.requestId)) {
    pendingTutor.delete(message.params.requestId);
    try {
      const body = await send('Network.getResponseBody', { requestId: message.params.requestId });
      tutorResponses.push(JSON.parse(body.result.body));
    } catch { /* best effort */ }
  }
};
const send = (method, params = {}) => new Promise((resolve) => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 200));
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
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
function distinctFrames() {
  const seen = new Map();
  for (const frame of frames) {
    const hash = createHash('md5').update(frame.data).digest('hex');
    if (!seen.has(hash)) seen.set(hash, frame);
  }
  return [...seen.values()];
}
async function runLesson(label, question, viewport) {
  await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
  await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
  await waitFor('!!document.querySelector(".classroom")');
  await sleep(600);
  frames = [];
  recording = true;
  await send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
  const t0 = Date.now();
  await evaluate(`(() => { const el = document.querySelector('[aria-label="سؤالك للمعلم"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(question)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await evaluate(`document.querySelector('[aria-label="أرسل السؤال"]')?.click(); true`);
  const loaded = await waitFor(`document.querySelector('.hud-step') !== null`, 120000);
  const tLesson = Date.now() - t0;
  // Let the first two segments draw while recording.
  await sleep(14000);
  recording = false;
  await send('Page.stopScreencast');
  const distinct = distinctFrames();
  const saved = [];
  distinct.slice(0, 6).forEach((frame, index) => {
    const name = `${OUT}/recording/${label}-${index + 1}.jpg`;
    writeFileSync(name, Buffer.from(frame.data, 'base64'));
    saved.push({ name: name.split('/').pop(), t: frame.t });
  });
  const state = JSON.parse(await evaluate(`JSON.stringify({
    step: document.querySelector('.hud-step')?.textContent ?? null,
    segments: document.querySelector('.hud-step')?.textContent ?? null,
    graphSvgs: document.querySelectorAll('.graph-layer svg').length,
    graphStrokes: document.querySelectorAll('.graph-layer .graph-stroke').length,
    graphDots: document.querySelectorAll('.graph-layer .graph-dot').length,
    annotations: document.querySelectorAll('.annotation-layer .annotation').length,
    objects: document.querySelectorAll('.board-object').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    credit: document.querySelector('.credit-chip')?.textContent?.replace(/\s+/g, ' ') ?? null,
  })`));
  await shot(`${label}-board`);
  const lesson = tutorResponses.at(-1);
  const actions = (lesson?.segments ?? []).flatMap((s) => s.actions ?? []);
  return {
    timeToLessonMs: tLesson,
    distinctFrames: distinct.length,
    totalFrames: frames.length,
    savedFrames: saved,
    state,
    lesson: lesson ? {
      title: lesson.title,
      segments: lesson.segments?.length ?? null,
      actionTypes: [...new Set(actions.map((a) => a.type))],
      graphActions: actions.filter((a) => a.region === 'graph-area').map((a) => a.type),
      labels: actions.filter((a) => a.type === 'show_label').map((a) => a.content),
      latexInNarration: (lesson.segments ?? []).filter((s) => /[\\^_{}$]/.test(s.narration)).length,
      finalNarration: (lesson.segments?.at(-1)?.narration ?? '').slice(0, 200),
    } : null,
  };
}

await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.bundle, domain: 'localhost', path: '/' });
if (sessions.deviceToken) await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });

const out = {};
out.geometry = await runLesson('geometry', 'ارسم مثلثًا وحدد رؤوسه ثم ارسم ارتفاعه.', { width: 1440, height: 900, mobile: false });
out.graph = await runLesson('graph', 'ارسم منحنى ص = س² - 4 واشرح جذوره.', { width: 1440, height: 900, mobile: false });
out.algebra = await runLesson('algebra', 'حل المعادلة س² - 5س + 6 = 0 خطوة بخطوة.', { width: 1440, height: 900, mobile: false });
out.mobile = await runLesson('mobile-algebra', 'حل المعادلة س² - 5س + 6 = 0 خطوة بخطوة.', { width: 390, height: 844, mobile: true });

out.consoleIssues = [...new Set(consoleIssues)].slice(0, 10);
writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();
