import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const GRADE_ID = process.env.AUDIT_GRADE_ID;
const SUBJECT_ID = process.env.AUDIT_SUBJECT_ID;

const V10 = [[320, 568], [375, 667], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 720], [1440, 900], [1920, 1080]];
const V2 = [[390, 844], [1280, 720]];
const V3 = [[390, 844], [768, 1024], [1280, 720], [1440, 900]];

const ROUTES = [
  { path: '/', session: null, group: 'public', viewports: V10, name: 'landing' },
  { path: '/login', session: null, group: 'public', viewports: V10, name: 'login' },
  { path: '/onboarding', session: 'noProfile', group: 'student', viewports: V2, name: 'onboarding' },
  { path: '/app', session: 'student', group: 'student', viewports: V10, name: 'dashboard' },
  { path: '/app/subjects', session: 'student', group: 'student', viewports: V10, name: 'catalog' },
  { path: '/app/subjects/tawjihi-math', session: 'student', group: 'student', viewports: V2, name: 'subject-detail' },
  { path: '/app/subjects/tawjihi-math/tutor', session: 'student', group: 'classroom', viewports: V10, name: 'classroom' },
  { path: '/app/subscription', session: 'student', group: 'subscription', viewports: V3, name: 'subscription' },
  { path: '/app/subscription/success', session: 'student', group: 'subscription', viewports: V2, name: 'subscription-success' },
  { path: '/app/subscription/cancel', session: 'student', group: 'subscription', viewports: V2, name: 'subscription-cancel' },
  { path: '/app/account', session: 'student', group: 'account', viewports: V2, name: 'account' },
  { path: '/app/subjects', session: 'bundle', group: 'student', viewports: V2, name: 'catalog-bundle' },
  { path: '/app/subjects', session: 'trialEligible', group: 'student', viewports: V2, name: 'catalog-eligible' },
  { path: '/app', session: 'trialActive', group: 'student', viewports: V2, name: 'dashboard-trial' },
  { path: '/admin', session: 'admin', group: 'admin', viewports: V3, name: 'admin-home' },
  { path: '/admin/grades', session: 'admin', group: 'admin', viewports: V2, name: 'admin-grades' },
  { path: '/admin/grades/new', session: 'admin', group: 'admin', viewports: V2, name: 'admin-grades-new' },
  { path: '/admin/grades/' + (GRADE_ID ?? 'missing'), session: 'admin', group: 'admin', viewports: V2, name: 'admin-grade-detail' },
  { path: '/admin/fields', session: 'admin', group: 'admin', viewports: V2, name: 'admin-fields' },
  { path: '/admin/fields/new', session: 'admin', group: 'admin', viewports: V2, name: 'admin-fields-new' },
  { path: '/admin/subjects', session: 'admin', group: 'admin', viewports: V2, name: 'admin-subjects' },
  { path: '/admin/subjects/new', session: 'admin', group: 'admin', viewports: V2, name: 'admin-subjects-new' },
  { path: '/admin/subjects/' + (SUBJECT_ID ?? 'missing'), session: 'admin', group: 'admin', viewports: V2, name: 'admin-subject-detail' },
  { path: '/admin/subscriptions', session: 'admin', group: 'admin', viewports: V3, name: 'admin-subscriptions' },
  { path: '/admin/settings', session: 'admin', group: 'admin', viewports: V2, name: 'admin-settings' },
  { path: '/legacy', session: null, group: 'public', viewports: V2, name: 'legacy' },
  { path: '/app/subjects/definitely-not-a-subject/tutor', session: 'student', group: 'failures', viewports: V2, name: 'unknown-tutor-404' },
];

const target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
let consoleMsgs = [];
let netFailures = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    consoleMsgs.push(`${m.params.type}: ${(m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
  }
  if (m.method === 'Network.responseReceived') {
    const r = m.params.response;
    if (r.status >= 400) netFailures.push(`${r.status} ${r.url.slice(0, 110)}`);
  }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => { const cur = ++id; pending.set(cur, res); ws.send(JSON.stringify({ id: cur, method, params })); });
const evaluate = async (expression) => {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('evaluate timeout')), 20000)),
  ]);
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (group, name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(`qa/screenshots/${group}`, { recursive: true });
  await writeFile(`qa/screenshots/${group}/${name}.png`, Buffer.from(s.result.data, 'base64'));
};

const PROBE = `(() => {
  const accName = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || (el.querySelector('img')?.getAttribute('alt')) || '').trim().slice(0, 60);
  const interactives = Array.from(document.querySelectorAll('a[href],button,select,textarea,input:not([type=hidden])'));
  const unnamed = interactives.filter((el) => !accName(el) && !el.closest('[aria-hidden="true"]')).map((el) => el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : ''));
  const smallTargets = interactives.filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.width < 40 || b.height < 40); }).length;
  const imgs = Array.from(document.querySelectorAll('img'));
  const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => h.tagName + ':' + h.textContent.trim().slice(0, 40));
  return JSON.stringify({
    title: document.title,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    h1: Array.from(document.querySelectorAll('h1')).map((h) => h.textContent.trim().slice(0, 60)),
    headingCount: headings.length,
    headingSample: headings.slice(0, 10),
    landmarks: {
      header: document.querySelectorAll('header').length,
      nav: document.querySelectorAll('nav').length,
      main: document.querySelectorAll('main').length,
      footer: document.querySelectorAll('footer').length,
    },
    controls: interactives.length,
    unnamedControls: unnamed.length,
    unnamedSample: unnamed.slice(0, 8),
    images: imgs.length,
    imagesWithoutAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
    smallTargets,
    ovX: document.documentElement.scrollWidth > innerWidth + 1,
    textSample: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 220),
    hasClassroom: !!document.querySelector('.classroom'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  });
})()`;

const results = [];
for (const route of ROUTES) {
  for (const [w, h] of route.viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
    await send('Network.clearBrowserCookies');
    const token = route.session ? sessions[route.session] : null;
    if (token) await send('Network.setCookie', { name: 'fahimni_session', value: token, domain: 'localhost', path: '/' });
    consoleMsgs = []; netFailures = [];
    let httpStatus = null;
    const nav = await send('Page.navigate', { url: `${BASE}${route.path}` });
    await sleep(2600);
    try {
      const s = await evaluate(`(() => { try { return document.readyState; } catch { return 'err'; } })()`);
      httpStatus = s;
    } catch {}
    let probe = null;
    try { probe = JSON.parse(await evaluate(PROBE)); } catch (e) { probe = { probeError: String(e).slice(0, 200) }; }
    const entry = {
      route: route.path,
      name: route.name,
      group: route.group,
      session: route.session,
      viewport: `${w}x${h}`,
      consoleErrors: consoleMsgs.filter((m) => !m.includes('[guard:origin-check]')).slice(0, 5),
      netFailures: netFailures.slice(0, 5),
      ...probe,
    };
    results.push(entry);
    const tag = `${route.name}-${w}x${h}`;
    await shot(route.group, tag);
    console.log(tag, JSON.stringify({ cd: entry.consoleErrors.length, nf: entry.netFailures.length, ovX: entry.ovX, ctl: entry.controls, unnamed: entry.unnamedControls, h1: entry.h1?.[0] ?? null, class: entry.hasClassroom ?? false }));
  }
}

await writeFile('qa/audit-routes.json', JSON.stringify(results, null, 1));
console.log('ROUTES TESTED:', results.length);
ws.close();
