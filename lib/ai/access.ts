import { AuthConfigError, authSecret } from '../auth/env';
import { sessionTokenFromRequest, userFromToken } from '../auth/request-user';
import type { AuthUser } from '../auth/store';
import { isEntitlementActive } from '../billing/entitlements';
import { billingStore, type BillingStore, type EntitlementRecord } from '../billing/store';
import { ensureCreditPeriod } from '../credits/periods';
import { deviceCookieHeader, createDeviceToken, deviceTokenFromRequest, hashDeviceToken } from '../devices/token';
import { summarizeUserAgent } from '../devices/user-agent';
import { deviceStore, type DeviceRecord, type DeviceStore } from '../devices/store';
import { RATE_LIMITS, TRIAL_BURST, TRIAL_RATE_LIMITS, type AiOperation } from '../rate-limit/config';
import { rateLimiter } from '../rate-limit/limiter';
import { subjectAppliesTo } from '../student/onboarding';
import { studentStore, type CatalogSubject, type StudentProfile, type StudentStore } from '../student/store';
import { trialBudget, type TrialBudget } from '../trial/budget';
import { aiBudget, type DailyBudget } from './budget';
import { aiRuntimeConfig } from './runtime-config';
import { TRIAL_COST_MICRO_USD, usdToMicroUsd } from '../trial/config';
import { trialStore, type FreeTrialRecord, type TrialStore } from '../trial/store';

export type AiAccessFailureCode =
  | 'unauthorized'
  | 'onboarding_required'
  | 'subject_unavailable'
  | 'book_required'
  | 'entitlement_required'
  | 'device_limit'
  | 'credit_required'
  | 'rate_limited'
  | 'legacy_disabled'
  | 'trial_expired'
  | 'trial_exhausted'
  | 'trial_budget'
  | 'ai_budget'
  | 'config_error';

export type AiAccessFailure = {
  code: AiAccessFailureCode;
  status: number;
  message: string;
  balance?: number;
  resetAt?: Date | null;
  setDeviceCookie?: string;
};

export type AiAccessContext = {
  user: AuthUser | null;
  subject: CatalogSubject | null;
  profile: StudentProfile | null;
  entitlement: EntitlementRecord | null;
  trial: FreeTrialRecord | null;
  device: DeviceRecord | null;
  balance: number | null;
  resetAt: Date | null;
  setDeviceCookie?: string;
};

export type AiAccessDeps = {
  students?: StudentStore;
  billing?: BillingStore;
  devices?: DeviceStore;
  trials?: TrialStore;
  budget?: TrialBudget;
  nodeEnv?: string;
};

export function legacyAiAllowed(user: AuthUser | null, nodeEnv: string): boolean {
  if (nodeEnv !== 'production') return true;
  return user?.role === 'ADMIN';
}

export function deviceRegistrationDecision(input: {
  hasValidDevice: boolean;
  activeCount: number;
  maxDevices: number;
}): 'use' | 'register' | 'limit' {
  if (input.hasValidDevice) return 'use';
  return input.activeCount < input.maxDevices ? 'register' : 'limit';
}

function failure(code: AiAccessFailureCode, status: number, message: string, extra: Partial<AiAccessFailure> = {}): AiAccessFailure {
  return { code, status, message, ...extra };
}

async function applyRateLimitWith(key: string, limit: number, windowMs: number): Promise<AiAccessFailure | null> {
  try {
    const result = await rateLimiter().consume(key, limit, windowMs);
    if (!result.ok) return failure('rate_limited', 429, 'طلبات كثيرة في وقت قصير. انتظر قليلًا ثم حاول مجددًا.');
    return null;
  } catch {
    return failure('config_error', 503, 'خدمة الحماية غير مهيأة حاليًا. حاول لاحقًا.');
  }
}

async function applyRateLimit(key: string, operation: AiOperation): Promise<AiAccessFailure | null> {
  const { limit, windowMs } = RATE_LIMITS[operation];
  return applyRateLimitWith(`rl:${operation}:${key}`, limit, windowMs);
}

