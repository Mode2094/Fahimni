import Link from 'next/link';

import { FnButton, FnCard } from '@/components/fahimni';
import { FahimniMark } from '@/components/fahimni/logo';

export default function NotFound() {
  return (
    <div className="fn-root fn-page">
      <main className="fn-page__main">
        <div className="fn-container">
          <FnCard variant="flat" className="fn-center fn-card--centered">
            <FahimniMark size={64} />
            <p className="fn-empty__title">الصفحة غير موجودة</p>
            <p className="fn-empty__text">ربما تغيّر الرابط أو لم تعد الصفحة متاحة.</p>
            <FnButton asChild>
              <Link href="/">العودة للرئيسية</Link>
            </FnButton>
          </FnCard>
        </div>
      </main>
    </div>
  );
}
