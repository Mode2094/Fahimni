import { NextResponse, type NextRequest } from 'next/server';

import { userFromToken, SESSION_COOKIE } from '../../../lib/auth/request-user';
import { loginPathFor, requestOrigin } from '../../../lib/auth/urls';
import { sameOrigin } from '../../../lib/http';
import { completeOnboarding, parseOnboardingForm } from '../../../lib/student/onboarding';
import { studentStore } from '../../../lib/student/store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse('Forbidden', { status: 403 });

  const origin = requestOrigin(request);
  const user = await userFromToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.redirect(new URL(loginPathFor('/onboarding'), origin), 303);

  const input = parseOnboardingForm(await request.formData());
  const result = await completeOnboarding(studentStore(), user.id, input);
  if (!result.ok) return NextResponse.redirect(new URL(`/onboarding?error=${result.reason}`, origin), 303);

  return NextResponse.redirect(new URL('/app', origin), 303);
}
