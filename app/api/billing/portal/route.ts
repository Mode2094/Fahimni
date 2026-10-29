import { loginPathFor, requestOrigin } from '../../../../lib/auth/urls';
import { sessionTokenFromRequest, userFromToken } from '../../../../lib/auth/request-user';
import { FreemiusConfigError, freemiusClient } from '../../../../lib/freemius/client';
import { sameOrigin } from '../../../../lib/http';
import { studentStore } from '../../../../lib/student/store';

export const dynamic = 'force-dynamic';

function redirectTo(target: URL | string, status = 303): Response {
  return new Response(null, { status, headers: { Location: String(target) } });
}

// Server-side generation of the Freemius Customer Portal link; no card UI is
// built here and no Freemius keys ever reach the browser.
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });

  const origin = requestOrigin(request);
  const user = await userFromToken(sessionTokenFromRequest(request));
  if (!user) return redirectTo(new URL(loginPathFor('/app/subscription'), origin));

  const profile = await studentStore().getProfile(user.id);
  if (!profile?.onboardingCompleted) return redirectTo(new URL('/onboarding', origin));

  try {
    const result = await (await freemiusClient()).api.user.retrieveHostedCustomerPortalByEmail(user.email);
    const link = result?.link;
    if (!link) return redirectTo(new URL('/app/subscription?error=portal', origin));
    return redirectTo(link);
  } catch (error) {
    if (!(error instanceof FreemiusConfigError)) console.error('[billing] portal link failed');
    return redirectTo(new URL('/app/subscription?error=portal', origin));
  }
}
