import { readFileSync } from 'node:fs';
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const out = {};

const adminPage = await fetch(`${BASE}/admin`, { headers: { cookie: `fahimni_session=${sessions.admin}` }, redirect: 'manual' });
out.adminPageWithCurrentToken = { status: adminPage.status, location: adminPage.headers.get('location') ?? '' };

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const cur = ++id; pending.set(cur, res); ws.send(JSON.stringify({ id: cur, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 200)); return r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function realClick(selector) {
  const box = JSON.parse(await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return 'null'; const b=el.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2}); })()`));
  if (!box) throw new Error(`missing ${selector}`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

// admin works with a fresh token?
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.admin, domain: 'localhost', path: '/' });
await send('Page.navigate', { url: `${BASE}/admin` });
await sleep(2500);
out.adminBrowser = await evaluate(`JSON.stringify({ path: location.pathname, adminNav: document.body.innerText.includes('لوحة الإدارة') })`);

// subscription overlap dialog then confirm -> checkout error
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.student, domain: 'localhost', path: '/' });
await send('Page.navigate', { url: `${BASE}/app/subscription` });
await sleep(2800);
await evaluate(`document.querySelector('.sub-card .fn-btn')?.click(); true`);
await sleep(600);
out.overlapDialog = await evaluate(`JSON.stringify({ dialog: !!document.querySelector('.sub-confirm'), text: document.querySelector('.sub-confirm__panel')?.textContent.replace(/\\s+/g,' ').slice(0, 140) ?? null })`);
await evaluate(`document.querySelector('.sub-confirm .fn-btn')?.click(); true`);
await sleep(2500);
out.afterConfirm = await evaluate(`JSON.stringify({ error: document.querySelector('.fn-alert--error, .sub-confirm .fn-alert--error')?.textContent?.slice(0, 100) ?? null, stillDialog: !!document.querySelector('.sub-confirm') })`);

// fullscreen real gesture + real Escape
await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
await sleep(2600);
await realClick('.course-bar [aria-label="ملء الشاشة"]');
await sleep(1200);
out.fsBefore = await evaluate(`JSON.stringify({ fs: !!document.fullscreenElement, immersive: document.querySelector('.classroom')?.classList.contains('is-immersive') })`);
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(1000);
out.fsAfterEsc = await evaluate(`JSON.stringify({ fs: !!document.fullscreenElement, immersive: document.querySelector('.classroom')?.classList.contains('is-immersive') })`);

// re-check the admin session row after all of this
console.log(JSON.stringify(out, null, 1));
ws.close();
