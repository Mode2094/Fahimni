import { readFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const ROUTES = [
  ['/onboarding', 'noProfile'],
  ['/app/subjects/tawjihi-math/tutor', 'student'],
  ['/legacy', null],
  ['/admin/grades/new', 'admin'],
  ['/admin/subjects/new', 'admin'],
  ['/admin/subjects/b0285393-fc49-4573-833f-07b87b1cb628', 'admin'],
  ['/admin/subscriptions', 'admin'],
  ['/admin/settings', 'admin'],
  ['/app/account', 'student'],
  ['/app/subscription', 'student'],
];

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const cur = ++id; pending.set(cur, res); ws.send(JSON.stringify({ id: cur, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 200)); return r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROBE = `(() => {
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"]');
  const accName = (el) => {
    const byAttr = (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
    if (byAttr) return byAttr;
    if (el.labels && el.labels.length) { const t = Array.from(el.labels).map((l) => l.textContent.trim()).join(' ').trim(); if (t) return t; }
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\\s+/).map((i) => document.getElementById(i)?.textContent || '').join(' ').trim(); if (t) return t; }
    const ph = el.getAttribute('placeholder'); if (ph) return ph;
    const txt = (el.textContent || '').trim(); if (txt) return txt;
    return '';
  };
  const controls = Array.from(document.querySelectorAll('a[href],button,select,textarea,input:not([type=hidden])')).filter(visible);
  const unnamed = controls.filter((el) => !accName(el)).map((el) => el.tagName + (el.id ? '#' + el.id : '') + (el.name ? '[name=' + el.name + ']' : ''));
  const tiny = controls.filter((el) => { const b = el.getBoundingClientRect(); return b.width < 24 || b.height < 24; }).map((el) => el.tagName + ':' + (accName(el) || '').slice(0, 24) + ':' + Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height));
  return JSON.stringify({ controls: controls.length, unnamed: unnamed.length, unnamedSample: unnamed.slice(0, 10), tiny: tiny.slice(0, 8) });
})()`;

for (const [path, session] of ROUTES) {
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Network.clearBrowserCookies');
  const token = session ? sessions[session] : null;
  if (token) await send('Network.setCookie', { name: 'fahimni_session', value: token, domain: 'localhost', path: '/' });
  await send('Page.navigate', { url: `${BASE}${path}` });
  await sleep(2500);
  console.log(path, await evaluate(PROBE));
}
ws.close();
console.log('done');
