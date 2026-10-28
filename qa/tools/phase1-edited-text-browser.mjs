import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Real-browser proof that the lesson request carries the student's own text.
// jsdom cannot drive a React controlled input, so this runs in Chrome: it types
// into the composer, presses send, and reads the outgoing /api/tutor body from
// the DevTools protocol (the request itself is blocked before any AI call).
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const DIR = 'docs/reviews/phase-1-screenshots';
mkdirSync(DIR, { recursive: true });

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const tutorBodies = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  if (message.method === 'Network.requestWillBeSent' && message.params.request.url.includes('/api/tutor')) {
    tutorBodies.push(message.params.request.postData ?? '');
  }
};
const send = (method, params = {}) => new Promise((resolve) => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 200));
  return result.result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, timeoutMs = 25000, interval = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await evaluate(expression).catch(() => false); if (value) return value; await sleep(interval); }
  return null;
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(result.result.data, 'base64'));
}

await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.student, domain: 'localhost', path: '/' });
if (sessions.deviceToken) await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
await waitFor('!!document.querySelector(".classroom")');
await sleep(600);

// Type a distinctive, student-authored question with the real keyboard path.
const typed = 'سؤالي المعدّل: أوجد قيمة س في 2س + 3 = 7';
await evaluate(`document.querySelector('[aria-label="سؤالك للمعلم"]').focus(); true`);
await send('Input.insertText', { text: typed });
await sleep(300);
const composerValue = await evaluate(`document.querySelector('[aria-label="سؤالك للمعلم"]').value`);
await shot('browser-typed-composer');

// Press send; the request body is captured from the protocol.
await evaluate(`document.querySelector('[aria-label="أرسل السؤال"]')?.click(); true`);
await waitFor('true', 3000);
await sleep(1200);

const out = {
  typed,
  composerValue,
  tutorRequests: tutorBodies.length,
  sentQuestion: tutorBodies.length ? (JSON.parse(tutorBodies[0]).question ?? null) : null,
  bodyMatchesTyped: tutorBodies.length ? JSON.parse(tutorBodies[0]).question === typed : false,
  finishedAt: new Date().toISOString(),
};
writeFileSync(`${DIR}/browser-edited-text.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();