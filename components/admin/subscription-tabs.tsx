import Link from 'next/link';
import { CalendarRange, Coins, CreditCard, Gauge, Receipt, ShieldCheck, TrendingUp, Users } from 'lucide-react';

import { cn } from '@/lib/utils';

export const SUBSCRIPTION_SECTIONS = [
  { id: 'semesters', label: 'الفصول الدراسية', icon: CalendarRange },
  { id: 'subscribers', label: 'الاشتراكات', icon: Users },
  { id: 'credits', label: 'الكريدت والشحن', icon: Coins },
  { id: 'payments', label: 'المدفوعات', icon: Receipt },
  { id: 'reports', label: 'التقارير المالية', icon: TrendingUp },
  { id: 'consumption', label: 'إعدادات الاستهلاك', icon: Gauge },
  { id: 'offers', label: 'الباقات القديمة', icon: CreditCard },
  { id: 'freemius', label: 'حالة الربط مع فريميوس', icon: ShieldCheck },
] as const;

export type SubscriptionSectionId = (typeof SUBSCRIPTION_SECTIONS)[number]['id'];

export function normalizeSubscriptionSection(value: string | undefined): SubscriptionSectionId {
  const match = SUBSCRIPTION_SECTIONS.find((section) => section.id === value);
  return match ? match.id : 'semesters';
}

export function SubscriptionTabs({ active }: { active: SubscriptionSectionId }) {
  return (
    <nav className="fn-admin-tabs" aria-label="أقسام الاشتراكات">
      {SUBSCRIPTION_SECTIONS.map((section) => {
        const Icon = section.icon;
        const isActive = section.id === active;
        return (
          <Link
            key={section.id}
            href={`/admin/subscriptions?section=${section.id}`}
            className={cn('fn-admin-tabs__item', isActive && 'is-active')}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
