import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const OUT = 'qa/screenshots/phase3-learning';
mkdirSync(OUT, { recursive: true });

// Review page over HTTP (server-rendered, real session)
const review = await fetch(`${BASE}/app/review`, { headers: { cookie: `fahimni_session=${sessions.student}` }, redirect: 'manual' });
const reviewHtml = await review.text();
console.log('review', JSON.stringify({ status: review.status, hasTitle: reviewHtml.includes('راجع نقاط ضعفي'), hasTopic: reviewHtml.includes('تحليل'), hasState: reviewHtml.includes('يحتاج تدريبًا') || reviewHtml.includes('في تطوّر') }));

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const consoleIssues = [];
ws.onmessage = (event) => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleIssues.push(String(m.params.args[0]?.value ?? '').slice(0, 120)); };
const send = (method, params = {}) => new Promise((r) => { const c = ++id; pending.set(c, r); ws.send(JSON.stringify({ id: c, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r.result.exceptionDetails ? 'ERR' : r.result.result.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(expression, timeoutMs = 20000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const v = await evaluate(expression); if (v) return v; await sleep(400); } return null; }
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); }

await send('Page.enable'); await send('Runtime.enable');
await send('Network.clearBrowserCookies');
await send('Network.setCookie', { name: 'fahimni_session', value: sessions.student, domain: 'localhost', path: '/' });
if (sessions.deviceToken) await send('Network.setCookie', { name: 'fahimni_device', value: sessions.deviceToken, domain: 'localhost', path: '/' });

const out = {};
// Desktop classroom: mode selector
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
await waitFor('!!document.querySelector(".mode-selector")');
await sleep(500);
out.modes = JSON.parse(await evaluate(`JSON.stringify({
  buttons: [...document.querySelectorAll('.mode-selector button')].map((b) => b.textContent.trim()),
  active: document.querySelector('.mode-selector button.is-active')?.textContent.trim() ?? null,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})`));
await evaluate(`[...document.querySelectorAll('.mode-selector button')].find((b) => b.textContent.includes('اختبرني'))?.click(); true`);
await sleep(300);
out.modeSwitch = await evaluate(`document.querySelector('.mode-selector button.is-active')?.textContent.trim() ?? null`);
await shot('desktop-mode-selector');

// Review page in the browser
await send('Page.navigate', { url: `${BASE}/app/review` });
await waitFor(`document.body.innerText.includes('راجع نقاط ضعفي')`);
await sleep(600);
out.reviewPage = JSON.parse(await evaluate(`JSON.stringify({
  cards: document.querySelectorAll('.fn-card').length,
  topics: [...document.querySelectorAll('.fn-card .fn-card__title')].map((el) => el.textContent.trim()).slice(0, 3),
  practiceLinks: document.querySelectorAll('a[href*="mode=quiz"]').length,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})`));
await shot('desktop-review');

// Deep link prefills the quiz
await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor?mode=quiz&topic=${encodeURIComponent('تحليل كثيرات الحدود')}` });
await waitFor('!!document.querySelector(".mode-selector")');
await sleep(600);
out.deepLink = JSON.parse(await evaluate(`JSON.stringify({
  active: document.querySelector('.mode-selector button.is-active')?.textContent.trim() ?? null,
  composer: document.querySelector('[aria-label="سؤالك للمعلم"]')?.value ?? null,
})`));
await shot('desktop-deeplink');

// Mobile
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: `${BASE}/app/subjects/tawjihi-math/tutor` });
await waitFor('!!document.querySelector(".mode-selector")');
await sleep(500);
out.mobile = JSON.parse(await evaluate(`JSON.stringify({
  buttons: document.querySelectorAll('.mode-selector button').length,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})`));
await shot('mobile-mode-selector');
await send('Page.navigate', { url: `${BASE}/app/review` });
await waitFor(`document.body.innerText.includes('راجع نقاط ضعفي')`);
await sleep(500);
out.mobileReview = JSON.parse(await evaluate(`JSON.stringify({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1 })`));
await shot('mobile-review');

out.consoleIssues = [...new Set(consoleIssues)].slice(0, 5);
writeFileSync(`${OUT}/results.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
ws.close();
