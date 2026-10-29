export const TURNSTILE_ACTION = 'claim_trial';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileMode = 'verify' | 'dev_skip' | 'config_error';

// Production trial activation fails closed when Turnstile is not configured.
// Development/test without keys uses an explicit local skip (never in prod).
export function turnstileMode(env: NodeJS.ProcessEnv = process.env): TurnstileMode {
  const configured = Boolean(env.TURNSTILE_SECRET_KEY?.trim());
  if (configured) return 'verify';
  return env.NODE_ENV === 'production' ? 'config_error' : 'dev_skip';
}

export type TurnstileVerification =
  | { ok: true }
  | { ok: false; reason: 'missing_token' | 'rejected' | 'config' | 'network' };

export type TurnstileVerifier = (input: {
  token: string;
  remoteIp: string | null;
  expectedAction: string;
  expectedHostname: string | null;
}) => Promise<TurnstileVerification>;

type SiteverifyResponse = {
  success?: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
};

// Server-side Siteverify: signature-free challenge check with action/hostname
// assertions. Cloudflare tokens are single-use, which covers replay.
export function createCloudflareTurnstileVerifier(secret: string, fetchImpl: typeof fetch = fetch): TurnstileVerifier {
  return async ({ token, remoteIp, expectedAction, expectedHostname }) => {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    let payload: SiteverifyResponse;
    try {
      const response = await fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      payload = (await response.json()) as SiteverifyResponse;
    } catch {
      return { ok: false, reason: 'network' };
    }
    if (payload.success !== true) return { ok: false, reason: 'rejected' };
    if (payload.action && payload.action !== expectedAction) return { ok: false, reason: 'rejected' };
    if (expectedHostname && payload.hostname && payload.hostname !== expectedHostname) {
      return { ok: false, reason: 'rejected' };
    }
    return { ok: true };
  };
}

let verifierOverride: TurnstileVerifier | null = null;

export function setTurnstileVerifierForTests(verifier: TurnstileVerifier | null): void {
  verifierOverride = verifier;
}

// Used by the claim route. Only the mode decides fail-open/fail-closed; the
// verifier itself always checks the Cloudflare response server-side.
export async function verifyTrialChallenge(
  token: string,
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TurnstileVerification> {
  const mode = turnstileMode(env);
  if (mode === 'config_error') return { ok: false, reason: 'config' };
  if (mode === 'dev_skip') return { ok: true };
  if (!token.trim()) return { ok: false, reason: 'missing_token' };

  const verifier = verifierOverride ?? createCloudflareTurnstileVerifier(env.TURNSTILE_SECRET_KEY?.trim() as string);
  const remoteIp = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  return verifier({
    token,
    remoteIp,
    expectedAction: TURNSTILE_ACTION,
    expectedHostname: env.TURNSTILE_EXPECTED_HOSTNAME?.trim() || null,
  });
}
