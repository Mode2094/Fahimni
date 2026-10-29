import { z } from 'zod';

import { sessionTokenFromRequest, userFromToken } from '../../../../lib/auth/request-user';
import { isEntitlementActive } from '../../../../lib/billing/entitlements';
import { billingStore } from '../../../../lib/billing/store';
import { jsonBody, sameOrigin } from '../../../../lib/http';
import { TRIAL_CLAIM_RATE } from '../../../../lib/rate-limit/config';
import { rateLimiter } from '../../../../lib/rate-limit/limiter';
import { studentStore } from '../../../../lib/student/store';
import {
  createTrialIdentityToken,
  hashTrialIdentityToken,
  trialIdentityCookieHeader,
  trialIdentityFromRequest,
  trialIdentitySecret,
} from '../../../../lib/trial/identity';
import { trialStore, type FreeTrialRecord } from '../../../../lib/trial/store';
import { verifyTrialChallenge } from '../../../../lib/trial/turnstile';

export const dynamic = 'force-dynamic';

const schema = z.object({ turnstileToken: z.string().max(4000).optional() }).strict();

function json(payload: unknown, status: number, headers?: Headers): Response {
  return new Response(JSON.stringify(payload), { status, headers: headers ?? { 'Content-Type': 'application/json' } });
}

// Raw trial identity tokens are never returned; only the trial state is.
function serializeTrial(trial: FreeTrialRecord) {
  return {
    status: trial.status,
    totalCredits: trial.totalCredits,
    remainingCredits: trial.remainingCredits,
    claimedAt: trial.claimedAt.toISOString(),
    startedAt: trial.startedAt ? trial.startedAt.toISOString() : null,
    expiresAt: trial.expiresAt ? trial.expiresAt.toISOString() : null,
  };
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'طلب غير صالح.', code: 'forbidden' }, 403);

  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) return json({ error: 'سجّل الدخول أولًا.', code: 'unauthorized' }, 401);

  const profile = await studentStore().getProfile(user.id);
  if (!profile?.onboardingCompleted) {
    return json({ error: 'أكمل إعداد حسابك أولًا.', code: 'onboarding_required' }, 403);
  }

  // Trial activation attempts are rate limited per account.
  try {
    const limited = await rateLimiter().consume(
      `rl:trial-claim:${user.id}`,
      TRIAL_CLAIM_RATE.limit,
      TRIAL_CLAIM_RATE.windowMs,
    );
    if (!limited.ok) {
      return json({ error: 'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.', code: 'rate_limited' }, 429);
    }
  } catch {
    return json({ error: 'الخدمة غير مهيأة حاليًا.', code: 'config_error' }, 503);
  }

  const trials = trialStore();
  let settings;
  try {
    settings = await trials.getSettings();
  } catch {
    return json({ error: 'الخدمة غير مهيأة حاليًا.', code: 'config_error' }, 503);
  }
  if (!settings.enabled) {
    return json({ error: 'التجربة المجانية غير متاحة حاليًا.', code: 'trial_disabled' }, 403);
  }

  // A student with an active paid subscription does not need a trial.
  const billing = billingStore();
  const entitlements = await billing.listEntitlementsForUser(user.id);
  if (entitlements.some((entitlement) => isEntitlementActive(entitlement))) {
    return json({ error: 'لديك اشتراك نشط بالفعل.', code: 'already_subscribed' }, 409);
  }

  let payload: { turnstileToken?: string } = {};
  try {
    const parsed = schema.safeParse(await jsonBody(request, 20_000));
    if (parsed.success) payload = parsed.data;
  } catch {
    payload = {};
  }

  const verification = await verifyTrialChallenge(payload.turnstileToken ?? '', request);
  if (!verification.ok) {
    if (verification.reason === 'config') {
      return json({ error: 'التجربة المجانية غير مهيأة حاليًا. حاول لاحقًا.', code: 'trial_unavailable' }, 503);
    }
    return json({ error: 'تعذر التحقق منك. أعد المحاولة.', code: 'turnstile_failed' }, 400);
  }

  const existingToken = trialIdentityFromRequest(request);
  const token = existingToken ?? createTrialIdentityToken();
  const identityHash = await hashTrialIdentityToken(token, trialIdentitySecret());

  const outcome = await trials.claim({
    id: crypto.randomUUID(),
    userId: user.id,
    browserIdentityHash: identityHash,
    totalCredits: settings.creditAllowance,
    claimedAt: new Date(),
  });

  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (!existingToken) {
    headers.append('Set-Cookie', trialIdentityCookieHeader(token, (process.env.NODE_ENV ?? 'development') === 'production'));
  }

  if (outcome.kind === 'browser_conflict') {
    // Never reveal the other account; offer a support path for shared devices.
    return new Response(
      JSON.stringify({
        error: 'هذا المتصفح استُخدم للتجربة المجانية من قبل. إذا كنت تشارك الجهاز مع طالب آخر، تواصل مع الدعم لمراجعة حالتك.',
        code: 'browser_used',
      }),
      { status: 409, headers },
    );
  }

  return new Response(JSON.stringify({ trial: serializeTrial(outcome.trial), created: outcome.kind === 'created' }), {
    status: 200,
    headers,
  });
}
