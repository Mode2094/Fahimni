import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const FAKE_FREEMIUS_KEY = 'sk_fake_phase3_value_123';
mkdirSync('qa/screenshots/phase3-settings', { recursive: true });

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
  if (result.result.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 300));
  return result.result.result.value;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(expression, timeoutMs = 15000, interval = 300) {
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
async function navigate(path, ready = 'document.readyState === "complete"') {
  await send('Page.navigate', { url: `${BASE}${path}` });
  await waitFor(ready, 20000);
  await sleep(500);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`qa/screenshots/phase3-settings/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
const setInput = (selector, value) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const clickText = (selector, text) =>
  evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
const clickSelector = (selector) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'missing'; el.click(); return 'clicked'; })()`);

const out = {};
await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');
await setViewport(1440, 900);
await setSession(sessions.admin);

// ---------- settings page structure ----------
await navigate('/admin/settings', '!!document.querySelector("#general")');
out.structure = JSON.parse(await evaluate(`JSON.stringify({
  sections: ['general', 'whatsapp', 'ai', 'trial', 'devices', 'freemius'].filter((anchor) => !!document.getElementById(anchor)),
  encryptionAlert: document.body.innerText.includes('SETTINGS_ENCRYPTION_KEY'),
  aiBadge: document.body.innerText.includes('المزود مهيأ'),
  freemiusComplete: document.body.innerText.includes('الربط مكتمل'),
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})`));
await shot('desktop-settings');

// ---------- whatsapp live update ----------
await setInput('#whatsappNumber', '+962 79 000 0001');
await clickSelector('#whatsapp form button[name="intent"][value="whatsapp-save"]');
await waitFor('location.search.includes("status=whatsapp_saved")');
await sleep(700);
out.whatsappSaved = JSON.parse(await evaluate(`JSON.stringify({ alert: document.querySelector('.fn-alert--success')?.textContent.trim() ?? null, badge: document.body.innerText.includes('مفعّل'), preview: !!document.querySelector('a[href*="wa.me/962790000001"]') })`));
await navigate('/');
out.landingWithWhatsApp = JSON.parse(await evaluate(`JSON.stringify({ hasLink: !!document.querySelector('a[href*="wa.me/962790000001"]'), note: document.body.innerText.includes('قيد التجهيز') })`));
await shot('landing-whatsapp');

// disable and confirm the landing page updates immediately
await setSession(sessions.admin);
await navigate('/admin/settings#whatsapp', '!!document.querySelector("#whatsapp")');
await waitFor('!!document.querySelector(\'#whatsapp button[value="whatsapp-disable"]\')');
await clickSelector('#whatsapp button[name="intent"][value="whatsapp-disable"]');
await waitFor('location.search.includes("status=whatsapp_disabled")');
await sleep(500);
await navigate('/');
out.landingDisabled = JSON.parse(await evaluate(`JSON.stringify({ hasLink: !!document.querySelector('a[href*="wa.me/"]'), note: document.body.innerText.includes('قيد التجهيز') })`));

// invalid number rejected
await setSession(sessions.admin);
await navigate('/admin/settings#whatsapp', '!!document.querySelector("#whatsapp")');
await setInput('#whatsappNumber', '123');
await clickSelector('#whatsapp form button[name="intent"][value="whatsapp-save"]');
await waitFor('location.search.includes("error=whatsapp_invalid")');
out.whatsappInvalid = await evaluate(`document.querySelector('.fn-alert--error')?.textContent.trim() ?? null`);

// ---------- AI key: invalid key rejected, settings saved without key ----------
await navigate('/admin/settings#ai', '!!document.querySelector("#ai")');
await setInput('#aiApiKey', 'sk-invalid-phase3-key');
await clickSelector('#ai form button[type=submit]');
await waitFor('location.search.includes("error=ai_key")', 25000);
await sleep(500);
out.aiInvalidKey = JSON.parse(await evaluate(`JSON.stringify({ error: new URLSearchParams(location.search).get('error'), alert: document.querySelector('.fn-alert--error')?.textContent.trim() ?? null })`));
await navigate('/admin/settings#ai', '!!document.querySelector("#ai")');
await setInput('#aiTutorModel', 'gpt-4.1-mini');
await setInput('#aiDailyBudget', '1.5');
await clickSelector('#ai form button[type=submit]');
await waitFor('location.search.includes("status=ai_settings_saved")');
await sleep(500);
out.aiSaved = JSON.parse(await evaluate(`JSON.stringify({ alert: document.querySelector('.fn-alert--success')?.textContent.trim() ?? null, envBadge: document.body.innerText.includes('مفتاح من بيئة الخادم') })`));
await shot('desktop-ai');

// ---------- freemius credentials: encrypted save, never displayed ----------
await navigate('/admin/settings#freemius', '!!document.querySelector("#freemius")');
await setInput('#freemiusProductId', '99999999');
await setInput('#freemiusApiKey', FAKE_FREEMIUS_KEY);
await setInput('#freemiusSecretKey', 'sk_fake_secret_456');
await setInput('#freemiusPublicKey', 'pk_fake_public_789');
await clickSelector('#freemius form[action="/api/admin/settings/freemius"] button[type=submit]');
await waitFor('location.search.includes("status=freemius_saved")');
await sleep(700);
out.freemiusSaved = JSON.parse(await evaluate(`JSON.stringify({
  alert: document.querySelector('.fn-alert--success')?.textContent.trim() ?? null,
  dbBadges: [...document.querySelectorAll('#freemius .fn-badge')].map((b) => b.textContent.trim()).filter((t) => t === 'مضبوط').length,
  keyInHtml: document.documentElement.outerHTML.includes(${JSON.stringify(FAKE_FREEMIUS_KEY)}),
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})`));
await shot('desktop-freemius');

// connection test with fake credentials must fail safely (no success)
await clickSelector('#freemius form input[name="intent"][value="test"] ~ button');
await waitFor('location.search.includes("error=freemius_")', 25000);
await sleep(500);
out.freemiusTest = JSON.parse(await evaluate(`JSON.stringify({ error: new URLSearchParams(location.search).get('error'), alert: document.querySelector('.fn-alert--error')?.textContent.trim() ?? null })`));

// ---------- offers show pending status, sync blocked ----------
await navigate('/admin/subscriptions?section=offers', '!!document.querySelector(".fn-offer-card")');
out.offerStatuses = JSON.parse(await evaluate(`JSON.stringify({
  badges: [...document.querySelectorAll('.fn-offer-card .fn-badge')].map((b) => b.textContent.trim()),
  anyReady: document.body.innerText.includes('جاهزة للدفع'),
  syncButtons: [...document.querySelectorAll('.fn-offer-card form[action*="sync"]')].length,
})`));
await shot('desktop-offers-pending');
await clickSelector('.fn-offer-card form[action*="sync"] button');
await waitFor('location.search.includes("error=sync_")', 20000);
await sleep(500);
out.syncAttempt = JSON.parse(await evaluate(`JSON.stringify({ error: new URLSearchParams(location.search).get('error'), alert: document.querySelector('.fn-alert--error')?.textContent.trim() ?? null })`));

// ---------- freemius section statuses ----------
await navigate('/admin/subscriptions?section=freemius', '!!document.querySelector(".fn-card")');
out.freemiusSection = JSON.parse(await evaluate(`JSON.stringify({
  readyCountZero: document.body.innerText.includes('جاهزة للدفع: 0'),
  pendingCount: document.body.innerText.includes('بانتظار الربط: 4'),
  developerNote: document.body.innerText.includes('صلاحيات مطوّر'),
  noSecret: !document.documentElement.outerHTML.includes(${JSON.stringify(FAKE_FREEMIUS_KEY)}),
})`));
await shot('desktop-freemius-section');

// ---------- student page hides unverified offers ----------
await setSession(sessions.student);
await navigate('/app/subscription', '!!document.body');
out.studentPage = JSON.parse(await evaluate(`JSON.stringify({
  emptyState: document.body.innerText.includes('خطط الاشتراك قادمة قريبًا'),
  paidCards: document.querySelectorAll('.sub-card').length,
  currentSection: document.body.innerText.includes('اشتراكك الحالي'),
})`));
await shot('student-no-unverified-offers');

// ---------- responsive ----------
await setSession(sessions.admin);
await setViewport(390, 844, true);
await navigate('/admin/settings', '!!document.querySelector("#general")');
out.mobile = JSON.parse(await evaluate(`JSON.stringify({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, sections: ['general','whatsapp','ai','trial','devices','freemius'].filter((a) => !!document.getElementById(a)).length })`));
await shot('mobile-settings');
await setViewport(768, 1024);
await navigate('/admin/settings#freemius', '!!document.querySelector("#freemius")');
out.tablet = JSON.parse(await evaluate(`JSON.stringify({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1 })`));
await shot('tablet-settings');

// ---------- non-admin ----------
await setSession(sessions.student);
await navigate('/admin/settings', 'document.readyState === "complete"');
await sleep(700);
out.studentAdmin = await evaluate(`location.pathname`);

out.consoleErrors = consoleErrors.slice(0, 6);
console.log(JSON.stringify(out, null, 1));
ws.close();
