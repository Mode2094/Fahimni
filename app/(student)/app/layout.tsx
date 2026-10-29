import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';

import { FnButton, FnNavActions, FnNavBar } from '@/components/fahimni';
import { FahimniBrand } from '@/components/fahimni/logo';
import { StudentNavLinks, StudentTabBar } from '@/components/student/student-nav';
import { requireOnboardedStudent } from '@/lib/student/guard';
import { studentStore } from '@/lib/student/store';
import { whiteboardHrefFor } from '@/lib/student/tutor-link';

export const dynamic = 'force-dynamic';

export default async function StudentAppLayout({ children }: { children: ReactNode }) {
  const { profile } = await requireOnboardedStudent('/app');
  const subjects = await studentStore().listSubjectsForStudent(profile.gradeId, profile.academicFieldId);
  const whiteboardHref = whiteboardHrefFor(subjects);

  return (
    <div className="fn-root fn-page fn-page--tabbar">
      <FnNavBar>
        <FahimniBrand subtitle="مساحة للفهم" />
        <StudentNavLinks whiteboardHref={whiteboardHref} />
        <FnNavActions>
          <form action="/api/auth/logout" method="post">
            <FnButton type="submit" variant="ghost" size="sm">
              <LogOut size={16} aria-hidden="true" />
              تسجيل الخروج
            </FnButton>
          </form>
        </FnNavActions>
      </FnNavBar>
      <main className="fn-app-main">{children}</main>
      <StudentTabBar whiteboardHref={whiteboardHref} />
    </div>
  );
}
