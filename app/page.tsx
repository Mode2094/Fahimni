import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, ChevronLeft, FileText, GraduationCap, ImagePlus, Layers, Mic, PenLine, Play, ShieldCheck, Sparkles, Timer } from 'lucide-react';

import { FnBadge, FnButton, FnCard } from '@/components/fahimni';
import { FahimniMark } from '@/components/fahimni/logo';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { currentUser } from '@/lib/auth/server';
import { resolveWhatsAppHref } from '@/lib/contact/whatsapp';
import { MAX_DEVICES_KEY } from '@/lib/devices/store';
import { getPlainSetting } from '@/lib/settings/service';
import { studentStore } from '@/lib/student/store';
import { trialStore } from '@/lib/trial/store';

export const dynamic = 'force-dynamic';

// The title intentionally falls back to the root layout's template so the
// admin-managed platform name is always reflected on the landing page.
export const metadata: Metadata = {
  description:
    'اسأل نصًا أو بصورة أو بالصوت، واحصل على شرح واضح خطوة بخطوة على سبورة تفاعلية من كتابك المدرسي — لجميع المواد والصفوف.',
};

// Official WhatsApp glyph, drawn locally so no icon dependency is added.
function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

const STEPS = [
  {
    title: 'اسأل بالنص أو الصورة أو الصوت',
    text: 'اكتب سؤالك، أو صوّر المسألة من كتابك، أو احكِه بصوتك.',
    icon: Mic,
    tile: 'fn-icon-tile fn-icon-tile--mint',
  },
  {
    title: 'شاهد الحل خطوة بخطوة',
    text: 'سبورة تفاعلية تشرح كل خطوة بوضوح مع صوت المعلّم.',
    icon: FileText,
    tile: 'fn-icon-tile',
  },
  {
    title: 'شرح مرتبط بكتابك',
    text: 'شرح مستند إلى كتابك المدرسي، مع مراجع من صفحاته.',
    icon: BookOpen,
    tile: 'fn-icon-tile fn-icon-tile--sky',
  },
];

// Real capabilities only — every card maps to a shipped feature.
const FEATURES = [
  {
    title: 'سبورة تفاعلية حيّة',
    text: 'كتابة ورسوم ومخططات بيانية تُرسم أمامك خطوة بخطوة أثناء الشرح.',
    icon: PenLine,
    tile: 'fn-icon-tile fn-icon-tile--gold',
  },
  {
    title: 'ثلاثة أنماط للتعلم',
    text: '«فهمني الدرس» لشرح جديد، «ساعدني أحل» لحل واجبك، و«اختبرني» لقياس فهمك.',
    icon: Layers,
    tile: 'fn-icon-tile fn-icon-tile--mint',
  },
  {
    title: 'سؤال بصورة',
    text: 'صوّر المسألة من كتابك وسنقرؤها ونشرحها لك.',
    icon: ImagePlus,
    tile: 'fn-icon-tile fn-icon-tile--pink',
  },
  {
    title: 'سؤال بالصوت واستماع للشرح',
    text: 'احكِ سؤالك بصوتك، واستمع للشرح بصوت عربي طبيعي.',
    icon: Mic,
    tile: 'fn-icon-tile fn-icon-tile--sky',
  },
  {
    title: 'من كتابك المدرسي',
    text: 'الشرح يستند إلى كتابك المعتمد، مع إشارة إلى صفحات المصدر.',
    icon: BookOpen,
    tile: 'fn-icon-tile',
  },
  {
    title: 'تتبّع تقدمك',
    text: 'نقاط فهمك محفوظة في حسابك، مع صفحة «راجع نقاط ضعفي» لتعود لأهم الدروس.',
    icon: Sparkles,
    tile: 'fn-icon-tile fn-icon-tile--gold',
  },
];

