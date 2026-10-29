import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
mkdirSync('qa/screenshots/phase1-admin', { recursive: true });

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
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
async function realClick(selector) {
  const box = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const rect = el.getBoundingClientRect(); return JSON.stringify({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }); })()`);
  if (!box) throw new Error(`missing selector: ${selector}`);
  const { x, y } = JSON.parse(box);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`qa/screenshots/phase1-admin/${name}.png`, Buffer.from(result.result.data, 'base64'));
}

await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.admin, domain: 'localhost', path: '/' });

const out = {};

// desktop: sidebar position + collapse toggle aria
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/admin` });
await sleep(3000);
out.desktop = JSON.parse(await evaluate(`(() => {
  const sidebar = document.querySelector('.fn-admin__sidebar');
  const main = document.querySelector('.fn-admin__main');
  const sr = sidebar.getBoundingClientRect();
  const mr = main.getBoundingClientRect();
  const toggle = document.querySelector('.fn-admin__collapse button');
  return JSON.stringify({
    sidebarRect: { x: Math.round(sr.x), width: Math.round(sr.width) },
    mainRect: { x: Math.round(mr.x), width: Math.round(mr.width) },
    sidebarOnRightEdge: Math.abs(sr.x + sr.width - window.innerWidth) < 2,
    toggleLabel: toggle.getAttribute('aria-label'),
    togglePressed: toggle.getAttribute('aria-pressed'),
  });
})()`));

// mobile: drawer side + link navigation with animation settled
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${BASE}/admin` });
await sleep(2500);
await realClick('.fn-admin__menu');
await sleep(700);
out.drawer = JSON.parse(await evaluate(`(() => {
  const drawer = document.querySelector('.fn-admin__drawer');
  const rect = drawer.getBoundingClientRect();
  return JSON.stringify({
    x: Math.round(rect.x), width: Math.round(rect.width), viewport: window.innerWidth,
    anchoredRight: Math.abs(rect.x + rect.width - window.innerWidth) < 2,
    label: drawer.getAttribute('aria-label'),
  });
})()`));
await shot('mobile-drawer-right');
await realClick('.fn-admin__drawer .fn-admin-nav__link[href="/admin/subjects"]');
await sleep(2500);
out.drawerNav = JSON.parse(await evaluate(`JSON.stringify({ path: location.pathname, drawerStillOpen: !!document.querySelector('.fn-admin__drawer'), active: document.querySelector('.fn-admin-nav__link.is-active')?.textContent.trim() })`));
await shot('mobile-after-drawer-nav');

console.log(JSON.stringify(out, null, 1));
ws.close();
