import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
mkdirSync('qa/screenshots/real-ai-classroom', { recursive: true });

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
    consoleErrors.push(String(message.params.args[0]?.value ?? '').slice(0, 150));
  }
};
const send = (method, params = {}) => new Promise((resolve) => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 250));
  return result.result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, timeoutMs = 60000, interval = 500) {
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
  writeFileSync(`qa/screenshots/real-ai-classroom/${name}.png`, Buffer.from(result.result.data, 'base64'));
}

await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.student, domain: 'localhost', path: '/' });
if (sessions.deviceToken) await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });

const out = { viewports: {} };
for (const viewport of [{ name: '390x844', width: 390, height: 844, mobile: true }, { name: '1440x900', width: 1440, height: 900, mobile: false }]) {
  await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
  await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
  await waitFor('!!document.querySelector(".classroom")');
  await sleep(600);
  const record = {};
  record.initial = JSON.parse(await evaluate(`JSON.stringify({
    demoBadge: document.body.innerText.includes('وضع تجريبي'),
    composer: !!document.querySelector('[aria-label="سؤالك للمعلم"]'),
    creditChip: document.querySelector('.credit-chip')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  })`));
  await shot(`${viewport.name}-before`);

  // Type a real question and send it.
  await evaluate(`(() => { const el = document.querySelector('[aria-label="سؤالك للمعلم"]'); const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(el, 'أوجد مساحة مثلث طولا ضلعيه 8 و 6 والزاوية المحصورة بينهما 30 درجة'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await evaluate(`document.querySelector('[aria-label="أرسل السؤال"]')?.click(); true`);
  const loaded = await waitFor('document.body.innerText.includes("وحدة مربعة") || document.querySelector(".classroom")?.textContent.includes("12")', 90000);
  await sleep(2500);
  record.afterQuestion = JSON.parse(await evaluate(`JSON.stringify({
    demoBadge: document.body.innerText.includes('وضع تجريبي'),
    lessonLoaded: !!document.querySelector('[aria-label="الخطوة التالية"]:not([disabled])'),
    boardText: (document.querySelector('[aria-label="السبورة التفاعلية"]')?.textContent ?? '').replace(/\\s+/g, ' ').slice(0, 200),
    svgShapes: document.querySelectorAll('[aria-label="السبورة التفاعلية"] svg *').length,
    creditChip: document.querySelector('.credit-chip')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    stepLabel: document.body.innerText.match(/\\d+\\s*\\/\\s*\\d+/)?.[0] ?? null,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  })`));
  await shot(`${viewport.name}-lesson`);
  out.viewports[viewport.name] = record;
}

out.consoleErrors = consoleErrors.slice(0, 8);
writeFileSync('qa/screenshots/real-ai-classroom/results.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();
