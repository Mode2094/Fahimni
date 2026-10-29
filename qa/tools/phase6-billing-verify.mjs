import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const DIR = 'qa/screenshots/phase6-billing';
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
    consoleErrors.push(String(message.params.args[0]?.value ?? '').slice(0, 150));
  }
};
const send = (method, params = {}) => new Promise((resolve) => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 300));
  return result.result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, timeoutMs = 20000, interval = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression).catch(() => false);
    if (value) return value;
    await sleep(interval);
  }
  return null;
}
async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
}
async function navigate(path, ready = 'document.readyState === "complete"') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await waitFor(ready, 25000);
  await sleep(600);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
const facts = () => evaluate(`JSON.stringify({
  title: document.title,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})`).then(JSON.parse);

await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.admin, domain: 'localhost', path: '/' });

const out = { startedAt: new Date().toISOString(), admin: {}, consoleErrors: [] };

await setViewport(1440, 900, false);
await navigate('/admin/subscriptions?section=freemius', 'document.body.innerText.includes("أحداث الفوترة الأخيرة")');
out.admin.freemius1440 = {
  ...(await facts()),
  hasEventsCard: await evaluate('document.body.innerText.includes("أحداث الفوترة الأخيرة")'),
  showsSimulatedEvent: await evaluate('document.body.innerText.includes("[محاكاة اختبار]")'),
  hasOperationalRules: await evaluate('document.body.innerText.includes("اشتراك واحد لكل مستخدم") && document.body.innerText.includes("العملات المدعومة للدفع") && document.body.innerText.includes("الفصل الدراسي")'),
  hasCurrencyList: await evaluate('document.body.innerText.includes("USD") && document.body.innerText.includes("ILS")'),
  noConflictWarning: await evaluate('!document.body.innerText.includes("تعارض في ربط الخطط")'),
};
await shot('admin-freemius-1440');

await navigate('/admin/subscriptions?section=subscribers', 'document.body.innerText.includes("اشتراكات الطلاب")');
out.admin.subscribers1440 = {
  ...(await facts()),
  hasResyncColumn: await evaluate('document.body.innerText.includes("مزامنة")'),
  rows: await evaluate('document.querySelectorAll("tbody tr").length'),
};
await shot('admin-subscribers-1440');

await setViewport(390, 844, true);
await navigate('/admin/subscriptions?section=freemius', 'document.body.innerText.includes("أحداث الفوترة الأخيرة")');
out.admin.freemius390 = { ...(await facts()) };
await shot('admin-freemius-390');
await navigate('/admin/subscriptions?section=subscribers', 'document.body.innerText.includes("اشتراكات الطلاب")');
out.admin.subscribers390 = { ...(await facts()) };
await shot('admin-subscribers-390');

out.consoleErrors = [...new Set(consoleErrors)].slice(0, 8);
out.finishedAt = new Date().toISOString();
writeFileSync('qa/audit-phase6-billing.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();
