import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Confirms the duplicate-key fix against a REAL lesson: one question, then the
// board is inspected for repeated object ids and the console is watched.
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const DIR = 'qa/screenshots/duplicate-key-fix';
mkdirSync(DIR, { recursive: true });

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(String(message.params.args[0]?.value ?? '').slice(0, 200));
  }
};
const send = (method, params = {}) => new Promise((resolve) => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 250));
  return result.result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, timeoutMs = 30000, interval = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression).catch(() => false);
    if (value) return value;
    await sleep(interval);
  }
  return null;
}
async function navigate(path, ready = 'document.readyState === "complete"') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await waitFor(ready);
  await sleep(500);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(result.result.data, 'base64'));
}

await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.student, domain: 'localhost', path: '/' });
if (sessions.deviceToken) await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const out = { startedAt: new Date().toISOString() };

await navigate('/app/subjects/tawjihi-math/tutor', '!!document.querySelector(".classroom")');
await evaluate(`(() => { const el = document.querySelector('[aria-label="سؤالك للمعلم"]'); const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(el, 'حل المعادلة 2س + 3 = 7 خطوة بخطوة'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await evaluate(`document.querySelector('[aria-label="أرسل السؤال"]')?.click(); true`);

// Sample the board while the lesson plays so late segments are covered too.
const samples = [];
for (let step = 0; step < 14; step += 1) {
  const sample = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('.board-object, .board-row-item, .board-zone .board-row > div'));
    return JSON.stringify({
      step: document.body.innerText.match(/\\d+\\s*\\/\\s*\\d+/)?.[0] ?? null,
      objects: items.length,
      texts: items.map((node) => (node.getAttribute('data-object-id') || node.textContent || '').slice(0, 40)),
    });
  })()`).catch(() => null);
  if (sample) samples.push(JSON.parse(sample));
  if (step === 6) await shot('lesson-mid');
  await sleep(2000);
}

out.duplicateKeyErrors = consoleErrors.filter((line) => line.includes('same key'));
out.consoleErrors = [...new Set(consoleErrors)].slice(0, 6);
out.samples = samples.map((sample) => ({
  step: sample.step,
  objects: sample.objects,
  // Duplicate rendered content is the visible symptom of a duplicated id.
  duplicates: sample.texts.filter((text, index, all) => text && all.indexOf(text) !== index),
}));
out.lessonReached = samples.some((sample) => sample.step && !sample.step.startsWith('0 /'));
await shot('lesson-end');
out.finishedAt = new Date().toISOString();
writeFileSync('qa/audit-duplicate-key-fix.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify({ duplicateKeyErrors: out.duplicateKeyErrors, consoleErrors: out.consoleErrors, lessonReached: out.lessonReached, samples: out.samples.slice(0, 6) }, null, 1));
ws.close();