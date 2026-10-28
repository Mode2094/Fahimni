import { redirect } from 'next/navigation';

import Classroom from '@/components/classroom/Classroom';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'السبورة (وضع التطوير)',
  robots: { index: false, follow: false },
};

// Development/test-only legacy classroom. Never public in production.
export default function LegacyTutorPage() {
  if (process.env.NODE_ENV === 'production') redirect('/');
  return <Classroom />;
}
