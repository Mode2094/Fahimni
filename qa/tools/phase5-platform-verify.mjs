import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const DIR = 'qa/screenshots/phase5-platform';
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
async function setSession(token, device) {
  await send('Network.clearBrowserCookies');
  if (token) await send('Network.setCookie', { name: 'fahimni_session', value: token, domain: 'localhost', path: '/' });
  if (device) await send('Network.setCookie', { name: 'fahimni_device', value: device, domain: 'localhost', path: '/' });
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
const pageFacts = () => evaluate(`JSON.stringify({
  title: document.title,
  h1: document.querySelector('h1')?.textContent?.replace(/\\s+/g,' ').trim().slice(0,90) ?? null,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  scrollWidth: document.documentElement.scrollWidth,
})`).then(JSON.parse);

await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');

const out = { startedAt: new Date().toISOString(), admin: {}, student: {}, classroom: {}, public: {} };

// ---------- Admin ----------
await setSession(sessions.admin, sessions.deviceToken);
await setViewport(1440, 900, false);

await navigate('/admin/students', '!!document.querySelector("table, .fn-empty")');
out.admin.students1440 = {
  ...(await pageFacts()),
  rows: await evaluate('document.querySelectorAll("tbody tr").length'),
  listsAuditStudent: await evaluate('document.body.innerText.includes("student@fahimni.local")'),
};
await shot('admin-students-1440');

await navigate('/admin/students?q=student%40fahimni.local', '!!document.querySelector("table, .fn-empty")');
out.admin.studentsSearch1440 = {
  rows: await evaluate('document.querySelectorAll("tbody tr").length'),
  showsMatch: await evaluate('document.body.innerText.includes("student@fahimni.local")'),
};

await navigate('/admin/settings', 'document.body.innerText.includes("استهلاك الذكاء اليوم")');
await evaluate('document.getElementById("budget")?.scrollIntoView({block:"start"}); true');
await sleep(400);
out.admin.settings1440 = {
  ...(await pageFacts()),
  budgetCard: await evaluate('document.getElementById("budget")?.textContent?.replace(/\\s+/g," ").trim().slice(0,400) ?? null'),
};
await shot('admin-settings-budget-1440');

await setViewport(390, 844, true);
await navigate('/admin/students', '!!document.querySelector("table, .fn-empty")');
out.admin.students390 = { ...(await pageFacts()), rows: await evaluate('document.querySelectorAll("tbody tr").length') };
await shot('admin-students-390');
await navigate('/admin/settings', 'document.body.innerText.includes("استهلاك الذكاء اليوم")');
await evaluate('document.getElementById("budget")?.scrollIntoView({block:"start"}); true');
await sleep(400);
out.admin.settings390 = { ...(await pageFacts()) };
await shot('admin-settings-budget-390');

// ---------- Student ----------
await setSession(sessions.student, sessions.deviceToken);
await setViewport(1440, 900, false);
await navigate('/app', 'document.readyState === "complete" && document.body.innerText.length > 50');
out.student.app1440 = { ...(await pageFacts()) };
await shot('student-app-1440');
await navigate('/app/review', 'document.body.innerText.length > 50');
out.student.review1440 = {
  ...(await pageFacts()),
  hasEmptyState: await evaluate('document.body.innerText.includes("لا توجد") || document.body.innerText.includes("نقاط")'),
};
await shot('student-review-1440');

await setViewport(390, 844, true);
await navigate('/app', 'document.readyState === "complete" && document.body.innerText.length > 50');
out.student.app390 = { ...(await pageFacts()) };
await shot('student-app-390');

// ---------- Real classroom E2E (1 question + 1 interrupt follow-up) ----------
await setViewport(1440, 900, false);
await navigate('/app/subjects/tawjihi-math/tutor', '!!document.querySelector(".classroom")');
const before = JSON.parse(await evaluate(`JSON.stringify({
  creditChip: document.querySelector('.credit-chip')?.textContent?.replace(/\\s+/g,' ').trim() ?? null,
  demoBadge: document.body.innerText.includes('وضع تجريبي'),
})`));
await evaluate(`(() => { const el = document.querySelector('[aria-label="سؤالك للمعلم"]'); const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(el, 'أوجد مساحة مثلث طولا ضلعيه 8 و 6 والزاوية المحصورة بينهما 30 درجة'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await evaluate(`document.querySelector('[aria-label="أرسل السؤال"]')?.click(); true`);
const lessonLoaded = await waitFor('document.body.innerText.includes("وحدة مربعة") || (document.querySelector("[aria-label=\\"الخطوة التالية\\"]") && !document.querySelector("[aria-label=\\"الخطوة التالية\\"]").disabled)', 120000);
await sleep(3000);
const afterQuestion = JSON.parse(await evaluate(`JSON.stringify({
  lessonLoaded: ${lessonLoaded ? 'true' : 'false'},
  stepLabel: document.body.innerText.match(/\\d+\\s*\\/\\s*\\d+/)?.[0] ?? null,
  boardText: (document.querySelector('[aria-label="السبورة التفاعلية"]')?.textContent ?? '').replace(/\\s+/g,' ').slice(0, 220),
  creditChip: document.querySelector('.credit-chip')?.textContent?.replace(/\\s+/g,' ').trim() ?? null,
  hasInterruptBar: !!document.querySelector('.teacher-actions'),
})`));
await shot('classroom-question-1440');

let afterInterrupt = null;
if (afterQuestion.hasInterruptBar) {
  await evaluate(`[...document.querySelectorAll('.teacher-action')].find(b => b.textContent.includes('اشرحها أبسط'))?.click(); true`);
  await sleep(1500);
  const followupDone = await waitFor(`(() => { const chip = document.querySelector('.credit-chip')?.textContent ?? ''; return !document.body.innerText.includes('يجهّز الشرح') && (document.querySelector('[aria-label="السبورة التفاعلية"]')?.textContent ?? '').length > 0; })()`, 90000);
  await sleep(2500);
  afterInterrupt = JSON.parse(await evaluate(`JSON.stringify({
    followupDone: ${followupDone ? 'true' : 'false'},
    stepLabel: document.body.innerText.match(/\\d+\\s*\\/\\s*\\d+/)?.[0] ?? null,
    boardText: (document.querySelector('[aria-label="سبورة تفاعلية"]')?.textContent ?? document.querySelector('[aria-label="السبورة التفاعلية"]')?.textContent ?? '').replace(/\\s+/g,' ').slice(0, 220),
    creditChip: document.querySelector('.credit-chip')?.textContent?.replace(/\\s+/g,' ').trim() ?? null,
    hasResume: !!document.querySelector('.teacher-action.resume'),
  })`));
  await shot('classroom-interrupt-1440');
}
out.classroom = { before, afterQuestion, afterInterrupt };

// ---------- Public: landing + legal ----------
for (const viewport of [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '768', width: 768, height: 1024, mobile: false },
  { name: '1440', width: 1440, height: 900, mobile: false },
]) {
  await setSession(null, null);
  await setViewport(viewport.width, viewport.height, viewport.mobile);
  await navigate('/', 'document.readyState === "complete"');
  out.public[`landing${viewport.name}`] = {
    ...(await pageFacts()),
    hasPrivacyLink: await evaluate('!!document.querySelector("a[href=\\"/privacy\\"]")'),
    hasTermsLink: await evaluate('!!document.querySelector("a[href=\\"/terms\\"]")'),
  };
  await shot(`landing-${viewport.name}`);
  if (viewport.name !== '768') {
    await navigate('/privacy', 'document.body.innerText.includes("مسودة")');
    out.public[`privacy${viewport.name}`] = { ...(await pageFacts()) };
    await shot(`privacy-${viewport.name}`);
    await navigate('/terms', 'document.body.innerText.includes("مسودة")');
    out.public[`terms${viewport.name}`] = { ...(await pageFacts()) };
    await shot(`terms-${viewport.name}`);
  }
}

out.consoleErrors = [...new Set(consoleErrors)].slice(0, 10);
out.finishedAt = new Date().toISOString();
writeFileSync('qa/audit-phase5-platform.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();
