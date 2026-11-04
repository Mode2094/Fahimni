import { desc, eq, sql } from 'drizzle-orm';

import { getDb } from '../../db';
import { books, creditWallets, semesterCreditGrants } from '../../db/schema';
import { adminStore } from './store';
import { semesterStore, isSellableSemester } from '../billing/semester-store';
import { topupStore } from '../billing/topup-store';
import { checkHealth } from '../health';
import { aiBudgetStatus } from '../ai/budget-status';
import { encryptionConfigured } from '../settings/crypto';
import { SETTING_KEYS, SECRET_KEYS } from '../settings/keys';
import { getPlainSetting, getSecretPresence } from '../settings/service';
import { checkFreemiusConnection } from '../freemius/connection';
import { isSupportedCheckoutCurrency } from '../freemius/verification';

// Aggregated, evidence-backed launch readiness. Every check reads real state or
// performs a real read-only test call; a green result is never assumed. Checks
// that depend on unavailable external credentials return a non-green status with
// the exact owner action required.

export type ReadinessLevel = 'ok' | 'warn' | 'blocked' | 'unknown';

export type ReadinessCheck = {
  id: string;
  label: string;
  level: ReadinessLevel;
  detail: string;
  // The precise owner action when the check is not ok.
  action?: string;
};

export type ReadinessReport = {
  generatedAt: string;
  environment: string;
  overall: ReadinessLevel;
  blockers: number;
  checks: ReadinessCheck[];
};

// Pure, testable payment-readiness decision. A semester can only sell when the
// provider connection is healthy AND the semester's currency is supported by
// the provider. This is the primary launch blocker in the current setup.
export function paymentReadiness(input: {
  providerOk: boolean;
  providerCode: string;
  currency: string;
}): ReadinessCheck {
  const currencySupported = isSupportedCheckoutCurrency(input.currency);
  const ready = input.providerOk && currencySupported;
  return {
    id: 'payment',
    label: 'مزود الدفع',
    level: ready ? 'ok' : 'blocked',
    detail: `الاتصال بالمزوّد: ${input.providerOk ? 'متاح' : input.providerCode} · عملة العرض (${input.currency}) مدعومة: ${currencySupported ? 'نعم' : 'لا'}`,
    action: ready ? undefined : 'المزود لا يدعم عملة العرض الحالية أو الربط غير مكتمل. اختر عملة مدعومة أو مزوّدًا يدعم عملتك، ثم فعّل الربط بعد اعتماد المالك.',
  };
}

export function worst(levels: ReadinessLevel[]): ReadinessLevel {
  if (levels.includes('blocked')) return 'blocked';
  if (levels.includes('warn')) return 'warn';
  if (levels.includes('unknown')) return 'unknown';
  return 'ok';
}

