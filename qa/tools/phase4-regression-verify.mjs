import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const BOOK_ID = '11111111-1111-4111-8111-111111111111';
mkdirSync('qa/screenshots/phase4-regression', { recursive: true });

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
  if (result.result.exceptionDetails) return { __error: JSON.stringify(result.result.exceptionDetails).slice(0, 200) };
  return result.result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function setSession(token) {
  await send('Network.clearBrowserCookies');
  if (token) await send('Network.setCookie', { name: 'fahimni_session', value: token, domain: 'localhost', path: '/' });
}
async function navigate(path, ready = 'document.readyState === "complete"') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const done = await evaluate(`(${ready}) ? true : false`);
    if (done === true) break;
    await sleep(300);
  }
  await sleep(400);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`qa/screenshots/phase4-regression/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
const overflowCheck = `document.documentElement.scrollWidth > window.innerWidth + 1`;
const clickText = (selector, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);

const out = { viewports: {}, authz: {}, admin: {}, spa: {}, sw: {}, consoleErrors: [] };
await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');

// ---------- book page authorization (the Phase 4 security fix) ----------
await setSession(null);
const anon = await fetch(`${BASE}/api/books/${BOOK_ID}/pages/1`, { redirect: 'manual' });
out.authz.anonymous = anon.status;
await setSession(sessions.student);
const entitled = await fetch(`${BASE}/api/books/${BOOK_ID}/pages/1`, { headers: { cookie: `fahimni_session=${sessions.student}` } });
out.authz.entitledStudent = entitled.status;
const expired = await fetch(`${BASE}/api/books/${BOOK_ID}/pages/1`, { headers: { cookie: `fahimni_session=${sessions.trialExpired}` } });
out.authz.expiredTrialStudent = expired.status;
const adminPage = await fetch(`${BASE}/api/books/${BOOK_ID}/pages/1`, { headers: { cookie: `fahimni_session=${sessions.admin}` } });
out.authz.admin = adminPage.status;
const traversal = await fetch(`${BASE}/api/books/${BOOK_ID}/pages/..%2f..%2fetc%2fpasswd`, { headers: { cookie: `fahimni_session=${sessions.student}` } });
out.authz.traversal = traversal.status;

// ---------- viewport sweep ----------
const viewports = [
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '768x1024', width: 768, height: 1024, mobile: false },
  { name: '1280x720', width: 1280, height: 720, mobile: false },
  { name: '1440x900', width: 1440, height: 900, mobile: false },
];
for (const viewport of viewports) {
  await send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
  const record = {};
  await setSession(sessions.student);
  await navigate('/', '!!document.querySelector("main, .fn-page")');
  record.landing = JSON.parse(await evaluate(`JSON.stringify({ overflow: ${overflowCheck}, rtl: document.documentElement.dir === 'rtl', h1: document.querySelector('h1')?.textContent?.trim()?.slice(0, 40) ?? null })`));
  await navigate('/app', '!!document.body');
  record.dashboard = JSON.parse(await evaluate(`JSON.stringify({ overflow: ${overflowCheck}, markers: document.body.innerText.includes('متابعة') || document.body.innerText.includes('الرئيسية') })`));
  await navigate('/app/subjects', '!!document.body');
  record.catalog = JSON.parse(await evaluate(`JSON.stringify({ overflow: ${overflowCheck}, cards: document.querySelectorAll('.subject-card').length })`));
  await navigate('/app/account', '!!document.body');
  record.account = JSON.parse(await evaluate(`JSON.stringify({ overflow: ${overflowCheck}, devices: document.body.innerText.includes('الأجهزة') })`));
  await navigate('/app/subscription', '!!document.body');
  record.subscription = JSON.parse(await evaluate(`JSON.stringify({ overflow: ${overflowCheck}, current: document.body.innerText.includes('اشتراكك الحالي') })`));
  await navigate('/app/subjects/tawjihi-math/tutor', '!!document.querySelector(".classroom")');
  record.tutor = JSON.parse(await evaluate(`JSON.stringify({ overflow: ${overflowCheck}, controls: document.querySelectorAll('.classroom button, .classroom [role=button]').length, composer: !!document.querySelector('.classroom') })`));
  await setSession(sessions.admin);
  await navigate('/admin', '!!document.querySelector(".fn-admin")');
  record.adminDashboard = JSON.parse(await evaluate(`JSON.stringify({
    overflow: ${overflowCheck},
    sidebarVisible: getComputedStyle(document.querySelector('.fn-admin__sidebar')).display !== 'none',
    menuVisible: getComputedStyle(document.querySelector('.fn-admin__menu')).display !== 'none',
  })`));
  await navigate('/admin/subscriptions', '!!document.querySelector(".fn-admin-tabs")');
  record.adminSubscriptions = JSON.parse(await evaluate(`JSON.stringify({ overflow: ${overflowCheck}, tabs: document.querySelectorAll('.fn-admin-tabs__item').length, activeSections: ['terms'].filter((a) => !!document.getElementById(a)).length })`));
  await navigate('/admin/settings', '!!document.querySelector("#general")');
  record.adminSettings = JSON.parse(await evaluate(`JSON.stringify({ overflow: ${overflowCheck}, sections: ['general','whatsapp','ai','trial','devices','freemius'].filter((a) => !!document.getElementById(a)).length })`));
  out.viewports[viewport.name] = record;
  if (viewport.name === '1440x900') {
    await navigate('/admin/subjects', '!!document.querySelector(".fn-admin")');
    await shot('desktop-admin-subjects');
    await navigate('/app', '!!document.body');
    await shot('desktop-dashboard');
  }
  if (viewport.name === '390x844') {
    await navigate('/app', '!!document.body');
    await shot('mobile-dashboard');
    await setSession(sessions.admin);
    await navigate('/admin/subscriptions', '!!document.querySelector(".fn-admin-tabs")');
    await shot('mobile-admin-subscriptions');
  }
}

// ---------- SPA navigation / stale CSS check (desktop) ----------
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await setSession(sessions.admin);
await navigate('/admin', '!!document.querySelector(".fn-admin")');
const stylesheetCount = await evaluate(`document.styleSheets.length`);
await clickText('.fn-admin-nav__link', 'المواد');
await sleep(1500);
out.spa = JSON.parse(await evaluate(`JSON.stringify({
  path: location.pathname,
  stylesheets: document.styleSheets.length,
  sidebarStyled: getComputedStyle(document.querySelector('.fn-admin__sidebar')).width,
  activeNav: document.querySelector('.fn-admin-nav__link.is-active')?.textContent.trim() ?? null,
  overflow: ${overflowCheck},
})`));
out.spa.stylesheetsBefore = stylesheetCount;

// mobile admin drawer still works after SPA navigation
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await evaluate(`document.querySelector('.fn-admin__menu')?.click()`);
await sleep(600);
out.spa.mobileDrawer = JSON.parse(await evaluate(`JSON.stringify({ drawer: !!document.querySelector('.fn-admin__drawer'), links: document.querySelectorAll('.fn-admin__drawer .fn-admin-nav__link').length })`));
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(400);
out.spa.drawerClosed = await evaluate(`!document.querySelector('.fn-admin__drawer')`);

// ---------- service worker state in dev ----------
out.sw = JSON.parse(await evaluate(`(async () => {
  const registrations = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
  return JSON.stringify({ controller: !!navigator.serviceWorker.controller, registrations: registrations.length });
})()`));

out.consoleErrors = consoleErrors.slice(0, 8);
console.log(JSON.stringify(out, null, 1));
ws.close();
