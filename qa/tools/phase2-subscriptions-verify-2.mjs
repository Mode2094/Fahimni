import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const GRADE_ID = 'ac160166-5f14-4234-80b8-a23c647294e7';
const FIELD_ID = '3233891a-640d-49b2-bcb3-ca1b108f9c12';
const CHEMISTRY_ID = 'aaaaaaaa-0102-4000-8000-000000000102';
mkdirSync('qa/screenshots/phase2-subscriptions', { recursive: true });

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
async function waitFor(expression, timeoutMs = 12000, interval = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(interval);
  }
  return null;
}
async function setSession(token) {
  await send('Network.clearBrowserCookies');
  if (token) await send('Network.setCookie', { name: 'fahimni_session', value: token, domain: 'localhost', path: '/' });
}
async function navigate(path, ready = 'document.readyState === "complete"') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await waitFor(ready, 15000);
  await sleep(400);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`qa/screenshots/phase2-subscriptions/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
const clickText = (selector, text) =>
  evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
const setSelect = (selector, value) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value; })()`);
const setInput = (selector, value) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);

const out = {};
await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// ---------- student picker after restore ----------
await setSession(sessions.student);
await navigate('/app/subscription', '!!document.body');
out.studentMonthly = JSON.parse(await evaluate(`JSON.stringify({
  cards: [...document.querySelectorAll('.sub-card .pricing-card__name')].map((el) => el.textContent.trim()),
  prices: [...document.querySelectorAll('.sub-card .pricing-card__price')].map((el) => el.textContent.trim()),
})`));
await clickText('.fn-segmented__item', 'فصلي');
await sleep(400);
out.studentSemester = JSON.parse(await evaluate(`JSON.stringify({ cards: [...document.querySelectorAll('.sub-card .pricing-card__name')].map((el) => el.textContent.trim()) })`));
await clickText('.sub-choice__tile', 'جميع المواد');
await sleep(400);
out.studentBundles = JSON.parse(await evaluate(`JSON.stringify({ cards: [...document.querySelectorAll('.sub-card .pricing-card__name')].map((el) => el.textContent.trim()), chips: [...document.querySelectorAll('.sub-chip')].map((el) => el.textContent.trim()) })`));
await shot('student-picker-restored');

// ---------- coverage badge on audit-bundle ----------
await setSession(sessions.bundle);
await navigate('/app/subscription', '!!document.body');
out.bundleCoverage = JSON.parse(await evaluate(`JSON.stringify({
  current: document.body.innerText.includes('اشتراكك الحالي'),
  badges: [...document.querySelectorAll('.sub-card .fn-badge')].map((b) => b.textContent.trim()).filter((t) => t.includes('وصول ساري')),
  cards: [...document.querySelectorAll('.sub-card .pricing-card__name')].map((el) => el.textContent.trim()),
})`));
await shot('student-coverage-badge');

// ---------- non-destructive draft: chemistry monthly ----------
await setSession(sessions.admin);
await navigate('/admin/subscriptions?section=offers', '!!document.querySelector(".fn-wizard")');
await setSelect('#wizard-grade', GRADE_ID);
await setSelect('#wizard-field', FIELD_ID);
await sleep(400);
await setSelect('#wizard-subject', CHEMISTRY_ID);
await clickText('.fn-wizard__footer .fn-btn', 'التالي');
await sleep(300);
await clickText('.fn-wizard__footer .fn-btn', 'التالي');
await sleep(300);
await setInput('#wizard-price', '9');
await setInput('#wizard-plan', '');
await clickText('.fn-wizard__footer .fn-btn', 'التالي');
await sleep(400);
await clickText('.fn-wizard__footer .fn-btn', 'حفظ كمسودة');
await waitFor('location.search.includes("status=offer_drafted")', 15000);
await sleep(700);
out.draftCreated = JSON.parse(await evaluate(`(() => {
  const card = [...document.querySelectorAll('.fn-offer-card')].find((el) => el.textContent.includes('كيمياء') && el.textContent.includes('يحتاج إعداد'));
  return JSON.stringify({ saved: location.search, found: !!card, id: card?.id ?? null, studentHidden: true });
})()`));
await shot('desktop-draft-card');

// student never sees the draft
await setSession(sessions.student);
await navigate('/app/subscription', '!!document.body');
out.draftHiddenFromStudent = await evaluate(`!document.body.innerText.includes('كيمياء')`);

// ---------- invalid term dates via full form ----------
await setSession(sessions.admin);
await navigate('/admin/subscriptions?section=terms', '!!document.querySelector("input[name=academicYear]")');
await setInput('input[name=name]', 'فصل تواريخ خاطئة');
await setInput('input[name=academicYear]', '2026/2027');
await setSelect('select[name=gradeId]', GRADE_ID);
await setInput('input[name=startDate]', '2027-06-01');
await setInput('input[name=endDate]', '2027-02-01');
await clickText('form[action="/api/admin/subscriptions/terms"] .fn-btn', 'إضافة الفصل');
await waitFor('location.search.includes("error=")', 15000);
await sleep(600);
out.invalidTerm = JSON.parse(await evaluate(`JSON.stringify({ error: location.search, alert: document.querySelector('.fn-alert--error')?.textContent.trim() ?? null, notCreated: !document.body.innerText.includes('فصل تواريخ خاطئة') })`));
await shot('desktop-invalid-term');

out.consoleErrors = consoleErrors.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
ws.close();
