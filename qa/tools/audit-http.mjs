import { readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const out = { anonymous: {}, student: {}, csrf: {}, redirects: {}, secrets: {}, trial: {}, limits: {}, session: {}, upload: {} };

const jsonHeaders = { 'content-type': 'application/json' };
const studentCookie = `fahimni_session=${sessions.student}`;
const studentWithDevice = `${studentCookie}; fahimni_device=${sessions.deviceToken}`;
const adminCookie = `fahimni_session=${sessions.admin}`;

async function req(path, { method = 'GET', headers = {}, body, token, device } = {}) {
  const h = { origin: BASE, ...headers };
  if (token) h.cookie = `fahimni_session=${token}${device ? `; fahimni_device=${device}` : ''}`;
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers: h, body, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    const text = await res.text().catch(() => '');
    return { status: res.status, location: res.headers.get('location') ?? '', text, setCookie: res.headers.get('set-cookie') ?? '' };
  } catch (error) {
    return { status: -1, location: '', text: `timeout:${error instanceof Error ? error.name : 'error'}`, setCookie: '' };
  }
}

const step = (name) => console.log(`[step] ${name}`);
step('anonymous');
const tutorBody = JSON.stringify({ question: 'اختبار', board: { objects: [] }, history: [], currentStep: 0, currentLesson: null, subjectSlug: 'tawjihi-math', requestId: crypto.randomUUID() });
out.anonymous.health = (await req('/api/health')).status;
const statusRes = await req('/api/status');
out.anonymous.status = { status: statusRes.status, body: statusRes.text.slice(0, 120) };
out.anonymous.tutor = (await req('/api/tutor', { method: 'POST', headers: jsonHeaders, body: tutorBody })).status;
out.anonymous.vision = (await req('/api/vision', { method: 'POST', body: new FormData() })).status;
out.anonymous.transcribe = (await req('/api/transcribe', { method: 'POST', body: new FormData() })).status;
// invalid body fails schema before any provider/authorization work (no cost)
out.anonymous.speechInvalid = (await req('/api/speech', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({}) })).status;
// subject-scoped speech requires a session even in dev (no provider call)
out.anonymous.speechSubjectScoped = (await req('/api/speech', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ text: 'اختبار', subjectSlug: 'tawjihi-math' }) })).status;
out.anonymous.trialClaim = (await req('/api/trial/claim', { method: 'POST', headers: jsonHeaders, body: '{}' })).status;
out.anonymous.checkout = (await req('/api/checkout', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ offerId: 'aaaaaaaa-0002-4000-8000-000000000002' }) })).status;
out.anonymous.adminGrades = (await req('/api/admin/grades', { method: 'POST', body: new FormData() })).status;
out.anonymous.adminSettings = (await req('/api/admin/settings', { method: 'POST', body: new FormData() })).status;
out.anonymous.webhookNoSignature = (await req('/api/webhooks/freemius', { method: 'POST', headers: jsonHeaders, body: '{}' })).status;
out.anonymous.bookPage = (await req('/api/books/book/../pages/1'.replace('..', ''))).status;
const rnd = await req(`/api/books/${crypto.randomUUID()}/pages/1`);
out.anonymous.bookRandom = rnd.status;
out.anonymous.appPage = (await req('/app')).status;
out.anonymous.adminPage = (await req('/admin')).status;
out.anonymous.tutorPage = (await req('/app/subjects/tawjihi-math/tutor')).status;

// ---------- student role boundaries ----------
step('student-boundaries');
out.student.adminGrades = (await req('/api/admin/grades', { method: 'POST', body: new FormData(), token: sessions.student })).status;
out.student.adminSettings = (await req('/api/admin/settings', { method: 'POST', body: new FormData(), token: sessions.student })).status;
out.student.adminPage = (await req('/admin', { token: sessions.student })).status;
out.student.adminPageLocation = (await req('/admin', { token: sessions.student })).location;
out.student.aiNoEntitlement = (await req('/api/tutor', { method: 'POST', headers: jsonHeaders, body: tutorBody.replace('tawjihi-math', 'tawjihi-physics'), token: sessions.student })).status;
out.student.speechNoEntitlement = (await req('/api/speech', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ text: 'اختبار', subjectSlug: 'tawjihi-physics' }), token: sessions.student })).status;
out.student.bookMathPage = (await req('/api/books/b0285393-fc49-4573-833f-07b87b1cb628/pages/1', { token: sessions.student })).status;
out.student.bookOtherSubject = (await req('/api/books/does-not-exist/pages/1', { token: sessions.student })).status;

// ---------- CSRF ----------
step('csrf');
out.csrf.adminCrossOrigin = (await req('/api/admin/settings', { method: 'POST', body: new FormData(), token: sessions.admin, headers: { origin: 'https://evil.example' } })).status;
out.csrf.checkoutCrossOrigin = (await req('/api/checkout', { method: 'POST', headers: { ...jsonHeaders, origin: 'https://evil.example' }, body: JSON.stringify({ offerId: 'x' }), token: sessions.student })).status;
out.csrf.logoutCrossOrigin = (await req('/api/auth/logout', { method: 'POST', token: sessions.student, headers: { origin: 'https://evil.example' } })).status;