// Trial-backed requests: standard limits already applied by the caller, plus
// stricter trial caps and a burst guard. Short windows bound concurrency abuse.
async function applyTrialRateLimits(userId: string, operation: AiOperation): Promise<AiAccessFailure | null> {
  const burst = await applyRateLimitWith(`rl:trial-burst:${userId}`, TRIAL_BURST.limit, TRIAL_BURST.windowMs);
  if (burst) return burst;
  const { limit, windowMs } = TRIAL_RATE_LIMITS[operation];
  return applyRateLimitWith(`rl:trial-${operation}:${userId}`, limit, windowMs);
}

const TRIAL_EXPIRED_MESSAGE = 'انتهت تجربتك المجانية. استكشف الاشتراكات للمتابعة.';
const TRIAL_EXHAUSTED_MESSAGE = 'انتهى رصيد تجربتك المجانية. استكشف الاشتراكات للمتابعة.';

// Trial access resolution. The 48-hour countdown starts here — on the first
// accepted billable AI request — never on signup or page views.
export async function resolveTrialAccess(
  trials: TrialStore,
  userId: string,
  now: Date,
): Promise<{ ok: true; trial: FreeTrialRecord } | { ok: false; failure: AiAccessFailure }> {
  const trial = await trials.findByUserId(userId);
  if (!trial) {
    return { ok: false, failure: failure('entitlement_required', 403, 'تحتاج للاشتراك في المادة للمتابعة.') };
  }
  switch (trial.status) {
    case 'CLAIMED': {
      if (trial.remainingCredits <= 0) {
        await trials.setStatus(trial.id, 'EXHAUSTED');
        return { ok: false, failure: failure('trial_exhausted', 402, TRIAL_EXHAUSTED_MESSAGE) };
      }
      const settings = await trials.getSettings();
      const expiresAt = new Date(now.getTime() + settings.durationHours * 60 * 60 * 1000);
      const started = await trials.start(trial.id, now, expiresAt);
      // A concurrent first request may have won the atomic start; re-read then.
      const record = started ?? (await trials.findByUserId(userId)) ?? trial;
      if (record.remainingCredits <= 0) {
        return { ok: false, failure: failure('trial_exhausted', 402, TRIAL_EXHAUSTED_MESSAGE) };
      }
      return { ok: true, trial: record };
    }
    case 'ACTIVE': {
      if (trial.expiresAt && trial.expiresAt.getTime() <= now.getTime()) {
        await trials.setStatus(trial.id, 'EXPIRED');
        return { ok: false, failure: failure('trial_expired', 402, TRIAL_EXPIRED_MESSAGE) };
      }
      if (trial.remainingCredits <= 0) {
        await trials.setStatus(trial.id, 'EXHAUSTED');
        return { ok: false, failure: failure('trial_exhausted', 402, TRIAL_EXHAUSTED_MESSAGE) };
      }
      return { ok: true, trial };
    }
    case 'EXPIRED':
      return { ok: false, failure: failure('trial_expired', 402, TRIAL_EXPIRED_MESSAGE) };
    case 'EXHAUSTED':
      return { ok: false, failure: failure('trial_exhausted', 402, TRIAL_EXHAUSTED_MESSAGE) };
    case 'REVOKED':
    default:
      return { ok: false, failure: failure('entitlement_required', 403, 'تحتاج للاشتراك في المادة للمتابعة.') };
  }
}

type DeviceResolution =
  | { kind: 'ok'; device: DeviceRecord; setDeviceCookie?: string }
  | { kind: 'limit'; setDeviceCookie: string };

