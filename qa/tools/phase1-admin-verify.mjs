import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const GRADE_ID = 'ac160166-5f14-4234-80b8-a23c647294e7';
const SUBJECT_NAME = 'مادة اختبار المرحلة الأولى';
const SLUG = `phase1-${Date.now()}`;
mkdirSync('qa/screenshots/phase1-admin', { recursive: true });

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
  if (message.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const current = ++id;
    pending.set(current, resolve);
    ws.send(JSON.stringify({ id: current, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 250));
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
async function setViewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
}
async function setSession(token) {
  await send('Network.clearBrowserCookies');
  if (token) await send('Network.setCookie', { name: 'fahimni_session', value: token, domain: 'localhost', path: '/' });
}
async function navigate(path, readyExpression = 'document.readyState === "complete"') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await waitFor(readyExpression, 15000);
  await sleep(500);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`qa/screenshots/phase1-admin/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
async function realClick(selector) {
  const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const rect = el.getBoundingClientRect(); return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }); })()`);
  if (!box) throw new Error(`missing selector: ${selector}`);
  const { x, y } = JSON.parse(box);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function pressEscape() {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}
async function setFile(selector, filePath) {
  const doc = await send('DOM.getDocument', { depth: 1 });
  const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  if (!node.result.nodeId) throw new Error(`file input missing: ${selector}`);
  await send('DOM.setFileInputFiles', { files: [filePath], nodeId: node.result.nodeId });
}

const out = {};
await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');

// ---------- desktop 1440x900 ----------
await setViewport(1440, 900);
await setSession(sessions.admin);
await navigate('/admin', '!!document.querySelector(".fn-admin")');
out.desktopSidebar = JSON.parse(await evaluate(`(() => {
  const sidebar = document.querySelector('.fn-admin__sidebar');
  const main = document.querySelector('.fn-admin__main');
  const sr = sidebar.getBoundingClientRect();
  const mr = main.getBoundingClientRect();
  return JSON.stringify({
    links: Array.from(document.querySelectorAll('.fn-admin-nav__link')).map((a) => a.textContent.trim()),
    active: document.querySelector('.fn-admin-nav__link.is-active')?.textContent.trim() ?? null,
    sidebarRightOfMain: sr.x > mr.x,
    sidebarWidth: Math.round(sr.width),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  });
})()`));
await shot('desktop-dashboard');

await realClick('.fn-admin__collapse button');
await sleep(600);
out.collapsed = JSON.parse(await evaluate(`JSON.stringify({ collapsed: document.querySelector('.fn-admin').classList.contains('is-collapsed'), width: Math.round(document.querySelector('.fn-admin__sidebar').getBoundingClientRect().width), labelHidden: getComputedStyle(document.querySelector('.fn-admin-nav__label')).display === 'none' })`));
await shot('desktop-collapsed');
await realClick('.fn-admin__collapse button');
await sleep(600);
out.expandedAgain = JSON.parse(await evaluate(`JSON.stringify({ width: Math.round(document.querySelector('.fn-admin__sidebar').getBoundingClientRect().width) })`));

// nav via sidebar link
await realClick('.fn-admin-nav__link[href="/admin/subjects"]');
await waitFor('location.pathname === "/admin/subjects"');
await sleep(800);
out.subjectsPage = JSON.parse(await evaluate(`JSON.stringify({ path: location.pathname, active: document.querySelector('.fn-admin-nav__link.is-active')?.textContent.trim(), thumbs: document.querySelectorAll('.fn-admin-thumb').length, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 })`));
await shot('desktop-subjects');

