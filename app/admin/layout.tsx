import type { ReactNode } from 'react';
import Link from 'next/link';
import { LogOut } from 'lucide-react';

import { FnButton, FahimniBrand } from '@/components/fahimni';
import { AdminShell } from '@/components/admin/admin-shell';
import { requireAdmin } from '@/lib/admin/guard';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin('/admin');

  return (
    <div className="fn-root fn-page">
      <AdminShell
        brand={<FahimniBrand subtitle="لوحة الإدارة" />}
        actions={
          <>
            <FnButton asChild variant="ghost" size="sm">
              <Link href="/app">مساحة الطالب</Link>
            </FnButton>
            <form action="/api/auth/logout" method="post">
              <FnButton type="submit" variant="ghost" size="sm">
                <LogOut size={16} aria-hidden="true" />
                خروج
              </FnButton>
            </form>
          </>
        }
      >
        {children}
      </AdminShell>
    </div>
  );
}
