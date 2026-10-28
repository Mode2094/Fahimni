import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { BrainCircuit, CreditCard, Gift, Globe, MessageCircle, MonitorSmartphone, ShieldCheck, Wallet } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { AdminMessage, AdminPageHeader } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/lib/admin/guard';
import { messageFromQuery } from '@/lib/admin/messages';
import { aiBudgetStatus } from '@/lib/ai/budget-status';
import { aiRuntimeConfig } from '@/lib/ai/runtime-config';
import { resolveWhatsAppHref } from '@/lib/contact/whatsapp';
import { MAX_DEVICES_LIMIT, deviceStore } from '@/lib/devices/store';
import { freemiusCredentials } from '@/lib/freemius/credentials';
import { encryptionConfigured } from '@/lib/settings/crypto';
import { SECRET_KEYS, SETTING_KEYS } from '@/lib/settings/keys';
import { getPlainSetting, getSecretPresence } from '@/lib/settings/service';
import { latestWebhookEvent } from '@/lib/settings/webhook-status';
import { TRIAL_LIMITS, microUsdToUsd } from '@/lib/trial/config';
import { trialStore } from '@/lib/trial/store';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'الإعدادات',
};

function SectionHead({ icon, tile, title, description }: { icon: ReactNode; tile: string; title: string; description: string }) {
  return (
    <div className="fn-row">
      <span className={`fn-icon-tile fn-icon-tile--sm ${tile}`}>{icon}</span>
      <div className="fn-stack fn-stack--sm">
        <h2 className="fn-card__title">{title}</h2>
        <p className="fn-card__text">{description}</p>
      </div>
    </div>
  );
}