async function resolveDevice(
  request: Request,
  user: AuthUser,
  devices: DeviceStore,
  secret: string,
  secure: boolean,
): Promise<DeviceResolution> {
  const token = deviceTokenFromRequest(request);
  if (token) {
    const existing = await devices.findDeviceByTokenHash(await hashDeviceToken(token, secret));
    // Revoked tokens are never resurrected; a fresh token is issued instead.
    if (existing && existing.userId === user.id && !existing.revokedAt) {
      await devices.touchDevice(existing.id, new Date());
      return { kind: 'ok', device: existing };
    }
  }

  const freshToken = createDeviceToken();
  const maxDevices = await devices.getMaxDevices();
  const activeCount = await devices.countActiveDevices(user.id);
  const decision = deviceRegistrationDecision({ hasValidDevice: false, activeCount, maxDevices });
  const cookie = deviceCookieHeader(freshToken, secure);

  if (decision === 'limit') return { kind: 'limit', setDeviceCookie: cookie };

  const { name, summary } = summarizeUserAgent(request.headers.get('user-agent'));
  const device = await devices.createDevice({
    id: crypto.randomUUID(),
    userId: user.id,
    deviceTokenHash: await hashDeviceToken(freshToken, secret),
    name,
    userAgentSummary: summary,
  });
  return { kind: 'ok', device, setDeviceCookie: cookie };
}

// One reusable guard for every OpenAI-backed endpoint: session → onboarding →
// visible subject → active entitlement → registered device → rate limit.
export async function authorizeAiRequest(
  request: Request,
  input: { operation: AiOperation; subjectSlug?: string | null },
  deps: AiAccessDeps = {},
): Promise<{ ok: true; context: AiAccessContext } | { ok: false; failure: AiAccessFailure }> {
  const nodeEnv = deps.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  let secret: string;
  let secure: boolean;
  try {
    secret = authSecret();
    secure = nodeEnv === 'production';
  } catch (error) {
    if (error instanceof AuthConfigError) {
      return { ok: false, failure: failure('config_error', 503, 'الخدمة غير مهيأة حاليًا.') };
    }
    throw error;
  }

  const students = deps.students ?? studentStore();
  const billing = deps.billing ?? billingStore();
  const devices = deps.devices ?? deviceStore();

  const user = await userFromToken(sessionTokenFromRequest(request));

  const subjectSlug = input.subjectSlug?.trim() || null;

  // Legacy (no subject) AI access: anonymous only in development/test; in
  // production it requires a session and is restricted to ADMIN.
  if (!subjectSlug) {
    if (!user) {
      if (nodeEnv === 'production') {
        return { ok: false, failure: failure('unauthorized', 401, 'سجّل الدخول للمتابعة.') };
      }
      const limitedAnonymous = await applyRateLimit('legacy-anonymous', input.operation);
      if (limitedAnonymous) return { ok: false, failure: limitedAnonymous };
      return {
        ok: true,
        context: { user: null, subject: null, profile: null, entitlement: null, trial: null, device: null, balance: null, resetAt: null },
      };
    }
    if (!legacyAiAllowed(user, nodeEnv)) {
      return { ok: false, failure: failure('legacy_disabled', 403, 'هذه المساحة متاحة من داخل مساحة الطالب.') };
    }
    const limited = await applyRateLimit(user.id, input.operation);
    if (limited) return { ok: false, failure: limited };
    return {
      ok: true,
      context: { user, subject: null, profile: null, entitlement: null, trial: null, device: null, balance: null, resetAt: null },
    };
  }

  if (!user) return { ok: false, failure: failure('unauthorized', 401, 'سجّل الدخول للمتابعة.') };

  const profile = await students.getProfile(user.id);
  if (!profile?.onboardingCompleted) {
    return { ok: false, failure: failure('onboarding_required', 403, 'أكمل إعداد حسابك أولًا.') };
  }

  const subject = await students.findSubjectBySlug(subjectSlug);
  if (!subject || !subject.isActive || !subjectAppliesTo(subject, profile.gradeId, profile.academicFieldId)) {
    return { ok: false, failure: failure('subject_unavailable', 404, 'المادة غير متاحة.') };
  }

  let entitlement = await billing.findAccessibleEntitlement(user.id, subject.id, new Date());
  let trial: FreeTrialRecord | null = null;
  if (entitlement && isEntitlementActive(entitlement)) {
    // Paid access stays authoritative wherever a valid subscription covers the
    // subject; the shared trial wallet applies only to other subjects.
    entitlement = await ensureCreditPeriod(billing, entitlement);
  } else {
    entitlement = null;
    const resolution = await resolveTrialAccess(deps.trials ?? trialStore(), user.id, new Date());
    if (!resolution.ok) return { ok: false, failure: resolution.failure };
    trial = resolution.trial;
  }

  const device = await resolveDevice(request, user, devices, secret, secure);
  if (device.kind === 'limit') {
    return {
      ok: false,
      failure: failure('device_limit', 403, 'وصلت للحد المسموح للأجهزة. أزل جهازًا قديمًا ثم حاول مجددًا.', {
        setDeviceCookie: device.setDeviceCookie,
      }),
    };
  }

  const limited = await applyRateLimit(user.id, input.operation);
  if (limited) return { ok: false, failure: limited };
  if (trial) {
    const trialLimited = await applyTrialRateLimits(user.id, input.operation);
    if (trialLimited) return { ok: false, failure: trialLimited };
  }

  return {
    ok: true,
    context: {
      user,
      subject,
      profile,
      entitlement,
      trial,
      device: device.device,
      balance: entitlement ? entitlement.creditBalance : trial ? trial.remainingCredits : null,
      resetAt: entitlement ? entitlement.creditPeriodEndsAt : trial?.expiresAt ?? null,
      setDeviceCookie: device.setDeviceCookie,
    },
  };
}

