import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const results = {};

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const cur = ++id; pending.set(cur, res); ws.send(JSON.stringify({ id: cur, method, params })); });
const evaluate = async (expression) => {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('eval-timeout')), 20_000)),
  ]);
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 240));
  return r.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setCookie = async (name, value) => { await send('Network.clearBrowserCookies'); await send('Network.setCookie', { name, value, domain: 'localhost', path: '/' }); };
async function realClick(selector) {
  const box = JSON.parse(await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return 'null'; const b=el.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2}); })()`));
  if (!box) throw new Error(`missing ${selector}`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}
async function shot(group, name) {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  mkdir(`qa/screenshots/${group}`, { recursive: true });
  await writeFile(`qa/screenshots/${group}/${name}.png`, Buffer.from(s.result.data, 'base64'));
}

await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

// 1) onboarding UI
await setCookie('fahimni_session', sessions.noProfile);
await send('Page.navigate', { url: `${BASE}/onboarding` });
await sleep(2500);
await evaluate(`document.querySelector('input[value="ac160166-5f14-4234-80b8-a23c647294e7"]')?.closest('label')?.click(); true`);
await sleep(300);
results.onboarding = await evaluate(`(() => {
  const fieldLabels = Array.from(document.querySelectorAll('input[name="academicFieldId"]')).map((i) => i.closest('label')?.textContent.trim());
  const submit = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('التالي'));
  return JSON.stringify({ fieldOptions: fieldLabels.length, submitDisabledWithoutField: submit?.disabled ?? null });
})()`);
await evaluate(`document.querySelector('input[name="academicFieldId"]')?.closest('label')?.click(); true`);
await sleep(300);
await evaluate(`Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('التالي'))?.click(); true`);
await sleep(2500);
results.onboardingAfterSubmit = await evaluate(`location.pathname`);
await send('Page.navigate', { url: `${BASE}/onboarding` });
await sleep(1800);
results.onboardingRevisit = await evaluate(`location.pathname`);

// 2) account devices
await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });
await setCookie('fahimni_session', sessions.student);
await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });
await send('Page.navigate', { url: `${BASE}/app/account` });
await sleep(2500);
results.accountBefore = await evaluate(`(() => {
  const rows = Array.from(document.querySelectorAll('li,article,div')).filter((el) => el.className && String(el.className).includes('device'));
  return JSON.stringify({ deviceText: document.body.innerText.match(/Chrome[^\\n]*|Safari[^\\n]*/g)?.slice(0, 6) ?? [], currentMarkers: (document.body.innerText.match(/الجهاز الحالي|هذا الجهاز/g) ?? []).length });
})()`);
const revokeClicked = await evaluate(`(() => { const btns = Array.from(document.querySelectorAll('button')).filter((b) => (b.getAttribute('aria-label') ?? '').includes('إزالة') || b.textContent.includes('إزالة')); const old = btns.find((b) => (b.closest('*')?.textContent ?? '').includes('Safari')) ?? btns[btns.length - 1]; if (!old) return false; old.click(); return true; })()`);
await sleep(2000);
results.accountRevoke = { clicked: revokeClicked, text: await evaluate(`document.body.innerText.match(/Chrome[^\\n]*|Safari[^\\n]*/g)?.slice(0, 6) ?? []`) };

// 3) admin grade CRUD UI
await setCookie('fahimni_session', sessions.admin);
await send('Page.navigate', { url: `${BASE}/admin/grades/new` });
await sleep(2200);
const slug = `audit-grade-${Date.now()}`;
results.adminGradeForm = await evaluate(`(() => {
  const form = document.querySelector('form');
  if (!form) return JSON.stringify({ form: false });
  const name = form.querySelector('input[name="name"]'); const slugInput = form.querySelector('input[name="slug"]');
  if (!name || !slugInput) return JSON.stringify({ form: true, fields: Array.from(form.querySelectorAll('input,select')).map((i) => i.name) });
  name.value = 'صف التدقيق';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  slugInput.value = ${JSON.stringify(slug)};
  slugInput.dispatchEvent(new Event('input', { bubbles: true }));
  const sort = form.querySelector('input[name="sortOrder"]'); if (sort) { sort.value = '90'; sort.dispatchEvent(new Event('input', { bubbles: true })); }
  return JSON.stringify({ form: true, ready: true });
})()`);
await evaluate(`document.querySelector('form button[type="submit"], form button:not([type])')?.click(); true`);
await sleep(2500);
results.adminGradeCreated = { url: await evaluate(`location.pathname + location.search`), slug };
await shot('admin', 'grade-created');

// 4) subscription picker + checkout error
await setCookie('fahimni_session', sessions.student);
await send('Page.navigate', { url: `${BASE}/app/subscription` });
await sleep(2800);
results.picker = await evaluate(`(async () => {
  const tiles = Array.from(document.querySelectorAll('.sub-choice__tile'));
  if (tiles.length < 2) return JSON.stringify({ tiles: tiles.length });
  tiles[1].click();
  await new Promise((r) => setTimeout(r, 200));
  const cardsAfterAll = document.querySelectorAll('.sub-card').length;
  tiles[0].click();
  await new Promise((r) => setTimeout(r, 200));
  const cta = document.querySelector('.sub-card .fn-btn');
  cta?.click();
  await new Promise((r) => setTimeout(r, 1200));
  return JSON.stringify({ tiles: tiles.length, cardsAfterAll, ctaText: cta?.textContent.trim() ?? null, error: document.querySelector('.fn-alert--error')?.textContent?.slice(0, 80) ?? null, stayed: location.pathname });
})()`);

// 5) classroom compact re-verification (fixture lesson, no AI cost)
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
await sleep(2600);
await evaluate(`(() => { const ta=document.querySelector('textarea[aria-label="سؤالك للمعلم"]'); const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'اشرح لي المعادلة'); ta.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('button[aria-label="أرسل السؤال"]')?.click(); return true; })()`);
await sleep(3000);
const LABELS = ['جلسة جديدة','رحلة الحل','تكبير الكتابة','تصغير الكتابة','ملء الشاشة','الخطوة السابقة','الخطوة التالية','أعد الخطوة','أوقف الشرح','أعد الشرح من البداية','مسح السبورة','سرعة الشرح','تسجيل سؤال صوتي','تصوير المسألة','رفع صورة','أرسل السؤال'];
results.classroom = await evaluate(`(() => {
  const labels = ${JSON.stringify(LABELS)};
  const nodes = Array.from(document.querySelectorAll('button,select'));
  const found = labels.filter((l) => nodes.some((n) => ((n.getAttribute('aria-label') ?? '') + (n.getAttribute('title') ?? '') + (n.textContent ?? '')).includes(l)));
  const form = document.querySelector('.question-form')?.getBoundingClientRect();
  const play = document.querySelector('.playback')?.getBoundingClientRect();
  return JSON.stringify({ controls: found.length + (document.querySelector('textarea') ? 1 : 0) + '/17', missing: labels.filter((l) => !found.includes(l)), lesson: !!document.querySelector('.board-object'), step: document.querySelector('.step-time')?.textContent, formInView: form ? form.bottom <= innerHeight + 1 : null, playInView: play ? play.bottom <= innerHeight + 1 : null });
})()`);
await evaluate(`document.querySelector('.step-next')?.click(); true`);
await sleep(800);
results.classroomStepNext = await evaluate(`document.querySelector('.step-time')?.textContent`);
await evaluate(`document.querySelector('.more-button, .tools-button')?.click(); true`);
await sleep(500);
results.classroomSheet = await evaluate(`!!document.querySelector('.tools-sheet-panel')`);
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); true`);
await sleep(300);

