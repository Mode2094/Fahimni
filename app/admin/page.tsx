import type { Metadata } from 'next';
import { BookOpen, CheckCircle2, GraduationCap, Users } from 'lucide-react';

import { FnCard } from '@/components/fahimni';
import { AdminPageHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/admin/guard';
import { adminStore } from '@/lib/admin/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'نظرة عامة',
};

export default async function AdminHomePage() {
  await requireAdmin('/admin');
  const store = adminStore();
  const [students, grades, subjects] = await Promise.all([
    store.countStudents(),
    store.countGrades(),
    store.countSubjects(),
  ]);

  const cards = [
    { label: 'عدد الطلاب', value: students, tile: 'fn-icon-tile', icon: <Users size={22} aria-hidden="true" /> },
    { label: 'عدد الصفوف', value: grades, tile: 'fn-icon-tile fn-icon-tile--sky', icon: <GraduationCap size={22} aria-hidden="true" /> },
    { label: 'عدد المواد', value: subjects.total, tile: 'fn-icon-tile fn-icon-tile--pink', icon: <BookOpen size={22} aria-hidden="true" /> },
    { label: 'المواد النشطة', value: subjects.active, tile: 'fn-icon-tile fn-icon-tile--mint', icon: <CheckCircle2 size={22} aria-hidden="true" /> },
  ];

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader title="نظرة عامة" description="أرقام سريعة عن منصة فهمني." />
      <div className="fn-grid fn-grid--4">
        {cards.map((card) => (
          <FnCard key={card.label}>
            <span className={card.tile}>{card.icon}</span>
            <span className="fn-display fn-display--xl">{card.value}</span>
            <span className="fn-card__text">{card.label}</span>
          </FnCard>
        ))}
      </div>
    </div>
  );
}