export type ChargeOutcome =
  | { ok: true; balance: number; charged: boolean; requestId: string; trial?: boolean }
  | { ok: false; failure: AiAccessFailure };

// Global daily budget: disabled (null) when the admin has not configured a
// limit. When a limit exists, an unavailable budget backend fails closed.
async function resolveGlobalBudget(): Promise<{ budgetMicroUsd: number; budget: DailyBudget } | null> {
  const config = await aiRuntimeConfig().catch(() => null);
  if (!config || config.dailyBudgetUsd <= 0) return null;
  return { budgetMicroUsd: usdToMicroUsd(config.dailyBudgetUsd), budget: aiBudget() };
}

async function releaseGlobalBudget(requestId: string): Promise<void> {
  try {
    await aiBudget().release(requestId);
  } catch {
    // Releasing is best-effort; a missing backend must not mask the original result.
  }
}

// Atomic, idempotent credit reservation. Must be called after authorizeAiRequest
// and before the provider call. Exactly one wallet is ever charged: the paid
// entitlement when it exists, otherwise the shared trial wallet (with a
// conservative daily-budget reservation before the provider call).
export async function chargeAiCredits(
  context: AiAccessContext,
  input: { operation: AiOperation; credits: number; requestId?: string | null },
  billing: BillingStore = billingStore(),
  trials: TrialStore = trialStore(),
  budget: TrialBudget = trialBudget(),
  globalOverride?: { budgetMicroUsd: number; budget: DailyBudget } | null,
): Promise<ChargeOutcome> {
  const requestId = input.requestId?.trim() || crypto.randomUUID();
  const estimate = TRIAL_COST_MICRO_USD[input.operation] ?? 0;

  if (input.credits > 0 && estimate > 0) {
    let global: { budgetMicroUsd: number; budget: DailyBudget } | null = globalOverride ?? null;
    if (globalOverride === undefined) {
      try {
        global = await resolveGlobalBudget();
      } catch {
        return { ok: false, failure: failure('config_error', 503, 'خدمة الاستخدام غير مهيأة حاليًا. حاول لاحقًا.') };
      }
    }
    if (global) {
      try {
        const reservation = await global.budget.reserve({ requestId, amountMicroUsd: estimate, budgetMicroUsd: global.budgetMicroUsd });
        if (!reservation.ok) {
          return {
            ok: false,
            failure: failure('ai_budget', 402, 'بلغت المنصة حدّها اليومي لاستخدام الذكاء الاصطناعي مؤقتًا. جرّب لاحقًا.'),
          };
        }
      } catch {
        return { ok: false, failure: failure('config_error', 503, 'خدمة الاستخدام غير مهيأة حاليًا. حاول لاحقًا.') };
      }
    }
  }

  if (context.trial) {
    if (!context.subject || !context.user || input.credits <= 0) {
      return { ok: true, balance: context.trial.remainingCredits, charged: false, requestId, trial: true };
    }
    let settings;
    try {
      settings = await trials.getSettings();
    } catch {
      await releaseGlobalBudget(requestId);
      return { ok: false, failure: failure('config_error', 503, 'خدمة التجربة غير مهيأة حاليًا. حاول لاحقًا.') };
    }
    let reservation;
    try {
      reservation = await budget.reserve({
        requestId,
        amountMicroUsd: estimate,
        budgetMicroUsd: usdToMicroUsd(settings.dailyBudgetUsd),
      });
    } catch {
      await releaseGlobalBudget(requestId);
      return { ok: false, failure: failure('config_error', 503, 'خدمة التجربة غير مهيأة حاليًا. حاول لاحقًا.') };
    }
    if (!reservation.ok) {
      await releaseGlobalBudget(requestId);
      return {
        ok: false,
        failure: failure('trial_budget', 402, 'بلغت التجربة المجانية حدّها اليومي مؤقتًا. جرّب لاحقًا أو اشترك للمتابعة.'),
      };
    }
    const result = await trials.chargeTrialCredits({
      trialId: context.trial.id,
      userId: context.user.id,
      subjectId: context.subject.id,
      operation: input.operation,
      credits: input.credits,
      requestId,
      estimatedCostMicroUsd: estimate,
    });
    if (!result.ok) {
      await budget.release(requestId).catch(() => undefined);
      await releaseGlobalBudget(requestId);
      return {
        ok: false,
        failure: failure('credit_required', 402, 'انتهى رصيد تجربتك المجانية. استكشف الاشتراكات للمتابعة.', {
          balance: context.trial.remainingCredits,
          resetAt: context.trial.expiresAt,
        }),
      };
    }
    return { ok: true, balance: result.balance, charged: !result.duplicate, requestId, trial: true };
  }

  if (!context.subject || !context.entitlement || !context.user || input.credits <= 0) {
    return { ok: true, balance: context.balance ?? 0, charged: false, requestId };
  }

  const result = await billing.chargeCredits({
    entitlementId: context.entitlement.id,
    userId: context.user.id,
    subjectId: context.subject.id,
    operation: input.operation,
    credits: input.credits,
    requestId,
  });

  if (!result.ok) {
    await releaseGlobalBudget(requestId);
    return {
      ok: false,
      failure: failure('credit_required', 402, 'انتهى رصيدك لهذه الفترة. يتم تجديد رصيدك تلقائيًا في بداية الفترة القادمة.', {
        balance: context.entitlement.creditBalance,
        resetAt: context.entitlement.creditPeriodEndsAt,
      }),
    };
  }
  return { ok: true, balance: result.balance, charged: !result.duplicate, requestId };
}