const FAQ = (maxDevices: number | null) => [
  {
    q: 'ما هو فهمني؟',
    a: 'منصة تعليمية ذكية تشرح لك دروسك خطوة بخطوة على سبورة تفاعلية، بالاستناد إلى كتابك المدرسي المعتمد.',
  },
  {
    q: 'هل الشرح من الكتاب المدرسي؟',
    a: 'نعم. يبحث فهمني في كتابك المعتمد ويربط الشرح بمحتواه، ويعرض صفحات المصدر عند الحاجة.',
  },
  {
    q: 'كيف تعمل التجربة المجانية؟',
    a: 'تحصل على رصيد تجريبي من النقاط خلال مدة محددة تبدأ من أول طلب فعلي، وتُستهلك النقاط حسب نوع الطلب (شرح، صورة، صوت) — مرة واحدة لكل حساب، وليست اشتراكًا متكررًا.',
  },
  {
    q: 'هل يعمل فهمني على الجوال؟',
    a: 'نعم، الموقع مصمم للجوال واللوح والحاسوب، ويمكنك تثبيته على شاشتك الرئيسية كتطبيق.',
  },
  {
    q: 'على كم جهاز يمكنني استخدام حسابي؟',
    a: `يمكنك استخدام حسابك على عدد محدود من الأجهزة${maxDevices ? ` (حتى ${maxDevices === 2 ? 'جهازين' : `${maxDevices} أجهزة`} حاليًا)` : ''}، ويمكنك إدارة الأجهزة من صفحة حسابك.`,
  },
  {
    q: 'كيف ألغي اشتراكي؟',
    a: 'تُدار الاشتراكات والفواتير عبر بوابة الدفع الآمنة، وعند إلغاء التجديد يبقى وصولك حتى نهاية المدة المدفوعة.',
  },
  {
    q: 'ماذا عن خصوصية بياناتي؟',
    a: 'تقدمك وأسئلتك خاصة بحسابك ولا تظهر لأي طالب آخر. راجع صفحتي الخصوصية والشروط لمزيد من التفاصيل.',
  },
];

