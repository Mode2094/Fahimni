import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const PHYSICS = 'aaaaaaaa-0101-4000-8000-000000000101';
mkdirSync('qa/screenshots/book-upload-fix', { recursive: true });
writeFileSync('/tmp/not-a-pdf.txt', 'this is not a pdf');

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
    const value = await evaluate(expression);
    if (value) return value;
    await sleep(interval);
  }
  return null;
}
async function navigate(path, ready = 'document.readyState === "complete"') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await waitFor(ready);
  await sleep(400);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`qa/screenshots/book-upload-fix/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
async function setFile(selector, filePath) {
  const doc = await send('DOM.getDocument', { depth: 1 });
  const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  if (!node.result.nodeId) throw new Error(`file input missing: ${selector}`);
  await send('DOM.setFileInputFiles', { files: [filePath], nodeId: node.result.nodeId });
}
const clickText = (selector, text) => evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
const panelState = `JSON.stringify({
  badge: [...document.querySelectorAll('.fn-badge')].map((b) => b.textContent.trim()).find((t) => ['جاهز','تم الرفع','جاري الفهرسة','فشل'].includes(t)) ?? null,
  pages: document.body.innerText.match(/الصفحات المفهرسة[\\s\\S]{0,30}/)?.[0]?.replace(/\\s+/g,' ').slice(0, 50) ?? null,
  error: document.querySelector('.fn-alert--error')?.textContent.trim() ?? null,
  success: document.querySelector('.fn-alert--success')?.textContent.trim() ?? null,
})`;

const out = {};
await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.admin, domain: 'localhost', path: '/' });

// 1) baseline: READY book with 10 pages
await navigate(`/admin/subjects/${PHYSICS}`, '!!document.querySelector(".fn-card")');
out.before = JSON.parse(await evaluate(panelState));
await shot('01-ready-baseline');

// 2) real PDF replacement through the UI
await setFile('#replace-file', '/tmp/real-textbook.pdf');
await clickText('form[action$="/book"] .fn-btn', 'استبدال الكتاب');
await waitFor('location.search.includes("status=book_uploaded")');
await sleep(700);
out.afterUpload = JSON.parse(await evaluate(panelState));
await shot('02-uploaded-pending-index');

// 3) run the indexing worker, then reload and confirm READY
execSync('pnpm worker:index -- --once', { cwd: process.cwd(), stdio: 'pipe' });
await navigate(`/admin/subjects/${PHYSICS}`, '!!document.querySelector(".fn-card")');
out.afterIndex = JSON.parse(await evaluate(panelState));
await shot('03-ready-after-index');

// 4) invalid file is rejected with a clear Arabic error and the book stays intact
await setFile('#replace-file', '/tmp/not-a-pdf.txt');
await clickText('form[action$="/book"] .fn-btn', 'استبدال الكتاب');
await waitFor('location.search.includes("error=invalid_file")');
await sleep(700);
out.invalidUpload = JSON.parse(await evaluate(panelState));
await shot('04-invalid-file-error');

out.consoleErrors = consoleErrors.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
ws.close();
