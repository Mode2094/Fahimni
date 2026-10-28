import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const GRADE_ID = 'ac160166-5f14-4234-80b8-a23c647294e7';
const FIELD_ID = '3233891a-640d-49b2-bcb3-ca1b108f9c12';
const PLAN_ID = 'qa-phase2-plan';
mkdirSync('qa/screenshots/phase2-subscriptions', { recursive: true });

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
async function waitFor(expression, timeoutMs = 12000, interval = 300) {
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
  await waitFor(ready, 15000);
  await sleep(400);
}
async function shot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`qa/screenshots/phase2-subscriptions/${name}.png`, Buffer.from(result.result.data, 'base64'));
}
const clickText = (selector, text) =>
  evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
const setSelect = (selector, value) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value; })()`);
const setInput = (selector, value) =>
  evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const setter = Object.getOwnPropertyDescriptor(proto, 'value').set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);

const out = {};
await send('Network.enable');
await send('Page.enable');
await send('Runtime.enable');

// ---------- desktop: sections ----------
await setViewport(1440, 900);
await setSession(sessions.admin);
await navigate('/admin/subscriptions', '!!document.querySelector(".fn-admin-tabs")');
out.tabs = JSON.parse(await evaluate(`JSON.stringify({ labels: [...document.querySelectorAll('.fn-admin-tabs__item')].map((a) => a.textContent.trim()), active: document.querySelector('.fn-admin-tabs__item.is-active')?.textContent.trim(), overflow: document.documentElement.scrollWidth > window.innerWidth + 1 })`));
out.termsSection = JSON.parse(await evaluate(`JSON.stringify({ cards: document.querySelectorAll('.fn-term-card').length, addForm: !!document.querySelector('input[name=academicYear]'), termNames: [...document.querySelectorAll('.fn-term-card .fn-card__title')].map((el) => el.textContent.trim()), connectedBadge: [...document.querySelectorAll('.fn-term-card .fn-badge')].map((b) => b.textContent.trim()).filter((t) => t.includes('عرض')) })`));
await shot('desktop-terms');

// offers section
await clickText('.fn-admin-tabs__item', 'الباقات والأسعار');
await waitFor('location.search.includes("section=offers")');
await sleep(800);
out.offersSection = JSON.parse(await evaluate(`JSON.stringify({
  wizardSteps: [...document.querySelectorAll('.fn-wizard__step-label')].map((el) => el.textContent.trim()),
  cards: [...document.querySelectorAll('.fn-offer-card .fn-card__title')].map((el) => el.textContent.trim()),
  readyBadges: [...document.querySelectorAll('.fn-offer-card .fn-badge')].map((b) => b.textContent.trim()).filter((t) => t === 'جاهز للدفع').length,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})`));
await shot('desktop-offers');

// ---------- wizard: publish a single-subject monthly offer ----------
await setSelect('#wizard-grade', GRADE_ID);
await setSelect('#wizard-field', FIELD_ID);
await sleep(400);
out.wizardSubjects = JSON.parse(await evaluate(`JSON.stringify({ options: [...document.querySelectorAll('#wizard-subject option')].map((o) => o.textContent.trim()) })`));
await setSelect('#wizard-subject', await evaluate(`document.querySelector('#wizard-subject option[value=""]').nextElementSibling.value`));
await clickText('.fn-wizard__footer .fn-btn', 'التالي');
await sleep(400);
out.step2 = await evaluate(`document.querySelector('.fn-wizard__step.is-active .fn-wizard__step-label')?.textContent.trim()`);
await clickText('.fn-wizard__footer .fn-btn', 'التالي');
await sleep(400);
await setInput('#wizard-price', '12.5');
await setInput('#wizard-credits', '250');
await setInput('#wizard-plan', PLAN_ID);
await clickText('.fn-wizard__footer .fn-btn', 'التالي');
await sleep(500);
out.review = JSON.parse(await evaluate(`JSON.stringify({
  step: document.querySelector('.fn-wizard__step.is-active .fn-wizard__step-label')?.textContent.trim(),
  summary: [...document.querySelectorAll('.fn-wizard__summary-row')].map((row) => row.textContent.replace(/\\s+/g, ' ').trim()),
  publishDisabled: [...document.querySelectorAll('.fn-wizard__footer .fn-btn')].find((b) => b.textContent.includes('نشر الباقة'))?.disabled,
})`));
await shot('desktop-wizard-review');
await clickText('.fn-wizard__footer .fn-btn', 'نشر الباقة');
await waitFor('location.search.includes("status=offer_saved")', 15000);
await sleep(800);
out.published = JSON.parse(await evaluate(`(() => {
  const card = [...document.querySelectorAll('.fn-offer-card')].find((el) => el.textContent.includes('12.5'));
  return JSON.stringify({ saved: location.search, found: !!card, id: card?.id ?? null, active: card?.textContent.includes('نشط'), ready: card?.textContent.includes('جاهز للدفع') });
})()`));
const publishedId = out.published.id?.replace('offer-', '') ?? null;
await shot('desktop-offer-published');

// ---------- wizard: save a draft (no plan id) ----------
await setSelect('#wizard-grade', GRADE_ID);
await setSelect('#wizard-field', FIELD_ID);
await sleep(300);
await setSelect('#wizard-subject', await evaluate(`document.querySelector('#wizard-subject option[value=""]')?.nextElementSibling?.value ?? ''`));
await clickText('.fn-wizard__footer .fn-btn', 'التالي');
await sleep(300);
await clickText('.fn-wizard__footer .fn-btn', 'التالي');
await sleep(300);
await setInput('#wizard-price', '7');
await setInput('#wizard-plan', '');
await clickText('.fn-wizard__footer .fn-btn', 'التالي');
await sleep(400);
out.draftReview = JSON.parse(await evaluate(`JSON.stringify({ issues: [...document.querySelectorAll('.fn-readiness li')].map((li) => li.textContent.trim()), publishDisabled: [...document.querySelectorAll('.fn-wizard__footer .fn-btn')].find((b) => b.textContent.includes('نشر الباقة'))?.disabled })`));
await clickText('.fn-wizard__footer .fn-btn', 'حفظ كمسودة');
await waitFor('location.search.includes("status=offer_drafted")', 15000);
await sleep(700);
out.drafted = JSON.parse(await evaluate(`(() => {
  const card = [...document.querySelectorAll('.fn-offer-card')].find((el) => el.textContent.includes('يحتاج إعداد'));
  return JSON.stringify({ saved: location.search, draftCards: [...document.querySelectorAll('.fn-offer-card')].filter((el) => el.textContent.includes('يحتاج إعداد')).length, id: card?.id ?? null });
})()`));
const draftId = out.drafted.id?.replace('offer-', '') ?? null;

// ---------- student page hides draft, keeps active ----------
await setSession(sessions.student);
await navigate('/app/subscription', '!!document.body');
out.studentPage = JSON.parse(await evaluate(`JSON.stringify({
  hasDraft: document.body.innerText.includes('مسودة') || document.body.innerText.includes('يحتاج إعداد'),
  offerCards: [...document.querySelectorAll('.sub-card .pricing-card__name')].map((el) => el.textContent.trim()),
  coverageBadges: [...document.querySelectorAll('.sub-card .fn-badge')].map((b) => b.textContent.trim()).filter((t) => t.includes('وصول ساري')),
  hasTrialSection: document.body.innerText.includes('التجربة المجانية'),
  hasCurrentSection: document.body.innerText.includes('اشتراكك الحالي'),
})`));
await shot('student-subscription');

// deactivate the published test offer and confirm it disappears for students
await setSession(sessions.admin);
await navigate('/admin/subscriptions?section=offers', '!!document.querySelector(".fn-offer-card")');
await evaluate(`(() => { const card = document.querySelector('#offer-${publishedId}'); const form = [...card.querySelectorAll('form')].find((f) => f.querySelector('input[name=intent]')); form.querySelector('button').click(); return true; })()`);
await waitFor('location.search.includes("status=offer_deactivated")', 15000);
await sleep(600);
await setSession(sessions.student);
await navigate('/app/subscription', '!!document.body');
out.studentAfterDeactivate = await evaluate(`!document.body.innerText.includes('12.5')`);

// ---------- terms: create valid + invalid ----------
await setSession(sessions.admin);
await navigate('/admin/subscriptions?section=terms', '!!document.querySelector("input[name=academicYear]")');
await setInput('input[name=name]', 'فصل تدقيق المرحلة الثانية');
await setInput('input[name=academicYear]', '2026/2027');
await setSelect('select[name=gradeId]', GRADE_ID);
await setInput('input[name=startDate]', '2027-02-01');
await setInput('input[name=endDate]', '2027-06-01');
await clickText('form[action="/api/admin/subscriptions/terms"] .fn-btn', 'إضافة الفصل');
await waitFor('location.search.includes("status=term_saved")', 15000);
await sleep(700);
out.termCreated = JSON.parse(await evaluate(`JSON.stringify({ saved: location.search, found: document.body.innerText.includes('فصل تدقيق المرحلة الثانية') })`));
const newTermId = await evaluate(`(() => { const card = [...document.querySelectorAll('.fn-term-card')].find((el) => el.textContent.includes('فصل تدقيق المرحلة الثانية')); const toggle = card?.querySelector('form[action*="/terms/"] input[name=intent]')?.closest('form'); const action = toggle?.getAttribute('action') ?? ''; return action.split('/').pop() ?? null; })()`);

// invalid dates refused
await setInput('input[name=name]', 'فصل تواريخ خاطئة');
await setInput('input[name=startDate]', '2027-06-01');
await setInput('input[name=endDate]', '2027-02-01');
await clickText('form[action="/api/admin/subscriptions/terms"] .fn-btn', 'إضافة الفصل');
await waitFor('location.search.includes("error=")', 15000);
await sleep(500);
out.invalidTerm = JSON.parse(await evaluate(`JSON.stringify({ error: location.search, alert: document.querySelector('.fn-alert--error')?.textContent.trim() ?? null, notCreated: !document.body.innerText.includes('فصل تواريخ خاطئة') })`));

// toggle new term off
if (newTermId) {
  await navigate('/admin/subscriptions?section=terms', '!!document.querySelector(".fn-term-card")');
  await evaluate(`(() => { const card = document.querySelector('.fn-term-card form[action="/api/admin/subscriptions/terms/${newTermId}"]'); const form = [...document.querySelectorAll('form')].find((f) => f.getAttribute('action') === '/api/admin/subscriptions/terms/${newTermId}' && f.querySelector('input[name=intent]')); form.querySelector('button').click(); return true; })()`);
  await waitFor('location.search.includes("status=term_deactivated")', 15000);
  await sleep(500);
  out.termToggled = await evaluate(`location.search`);
}

// ---------- subscribers search ----------
await navigate('/admin/subscriptions?section=subscribers', '!!document.querySelector("input[name=q]")');
await setInput('input[name=q]', 'student@fahimni.local');
await clickText('.fn-card .fn-btn', 'بحث');
await waitFor('location.search.includes("q=")', 15000);
await sleep(800);
out.subscribers = JSON.parse(await evaluate(`JSON.stringify({
  search: new URLSearchParams(location.search).get('q'),
  rows: document.querySelectorAll('tbody tr').length,
  hasStudent: document.body.innerText.includes('student@fahimni.local'),
  hasCreditColumn: document.body.innerText.includes('الرصيد'),
  hasReadonlyNote: document.body.innerText.includes('قراءة فقط'),
})`));
await shot('desktop-subscribers');
await setInput('input[name=q]', 'no-such-user-xyz');
await clickText('.fn-card .fn-btn', 'بحث');
await waitFor('location.search.includes("no-such-user-xyz")', 15000);
await sleep(700);
out.subscribersEmpty = await evaluate(`document.body.innerText.includes('لا توجد نتائج مطابقة')`);

// ---------- freemius readiness ----------
await navigate('/admin/subscriptions?section=freemius', '!!document.querySelector(".fn-card")');
await sleep(600);
out.freemius = JSON.parse(await evaluate(`JSON.stringify({
  status: [...document.querySelectorAll('.fn-badge')].map((b) => b.textContent.trim()).slice(0, 6),
  readyTable: document.body.innerText.includes('العروض الجاهزة للدفع'),
  needsConfig: document.body.innerText.includes('عروض تحتاج إعدادًا'),
  legacy: document.body.innerText.includes('خطط قديمة'),
  phase3Notes: document.body.innerText.includes('صلاحيات مطوّر'),
  noSecretValues: !document.body.innerHTML.match(/sk_[A-Za-z0-9]/),
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
})`));
await shot('desktop-freemius');

// ---------- mobile 390 + tablet 768 ----------
await setViewport(390, 844, true);
await navigate('/admin/subscriptions', '!!document.querySelector(".fn-admin-tabs")');
out.mobile = JSON.parse(await evaluate(`JSON.stringify({
  tabsVisible: document.querySelectorAll('.fn-admin-tabs__item').length,
  overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
  termCards: document.querySelectorAll('.fn-term-card').length,
})`));
await shot('mobile-terms');
await navigate('/admin/subscriptions?section=offers', '!!document.querySelector(".fn-wizard")');
out.mobileOffers = JSON.parse(await evaluate(`JSON.stringify({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, wizard: !!document.querySelector('.fn-wizard'), steps: document.querySelectorAll('.fn-wizard__step').length })`));
await shot('mobile-offers');
await setViewport(768, 1024);
await navigate('/admin/subscriptions?section=offers', '!!document.querySelector(".fn-wizard")');
out.tablet = JSON.parse(await evaluate(`JSON.stringify({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, wizardCols: getComputedStyle(document.querySelector('.fn-wizard__steps')).gridTemplateColumns.split(' ').length })`));
await shot('tablet-offers');

// ---------- non-admin ----------
await setSession(sessions.student);
await navigate('/admin/subscriptions', 'document.readyState === "complete"');
await sleep(700);
out.studentAdmin = await evaluate(`location.pathname`);

out.consoleErrors = consoleErrors.slice(0, 5);
out.publishedId = publishedId;
out.draftId = draftId;
out.newTermId = newTermId;
console.log(JSON.stringify(out, null, 1));
ws.close();
