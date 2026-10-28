import { readFileSync } from 'node:fs';
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const out = {};

// (a) admin session direct API + page check
const adminPage = await fetch(`${BASE}/admin/grades/new`, { headers: { cookie: `fahimni_session=${sessions.admin}` }, redirect: 'manual' });
out.adminPage = { status: adminPage.status, location: adminPage.headers.get('location') ?? '' };
const adminApi = await fetch(`${BASE}/api/admin/settings`, {
  method: 'POST',
  headers: { origin: BASE, cookie: `fahimni_session=${sessions.admin}` },
  body: (() => { const f = new FormData(); f.set('maxDevices', '2'); return f; })(),
  redirect: 'manual',
});
out.adminApi = { status: adminApi.status, location: adminApi.headers.get('location') ?? '' };

// (b) checkout error text for a real active subject offer
const checkout = await fetch(`${BASE}/api/checkout`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE, cookie: `fahimni_session=${sessions.student}` },
  body: JSON.stringify({ offerId: '808afe66-b823-48e1-921d-76e35ea2ab91' }),
  redirect: 'manual',
});
out.checkout = { status: checkout.status, body: (await checkout.text()).slice(0, 120) };

console.log(JSON.stringify(out, null, 1));

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const cur = ++id; pending.set(cur, res); ws.send(JSON.stringify({ id: cur, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 200)); return r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');

// (a2) admin page as a real browser navigation
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.admin, domain: 'localhost', path: '/' });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/admin/grades/new` });
await sleep(2500);
console.log('ADMIN PAGE', await evaluate(`JSON.stringify({ path: location.pathname, hasForm: !!document.querySelector('form'), fields: Array.from(document.querySelectorAll('form input')).map((i) => i.name) })`));

// (b2) subscription checkout click with a longer wait for the inline error
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.student, domain: 'localhost', path: '/' });
await send('Page.navigate', { url: `${BASE}/app/subscription` });
await sleep(2800);
console.log('CTA PRESENT', await evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.sub-card .fn-btn')).map((b) => b.textContent.trim()))`));
await evaluate(`document.querySelector('.sub-card .fn-btn')?.click(); true`);
await sleep(2500);
console.log('CHECKOUT UI', await evaluate(`JSON.stringify({ error: document.querySelector('.fn-alert--error')?.textContent?.slice(0, 100) ?? null, buttons: Array.from(document.querySelectorAll('.sub-card .fn-btn')).map((b) => b.textContent.trim()) })`));

// (c) fullscreen Escape with native key params (proven pattern)
await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
await sleep(2600);
await evaluate(`(() => { const b=document.querySelector('.course-bar [aria-label="ملء الشاشة"]'); b?.click(); return true; })()`);
await sleep(1200);
console.log('FS BEFORE', await evaluate(`!!document.fullscreenElement`));
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(1000);
console.log('FS AFTER ESC', await evaluate(`!!document.fullscreenElement`));
ws.close();