// fullscreen real gesture
await realClick('.course-bar [aria-label="ملء الشاشة"]');
await sleep(1000);
results.fullscreen = await evaluate(`JSON.stringify({ fs: !!document.fullscreenElement, form: !!document.querySelector('textarea'), playback: !!document.querySelector('.playback') })`);
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(800);
results.fullscreenExit = await evaluate(`JSON.stringify({ fs: !!document.fullscreenElement, step: document.querySelector('.step-time')?.textContent, lesson: !!document.querySelector('.board-object') })`);

// 6) session persistence + logout (expired trial session)
await setCookie('fahimni_session', sessions.student);
await send('Page.navigate', { url: `${BASE}/app` });
await sleep(2200);
await send('Page.reload');
await sleep(2200);
results.persistence = await evaluate(`location.pathname`);

await setCookie('fahimni_session', sessions.trialExpired);
await send('Page.navigate', { url: `${BASE}/app` });
await sleep(2200);
await evaluate(`Array.from(document.querySelectorAll('form')).find((f) => f.action.includes('logout'))?.querySelector('button')?.click(); true`);
await sleep(2500);
results.logout = { url: await evaluate(`location.pathname + location.search`) };
await send('Page.navigate', { url: `${BASE}/app` });
await sleep(1800);
results.afterLogoutApp = await evaluate(`location.pathname`);

// 7) anonymous landing grade card → login
await send('Network.clearBrowserCookies');
await send('Page.navigate', { url: `${BASE}/` });
await sleep(2200);
await evaluate(`document.querySelector('.grade-card')?.click(); true`);
await sleep(2200);
results.anonymousGrade = await evaluate(`location.pathname + location.search`);

writeFile('qa/audit-flows.json', JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
ws.close();