// Refunds once when a provider request fails before a useful result. Duplicate
// charges (retried requestIds) are never refunded. Trial refunds also release
// the daily budget reservation.
export async function refundAiCredits(
  charge: ChargeOutcome,
  billing: BillingStore = billingStore(),
  trials: TrialStore = trialStore(),
  budget: TrialBudget = trialBudget(),
): Promise<void> {
  if (!charge.ok || !charge.charged) return;
  try {
    if (charge.trial) {
      await trials.refundTrialCredits(charge.requestId);
    } else {
      await billing.refundCredits(charge.requestId);
    }
  } catch {
    console.error('[credits] refund failed');
  } finally {
    if (charge.trial) {
      await budget.release(charge.requestId).catch(() => undefined);
    }
    await releaseGlobalBudget(charge.requestId);
  }
}

export function aiFailureResponse(failureResult: AiAccessFailure, context?: AiAccessContext): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const cookie = failureResult.setDeviceCookie ?? context?.setDeviceCookie;
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(
    JSON.stringify({
      error: failureResult.message,
      code: failureResult.code,
      balance: failureResult.balance ?? null,
      resetAt: failureResult.resetAt ? failureResult.resetAt.toISOString() : null,
    }),
    { status: failureResult.status, headers },
  );
}

export function applyAiHeaders(headers: Headers, context: AiAccessContext): Headers {
  if (context.setDeviceCookie) headers.append('Set-Cookie', context.setDeviceCookie);
  return headers;
}

export function aiResponseHeaders(context: AiAccessContext): Headers {
  return applyAiHeaders(new Headers(), context);
}
