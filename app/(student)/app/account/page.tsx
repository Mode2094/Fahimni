import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { GraduationCap, LogOut, Monitor, UserRound } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { FahimniMark } from '@/components/fahimni/logo';
import { authEnv } from '@/lib/auth/env';
import { formatBookDate } from '@/lib/books/messages';
import { deviceStore } from '@/lib/devices/store';
import { DEVICE_COOKIE, hashDeviceToken } from '@/lib/devices/token';
import { fieldNameFor } from '@/lib/student/onboarding';
import { requireOnboardedStudent } from '@/lib/student/guard';
import { studentStore } from '@/lib/student/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'حسابي',
  description: 'إدارة معلوماتك الشخصية وأجهزتك واشتراكك في منصة فهمني.',
};

// Display-only mapping derived from the stored device label; no data invented.
function deviceTypeLabel(name: string): string {
  return /iOS|Android/i.test(name) ? 'جهاز محمول' : 'كمبيوتر';
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { user, profile } = await requireOnboardedStudent('/app/account');
  const store = studentStore();
  const devices = deviceStore();
  const [grade, fields, deviceList, maxDevices, params] = await Promise.all([
    store.findGradeById(profile.gradeId),
    store.listActiveFieldsForGrade(profile.gradeId),
    devices.listDevices(user.id),
    devices.getMaxDevices(),
    searchParams,
  ]);
  const fieldName = fieldNameFor(fields, profile.academicFieldId);
  const displayName = user.name?.trim() || 'طالب فهمني';
  const initial = displayName.charAt(0) || user.email.charAt(0);

  let currentHash: string | null = null;
  try {
    const token = (await cookies()).get(DEVICE_COOKIE)?.value;
    if (token) currentHash = await hashDeviceToken(token, authEnv().authSecret);
  } catch {
    currentHash = null;
  }

  const activeDevices = deviceList.filter((device) => !device.revokedAt);
  const message =
    params.status === 'device_removed'
      ? { type: 'success' as const, text: 'تمت إزالة الجهاز.' }
      : params.error === 'device'
        ? { type: 'error' as const, text: 'تعذر إزالة الجهاز. حاول مرة أخرى.' }
        : null;

  return (
    <div className="fn-container fn-stack fn-stack--lg">
      <header className="account-hero">
        <div className="fn-stack fn-stack--sm">
          <h1 className="fn-display fn-display--xl">حسابي</h1>
          <p className="fn-subtitle">إدارة معلوماتك الشخصية وأجهزتك واشتراكك في منصة فهمني.</p>
        </div>
        <span className="account-hero__art" aria-hidden="true">
          <FahimniMark size={64} />
        </span>
      </header>

      <div className="fn-grid fn-grid--3">
        <FnCard variant="flat" className="dash-stat">
          <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--gold">
            <GraduationCap size={18} aria-hidden="true" />
          </span>
          <span className="dash-stat__body">
            <span className="fn-caption">المرحلة الدراسية</span>
            <span className="dash-stat__value">{grade?.name ?? '—'}</span>
          </span>
        </FnCard>
        <FnCard variant="flat" className="dash-stat">
          <span className="fn-icon-tile fn-icon-tile--sm">
            <UserRound size={18} aria-hidden="true" />
          </span>
          <span className="dash-stat__body">
            <span className="fn-caption">نوع الحساب</span>
            <span className="dash-stat__value">{user.role === 'ADMIN' ? 'مشرف' : 'طالب'}</span>
          </span>
        </FnCard>
        <FnCard variant="flat" className="dash-stat">
          <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--sky">
            <Monitor size={18} aria-hidden="true" />
          </span>
          <span className="dash-stat__body">
            <span className="fn-caption">الأجهزة المسجلة</span>
            <span className="dash-stat__value">
              {activeDevices.length} من {maxDevices}
            </span>
          </span>
        </FnCard>
      </div>

      <div className="account-grid">
        <FnCard className="fn-stack">
          <div className="fn-row">
            <div className="fn-avatar">
              {user.image ? <img src={user.image} alt="" /> : <span>{initial}</span>}
            </div>
            <div className="fn-stack fn-stack--sm">
              <span className="fn-card__title">{displayName}</span>
              <span className="fn-caption" dir="ltr">
                {user.email}
              </span>
              <span className="fn-row fn-row--wrap">
                <FnBadge variant={user.role === 'ADMIN' ? 'gold' : 'primary'}>
                  {user.role === 'ADMIN' ? 'مشرف' : 'طالب'}
                </FnBadge>
                {grade ? (
                  <FnBadge variant="outline">
                    {grade.name}
                    {fieldName ? ` · ${fieldName}` : ''}
                  </FnBadge>
                ) : null}
              </span>
            </div>
          </div>

          <dl className="account-info">
            <div>
              <dt>الاسم</dt>
              <dd>{displayName}</dd>
            </div>
            <div>
              <dt>البريد الإلكتروني</dt>
              <dd dir="ltr">{user.email}</dd>
            </div>
            <div>
              <dt>المرحلة الدراسية</dt>
              <dd>{grade?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>المسار الأكاديمي</dt>
              <dd>{fieldName ?? '—'}</dd>
            </div>
            <div>
              <dt>نوع الحساب</dt>
              <dd>{user.role === 'ADMIN' ? 'مشرف' : 'طالب'}</dd>
            </div>
          </dl>

          <form action="/api/auth/logout" method="post">
            <FnButton type="submit" variant="soft" block>
              <LogOut size={17} aria-hidden="true" />
              تسجيل الخروج
            </FnButton>
          </form>
        </FnCard>

        <FnCard className="fn-stack">
          <div className="fn-card__head">
            <div>
              <h2 className="fn-card__title">أجهزتي</h2>
              <p className="fn-card__text">
                يمكنك استخدام فهمني على عدد محدود من الأجهزة. أزل جهازًا قديمًا لإضافة جهاز جديد.
              </p>
            </div>
            <FnBadge variant="outline">
              {activeDevices.length} من {maxDevices}
            </FnBadge>
          </div>

          {message ? (
            <p className={`fn-alert ${message.type === 'success' ? 'fn-alert--success' : 'fn-alert--error'}`} role="status">
              {message.text}
            </p>
          ) : null}

          {activeDevices.length > 0 ? (
            <div className="fn-stack">
              {activeDevices.map((device) => {
                const isCurrent = currentHash !== null && device.deviceTokenHash === currentHash;
                return (
                  <div key={device.id} className="device-row fn-row fn-row--wrap">
                    <span className="fn-icon-tile fn-icon-tile--sm">
                      <Monitor size={18} aria-hidden="true" />
                    </span>
                    <span className="fn-grow fn-stack fn-stack--sm">
                      <span className="fn-choice__title">{device.name}</span>
                      <span className="fn-row fn-row--wrap">
                        <FnBadge variant="outline">{deviceTypeLabel(device.name)}</FnBadge>
                        <span className="fn-caption">آخر نشاط: {formatBookDate(device.lastSeenAt)}</span>
                      </span>
                    </span>
                    {isCurrent ? <FnBadge variant="primary">هذا الجهاز</FnBadge> : null}
                    <form action={`/api/devices/${device.id}/revoke`} method="post">
                      <FnButton type="submit" variant="danger" size="sm">
                        إزالة
                      </FnButton>
                    </form>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="devices-empty">
              <span className="fn-icon-tile fn-icon-tile--sky fn-icon-tile--lg">
                <Monitor size={26} aria-hidden="true" />
              </span>
              <p className="fn-empty__title">لا توجد أجهزة مسجّلة بعد</p>
              <p className="fn-empty__text">يُسجَّل جهازك تلقائيًا عند أول استخدام للمعلّم الذكي.</p>
            </div>
          )}
        </FnCard>
      </div>
    </div>
  );
}