// ---------- create subject with image upload ----------
await navigate('/admin/subjects/new', '!!document.querySelector("input[name=slug]")');
await evaluate(`(() => {
  const set = (selector, value) => { const el = document.querySelector(selector); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('input[name=name]', ${JSON.stringify(SUBJECT_NAME)});
  set('input[name=slug]', ${JSON.stringify(SLUG)});
  const select = document.querySelector('select[name=gradeId]');
  select.value = ${JSON.stringify(GRADE_ID)};
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await setFile('input[type=file]', '/tmp/phase1-image-a.png');
const uploadedA = await waitFor(`(() => { const v = document.querySelector('input[name=image]')?.value ?? ''; return v.startsWith('/api/media/') ? v : null; })()`, 15000);
out.uploadA = uploadedA;
await shot('desktop-subject-new-upload');
await evaluate(`document.querySelector('input[name=slug]').closest('form').querySelector('button[type=submit]').click(); true`);
await waitFor('location.pathname === "/admin/subjects"', 15000);
await sleep(800);
out.created = JSON.parse(await evaluate(`(() => {
  const row = Array.from(document.querySelectorAll('tbody tr')).find((tr) => tr.textContent.includes(${JSON.stringify(SUBJECT_NAME)}));
  const editHref = row?.querySelector('a[href^="/admin/subjects/"]')?.getAttribute('href') ?? null;
  const thumb = row?.querySelector('.fn-admin-thumb img')?.getAttribute('src') ?? null;
  return JSON.stringify({ found: !!row, editHref, thumb, status: location.search });
})()`));
await shot('desktop-subject-created');
const subjectId = out.created.editHref?.split('/').pop();

// student page shows uploaded image
await setSession(sessions.student);
await navigate(`/app/subjects/${SLUG}`, '!!document.body');
out.studentImage = JSON.parse(await evaluate(`(() => {
  const img = document.querySelector('img[alt=${JSON.stringify(SUBJECT_NAME)}]');
  return JSON.stringify({ hasImg: !!img, src: img?.getAttribute('src') ?? null, loaded: img ? img.naturalWidth > 0 : false });
})()`));
await shot('student-subject-image');

// replace image via admin edit
await setSession(sessions.admin);
await navigate(`/admin/subjects/${subjectId}`, '!!document.querySelector("input[name=slug]")');
out.editPreviewBefore = await evaluate(`document.querySelector('.fn-image-field__preview img')?.getAttribute('src') ?? null`);
await setFile('input[type=file]', '/tmp/phase1-image-b.jpg');
const uploadedB = await waitFor(`(() => { const v = document.querySelector('input[name=image]')?.value ?? ''; return v.startsWith('/api/media/') && v !== ${JSON.stringify(uploadedA)} ? v : null; })()`, 15000);
out.uploadB = uploadedB;
await shot('desktop-subject-edit-replaced');
await evaluate(`document.querySelector('input[name=slug]').closest('form').querySelector('button[type=submit]').click(); true`);
await waitFor('location.search.includes("status=updated")', 15000);
await sleep(600);
await navigate(`/admin/subjects/${subjectId}`, '!!document.querySelector("input[name=slug]")');
out.editPreviewAfterReload = await evaluate(`document.querySelector('.fn-image-field__preview img')?.getAttribute('src') ?? null`);

// remove image
await realClick('.fn-image-field__actions button:nth-child(2)');
await sleep(300);
out.removedValue = await evaluate(`document.querySelector('input[name=image]').value`);
await evaluate(`document.querySelector('input[name=slug]').closest('form').querySelector('button[type=submit]').click(); true`);
await waitFor('location.search.includes("status=updated")', 15000);
await sleep(600);
await navigate(`/admin/subjects/${subjectId}`, '!!document.querySelector("input[name=slug]")');
out.afterRemove = JSON.parse(await evaluate(`JSON.stringify({ hidden: document.querySelector('input[name=image]').value, previewImg: !!document.querySelector('.fn-image-field__preview img') })`));

// ---------- settings ----------
await navigate('/admin/settings', '!!document.querySelector("input[name=maxDevices]")');
out.settings = JSON.parse(await evaluate(`(() => {
  const cards = Array.from(document.querySelectorAll('.fn-card')).map((card) => card.querySelector('.fn-card__title')?.textContent.trim());
  const badges = Array.from(document.querySelectorAll('.fn-badge')).map((b) => b.textContent.trim());
  return JSON.stringify({ cards, badges, value: document.querySelector('input[name=maxDevices]').value, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 });
})()`));
await shot('desktop-settings');
await evaluate(`(() => { const el = document.querySelector('input[name=maxDevices]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '4'); el.dispatchEvent(new Event('input', { bubbles: true })); el.closest('form').querySelector('button[type=submit]').click(); return true; })()`);
await waitFor('location.search.includes("status=updated")', 15000);
await sleep(600);
out.settingsSaved = JSON.parse(await evaluate(`JSON.stringify({ alert: document.querySelector('.fn-alert--success')?.textContent.trim() ?? null, value: document.querySelector('input[name=maxDevices]')?.value })`));
await navigate('/admin/settings', '!!document.querySelector("input[name=maxDevices]")');
out.settingsReloaded = await evaluate(`document.querySelector('input[name=maxDevices]').value`);
await evaluate(`(() => { const el = document.querySelector('input[name=maxDevices]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, '2'); el.dispatchEvent(new Event('input', { bubbles: true })); el.closest('form').querySelector('button[type=submit]').click(); return true; })()`);
await waitFor('location.search.includes("status=updated")', 15000);
out.settingsRestored = true;

// existing admin pages
await navigate('/admin/grades', '!!document.querySelector("tbody tr")');
out.grades = JSON.parse(await evaluate(`JSON.stringify({ rows: document.querySelectorAll('tbody tr').length, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 })`));
await navigate('/admin/subscriptions', '!!document.querySelector(".fn-page-header__title")');
out.subscriptions = await evaluate(`document.querySelector('.fn-page-header__title').textContent.trim()`);

// ---------- non-admin ----------
await setSession(sessions.student);
await navigate('/admin', 'document.readyState === "complete"');
await sleep(800);
out.studentAdmin = await evaluate(`location.pathname`);
const studentUpload = await evaluate(`fetch('/api/admin/uploads/image', { method: 'POST', body: new FormData() }).then((r) => r.status)`);
out.studentUploadStatus = studentUpload;
const anonFetch = await fetch(`${BASE}/api/admin/uploads/image`, { method: 'POST', headers: { origin: BASE }, body: new FormData() });
out.anonUploadStatus = anonFetch.status;

// ---------- mobile 390x844 ----------
await setViewport(390, 844, true);
await setSession(sessions.admin);
await navigate('/admin', '!!document.querySelector(".fn-admin")');
out.mobile = JSON.parse(await evaluate(`(() => {
  const sidebar = document.querySelector('.fn-admin__sidebar');
  return JSON.stringify({
    sidebarHidden: getComputedStyle(sidebar).display === 'none',
    menuVisible: getComputedStyle(document.querySelector('.fn-admin__menu')).display !== 'none',
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  });
})()`));
await shot('mobile-dashboard');
await realClick('.fn-admin__menu');
await waitFor('!!document.querySelector(".fn-admin__drawer")');
await sleep(500);
out.drawerOpen = JSON.parse(await evaluate(`(() => {
  const drawer = document.querySelector('.fn-admin__drawer');
  const rect = drawer.getBoundingClientRect();
  return JSON.stringify({
    dialog: drawer.getAttribute('role'),
    modal: drawer.getAttribute('aria-modal'),
    anchoredRight: Math.abs(rect.x + rect.width - window.innerWidth) < 2,
    focusInside: drawer.contains(document.activeElement),
    focusLabel: document.activeElement?.textContent?.trim() ?? null,
    links: drawer.querySelectorAll('.fn-admin-nav__link').length,
  });
})()`));
await shot('mobile-drawer');
await pressEscape();
await sleep(500);
out.drawerClosedByEscape = JSON.parse(await evaluate(`JSON.stringify({ drawer: !!document.querySelector('.fn-admin__drawer'), focusBack: document.activeElement?.getAttribute('aria-label') })`));
await realClick('.fn-admin__menu');
await waitFor('!!document.querySelector(".fn-admin__drawer")');
await realClick('.fn-admin__scrim');
await sleep(400);
out.drawerClosedByScrim = await evaluate(`!document.querySelector('.fn-admin__drawer')`);
await realClick('.fn-admin__menu');
await waitFor('!!document.querySelector(".fn-admin__drawer")');
await sleep(600);
await realClick('.fn-admin__drawer .fn-admin-nav__link[href="/admin/subjects"]');
await waitFor('location.pathname === "/admin/subjects"', 12000);
await sleep(600);
out.drawerNav = JSON.parse(await evaluate(`JSON.stringify({ path: location.pathname, drawer: !!document.querySelector('.fn-admin__drawer'), overflow: document.documentElement.scrollWidth > window.innerWidth + 1 })`));
await shot('mobile-subjects');
await navigate('/admin/settings', '!!document.querySelector("input[name=maxDevices]")');
out.mobileSettings = JSON.parse(await evaluate(`JSON.stringify({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, cards: document.querySelectorAll('.fn-card').length })`));
await shot('mobile-settings');
await navigate('/admin/subjects/new', '!!document.querySelector(".fn-image-field")');
out.mobileImageField = JSON.parse(await evaluate(`JSON.stringify({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, preview: !!document.querySelector('.fn-image-field__preview') })`));
await shot('mobile-subject-new');

out.subjectId = subjectId;
out.slug = SLUG;
out.uploadedUrls = [uploadedA, uploadedB].filter(Boolean);
out.consoleErrors = consoleErrors.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
ws.close();
