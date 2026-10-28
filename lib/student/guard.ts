import { redirect } from 'next/navigation';

import { requireUser } from '../auth/server';
import { studentAccessFor } from './onboarding';
import { studentStore, type StudentProfile } from './store';

export async function requireOnboardedStudent(
  returnTo: string,
): Promise<{ user: Awaited<ReturnType<typeof requireUser>>; profile: StudentProfile }> {
  const user = await requireUser(returnTo);
  const profile = await studentStore().getProfile(user.id);
  const access = studentAccessFor(user, profile, returnTo);
  if (access.kind === 'login') redirect(access.loginPath);
  if (access.kind === 'onboarding') redirect('/onboarding');
  return { user, profile: access.profile };
}
