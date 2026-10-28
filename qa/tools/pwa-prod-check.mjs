const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const cur = ++id; pending.set(cur, res); ws.send(JSON.stringify({ id: cur, method, params })); });
const evaluate = async (expression, awaitPromise = true) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
const consoleErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(String(m.params.args[0]?.value ?? '').slice(0, 200));
});
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const out = {};
await send('Page.navigate', { url: 'http://localhost:3000/' });
await sleep(4500);
out.sw = await evaluate(`navigator.serviceWorker.getRegistration().then(async (r) => JSON.stringify({ hasReg: !!r, scope: r?.scope ?? null, active: !!r?.active, state: r?.active?.state ?? null }))`);
out.caches = await evaluate(`(async () => { const keys = await caches.keys(); const detail = {}; for (const k of keys) { const c = await caches.open(k); detail[k] = (await c.keys()).length; } return JSON.stringify(detail); })()`);
out.manifest = await evaluate(`document.querySelector('link[rel=manifest]')?.href ?? null`);
out.theme = await evaluate(`document.querySelector('meta[name=theme-color]')?.content ?? null`);
out.devArtifacts = await evaluate(`JSON.stringify({ nextDevScript: !!document.querySelector('script[src*="next/dist/client"]'), hmr: !!window.__NEXT_HMR })`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync('qa/screenshots/prod/sw-registered.png', Buffer.from(shot.result.data, 'base64'));

await send('Page.navigate', { url: 'http://localhost:3000/app/subjects' });
await sleep(3000);
out.secondNav = await evaluate(`JSON.stringify({ path: location.pathname, controlled: !!navigator.serviceWorker.controller, title: document.title })`);
const shot2 = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('qa/screenshots/prod/second-nav.png', Buffer.from(shot2.result.data, 'base64'));

out.consoleErrors = consoleErrors.slice(0, 3);
console.log(JSON.stringify(out, null, 1));
ws.close();
