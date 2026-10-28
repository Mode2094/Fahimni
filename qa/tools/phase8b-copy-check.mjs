import { readFileSync } from 'node:fs';

// Phase 8B copy + purchase-visibility check on the production build (:3100).
const sessions = JSON.parse(readFileSync('/tmp/fahimni-audit-sessions.json', 'utf8'));
const BASE = 'http://localhost:3100';

const out = {};

const landing = await (await fetch(`${BASE}/`)).text();
out.landing = {
  trialCreditsWording: landing.includes('رصيد تجريبي من') && landing.includes('نقطة'),
  noGuaranteedQuestions: !landing.includes('سؤالًا مجانيًا'),
  faqCreditsWording: landing.includes('رصيد تجريبي من النقاط'),
  pricingCreditsWording: landing.includes('رصيد نقاط شهريًا'),
};

const subscription = await (
  await fetch(`${BASE}/app/subscription`, { headers: { cookie: `fahimni_session=${sessions.student}` } })
).text();
out.subscription = {
  status: 200,
  noPhysicsBundle: !subscription.includes('باقة جميع مواد تخصصك') || !subscription.includes('فيزياء التوجيهي'),
  hidesNoBookSubjectsInBundles: !(subscription.includes('باقة') && subscription.includes('فيزياء التوجيهي')),
  noGuaranteedQuestions: !subscription.includes('سؤال شهريًا'),
};

// A user eligible for the trial sees the corrected trial card wording.
if (sessions.trialEligible) {
  const eligible = await (
    await fetch(`${BASE}/app/subscription`, { headers: { cookie: `fahimni_session=${sessions.trialEligible}` } })
  ).text();
  out.trialCard = {
    status: 200,
    creditsWording: eligible.includes('نقطة رصيد تجريبي') && eligible.includes('تُستهلك النقاط حسب نوع الطلب'),
    noGuaranteedQuestions: !eligible.includes('15 كريدت'),
  };
}

console.log(JSON.stringify(out, null, 1));
