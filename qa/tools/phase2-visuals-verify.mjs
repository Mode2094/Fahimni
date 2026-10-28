import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const OUT = 'qa/screenshots/phase2-visuals';
mkdirSync(OUT, { recursive: true });
mkdirSync(`${OUT}/recording`, { recursive: true });

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
    pendingTutor.set(message.params.requestId, true);
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
async function shot(name, dir = OUT) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${dir}/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
async function ask(text) {
  await evaluate(`(() => { const el = document.querySelector('[aria-label="سؤالك للمعلم"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await evaluate(`document.querySelector('[aria-label="أرسل السؤال"]')?.click(); true`);
  return waitFor(`document.querySelector('.hud-step') !== null`, 120000);
}
const boardState = `JSON.stringify({
  step: document.querySelector('.hud-step')?.textContent ?? null,
  status: document.querySelector('.hud-status')?.textContent ?? null,
  graphSvgs: document.querySelectorAll('.graph-layer svg').length,
  graphStrokes: document.querySelectorAll('.graph-layer .graph-stroke').length,
  annotations: document.querySelectorAll('.annotation-layer .annotation').length,
  objects: document.querySelectorAll('.board-object').length,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})`;

const out = { math: {}, geometry: {}, fixtures: {}, mobile: {}, consoleErrors: [] };
await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.bundle, domain: 'localhost', path: '/' });
if (sessions.deviceToken) await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// ---------- A. real AI maths lesson with a graph ----------
await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
await waitFor('!!document.querySelector(".classroom")');
await sleep(500);
const t0 = Date.now();
await ask('اشرح حل معادلة تربيعية بالتحليل إلى عوامل، وارسم تمثيلها البياني على السبورة.');
out.math.timeToLessonMs = Date.now() - t0;
await sleep(700);
for (let frame = 1; frame <= 4; frame += 1) {
  await shot(`recording/math-frame-${frame}`, OUT);
  await sleep(450);
}
out.math.state = JSON.parse(await evaluate(boardState));
await shot('math-lesson-playing');
await waitFor(`document.querySelector('.hud-status')?.textContent?.includes('اكتمل')`, 240000);
out.math.completed = JSON.parse(await evaluate(boardState));
await shot('math-lesson-completed');
const mathLesson = tutorResponses.at(-1);
if (mathLesson) {
  const actions = (mathLesson.segments ?? []).flatMap((s) => s.actions);
  out.math.response = {
    title: mathLesson.title,
    segments: mathLesson.segments?.length ?? null,
    actionTypes: [...new Set(actions.map((a) => a.type))],
    plotGraphPoints: actions.filter((a) => a.type === 'plot_graph').map((a) => a.points?.length ?? 0),
    latexInNarration: (mathLesson.segments ?? []).filter((s) => /[\\^_{}$]/.test(s.narration)).length,
    finalNarration: (mathLesson.segments?.at(-1)?.narration ?? '').slice(0, 200),
  };
}

// ---------- B. real AI geometry lesson (triangle + altitude) ----------
await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
await waitFor('!!document.querySelector(".classroom")');
await sleep(500);
const t1 = Date.now();
await ask('أنشئ مثلثًا على السبورة وارسم ارتفاعه، ثم اشرح قانون مساحة المثلث.');
out.geometry.timeToLessonMs = Date.now() - t1;
await sleep(900);
out.geometry.earlyState = JSON.parse(await evaluate(boardState));
await shot('geometry-triangle-progress');
await waitFor(`document.querySelector('.hud-status')?.textContent?.includes('اكتمل')`, 240000);
out.geometry.completed = JSON.parse(await evaluate(boardState));
await shot('geometry-completed');
const geometryLesson = tutorResponses.at(-1);
if (geometryLesson) {
  const actions = (geometryLesson.segments ?? []).flatMap((s) => s.actions);
  out.geometry.response = {
    title: geometryLesson.title,
    actionTypes: [...new Set(actions.map((a) => a.type))],
    graphObjects: actions.filter((a) => a.region === 'graph-area').map((a) => a.type),
    labels: actions.filter((a) => a.type === 'show_label').map((a) => a.content),
    finalNarration: (geometryLesson.segments?.at(-1)?.narration ?? '').slice(0, 200),
  };
}

// ---------- C/D/E. labelled renderer fixtures (no books for these subjects) ----------
for (const fixture of ['physics', 'arabic', 'chemistry']) {
  await send('Page.navigate', { url: `${BASE}/legacy?fixture=${fixture}` });
  await waitFor('!!document.querySelector(".classroom")');
  await sleep(2500);
  out.fixtures[fixture] = JSON.parse(await evaluate(`JSON.stringify({
    badge: document.body.innerText.includes('عرض تجريبي — بيانات وهمية'),
    title: document.querySelector('.narration-copy p')?.textContent?.slice(0, 80) ?? null,
    graphSvgs: document.querySelectorAll('.graph-layer svg').length,
    graphStrokes: document.querySelectorAll('.graph-layer .graph-stroke').length,
    coloredWords: [...document.querySelectorAll('.board-object.type-write_text')].map((el) => el.style.getPropertyValue('--tone')).length,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  })`));
  await shot(`fixture-${fixture}`);
}

// ---------- mobile fixture ----------
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${BASE}/legacy?fixture=arabic` });
await waitFor('!!document.querySelector(".classroom")');
await sleep(2500);
out.mobile = JSON.parse(await evaluate(`JSON.stringify({
  badge: document.body.innerText.includes('عرض تجريبي'),
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  objects: document.querySelectorAll('.board-object').length,
})`));
await shot('mobile-fixture-arabic');

out.consoleErrors = consoleErrors.slice(0, 8);
writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();
