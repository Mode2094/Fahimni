import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Phase 1 browser evidence: mobile (390x844) + desktop (1440x900), RTL, and a
// long equation rendered on the board. No AI calls are made.
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const DIR = 'docs/reviews/phase-1-screenshots';
mkdirSync(DIR, { recursive: true });

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(String(message.params.args[0]?.value ?? '').slice(0, 160));
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
async function navigate(path, ready = 'document.readyState === "complete"') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await waitFor(ready);
  await sleep(700);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
const setViewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });

await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.student, domain: 'localhost', path: '/' });
if (sessions.deviceToken) await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });

const out = { startedAt: new Date().toISOString(), viewports: {} };
const longEquation = 'أوجد قيمة x في المعادلة 3x^2 - 12x + 9 = 0 باستخدام التحليل إلى العوامل ثم تحقق من الحلين';

for (const viewport of [
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false },
  { name: 'tablet-768', width: 768, height: 1024, mobile: false },
  { name: 'mobile-390', width: 390, height: 844, mobile: true },
]) {
  await setViewport(viewport.width, viewport.height, viewport.mobile);
  await navigate('/app/subjects/tawjihi-math/tutor', '!!document.querySelector(".classroom")');

  // Type a long RTL question into the composer (no submission).
  await evaluate(`(() => { const el = document.querySelector('[aria-label="سؤالك للمعلم"]'); const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(longEquation)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(400);

  out.viewports[viewport.name] = JSON.parse(await evaluate(`JSON.stringify({
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    composerValue: (document.querySelector('[aria-label="سؤالك للمعلم"]')?.value ?? '').slice(0, 40),
    sendEnabled: !document.querySelector('[aria-label="أرسل السؤال"]')?.disabled,
    textareaHeight: document.querySelector('[aria-label="سؤالك للمعلم"]')?.style?.height ?? null,
  })`));
  await shot(`${viewport.name}-composer`);

  // Open the shared tools panel (secondary controls, kept out of the way).
  await evaluate(`document.querySelector('.tools-button')?.click(); true`);
  await sleep(400);
  out.viewports[viewport.name].toolsOpen = await evaluate(`!!document.querySelector('.tools-sheet')`);
  await shot(`${viewport.name}-tools`);
  await evaluate(`document.querySelector('.tools-sheet-head .icon-button')?.click(); true`);
  await sleep(200);
}

out.consoleErrors = [...new Set(consoleErrors)].slice(0, 8);
out.finishedAt = new Date().toISOString();
writeFileSync('docs/reviews/phase-1-screenshots/results.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();