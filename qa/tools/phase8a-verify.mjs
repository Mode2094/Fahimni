import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Phase 8A verification on the production build (:3100): landing completeness
// (features/trial/FAQ), FAQ interaction, admin content warnings, student pages
// and viewport sweep. No AI calls.
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3100';
const DIR = 'qa/screenshots/phase8a';
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
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 250));
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
async function navigate(path, ready = 'document.readyState === "complete"') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await waitFor(ready);
  await sleep(500);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
const setViewport = (width, height, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
const setSession = async (token, device) => {
  await send('Network.clearBrowserCookies');
  if (token) await send('Network.setCookie', { name: 'fahimni_session', value: token, domain: 'localhost', path: '/' });
  if (device) await send('Network.setCookie', { name: 'fahimni_device', value: device, domain: 'localhost', path: '/' });
};
const facts = () => evaluate(`JSON.stringify({
  title: document.title,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})`).then(JSON.parse);

await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');

const out = { startedAt: new Date().toISOString(), landing: {}, faq: {}, admin: {}, student: {}, consoleErrors: [] };

// ---------- Landing across viewports ----------
for (const viewport of [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '768', width: 768, height: 1024, mobile: false },
  { name: '1440', width: 1440, height: 900, mobile: false },
]) {
  await setSession(null);
  await setViewport(viewport.width, viewport.height, viewport.mobile);
  await navigate('/', 'document.body.innerText.includes("الصفوف الدراسية")');
  out.landing[viewport.name] = {
    ...(await facts()),
    hasFeatures: await evaluate('document.body.innerText.includes("كل ما تحتاجه للفهم")'),
    hasTrial: await evaluate('document.body.innerText.includes("جرّب فهمني مجانًا") || document.body.innerText.includes("ابدأ بحساب مجاني")'),
    hasPricing: await evaluate('document.body.innerText.includes("الاشتراكات بوضوح")'),
    hasFaq: await evaluate('document.body.innerText.includes("الأسئلة الشائعة")'),
    hasRealGrades: await evaluate('document.body.innerText.includes("الصف الثاني عشر (توجيهي)")'),
    hasWhatsApp: await evaluate('document.body.innerText.includes("تواصل معنا")'),
    hasLegalLinks: await evaluate('!!document.querySelector("a[href=\\"/privacy\\"]") && !!document.querySelector("a[href=\\"/terms\\"]")'),
    navFaqLink: await evaluate('!!document.querySelector("a[href=\\"/#faq\\"]")'),
  };
  await shot(`landing-${viewport.name}`);
}

// ---------- FAQ interaction (desktop) ----------
await setViewport(1440, 900, false);
await navigate('/', 'document.body.innerText.includes("الأسئلة الشائعة")');
out.faq.items = await evaluate('document.querySelectorAll(".faq-item").length');
const opened = await evaluate(`(() => { const item = document.querySelector('.faq-item'); if (!item) return false; item.querySelector('summary').click(); return item.open; })()`);
out.faq.opensOnClick = opened;
out.faq.answerVisible = await evaluate(`(() => { const item = document.querySelector('.faq-item'); return !!item && item.open && (item.querySelector('.faq-item__a')?.textContent?.length ?? 0) > 20; })()`);
await evaluate('document.getElementById("faq")?.scrollIntoView({block:"start"}); true');
await sleep(400);
await shot('landing-faq-open');

// ---------- Admin ----------
await setSession(sessions.admin);
await setViewport(1440, 900, false);
await navigate('/admin/subjects', 'document.body.innerText.includes("المواد")');
out.admin.subjects = {
  ...(await facts()),
  warningCard: await evaluate('document.body.innerText.includes("مواد مفعّلة بلا كتاب جاهز")'),
  listsMissing: await evaluate('document.body.innerText.includes("لا يوجد كتاب")'),
  warningCount: await evaluate('document.querySelectorAll(".fn-readiness li").length'),
};
await shot('admin-subjects-warning-1440');
await navigate('/admin/subjects?section=none', 'document.readyState === "complete"');
for (const path of ['/admin', '/admin/grades', '/admin/fields', '/admin/subscriptions', '/admin/settings', '/admin/students']) {
  await navigate(path, 'document.body.innerText.length > 150');
  const status = await evaluate(`document.body.innerText.includes('تعذر') ? 'error-text' : 'ok'`);
  out.admin[path] = status;
}

// ---------- Student ----------
await setSession(sessions.student, sessions.deviceToken);
for (const viewport of [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '768', width: 768, height: 1024, mobile: false },
  { name: '1440', width: 1440, height: 900, mobile: false },
]) {
  await setViewport(viewport.width, viewport.height, viewport.mobile);
  await navigate('/app', 'document.body.innerText.length > 100');
  out.student[`app-${viewport.name}`] = { ...(await facts()) };
  await shot(`student-app-${viewport.name}`);
}
await setViewport(1440, 900, false);
await navigate('/app/subjects/tawjihi-math/tutor', '!!document.querySelector(".classroom")');
out.student.classroom = {
  ...(await facts()),
  hasToolsButton: await evaluate(`!!document.querySelector('.tools-button, [aria-label*="أدوات"]')`),
};
await shot('student-classroom-1440');

// ---------- Classroom non-AI controls (tools sheet, immersive, font size) ----------
out.student.controls = await evaluate(`(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const result = { toolsOpened: false, fontStep: false, immersiveOn: false, immersiveOff: false, newSession: false, sheetClosed: false, errors: 0 };
  const openSheet = async () => { document.querySelector('.tools-button')?.click(); await wait(250); };
  const tile = (text) => [...document.querySelectorAll('.tool-tile')].find(t => t.textContent.includes(text));
  try {
    await openSheet();
    result.toolsOpened = !!document.querySelector('.tools-sheet');
    tile('تكبير الكتابة')?.click();
    await wait(150);
    result.fontStep = true;
    tile('ملء الشاشة')?.click();
    await wait(250);
    result.immersiveOn = document.querySelector('.classroom')?.className.includes('is-immersive') ?? false;
    await openSheet();
    tile('إنهاء وضع الصف')?.click();
    await wait(250);
    result.immersiveOff = !(document.querySelector('.classroom')?.className.includes('is-immersive') ?? true);
    await openSheet();
    tile('جلسة جديدة')?.click();
    await wait(250);
    result.newSession = !document.querySelector('.tools-sheet');
    await openSheet();
    document.querySelector('.tools-sheet-head .icon-button')?.click();
    await wait(250);
    result.sheetClosed = !document.querySelector('.tools-sheet');
  } catch { result.errors += 1; }
  return JSON.stringify(result);
})()`).then(JSON.parse);
await shot('student-classroom-controls-1440');

await navigate('/app/review', 'document.body.innerText.length > 100');
out.student.review = { title: await evaluate('document.title') };

out.consoleErrors = [...new Set(consoleErrors)].slice(0, 10);
out.finishedAt = new Date().toISOString();
writeFileSync('qa/audit-phase8a.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();