// ---------- ----------
step('redirects-secrets-trial');
const loginEvil = await req('/login?returnTo=https%3A%2F%2Fevil.example');
out.redirects.loginEvilContainsEvil = loginEvil.text.includes('evil.example');
const authStartEvil = await req('/api/auth/google?returnTo=%2F%2Fevil.example');
out.redirects.authStartStatus = authStartEvil.status;
try { out.redirects.authStartHost = new URL(authStartEvil.location).hostname; } catch { out.redirects.authStartHost = null; }

// ---------- secrets in client output ----------
const home = await req('/');
const scriptUrls = [...home.text.matchAll(/src="([^"]*_next[^"]*\.js)"/g)].map((m) => m[1]).slice(0, 6);
let leaked = 0; let checked = 0;
for (const url of scriptUrls) {
  const res = await fetch(`${BASE}${url}`);
  const text = await res.text();
  checked += 1;
  if (/GOCSPX|sk-proj-|sk-[A-Za-z0-9]{20,}|FREEMIUS_SECRET_KEY|TURNSTILE_SECRET_KEY|AUTH_SECRET/.test(text)) leaked += 1;
}
out.secrets = { scriptsChecked: checked, scriptsWithSecretPatterns: leaked, htmlHasSecret: /GOCSPX|sk-proj-/.test(home.text) };

// ---------- trial claim rules ----------
let trialClaim = await req('/api/trial/claim', { method: 'POST', headers: jsonHeaders, body: '{}', token: sessions.trialEligible });
out.trial.firstClaim = { status: trialClaim.status, body: JSON.parse(await Promise.resolve(trialClaim.text || '{}') || '{}') };
const cookie = (trialClaim.setCookie.match(/fahimni_trial_identity=([^;]+)/) ?? [])[1] ?? '';
const second = await req('/api/trial/claim', { method: 'POST', headers: { ...jsonHeaders, cookie: `fahimni_session=${sessions.trialEligible}; fahimni_trial_identity=${cookie}` }, body: '{}' });
out.trial.secondClaim = { status: second.status, created: (JSON.parse(second.text || '{}') || {}).created };
const other = await req('/api/trial/claim', { method: 'POST', headers: { ...jsonHeaders, cookie: `fahimni_session=${sessions.trialExpired}; fahimni_trial_identity=${cookie}` }, body: '{}' });
out.trial.otherAccountSameBrowser = { status: other.status, code: (JSON.parse(other.text || '{}') || {}).code };
// paid account cannot claim
const paidClaim = await req('/api/trial/claim', { method: 'POST', headers: jsonHeaders, body: '{}', token: sessions.student });
out.trial.paidAccountClaim = { status: paidClaim.status, code: (JSON.parse(paidClaim.text || '{}') || {}).code };

// ---------- claim endpoint rate limit (no AI cost) ----------
step('rate-limit-claims');
const statuses = [];
for (let i = 0; i < 12; i += 1) {
  const r = await req('/api/trial/claim', { method: 'POST', headers: jsonHeaders, body: '{}', token: sessions.student });
  statuses.push(r.status);
}
out.limits.claimAttempts = statuses.join(',');

// ---------- session expiry ----------
out.session.expiredRowCreated = 'see psql step';
out.session.adminNoCookie = (await req('/api/admin/settings', { method: 'POST', body: new FormData() })).status;

// ---------- device limit (no cookie, student has 2 devices) ----------
step('device-limit-upload');
out.limits.deviceLimit = (await req('/api/tutor', { method: 'POST', headers: jsonHeaders, body: tutorBody, token: sessions.student })).status;
// with the current device cookie the request passes the device gate (may reach provider: use a denied subject to avoid cost)
const physBody = tutorBody.replace('tawjihi-math', 'tawjihi-physics');
out.limits.deviceOkButNoEntitlement = (await req('/api/tutor', { method: 'POST', headers: jsonHeaders, body: physBody, token: sessions.student, device: sessions.deviceToken })).status;

// ---------- upload validation (admin) ----------
const subjectId = 'b0285393-fc49-4573-833f-07b87b1cb628';
const fd = new FormData();
fd.set('file', new File([new TextEncoder().encode('not a real pdf')], 'fake.pdf', { type: 'application/pdf' }));
out.upload.fakePdf = (await req(`/api/admin/subjects/${subjectId}/book`, { method: 'POST', body: fd, token: sessions.admin })).status;
const empty = new FormData();
out.upload.empty = (await req(`/api/admin/subjects/${subjectId}/book`, { method: 'POST', body: empty, token: sessions.admin })).status;

writeFileSync('qa/audit-http.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
