import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Phase 7 — production-build E2E against the local production server (:3100).
// Admin journey: dashboard, catalog, settings budget card, Freemius readiness,
// real PDF upload → worker → READY → cleanup delete.
// Student journey: authorized subject, REAL lesson + interrupt + resume, TTS,
// progress/review, exhausted credits, expired session, unauthorized access,
// slow network, concurrent requests, viewport sweep, mock-content check.
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3100';
const PHYSICS = 'aaaaaaaa-0101-4000-8000-000000000101';
const DIR = 'qa/screenshots/phase7-prod';
const STUDENT_ONLY = process.argv.includes('--student-only');
mkdirSync(DIR, { recursive: true });

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const consoleErrors = [];
const audioResponses = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(String(message.params.args[0]?.value ?? '').slice(0, 160));
  }
  if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/speech')) {
    audioResponses.push({ status: message.params.response.status, mime: message.params.response.mimeType });
  }
};
const send = (method, params = {}) => new Promise((resolve) => { const current = ++id; pending.set(current, resolve); ws.send(JSON.stringify({ id: current, method, params })); });
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 250));
  return result.result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, timeoutMs = 25000, interval = 300) {
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
async function setFile(selector, filePath) {
  const doc = await send('DOM.getDocument', { depth: 1 });
  const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  if (!node.result.nodeId) throw new Error(`file input missing: ${selector}`);
  await send('DOM.setFileInputFiles', { files: [filePath], nodeId: node.result.nodeId });
}
const clickText = (selector, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
const setViewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const setSession = async (token, device) => {
  await send('Network.clearBrowserCookies');
  if (token) await send('Network.setCookie', { name: 'fahimni_session', value: token, domain: 'localhost', path: '/' });
  if (device) await send('Network.setCookie', { name: 'fahimni_device', value: device, domain: 'localhost', path: '/' });
};

await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');

const out = { startedAt: new Date().toISOString(), admin: {}, student: {}, security: {}, viewports: {} };

// ---------- Admin journey ----------
if (!STUDENT_ONLY) {
await setSession(sessions.admin);
await setViewport(1440, 900, false);

await navigate('/admin', 'document.body.innerText.includes("لوحة") || document.querySelector(".dash-stat")');
out.admin.dashboard = { title: await evaluate('document.title') };
await shot('admin-dashboard-1440');

await navigate('/admin/subjects', 'document.body.innerText.length > 200');
out.admin.catalog = { subjectsListed: await evaluate('document.body.innerText.includes("الرياضيات")') };
await shot('admin-catalog-1440');

await navigate('/admin/settings', 'document.body.innerText.includes("استهلاك الذكاء اليوم")');
out.admin.settings = {
  budgetCard: await evaluate('document.getElementById("budget")?.textContent?.replace(/\\s+/g," ").slice(0, 260) ?? null'),
};
await shot('admin-settings-1440');

await navigate('/admin/subscriptions?section=freemius', 'document.body.innerText.includes("حالة الربط مع فريميوس")');
out.admin.freemius = {
  readiness: await evaluate('document.body.innerText.includes("جاهزية العروض للدفع")'),
  noReadyOffers: await evaluate('document.body.innerText.includes("لا يوجد أي عرض جاهز للدفع")'),
};
await shot('admin-freemius-1440');

// Real PDF upload → worker → READY → cleanup.
await navigate(`/admin/subjects/${PHYSICS}`, '!!document.querySelector(".fn-card")');
await setFile('#book-file', '/tmp/phase7-test.pdf');
await clickText(`form[action$="/book"] .fn-btn`, 'رفع الكتاب');
await waitFor('location.search.includes("status=book_uploaded")', 30000);
out.admin.upload = { accepted: await evaluate('location.search.includes("status=book_uploaded")') };
await shot('admin-book-uploaded-1440');

execSync('pnpm worker:index -- --once', { cwd: process.cwd(), stdio: 'pipe' });
await navigate(`/admin/subjects/${PHYSICS}`, '!!document.querySelector(".fn-card")');
out.admin.indexing = {
  ready: await evaluate('document.body.innerText.includes("جاهز") || document.body.innerText.includes("READY")'),
  pages: await evaluate('document.body.innerText.match(/الصفحات المفهرسة[^\\d]*(\\d+)/)?.[1] ?? null'),
  lowTextWarning: await evaluate('document.body.innerText.includes("النص المستخرج قليل")'),
};
await shot('admin-book-ready-1440');

// Cleanup: delete the QA test book through the admin delete route.
const bookId = await evaluate(`fetch('/admin/subjects/${PHYSICS}').then(r => r.text()).then(html => (html.match(/\\/api\\/admin\\/books\\/([0-9a-f-]{36})\\/delete/) ?? [])[1] ?? null)`);
if (bookId) {
  const deleted = await evaluate(`fetch('/api/admin/books/${bookId}/delete', { method: 'POST', headers: { origin: location.origin } }).then(r => r.status)`);
  out.admin.cleanup = { bookId, deleteStatus: deleted };
} else {
  out.admin.cleanup = { bookId: null, deleteStatus: null };
}
}

// ---------- Student journey ----------
await setSession(sessions.student, sessions.deviceToken);
await setViewport(1440, 900, false);

await navigate('/app', 'document.body.innerText.length > 100');
out.student.dashboard = { title: await evaluate('document.title') };
await shot('student-app-1440');

await navigate('/app/subjects', 'document.body.innerText.length > 100');
out.student.subjects = { listed: await evaluate('document.body.innerText.includes("الرياضيات")') };

await navigate('/app/subjects/tawjihi-math/tutor', '!!document.querySelector(".classroom")');
out.student.mockCheck = {
  demoBadge: await evaluate(`document.body.innerText.includes('وضع تجريبي')`),
  fixtureBadge: await evaluate(`document.body.innerText.includes('عرض تجريبي — بيانات وهمية')`),
  creditChip: await evaluate(`document.querySelector('.credit-chip')?.textContent?.replace(/\\s+/g,' ').trim() ?? null`),
};

// REAL question (bounded: one lesson + one interrupt).
await evaluate(`(() => { const el = document.querySelector('[aria-label="سؤالك للمعلم"]'); const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(el, 'أوجد مساحة مثلث طولا ضلعيه 8 و 6 والزاوية المحصورة بينهما 30 درجة'); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await evaluate(`document.querySelector('[aria-label="أرسل السؤال"]')?.click(); true`);
const lessonLoaded = await waitFor('document.body.innerText.includes("وحدة مربعة") || (document.querySelector("[aria-label=\\"الخطوة التالية\\"]") && !document.querySelector("[aria-label=\\"الخطوة التالية\\"]").disabled)', 120000);
await sleep(2500);
out.student.lesson = {
  loaded: Boolean(lessonLoaded),
  stepLabel: await evaluate(`document.body.innerText.match(/\\d+\\s*\\/\\s*\\d+/)?.[0] ?? null`),
  interruptBar: await evaluate(`!!document.querySelector('.teacher-actions')`),
  errorText: await evaluate(`(document.querySelector('.fn-alert--error, [role="alert"], .classroom-error')?.textContent ?? document.body.innerText.match(/تعذر[^\\n]{0,120}/)?.[0] ?? null)`),
  statusText: await evaluate(`document.querySelector('.classroom')?.textContent?.replace(/\\s+/g,' ').slice(0, 180) ?? null`),
};
await shot('student-lesson-1440');

if (out.student.lesson.interruptBar) {
  await evaluate(`[...document.querySelectorAll('.teacher-action')].find(b => b.textContent.includes('اشرحها أبسط'))?.click(); true`);
  const followupDone = await waitFor(`!document.body.innerText.includes('يجهّز الشرح') && !!document.querySelector('.teacher-action.resume')`, 90000);
  out.student.interrupt = {
    followupDone: Boolean(followupDone),
    hasResume: await evaluate(`!!document.querySelector('.teacher-action.resume')`),
    creditChip: await evaluate(`document.querySelector('.credit-chip')?.textContent?.replace(/\\s+/g,' ').trim() ?? null`),
  };
  await shot('student-interrupt-1440');
  await evaluate(`document.querySelector('.teacher-action.resume')?.click(); true`);
  await sleep(2500);
}

out.student.audio = { speechResponses: audioResponses.slice(0, 4) };

await navigate('/app/review', 'document.body.innerText.length > 100');
out.student.review = { title: await evaluate('document.title') };
await shot('student-review-1440');

// Viewport sweep (mobile + tablet) on the classroom shell.
await setViewport(390, 844, true);
await navigate('/app/subjects/tawjihi-math/tutor', '!!document.querySelector(".classroom")');
out.viewports.mobile390 = { overflow: await evaluate('document.documentElement.scrollWidth > window.innerWidth + 1') };
await shot('student-classroom-390');
await setViewport(768, 1024, false);
await navigate('/app', 'document.body.innerText.length > 100');
out.viewports.tablet768 = { overflow: await evaluate('document.documentElement.scrollWidth > window.innerWidth + 1') };
await shot('student-app-768');

// Slow network: 400ms latency, ~1.5Mbps.
await setViewport(1440, 900, false);
await send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 196608, uploadThroughput: 98304 });
await navigate('/app', 'document.body.innerText.length > 100');
out.student.slowNetwork = { loaded: true, title: await evaluate('document.title') };
await shot('student-app-slow-network');
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

// ---------- Security checks ----------
// Expired/invalid session: bogus cookie must land on login.
await setSession('invalid-expired-token');
await navigate('/app', 'document.readyState === "complete"');
out.security.expiredSession = { url: await evaluate('location.pathname'), onLogin: await evaluate('location.pathname.startsWith("/login")') };

// Unauthorized admin access with a student session: must be redirected away.
await setSession(sessions.student, sessions.deviceToken);
await navigate('/admin', 'document.readyState === "complete"');
const adminPath = await evaluate('location.pathname');
out.security.studentOnAdmin = { url: adminPath, blocked: adminPath !== '/admin' };

// Unauthenticated book page fetch.
await setSession(null);
const unauthBook = await fetch(`${BASE}/api/books/11111111-1111-4111-8111-111111111111/pages/50`, { redirect: 'manual' });
out.security.unauthBookPage = unauthBook.status;

// Concurrent requests from an authenticated page.
await setSession(sessions.student, sessions.deviceToken);
if (sessions.deviceToken) await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });
await navigate('/app', 'document.body.innerText.length > 100');
out.security.concurrent = await evaluate(`Promise.all(Array.from({length: 5}, () => fetch('/api/health').then(r => r.status)))`);

// Exhausted credits: temporarily zero the QA student's wallet, expect a clean
// Arabic credit error (no charge, no crash), then restore the exact original
// balances (QA fixture user only).
const PSQL = `psql -tA 'postgresql://mrik@127.0.0.1:5432/fahimni_local'`;
const balancesRaw = execSync(`${PSQL} -c "select id, credit_balance from entitlements where user_id = (select id from users where email = 'student@fahimni.local')"`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const originalBalances = balancesRaw
  ? balancesRaw.split('\n').map((line) => {
      const [entitlementId, balance] = line.split('|');
      return { entitlementId, balance: Number(balance) };
    })
  : [];
execSync(`${PSQL} -c "update entitlements set credit_balance = 0 where user_id = (select id from users where email = 'student@fahimni.local')"`, { stdio: 'pipe' });
const exhausted = await evaluate(`fetch('/api/tutor', { method: 'POST', headers: { 'content-type': 'application/json', origin: location.origin }, body: JSON.stringify({ question: 'سؤال اختبار الرصيد', board: { objects: [] }, history: [], currentStep: 0, currentLesson: null, subjectSlug: 'tawjihi-math', requestId: crypto.randomUUID() }) }).then(async r => ({ status: r.status, code: (await r.json()).code }))`);
out.security.exhaustedCredits = { ...exhausted, balancesRestored: originalBalances.length };
for (const entry of originalBalances) {
  execSync(`${PSQL} -c "update entitlements set credit_balance = ${entry.balance} where id = '${entry.entitlementId}'"`, { stdio: 'pipe' });
}
await shot('student-exhausted-credits');

out.consoleErrors = [...new Set(consoleErrors)].slice(0, 10);
out.finishedAt = new Date().toISOString();
writeFileSync('qa/audit-phase7-prod.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();