export async function launchReadiness(now = new Date()): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];

  // 1. Infrastructure health (real read). Redis is REQUIRED in production: a
  // missing Redis in production is a blocker (rate limits and budgets would
  // silently fall back to per-process memory), not a tolerable warning.
  try {
    const health = await checkHealth();
    const production = process.env.NODE_ENV === 'production';
    const redisRequired = production && health.checks.redis === 'not_configured';
    const infraOk = health.checks.database === 'ok' && health.checks.redis !== 'down' && !redisRequired;
    checks.push({
      id: 'infra',
      label: 'قاعدة البيانات و Redis',
      level: infraOk ? 'ok' : 'blocked',
      detail: `database=${health.checks.database} · redis=${health.checks.redis}${production ? ' (مطلوب في الإنتاج)' : ''}`,
      action: infraOk
        ? undefined
        : redisRequired
          ? 'Redis إلزامي في بيئة الإنتاج. عيّن REDIS_URL وشغّل Redis.'
          : 'تحقق من تشغيل PostgreSQL و Redis وسلامة متغيرات الاتصال.',
    });
  } catch {
    checks.push({ id: 'infra', label: 'قاعدة البيانات و Redis', level: 'blocked', detail: 'تعذر إجراء فحص الصحة.', action: 'تحقق من الخدمات والاتصال.' });
  }

  // 2. Encryption root key present (secrets at rest).
  const encryption = encryptionConfigured();
  checks.push({
    id: 'encryption',
    label: 'مفتاح تشفير الإعدادات',
    level: encryption ? 'ok' : 'blocked',
    detail: encryption ? 'SETTINGS_ENCRYPTION_KEY مهيأ.' : 'SETTINGS_ENCRYPTION_KEY غير مهيأ.',
    action: encryption ? undefined : 'عيّن SETTINGS_ENCRYPTION_KEY (32 بايت) خارج النسخ الاحتياطي لقاعدة البيانات.',
  });

  // 3. AI provider key presence + last verification (real read).
  const [aiKeyPresent, aiLastTestOk, aiLastTestAt] = await Promise.all([
    getSecretPresence(SECRET_KEYS.openaiApiKey).catch(() => false),
    getPlainSetting(SETTING_KEYS.aiLastTestOk).catch(() => null),
    getPlainSetting(SETTING_KEYS.aiLastTestAt).catch(() => null),
  ]);
  const aiOk = aiKeyPresent && aiLastTestOk === 'true';
  checks.push({
    id: 'ai',
    label: 'مزود الذكاء الاصطناعي',
    level: aiOk ? 'ok' : aiKeyPresent ? 'warn' : 'blocked',
    detail: aiKeyPresent ? `مفتاح محفوظ · آخر اختبار: ${aiLastTestOk === 'true' ? 'ناجح' : 'غير ناجح أو غير مُجرّب'}${aiLastTestAt ? ` (${aiLastTestAt})` : ''}` : 'لا يوجد مفتاح محفوظ.',
    action: aiOk ? undefined : 'احفظ مفتاح OpenAI واختبره من إعدادات الذكاء الاصطناعي.',
  });

  // 4. AI budget backend must not be memory-only in production.
  try {
    const budget = await aiBudgetStatus(now);
    const memoryInProduction = budget.source === 'memory' && process.env.NODE_ENV === 'production';
    checks.push({
      id: 'ai-budget',
      label: 'ميزانية الذكاء الاصطناعي',
      level: memoryInProduction ? 'warn' : 'ok',
      detail: `المصدر: ${budget.source} · الحد العام: ${budget.global.limitUsd}$ · المستهلك: ${budget.global.spentUsd}$`,
      action: memoryInProduction ? 'Redis مطلوب في الإنتاج حتى لا تُصفَّر الميزانية عند إعادة التشغيل.' : undefined,
    });
  } catch {
    checks.push({ id: 'ai-budget', label: 'ميزانية الذكاء الاصطناعي', level: 'unknown', detail: 'تعذر قراءة حالة الميزانية.' });
  }

  // 5. Active semester + sellable offer (real reads). Computed before payment
  // readiness because the payment currency is the semester's currency.
  const semesters = await semesterStore().listSemesters();
  const nowSemesters = semesters.filter((semester) => semester.status !== 'ARCHIVED');
  const activeSemester = nowSemesters.find((semester) => semester.status === 'ACTIVE') ?? null;
  const sellable = nowSemesters.find((semester) => isSellableSemester(semester, now)) ?? null;

  // 6. Payment provider readiness (real read-only connection check). Computed
  // before the semester readiness check because it feeds the pricing verdict.
  let providerPricingVerified = false;
  try {
    const connection = await checkFreemiusConnection();
    providerPricingVerified = connection.ok && isSupportedCheckoutCurrency(activeSemester?.currency ?? '');
    checks.push(paymentReadiness({
      providerOk: connection.ok,
      providerCode: connection.code,
      currency: activeSemester?.currency ?? '',
    }));
  } catch {
    checks.push({ id: 'payment', label: 'مزود الدفع', level: 'blocked', detail: 'فريميوس غير مهيأ.', action: 'أكمل بيانات الربط ثم اختبر الاتصال.' });
  }

  // 7. Semester readiness: an active semester is only "ready" when it is
  // actually sellable now AND its provider pricing is verified. A configured
  // plan id alone is not readiness.
  checks.push({
    id: 'semester',
    label: 'الفصل الدراسي',
    level: activeSemester ? (sellable && providerPricingVerified ? 'ok' : 'blocked') : 'blocked',
    detail: activeSemester
      ? `${activeSemester.name} · قابل للبيع الآن: ${sellable ? 'نعم' : 'لا'} · خطة الدفع: ${activeSemester.freemiusPlanId ? 'مربوطة' : 'غير مربوطة'} · تسعير المزود موثّق: ${providerPricingVerified ? 'نعم' : 'لا'}`
      : 'لا يوجد فصل نشط.',
    action: !activeSemester
      ? 'أنشئ فصلًا دراسيًا وفعّله.'
      : !sellable
        ? 'الفصل النشط غير قابل للبيع في الوقت الحالي؛ تحقق من نافذة البيع وتواريخ الفصل وحالته.'
        : !providerPricingVerified
          ? 'تسعير المزود للفصل غير موثّق؛ اربط الخطة بعملة مدعومة وتحقق من المطابقة قبل الإطلاق.'
          : undefined,
  });

  // 7. READY subjects (real reads).
  const admin = adminStore();
  const allSubjects = await admin.listSubjects();
  const activeSubjects = allSubjects.filter((subject) => subject.isActive);
  const db = getDb();
  const readyRows = await db
    .select({ subjectId: books.subjectId })
    .from(books)
    .where(eq(books.status, 'READY'));
  const readySubjectIds = new Set(readyRows.map((row) => row.subjectId));
  const activeReady = activeSubjects.filter((subject) => readySubjectIds.has(subject.id));
  const activeWithoutBook = activeSubjects.filter((subject) => !readySubjectIds.has(subject.id));
  checks.push({
    id: 'content',
    label: 'المواد الجاهزة',
    level: activeReady.length === 0 ? 'blocked' : activeWithoutBook.length === 0 ? 'ok' : 'warn',
    detail: `مواد نشطة: ${activeSubjects.length} · جاهزة بكتاب: ${activeReady.length} · نشطة بلا كتاب جاهز: ${activeWithoutBook.length}`,
    action: activeReady.length === 0
      ? 'ارفع كتابًا معتمدًا لمادة واحدة على الأقل وانتظر اكتمال الفهرسة.'
      : activeWithoutBook.length
        ? 'بعض المواد النشطة بلا كتاب جاهز؛ لن تظهر للطلاب حتى تصبح جاهزة.'
        : undefined,
  });

  // 8. Wallet / ledger integrity: a REAL bounded reconciliation over a sample
  // of wallets, comparing the persisted cache against the grant sum and the
  // top-up ledger sum. It must never report green merely because no balance is
  // negative. Coverage is reported explicitly (verified / partial / unavailable).
  try {
    const sampleSize = 200;
    const sample = await db
      .select({ userId: creditWallets.userId })
      .from(creditWallets)
      .orderBy(desc(creditWallets.updatedAt))
      .limit(sampleSize);
    const [totalRow] = await db.select({ count: sql<number>`count(*)::int` }).from(creditWallets);
    const total = totalRow?.count ?? 0;

    // Any negative grant balance is an immediate hard failure.
    const [negative] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(semesterCreditGrants)
      .where(sql`${semesterCreditGrants.remainingCredits} < 0`);

    // Reconcile the sampled wallets: cache.semester vs ACTIVE grant sum, and
    // cache.topup vs the TOPUP ledger sum. Do the whole sample in one query.
    const sampleIds = sample.map((row) => row.userId);
    let mismatches = 0;
    if (sampleIds.length) {
      const rows = await db.execute<{ uid: string; mismatch: boolean }>(sql`
        with sampled as (select unnest(${sql.raw(`ARRAY[${sampleIds.map((id) => `'${id}'`).join(',')}]::text[]`)}) as uid)
        select s.uid::text as uid,
          (w.semester_balance <> coalesce(g.semester_sum, 0) or w.topup_balance <> coalesce(l.topup_sum, 0)) as mismatch
        from sampled s
        join credit_wallets w on w.user_id = s.uid
        left join (
          select user_id, sum(case when status = 'ACTIVE' and starts_at <= now() and expires_at > now() then remaining_credits else 0 end)::int as semester_sum
          from semester_credit_grants group by user_id
        ) g on g.user_id = s.uid
        left join (
          select user_id, sum(delta)::int as topup_sum
          from credit_ledger where bucket = 'TOPUP' group by user_id
        ) l on l.user_id = s.uid
      `);
      mismatches = rows.rows.filter((row) => row.mismatch).length;
    }

    const checked = sampleIds.length;
    const negativeCount = negative?.count ?? 0;
    // Coverage: verified when every wallet was checked; partial otherwise.
    const coverage = checked === 0 ? 'unavailable' : checked >= total ? 'verified' : 'partial';
    const healthy = negativeCount === 0 && mismatches === 0;
    checks.push({
      id: 'wallet',
      label: 'سلامة الرصيد والسجل',
      level: coverage === 'unavailable' ? 'unknown' : healthy ? 'ok' : 'blocked',
      detail: `تم فحص ${checked} من ${total} محفظة (تغطية: ${{ verified: 'كاملة', partial: 'جزئية', unavailable: 'غير متاحة' }[coverage]}) · عدم تطابق: ${mismatches} · أرصدة سالبة: ${negativeCount}`,
      action: healthy
        ? undefined
        : 'يوجد عدم تطابق بين ذاكرة الرصيد ودفتر الكريدت أو أرصدة سالبة. استخدم أداة المطابقة وأصلح السجل قبل الإطلاق.',
    });
  } catch {
    checks.push({ id: 'wallet', label: 'سلامة الرصيد والسجل', level: 'unknown', detail: 'تعذر إجراء مطابقة الرصيد.', action: 'تحقق من اتصال قاعدة البيانات.' });
  }

  // 9. Top-up catalog (informational; not a blocker).
  const topups = await topupStore().listOffers();
  const activeTopups = topups.filter((offer) => offer.status === 'ACTIVE');
  const topupReady = activeTopups.filter((offer) => offer.freemiusPlanId).length;
  checks.push({
    id: 'topups',
    label: 'عروض شحن الرصيد',
    level: activeTopups.length === 0 ? 'warn' : topupReady === activeTopups.length ? 'ok' : 'warn',
    detail: `نشطة: ${activeTopups.length} · مربوطة بمزود: ${topupReady}`,
    action: activeTopups.length === 0 ? 'أضف عرض شحن واحدًا على الأقل إن رغبت بتفعيل الشحن.' : undefined,
  });

  // 10. Admin authorization configured (real read).
  const adminConfigured = Boolean(process.env.ADMIN_EMAILS?.trim());
  checks.push({
    id: 'admin',
    label: 'صلاحيات المشرف',
    level: adminConfigured ? 'ok' : 'warn',
    detail: adminConfigured ? 'ADMIN_EMAILS مهيأ.' : 'ADMIN_EMAILS غير مهيأ (لا مشرفين عبر البريد).',
    action: adminConfigured ? undefined : 'عيّن ADMIN_EMAILS لضمان وصول مشرف موثوق.',
  });

  // 11. Legal documents. A stored timestamp is only an owner self-attestation;
  // it is NEVER independent legal approval. This check can therefore never be
  // green — it stays a warning with clear wording, and the final acceptance
  // report gates legal approval separately.
  const legalReviewed = await getPlainSetting('legalReviewedAt').catch(() => null);
  checks.push({
    id: 'legal',
    label: 'المستندات القانونية (اعتماد خارجي)',
    level: 'warn',
    detail: legalReviewed
      ? `إقرار المالك مسجّل في ${legalReviewed} — هذا إقرار ذاتي وليس اعتمادًا قانونيًا مستقلًا.`
      : 'لا يوجد إقرار من المالك بعد. المستندات مسودات معلّمة.',
    action: 'مطلوب مراجعة قانونية مؤهّلة واعتماد المالك قبل الإطلاق التجاري؛ لا يمكن اعتبار هذه البند «جاهزًا» آليًا.',
  });

  const overall = worst(checks.map((check) => check.level));
  return {
    generatedAt: now.toISOString(),
    environment: process.env.NODE_ENV ?? 'development',
    overall,
    blockers: checks.filter((check) => check.level === 'blocked').length,
    checks,
  };
}