function Presence({ label, present, source }: { label: string; present: boolean; source?: string | null }) {
  return (
    <div className="fn-row fn-row--wrap">
      <FnBadge variant={present ? 'mint' : 'outline'}>{present ? 'مضبوط' : 'غير مضبوط'}</FnBadge>
      <span className="fn-caption">
        {label}
        {present && source ? ` — ${source}` : ''}
      </span>
    </div>
  );
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  await requireAdmin('/admin/settings');
  const params = await searchParams;
  const message = messageFromQuery(params.status, params.error);

  const [maxDevices, trialSettings, trialMetrics] = await Promise.all([
    deviceStore().getMaxDevices(),
    trialStore().getSettings(),
    trialStore().metrics(),
  ]);

  const [
    platformName,
    whatsappRaw,
    storedModel,
    storedBudget,
    aiLastAt,
    aiLastOk,
    freemiusProductIdStored,
    freemiusDeveloperIdStored,
    syncEnabledRaw,
    lastVerifiedAt,
    lastVerifiedSummaryRaw,
  ] = await Promise.all([
    getPlainSetting(SETTING_KEYS.platformName),
    getPlainSetting(SETTING_KEYS.whatsappNumber),
    getPlainSetting(SETTING_KEYS.aiTutorModel),
    getPlainSetting(SETTING_KEYS.aiDailyBudgetUsd),
    getPlainSetting(SETTING_KEYS.aiLastTestAt),
    getPlainSetting(SETTING_KEYS.aiLastTestOk),
    getPlainSetting(SETTING_KEYS.freemiusProductId),
    getPlainSetting(SETTING_KEYS.freemiusDeveloperId),
    getPlainSetting(SETTING_KEYS.freemiusSyncEnabled),
    getPlainSetting(SETTING_KEYS.freemiusLastVerifiedAt),
    getPlainSetting(SETTING_KEYS.freemiusLastVerifiedSummary),
  ]);

  const [
    aiKeyStored,
    freemiusApiKeyStored,
    freemiusSecretKeyStored,
    freemiusPublicKeyStored,
    freemiusDeveloperSecretStored,
    credentials,
    aiConfig,
    whatsappHref,
    webhookEvent,
  ] = await Promise.all([
    getSecretPresence(SECRET_KEYS.openaiApiKey),
    getSecretPresence(SECRET_KEYS.freemiusApiKey),
    getSecretPresence(SECRET_KEYS.freemiusSecretKey),
    getSecretPresence(SECRET_KEYS.freemiusPublicKey),
    getSecretPresence(SECRET_KEYS.freemiusDeveloperSecret),
    freemiusCredentials(),
    aiRuntimeConfig(),
    resolveWhatsAppHref(),
    latestWebhookEvent(),
  ]);

  const encryptionReady = encryptionConfigured();
  const budget = await aiBudgetStatus().catch(() => null);
  const aiKeyFromEnv = Boolean(process.env.OPENAI_API_KEY?.trim());
  const aiKeyActive = Boolean(aiConfig.apiKey);
  const syncEnabled = syncEnabledRaw === 'true';
  const lastVerified = (() => {
    if (!lastVerifiedAt) return null;
    try {
      return JSON.parse(lastVerifiedSummaryRaw ?? '{}') as {
        ok?: boolean;
        productId?: string | null;
        productTitle?: string | null;
        planCount?: number;
        developerConfigured?: boolean;
      };
    } catch {
      return null;
    }
  })();

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader title="الإعدادات" description="كل ما يحتاجه التشغيل اليومي: الهوية العامة، الذكاء الاصطناعي، التجربة، الأجهزة، وفريميوس." />
      <AdminMessage message={message} />

      {!encryptionReady ? (
        <p className="fn-alert fn-alert--error" role="alert">
          مفتاح تشفير الخادم (SETTINGS_ENCRYPTION_KEY) غير مهيأ — لا يمكن حفظ مفاتيح حساسة بأمان حتى يُضبط في بيئة الخادم.
        </p>
      ) : null}

      {/* A. General */}
      <FnCard variant="flat" className="fn-stack" id="general">
        <SectionHead
          icon={<Globe size={18} aria-hidden="true" />}
          tile="fn-icon-tile--sky"
          title="عام"
          description="اسم المنصة الظاهر في العناوين ومعلومات التواصل العامة."
        />
        <form action="/api/admin/settings/general" method="post" className="fn-stack">
          <input type="hidden" name="intent" value="platform-name" />
          <div className="fn-field">
            <label className="fn-field__label" htmlFor="platformName">
              اسم المنصة
            </label>
            <input className="fn-input" id="platformName" name="platformName" maxLength={40} defaultValue={platformName ?? 'فهمني'} />
            <p className="fn-field__hint">يظهر في عنوان المتصفح والمشاركات. الشعار المرسوم يبقى ثابتًا.</p>
          </div>
          <div className="fn-row">
            <FnButton type="submit" size="sm">
              حفظ الاسم
            </FnButton>
          </div>
        </form>
      </FnCard>

      <FnCard variant="flat" className="fn-stack" id="whatsapp">
        <SectionHead
          icon={<MessageCircle size={18} aria-hidden="true" />}
          tile="fn-icon-tile--mint"
          title="الدعم عبر واتساب"
          description="رقم الدعم الذي يظهر للطلاب في صفحة التواصل. يُحدَّث فورًا بدون إعادة تشغيل."
        />
        <div className="fn-row fn-row--wrap">
          <FnBadge variant={whatsappHref ? 'mint' : 'outline'}>{whatsappHref ? 'مفعّل' : 'معطّل'}</FnBadge>
          {whatsappRaw ? (
            <span className="fn-price" dir="ltr">
              {whatsappRaw}
            </span>
          ) : null}
        </div>
        <form action="/api/admin/settings/general" method="post" className="fn-stack">
          <div className="fn-field">
            <label className="fn-field__label" htmlFor="whatsappNumber">
              رقم واتساب بالصيغة الدولية
            </label>
            <input className="fn-input" id="whatsappNumber" name="whatsappNumber" dir="ltr" inputMode="tel" placeholder="9627XXXXXXXX" />
            <p className="fn-field__hint">يُقبل الرقم مع + أو 00 أو مسافات، ويُخزَّن بصيغة دولية نظيفة.</p>
          </div>
          <div className="fn-row">
            <FnButton type="submit" name="intent" value="whatsapp-save" size="sm">
              حفظ الرقم
            </FnButton>
            {whatsappHref ? (
              <FnButton type="submit" name="intent" value="whatsapp-disable" variant="soft" size="sm">
                تعطيل واتساب
              </FnButton>
            ) : null}
            {whatsappHref ? (
              <FnButton asChild variant="ghost" size="sm">
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                  معاينة رابط التواصل
                </a>
              </FnButton>
            ) : null}
          </div>
        </form>
      </FnCard>

      {/* B. AI provider */}
      <FnCard variant="flat" className="fn-stack" id="ai">
        <SectionHead
          icon={<BrainCircuit size={18} aria-hidden="true" />}
          tile="fn-icon-tile--gold"
          title="مزود الذكاء الاصطناعي"
          description="مفتاح OpenAI ونموذج الشرح وحد الإنفاق اليومي. تُستخدم القيم فورًا بدون إعادة تشغيل."
        />
        <div className="fn-row fn-row--wrap">
          <FnBadge variant={aiKeyActive ? 'mint' : 'outline'}>{aiKeyActive ? 'المزود مهيأ' : 'غير مهيأ'}</FnBadge>
          <Presence label="مفتاح مخزّن في قاعدة البيانات (مشفّر)" present={aiKeyStored} />
          <Presence label="مفتاح من بيئة الخادم" present={aiKeyFromEnv} />
        </div>
        {aiLastAt ? (
          <p className="fn-caption">
            آخر اختبار: {new Date(aiLastAt).toLocaleString('ar-JO')} — {aiLastOk === 'true' ? 'نجح' : 'فشل'}
          </p>
        ) : null}
        <form action="/api/admin/settings/ai" method="post" className="fn-stack">
          <input type="hidden" name="intent" value="save" />
          <div className="fn-grid fn-grid--2">
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="aiApiKey">
                مفتاح OpenAI الجديد (اختياري)
              </label>
              <input className="fn-input" id="aiApiKey" name="apiKey" type="password" dir="ltr" autoComplete="new-password" placeholder="sk-…" />
              <p className="fn-field__hint">يُختبَر لدى OpenAI قبل الحفظ. عند الفشل يبقى المفتاح الحالي كما هو.</p>
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="aiTutorModel">
                نموذج الشرح
              </label>
              <input className="fn-input" id="aiTutorModel" name="tutorModel" dir="ltr" defaultValue={storedModel ?? ''} placeholder={process.env.OPENAI_TUTOR_MODEL ?? 'gpt-4.1-mini'} />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="aiDailyBudget">
                حد الإنفاق اليومي (دولار) — 0 بلا حد
              </label>
              <input className="fn-input" id="aiDailyBudget" name="dailyBudgetUsd" type="number" min={0} max={100000} step="0.5" dir="ltr" defaultValue={storedBudget ?? '0'} />
              <p className="fn-field__hint">يشمل كل طلبات الذكاء الاصطناعي (مدفوعة وتجريبية). عند بلوغ الحد تتوقف الطلبات مؤقتًا.</p>
            </div>
          </div>
          <div className="fn-row">
            <FnButton type="submit" size="sm">
              حفظ إعدادات الذكاء الاصطناعي
            </FnButton>
          </div>
        </form>
        <div className="fn-row">
          <form action="/api/admin/settings/ai" method="post">
            <input type="hidden" name="intent" value="test-key" />
            <FnButton type="submit" variant="soft" size="sm">
              اختبار الاتصال
            </FnButton>
          </form>
          {aiKeyStored ? (
            <form action="/api/admin/settings/ai" method="post">
              <input type="hidden" name="intent" value="clear-key" />
              <FnButton type="submit" variant="ghost" size="sm">
                حذف المفتاح المخزّن
              </FnButton>
            </form>
          ) : null}
        </div>
      </FnCard>

      {/* B2. Daily AI budget status (read-only) */}
      {budget ? (
        <FnCard variant="flat" className="fn-stack" id="budget">
          <SectionHead
            icon={<Wallet size={18} aria-hidden="true" />}
            tile="fn-icon-tile--gold"
            title="استهلاك الذكاء اليوم"
            description="عداد يومي بتوقيت الأردن (يُصفَّر منتصف ليل عمّان)، يشمل الطلبات المدفوعة والتجريبية."
          />
          <div className="fn-grid fn-grid--2">
            <div className="dash-stat__body">
              <span className="fn-caption">الإنفاق العام اليوم</span>
              <span className="dash-stat__value">${budget.global.spentUsd.toFixed(2)}</span>
              <span className="fn-caption">{budget.global.limitUsd > 0 ? `الحد اليومي: $${budget.global.limitUsd}` : 'بلا حد (0)'}</span>
            </div>
            <div className="dash-stat__body">
              <span className="fn-caption">إنفاق التجربة المجانية اليوم</span>
              <span className="dash-stat__value">${budget.trial.spentUsd.toFixed(2)}</span>
              <span className="fn-caption">{budget.trial.limitUsd > 0 ? `حد التجربة: $${budget.trial.limitUsd}` : 'بلا حد (0)'}</span>
            </div>
          </div>
          <p className="fn-caption">
            إعادة الضبط: {new Date(budget.resetsAt).toLocaleString('ar-JO')} · المصدر:{' '}
            {budget.source === 'redis' ? 'Redis (يصمد أمام إعادة التشغيل)' : 'ذاكرة التطوير (تُصفَّر مع إعادة تشغيل الخادم — للإنتاج يُشترط Redis)'}
          </p>
          <p className="fn-caption">الأرقام تقديرات محافظة تُحجز قبل كل طلب؛ قد تختلف قليلًا عن فاتورة المزوّد الفعلية.</p>
        </FnCard>
      ) : null}

      {/* C. Free trial */}
      <FnCard variant="flat" className="fn-stack" id="trial">
        <SectionHead
          icon={<Gift size={18} aria-hidden="true" />}
          tile="fn-icon-tile--pink"
          title="التجربة المجانية"
          description="تُطبَّق الإعدادات على الطلبات الجديدة فقط. تغيير الأرصدة هنا لا يعدّل تجارب الطلاب القائمة."
        />
        <form action="/api/admin/trial/settings" method="post" className="fn-stack">
          <label className="fn-check">
            <input type="checkbox" name="trialEnabled" defaultChecked={trialSettings.enabled} />
            تفعيل التجربة المجانية
          </label>
          <div className="fn-grid fn-grid--3">
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="trialCredits">
                رصيد التجربة (كريدت)
              </label>
              <input className="fn-input" id="trialCredits" name="creditAllowance" type="number" min={1} max={TRIAL_LIMITS.maxCreditAllowance} dir="ltr" defaultValue={trialSettings.creditAllowance} />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="trialHours">
                المدة (ساعة)
              </label>
              <input className="fn-input" id="trialHours" name="durationHours" type="number" min={TRIAL_LIMITS.minDurationHours} max={TRIAL_LIMITS.maxDurationHours} dir="ltr" defaultValue={trialSettings.durationHours} />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="trialBudget">
                ميزانية التجربة اليومية (دولار)
              </label>
              <input className="fn-input" id="trialBudget" name="dailyBudgetUsd" type="number" min={0} max={TRIAL_LIMITS.maxDailyBudgetUsd} step="0.5" dir="ltr" defaultValue={trialSettings.dailyBudgetUsd} />
            </div>
          </div>
          <div className="fn-row">
            <FnButton type="submit" size="sm">
              حفظ إعدادات التجربة
            </FnButton>
          </div>
        </form>
        <div className="fn-grid fn-grid--3">
          <div className="dash-stat__body">
            <span className="fn-caption">تجارب مطلوبة</span>
            <span className="dash-stat__value">{trialMetrics.claimed}</span>
          </div>
          <div className="dash-stat__body">
            <span className="fn-caption">تجارب بدأت</span>
            <span className="dash-stat__value">{trialMetrics.started}</span>
          </div>
          <div className="dash-stat__body">
            <span className="fn-caption">منتهية</span>
            <span className="dash-stat__value">{trialMetrics.expired}</span>
          </div>
          <div className="dash-stat__body">
            <span className="fn-caption">نفد رصيدها</span>
            <span className="dash-stat__value">{trialMetrics.exhausted}</span>
          </div>
          <div className="dash-stat__body">
            <span className="fn-caption">كريدت مستهلك</span>
            <span className="dash-stat__value">{trialMetrics.creditsConsumed}</span>
          </div>
          <div className="dash-stat__body">
            <span className="fn-caption">تكلفة تقديرية</span>
            <span className="dash-stat__value">${microUsdToUsd(trialMetrics.estimatedCostMicroUsd).toFixed(2)}</span>
          </div>
        </div>
      </FnCard>

      {/* D. Devices */}
      <FnCard variant="flat" className="fn-stack" id="devices">
        <SectionHead
          icon={<MonitorSmartphone size={18} aria-hidden="true" />}
          tile="fn-icon-tile--sky"
          title="الأجهزة"
          description="الحد الأقصى لعدد الأجهزة النشطة لكل حساب طالب."
        />
        <form action="/api/admin/settings" method="post" className="fn-stack">
          <div className="fn-field">
            <label className="fn-field__label" htmlFor="maxDevices">
              عدد الأجهزة المسموح بها
            </label>
            <input className="fn-input" id="maxDevices" name="maxDevices" type="number" min={1} max={MAX_DEVICES_LIMIT} defaultValue={maxDevices} />
          </div>
          <div className="fn-row">
            <FnButton type="submit" size="sm">
              حفظ
            </FnButton>
          </div>
        </form>
      </FnCard>

      {/* E. Freemius */}
      <FnCard variant="flat" className="fn-stack" id="freemius">
        <SectionHead
          icon={<ShieldCheck size={18} aria-hidden="true" />}
          tile="fn-icon-tile--mint"
          title="فريميوس"
          description="بوابة الدفع الوحيدة. المفاتيح تُشفَّر عند الحفظ ولا تُعرض مرة أخرى أبدًا."
        />
        <div className="fn-row fn-row--wrap">
          <FnBadge variant={credentials.productId && credentials.apiKey && credentials.secretKey && credentials.publicKey ? 'mint' : 'outline'}>
            {credentials.productId && credentials.apiKey && credentials.secretKey && credentials.publicKey ? 'الربط مكتمل' : 'الربط غير مكتمل'}
          </FnBadge>
          {lastVerified?.productId ? (
            <span className="fn-caption">
              المنتج: {lastVerified.productTitle ?? lastVerified.productId} · {lastVerified.planCount ?? 0} خطة
            </span>
          ) : null}
          {lastVerifiedAt ? <span className="fn-caption">آخر تحقق: {new Date(lastVerifiedAt).toLocaleString('ar-JO')}</span> : null}
        </div>
        <div className="fn-grid fn-grid--2">
          <Presence label="معرّف المنتج" present={Boolean(credentials.productId)} source={freemiusProductIdStored ? 'قاعدة البيانات' : credentials.productId ? 'بيئة الخادم' : null} />
          <Presence label="مفتاح API" present={Boolean(credentials.apiKey)} source={freemiusApiKeyStored ? 'قاعدة البيانات' : credentials.apiKey ? 'بيئة الخادم' : null} />
          <Presence label="المفتاح السري" present={Boolean(credentials.secretKey)} source={freemiusSecretKeyStored ? 'قاعدة البيانات' : credentials.secretKey ? 'بيئة الخادم' : null} />
          <Presence label="المفتاح العام" present={Boolean(credentials.publicKey)} source={freemiusPublicKeyStored ? 'قاعدة البيانات' : credentials.publicKey ? 'بيئة الخادم' : null} />
          <Presence label="معرّف المطوّر (اختياري للأتمتة)" present={Boolean(credentials.developerId)} source={freemiusDeveloperIdStored ? 'قاعدة البيانات' : credentials.developerId ? 'بيئة الخادم' : null} />
          <Presence label="المفتاح السري للمطوّر (اختياري للأتمتة)" present={Boolean(credentials.developerSecret)} source={freemiusDeveloperSecretStored ? 'قاعدة البيانات' : credentials.developerSecret ? 'بيئة الخادم' : null} />
        </div>
        <form action="/api/admin/settings/freemius" method="post" className="fn-stack">
          <input type="hidden" name="intent" value="save" />
          <div className="fn-grid fn-grid--2">
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="freemiusProductId">
                معرّف المنتج
              </label>
              <input className="fn-input" id="freemiusProductId" name="productId" dir="ltr" inputMode="numeric" placeholder={freemiusProductIdStored ?? '1234'} />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="freemiusApiKey">
                مفتاح API
              </label>
              <input className="fn-input" id="freemiusApiKey" name="apiKey" type="password" dir="ltr" autoComplete="new-password" placeholder="••••••••" />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="freemiusSecretKey">
                المفتاح السري
              </label>
              <input className="fn-input" id="freemiusSecretKey" name="secretKey" type="password" dir="ltr" autoComplete="new-password" placeholder="••••••••" />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="freemiusPublicKey">
                المفتاح العام
              </label>
              <input className="fn-input" id="freemiusPublicKey" name="publicKey" type="password" dir="ltr" autoComplete="new-password" placeholder="••••••••" />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="freemiusDeveloperId">
                معرّف المطوّر (للأتمتة)
              </label>
              <input className="fn-input" id="freemiusDeveloperId" name="developerId" dir="ltr" inputMode="numeric" placeholder={freemiusDeveloperIdStored ?? 'اختياري'} />
            </div>
            <div className="fn-field">
              <label className="fn-field__label" htmlFor="freemiusDeveloperSecret">
                المفتاح السري للمطوّر (للأتمتة)
              </label>
              <input className="fn-input" id="freemiusDeveloperSecret" name="developerSecret" type="password" dir="ltr" autoComplete="new-password" placeholder="اختياري" />
            </div>
          </div>
          <p className="fn-field__hint">
            الحقول الفارغة لا تُغيّر القيم الحالية. تُدار الخطط والأسعار من لوحة فريميوس؛ التحقق هنا للقراءة فقط.
          </p>
          <div className="fn-row">
            <FnButton type="submit" size="sm">
              حفظ بيانات الربط
            </FnButton>
          </div>
        </form>
        <div className="fn-row">
          <form action="/api/admin/settings/freemius" method="post">
            <input type="hidden" name="intent" value="test" />
            <FnButton type="submit" variant="soft" size="sm">
              اختبار الاتصال
            </FnButton>
          </form>
          <FnButton asChild variant="ghost" size="sm">
            <Link href="/admin/subscriptions?section=freemius">حالة العروض والربط</Link>
          </FnButton>
        </div>
        <form action="/api/admin/settings/freemius" method="post" className="fn-stack">
          <input type="hidden" name="intent" value="toggle-sync" />
          <label className="fn-check">
            <input type="checkbox" name="syncEnabled" defaultChecked={syncEnabled} />
            تمكين المزامنة الحية (لا تُنشئ خططًا إلا بصلاحيات مطوّر)
          </label>
          <div className="fn-row">
            <FnButton type="submit" variant="soft" size="sm">
              حفظ حالة المزامنة
            </FnButton>
          </div>
        </form>
        <p className="fn-caption">
          آخر ويبهوك: {webhookEvent ? `${webhookEvent.type} · ${new Date(webhookEvent.createdAt).toLocaleString('ar-JO')}` : 'لا توجد أحداث مسجلة بعد'}
        </p>
        {lastVerified && !lastVerified.ok ? (
          <p className="fn-alert fn-alert--error" role="status">
            آخر اختبار اتصال لم ينجح — راجع المفاتيح ثم أعد الاختبار.
          </p>
        ) : null}
      </FnCard>

      <FnCard variant="flat" className="fn-stack">
        <SectionHead
          icon={<CreditCard size={18} aria-hidden="true" />}
          tile="fn-icon-tile--pink"
          title="جاهزية الدفع"
          description="لا يصل الطالب إلى الدفع إلا لعرض تم التحقق من خطته وتسعيره وعملته ودورته لدى فريميوس."
        />
        <p className="fn-caption">
          راجع حالة كل عرض في قسم «الباقات والأسعار» ثم شغّل «تحقق/مزامنة». الدفع يُحصَّل دائمًا بعملة خطة فريميوس المعتمدة.
        </p>
      </FnCard>
    </div>
  );
}
