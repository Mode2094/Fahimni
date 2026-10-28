import { readFileSync, writeFileSync } from 'node:fs';

const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3000';
const out = {};

async function req(path, { method = 'GET', headers = {}, body, cookie } = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { origin: BASE, ...headers, ...(cookie ? { cookie } : {}) },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, location: res.headers.get('location') ?? '', text: await res.text().catch(() => ''), setCookie: res.headers.get('set-cookie') ?? '' };
  } catch (error) {
    return { status: -1, location: '', text: `timeout:${error instanceof Error ? error.name : ''}`, setCookie: '' };
  }
}

// A) trial browser reuse with a genuinely fresh account on the same browser
const first = await req('/api/trial/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', cookie: `fahimni_session=${sessions.trialEligible}` });
const identity = (first.setCookie.match(/fahimni_trial_identity=([^;]+)/) ?? [])[1] ?? '';
const second = await req('/api/trial/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', cookie: `fahimni_session=${sessions.trialEligible}; fahimni_trial_identity=${identity}` });
const other = await req('/api/trial/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', cookie: `fahimni_session=${sessions.noAccess}; fahimni_trial_identity=${identity}` });
out.trialBrowser = {
  first: { status: first.status, created: JSON.parse(first.text || '{}').created },
  sameAccountAgain: { status: second.status, created: JSON.parse(second.text || '{}').created },
  freshAccountSameBrowser: { status: other.status, code: JSON.parse(other.text || '{}').code ?? null },
};

// B) book page authorization matrix (real book id)
const bookId = sessions.ids.mathBook;
out.bookPages = {
  anonymous: (await req(`/api/books/${bookId}/pages/1`)).status,
  entitledStudent: (await req(`/api/books/${bookId}/pages/1`, { cookie: `fahimni_session=${sessions.student}` })).status,
  trialActive: (await req(`/api/books/${bookId}/pages/1`, { cookie: `fahimni_session=${sessions.trialActive}` })).status,
  noAccessGrade11: (await req(`/api/books/${bookId}/pages/1`, { cookie: `fahimni_session=${sessions.noAccess}` })).status,
  unknownBook: (await req('/api/books/00000000-0000-4000-8000-000000000000/pages/1', { cookie: `fahimni_session=${sessions.student}` })).status,
};

// C) upload rejection evidence
const form = new FormData();
form.set('file', new File([new TextEncoder().encode('not a real pdf')], 'fake.pdf', { type: 'application/pdf' }));
const upload = await req(`/api/admin/subjects/${sessions.ids.mathBook.replace(sessions.ids.mathBook, 'b0285393-fc49-4573-833f-07b87b1cb628')}/book`, {
  method: 'POST',
  cookie: `fahimni_session=${sessions.admin}`,
  body: form,
});
out.uploadRejection = { status: upload.status, redirect: upload.location };

// D) returnTo sanitization on the login page's Google link
const login = await req('/login?returnTo=%2F%2Fevil.example');
const href = (login.text.match(/href="([^"]*api\/auth\/google[^"]*)"/) ?? [])[1] ?? '';
const returnToParam = href ? decodeURIComponent((href.match(/returnTo=([^&"]*)/) ?? [])[1] ?? '') : null;
out.returnToSanitization = { googleHrefPresent: Boolean(href), returnToParam };

// E) expired session behavior
out.expiredSession = {
  pageApp: (await req('/app', { cookie: `fahimni_session=${sessions.expiredSession}` })).status,
  apiTutor: (
    await req('/api/tutor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'س', board: { objects: [] }, history: [], currentStep: 0, currentLesson: null, subjectSlug: 'tawjihi-math', requestId: crypto.randomUUID() }),
      cookie: `fahimni_session=${sessions.expiredSession}`,
    })
  ).status,
};

// F) onboarding API validation (noProfile audit user)
const missingField = await req('/api/onboarding', {
  method: 'POST',
  cookie: `fahimni_session=${sessions.noProfile}`,
  body: (() => { const f = new FormData(); f.set('gradeId', 'ac160166-5f14-4234-80b8-a23c647294e7'); return f; })(),
});
out.onboarding = { missingFieldRedirect: missingField.location };
const invalidField = await req('/api/onboarding', {
  method: 'POST',
  cookie: `fahimni_session=${sessions.noProfile}`,
  body: (() => { const f = new FormData(); f.set('gradeId', 'ac160166-5f14-4234-80b8-a23c647294e7'); f.set('academicFieldId', 'not-a-uuid'); return f; })(),
});
out.onboarding.invalidFieldRedirect = invalidField.location;

// G) checkout with the real active offer (Freemius unconfigured locally)
const checkout = await req('/api/checkout', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ offerId: 'aaaaaaaa-0002-4000-8000-000000000002' }),
  cookie: `fahimni_session=${sessions.noAccess}`,
});
out.checkout = { status: checkout.status, body: checkout.text.slice(0, 120) };
const forged = await req('/api/checkout', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ offerId: 'aaaaaaaa-0002-4000-8000-000000000002', priceMinor: 1 }),
  cookie: `fahimni_session=${sessions.student}`,
});
out.checkout.forgedPriceStatus = forged.status;

writeFileSync('qa/audit-targeted.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
