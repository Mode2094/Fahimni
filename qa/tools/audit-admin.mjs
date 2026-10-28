import { readFileSync, writeFileSync } from 'node:fs';
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const out = {};

const post = (path, token, body, type = 'form') => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: type === 'form'
    ? { origin: BASE, cookie: `fahimni_session=${token}` }
    : { origin: BASE, cookie: `fahimni_session=${token}`, 'content-type': 'application/json' },
  body: type === 'form' ? body : JSON.stringify(body),
  redirect: 'manual',
}).then(async (r) => ({ status: r.status, location: r.headers.get('location') ?? '', body: type === 'form' ? '' : (await r.text()).slice(0, 120) }));

const settings = await post('/api/admin/settings', sessions.admin, (() => { const f = new FormData(); f.set('maxDevices', '3'); return f; })());
out.settingsValid = settings;
const settingsBad = await post('/api/admin/settings', sessions.admin, (() => { const f = new FormData(); f.set('maxDevices', 'abc'); return f; })());
out.settingsInvalid = settingsBad;
const settingsStudent = await post('/api/admin/settings', sessions.student, (() => { const f = new FormData(); f.set('maxDevices', '9'); return f; })());
out.settingsAsStudent = settingsStudent;

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const consoleErrors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(String(m.params.args[0]?.value ?? '').slice(0, 150));
};
const send = (method, params = {}) => new Promise((res) => { const cur = ++id; pending.set(cur, res); ws.send(JSON.stringify({ id: cur, method, params })); });
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
});
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`qa/screenshots/admin/${name}.png`, Buffer.from(s.result.data, 'base64')); };
async function realClick(selector) {
  const box = JSON.parse(await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) return 'null'; el.scrollIntoView({block:'center'}); const b=el.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2}); })()`));
  if (!box) throw new Error(`missing ${selector}`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.admin, domain: 'localhost', path: '/' });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

const slug = `audit-grade-${Date.now()}`;
await send('Page.navigate', { url: `${BASE}/admin/grades` });
await sleep(2500);
out.gradesList = await evaluate(`JSON.stringify({ path: location.pathname, rows: document.querySelectorAll('table tbody tr, .fn-table tbody tr').length })`);
await send('Page.navigate', { url: `${BASE}/admin/grades/new` });
await sleep(2500);
out.newGradeForm = await evaluate(`JSON.stringify({ path: location.pathname, fields: Array.from(document.querySelectorAll('input[name=slug]')?.[0]?.closest('form')?.querySelectorAll('input, select') ?? []).map((i) => i.name), submitText: document.querySelector('input[name=slug]')?.closest('form')?.querySelector('button[type=submit]')?.textContent?.trim() ?? null })`);
await evaluate(`(() => { const set = (sel, val) => { const el = document.querySelector(sel); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); }; set('input[name=name]', 'صف تدقيق'); set('input[name=slug]', ${JSON.stringify(slug)}); return true; })()`);
await sleep(300);
await shot('grade-form-filled');
await evaluate(`document.querySelector('input[name=slug]')?.closest('form')?.querySelector('button[type=submit]')?.click(); true`);
await sleep(3000);
out.afterCreate = await evaluate(`JSON.stringify({ path: location.pathname, errors: Array.from(document.querySelectorAll('.fn-alert--error')).map((e) => e.textContent.slice(0, 80)), rowFound: document.body.innerText.includes('صف تدقيق') })`);
await shot('grade-created');
if (out.afterCreate.includes('true')) {
  const del = await evaluate(`JSON.stringify(Array.from(document.querySelectorAll('a,button')).filter((el) => el.textContent.includes('حذف') || el.getAttribute('aria-label')?.includes('حذف')).map((el) => el.tagName + ':' + (el.textContent.trim().slice(0, 30))))`).catch(() => '[]');
  out.deleteControls = del;
}
out.consoleErrors = consoleErrors.slice(0, 3);
console.log(JSON.stringify(out, null, 1));
ws.close();