export default async function LandingPage() {
  let user: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    user = await currentUser();
  } catch {
    user = null;
  }
  let grades: Awaited<ReturnType<ReturnType<typeof studentStore>['listActiveGrades']>> = [];
  try {
    grades = await studentStore().listActiveGrades();
  } catch {
    grades = [];
  }

  const startHref = user ? (user.role === 'ADMIN' ? '/admin' : '/app') : '/login';
  const gradeHref = user ? '/app' : `/login?returnTo=${encodeURIComponent('/app')}`;
  const whatsAppHref = await resolveWhatsAppHref();
  // Real, admin-managed values — the landing never invents trial terms.
  const trialSettings = await trialStore()
    .getSettings()
    .catch(() => null);
  const maxDevicesRaw = await getPlainSetting(MAX_DEVICES_KEY).catch(() => null);
  const maxDevices = Number.parseInt(maxDevicesRaw ?? '', 10) || null;

  return (
    <div className="fn-root fn-page">
      <header className="landing-nav">
        <div className="fn-container landing-nav__inner">
          <Link href="/" className="fn-brand" aria-label="فهمني">
            <FahimniMark size={36} />
            <span className="fn-brand__name">فهمني</span>
          </Link>
          <nav className="landing-nav__links" aria-label="التنقل الرئيسي">
            <Link href="/" className="fn-nav-link is-active">
              الرئيسية
            </Link>
            <Link href="/#grades" className="fn-nav-link">
              الصفوف الدراسية
            </Link>
            <Link href="/#how" className="fn-nav-link">
              كيف يعمل؟
            </Link>
            <Link href="/#faq" className="fn-nav-link">
              الأسئلة الشائعة
            </Link>
            <Link href="/#contact" className="fn-nav-link">
              اتصل بنا
            </Link>
          </nav>
          <FnButton asChild size="sm">
            <Link href={startHref}>ابدأ الآن</Link>
          </FnButton>
        </div>
      </header>

      <main className="fn-app-main">
        <div className="fn-container landing-sections">
          <section className="landing-hero">
            <div className="landing-hero__art landing-hero__art--mascot" aria-hidden="true">
              <FahimniMark size={200} className="landing-mascot-svg" />
            </div>

            <div className="landing-hero__copy">
              <FnBadge variant="primary">
                <Sparkles size={13} aria-hidden="true" />
                فهمني · منصة تعليمية ذكية لجميع المواد
              </FnBadge>
              <h1 className="fn-display fn-display--hero landing-title">
                مدرّسك الذكي <span className="fn-text-gradient">من كتابك</span>
              </h1>
              <p className="landing-lede">
                اسأل نصًا أو بصورة أو بالصوت، واحصل على شرح واضح خطوة بخطوة على سبورة تفاعلية — من كتابك المدرسي، وبالسرعة
                التي تناسبك.
              </p>
              <div className="fn-row fn-row--wrap landing-actions">
                <FnButton asChild size="lg">
                  <Link href={startHref}>
                    ابدأ الآن
                    <ChevronLeft size={19} aria-hidden="true" />
                  </Link>
                </FnButton>
                <FnButton asChild size="lg" variant="outline">
                  <Link href="/#how">كيف يعمل فهمني؟</Link>
                </FnButton>
              </div>
            </div>

            <div className="landing-hero__art landing-hero__art--visual" aria-hidden="true">
              <div className="landing-visual">
                <div className="landing-visual__card">
                  <span className="landing-visual__head">
                    <span className="landing-visual__tile">
                      <Sparkles size={16} />
                    </span>
                    <span className="landing-visual__name">فهمني يشرح</span>
                  </span>
                  <span className="landing-visual__line" />
                  <span className="landing-visual__line landing-visual__line--short" />
                  <span className="landing-visual__line landing-visual__line--mid" />
                  <span className="landing-visual__chips">
                    <span className="landing-visual__chip landing-visual__chip--mint">
                      <Mic size={14} />
                      صوت
                    </span>
                    <span className="landing-visual__chip landing-visual__chip--pink">
                      <ImagePlus size={14} />
                      صورة
                    </span>
                  </span>
                </div>
                <span className="landing-visual__badge">
                  <PenLine size={14} />
                  خطوة بخطوة
                </span>
              </div>
            </div>
          </section>

          <InstallPrompt />

          <section id="grades" className="fn-section landing-anchor">
            <div className="landing-section-head">
              <h2 className="landing-section-title">الصفوف الدراسية</h2>
              <p className="landing-section-sub">اختر صفك الدراسي وابدأ التعلّم مباشرة.</p>
            </div>
            {grades.length > 0 ? (
              <div className="grades-grid">
                {grades.map((grade, index) => (
                  <Link
                    key={grade.id}
                    href={gradeHref}
                    className="grade-card"
                    aria-label={`ابدأ التعلّم — ${grade.name}`}
                  >
                    <span className={`grade-card__icon grade-card__icon--${index % 3}`}>
                      <GraduationCap size={26} aria-hidden="true" />
                    </span>
                    <span className="grade-card__title">{grade.name}</span>
                    <span className="grade-card__cta">
                      ابدأ التعلّم
                      <ChevronLeft size={16} aria-hidden="true" />
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <FnCard variant="flat" className="fn-empty">
                <div className="fn-icon-tile fn-icon-tile--lg">
                  <GraduationCap size={26} aria-hidden="true" />
                </div>
                <p className="fn-empty__title">لا توجد صفوف دراسية متاحة حاليًا</p>
                <p className="fn-empty__text">نعمل على تجهيز الصفوف والمواد. تابعنا قريبًا.</p>
              </FnCard>
            )}
          </section>

          <section id="how" className="fn-section landing-anchor">
            <div className="landing-how">
              <div className="landing-section-head">
                <h2 className="landing-section-title">كيف يعمل فهمني؟</h2>
              </div>
              <div className="fn-grid fn-grid--3">
                {STEPS.map((step) => {
                  const Icon = step.icon;
                  return (
                    <FnCard key={step.title} variant="flat" className="fn-card--centered">
                      <span className={step.tile}>
                        <Icon size={22} aria-hidden="true" />
                      </span>
                      <span className="fn-card__title">{step.title}</span>
                      <span className="fn-card__text">{step.text}</span>
                    </FnCard>
                  );
                })}
              </div>

              <div className="landing-cta" aria-labelledby="landing-cta-title">
                <div className="landing-cta__inner">
                  <div className="landing-cta__art" aria-hidden="true">
                    <div className="landing-board">
                      <span className="landing-board__bar">
                        <span />
                        <span />
                        <span />
                      </span>
                      <span className="landing-board__line" />
                      <span className="landing-board__line landing-board__line--short" />
                      <span className="landing-board__line landing-board__line--accent" />
                      <span className="landing-board__line landing-board__line--mid" />
                      <span className="landing-board__play">
                        <Play size={15} />
                      </span>
                      <span className="landing-board__spark">
                        <Sparkles size={16} />
                      </span>
                    </div>
                  </div>

                  <div className="landing-cta__copy">
                    <h2 id="landing-cta-title" className="landing-cta__title">
                      جاهز تبدأ؟
                    </h2>
                    <p className="landing-cta__text">أنشئ حسابك مجانًا وجرّب السبورة التفاعلية بنفسك.</p>
                    <FnButton asChild size="lg" className="landing-cta__btn">
                      <Link href={startHref}>
                        ابدأ الآن
                        <ChevronLeft size={19} aria-hidden="true" />
                      </Link>
                    </FnButton>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="features" className="fn-section landing-anchor">
            <div className="landing-section-head">
              <h2 className="landing-section-title">كل ما تحتاجه للفهم</h2>
              <p className="landing-section-sub">أدوات حقيقية مصممة لطالب المدرسة: اسأل، شاهد، افهم، وتدرّب.</p>
            </div>
            <div className="fn-grid fn-grid--3">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <FnCard key={feature.title} variant="flat" className="fn-stack fn-stack--sm">
                    <span className={feature.tile}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="fn-card__title">{feature.title}</span>
                    <span className="fn-card__text">{feature.text}</span>
                  </FnCard>
                );
              })}
            </div>
          </section>

          <section id="trial" className="fn-section landing-anchor">
            <div className="fn-grid fn-grid--2">
              {trialSettings?.enabled ? (
                <FnCard variant="tinted" className="fn-stack">
                  <div className="fn-row">
                    <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--mint">
                      <Timer size={18} aria-hidden="true" />
                    </span>
                    <h2 className="fn-card__title">جرّب فهمني مجانًا</h2>
                  </div>
                  <p className="fn-card__text">
                    عند تفعيل التجربة تحصل على <strong>رصيد تجريبي من {trialSettings.creditAllowance} نقطة</strong> خلال{' '}
                    <strong>{trialSettings.durationHours} ساعة</strong> تبدأ من أول طلب فعلي. تُستهلك النقاط حسب نوع الطلب
                    (شرح، صورة، صوت) — مرة واحدة لكل حساب، وليست اشتراكًا متكررًا.
                  </p>
                  <FnButton asChild size="sm">
                    <Link href={startHref}>ابدأ تجربتك المجانية</Link>
                  </FnButton>
                </FnCard>
              ) : (
                <FnCard variant="flat" className="fn-stack">
                  <h2 className="fn-card__title">ابدأ بحساب مجاني</h2>
                  <p className="fn-card__text">أنشئ حسابك وشاهد السبورة التفاعلية. التجربة المجانية قيد التجهيز حاليًا.</p>
                  <FnButton asChild size="sm">
                    <Link href={startHref}>ابدأ الآن</Link>
                  </FnButton>
                </FnCard>
              )}
              <FnCard variant="flat" className="fn-stack">
                <div className="fn-row">
                  <span className="fn-icon-tile fn-icon-tile--sm fn-icon-tile--gold">
                    <ShieldCheck size={18} aria-hidden="true" />
                  </span>
                  <h2 className="fn-card__title">الاشتراكات بوضوح</h2>
                </div>
                <ul className="fn-list">
                  <li>مادة واحدة، أو باقة تجمع كل مواد صفك وتخصصك.</li>
                  <li>شهري متكرر، أو فصلي بدفعة واحدة حتى نهاية الفصل الدراسي.</li>
                  <li>كل خطة تشمل رصيد نقاط شهريًا معلنًا قبل الشراء.</li>
                  <li>الأسعار النهائية تُعرض داخل حسابك حسب صفك عند تفعيل الدفع — بلا رسوم خفية.</li>
                  <li>الإلغاء والتجديد والفواتير عبر بوابة الدفع الآمنة.</li>
                </ul>
              </FnCard>
            </div>
          </section>

          <section id="faq" className="fn-section landing-anchor">
            <div className="landing-section-head">
              <h2 className="landing-section-title">الأسئلة الشائعة</h2>
              <p className="landing-section-sub">أجوبة مباشرة لأكثر ما يسأل عنه الطلاب وأولياء الأمور.</p>
            </div>
            <div className="landing-faq">
              {FAQ(maxDevices).map((item) => (
                <details key={item.q} className="faq-item">
                  <summary className="faq-item__q">{item.q}</summary>
                  <p className="faq-item__a">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section id="contact" className="fn-section landing-anchor">
            <div className="contact-card">
              <div className="contact-card__main">
                <span className="contact-card__icon" aria-hidden="true">
                  <WhatsAppIcon size={26} />
                </span>
                <div className="contact-card__copy">
                  <h2 className="landing-section-title">تواصل معنا</h2>
                  <p className="landing-section-sub">عندك سؤال أو تحتاج مساعدة؟ فريق فهمني جاهز يساعدك عبر واتساب.</p>
                </div>
              </div>
              {whatsAppHref ? (
                <FnButton asChild size="lg" className="contact-card__btn">
                  <a href={whatsAppHref} target="_blank" rel="noopener noreferrer">
                    <WhatsAppIcon size={19} />
                    تواصل عبر واتساب
                  </a>
                </FnButton>
              ) : (
                <p className="fn-caption contact-card__note">التواصل عبر واتساب قيد التجهيز حاليًا.</p>
              )}
            </div>
          </section>
        </div>
      </main>

      <footer className="fn-footer">
        <div className="fn-container fn-row fn-row--wrap fn-row--between">
          <span>© {new Date().getFullYear()} فهمني — مساحة للفهم.</span>
          <span className="fn-row fn-row--wrap">
            <Link className="fn-caption" href="/privacy">سياسة الخصوصية (مسودة)</Link>
            <Link className="fn-caption" href="/terms">الشروط والأحكام (مسودة)</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
