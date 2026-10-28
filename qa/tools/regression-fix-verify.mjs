import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const OUT = 'qa/screenshots/regression-fix';
mkdirSync(`${OUT}/recording`, { recursive: true });

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const consoleIssues = [];
let frames = [];
let recording = false;
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) consoleIssues.push(`${message.params.type}: ${String(message.params.args[0]?.value ?? '').slice(0, 120)}`);
  if (message.method === 'Page.screencastFrame' && recording) { frames.push({ data: message.params.data, t: message.params.metadata.timestamp }); send('Page.screencastFrameAck', { sessionId: message.params.sessionId }); }
};
const send = (method, params = {}) => new Promise((r) => { const c = ++id; pending.set(c, r); ws.send(JSON.stringify({ id: c, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 200)); return r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(expression, timeoutMs = 90000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const v = await evaluate(expression); if (v) return v; await sleep(400); } return null; }
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }

async function lesson(label, question, viewport, recordMs = 8000) {
  await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
  await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
  await waitFor('!!document.querySelector(".classroom")');
  await sleep(600);
  frames = []; recording = true;
  await send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
  const before = await evaluate(`document.querySelector('.credit-chip')?.textContent ?? null`);
  const t0 = Date.now();
  await evaluate(`(() => { const el = document.querySelector('[aria-label="سؤالك للمعلم"]'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(question)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await evaluate(`document.querySelector('[aria-label="أرسل السؤال"]')?.click(); true`);
  const loaded = await waitFor(`document.querySelector('.hud-step') !== null`, 90000);
  const errorShown = await evaluate(`document.querySelector('.error-message')?.textContent?.includes('تعذر تجهيز') ?? false`);
  const tLesson = Date.now() - t0;
  await sleep(recordMs);
  recording = false;
  await send('Page.stopScreencast');
  const seen = new Set();
  for (const frame of frames) seen.add(createHash('md5').update(frame.data).digest('hex'));
  const state = JSON.parse(await evaluate(`JSON.stringify({
    step: document.querySelector('.hud-step')?.textContent ?? null,
    errorVisible: document.querySelector('.error-message')?.textContent?.slice(0, 60) ?? null,
    graphSvgs: document.querySelectorAll('.graph-layer svg').length,
    graphStrokes: document.querySelectorAll('.graph-layer .graph-stroke').length,
    objects: document.querySelectorAll('.board-object').length,
    narration: document.querySelector('.narration-copy p')?.textContent?.slice(0, 90) ?? null,
    speaking: document.querySelector('.narration-bar .pulse-dot') !== null,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    creditBefore: ${JSON.stringify(before)},
    creditAfter: document.querySelector('.credit-chip')?.textContent ?? null,
  })`));
  await shot(`${label}-board`);
  return { label, loaded: Boolean(loaded), errorShown, timeToLessonMs: tLesson, distinctFrames: seen.size, totalFrames: frames.length, state };
}

await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.student, domain: 'localhost', path: '/' });
if (sessions.deviceToken) await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });

const out = {};
out.exact = await lesson('exact-system', 'y - x^2 = 7 - 5x', { width: 1440, height: 900, mobile: false }, 10000);
out.simple = await lesson('simple', 'ما هو حل المعادلة س + 3 = 5؟', { width: 1440, height: 900, mobile: false }, 8000);
out.multi = await lesson('multi', 'حل المعادلة س² - 5س + 6 = 0 خطوة بخطوة.', { width: 1440, height: 900, mobile: false }, 10000);
out.triangle = await lesson('triangle', 'ارسم مثلثًا وحدد رؤوسه ثم ارسم ارتفاعه.', { width: 1440, height: 900, mobile: false }, 12000);
out.mobile = await lesson('mobile-exact', 'y - x^2 = 7 - 5x', { width: 390, height: 844, mobile: true }, 8000);
out.consoleIssues = [...new Set(consoleIssues)].slice(0, 8);

writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();
