import type { Metadata } from 'next';

import { AdminMessage, AdminPageHeader } from '@/components/admin/admin-ui';
import { FreemiusSection } from '@/components/admin/freemius-section';
import { OffersSection, type OfferAdminView } from '@/components/admin/offers-section';
import { SubscribersSection } from '@/components/admin/subscribers-section';
import { SemestersSection, type SemesterAdminView } from '@/components/admin/semesters-section';
import { TopupsSection } from '@/components/admin/topups-section';
import {
  ConsumptionSection,
  CreditAdjustForm,
  FinancialOverview,
  LedgerTable,
  PaymentsSection,
  ProfitabilityPanel,
} from '@/components/admin/financial-sections';
import { TermsSection, type TermOfferSummary } from '@/components/admin/terms-section';
import {
  SubscriptionTabs,
  normalizeSubscriptionSection,
} from '@/components/admin/subscription-tabs';
import type { WizardCatalog } from '@/components/admin/offer-wizard';
import { messageFromQuery } from '@/lib/admin/messages';
import { offerDisplayTitle } from '@/lib/admin/offer-labels';
import { offerReadiness } from '@/lib/admin/offer-readiness';
import { adminStore } from '@/lib/admin/store';
import { billingStore, type PlanType } from '@/lib/billing/store';
import { semesterStore } from '@/lib/billing/semester-store';
import { topupStore } from '@/lib/billing/topup-store';
import { creditWalletStore } from '@/lib/billing/wallet-store';
import { financialSummary, ledgerExport, projectProfitability } from '@/lib/admin/financials';
import { AI_SERVICE_KEYS, AI_SERVICE_LABELS, creditCostTable } from '@/lib/credits/costs';
import { formatMinor } from '@/lib/admin/money';
import { formatTermDate, termPhase } from '@/lib/billing/terms';
import { freemiusCredentials } from '@/lib/freemius/credentials';
import { billingEventStore } from '@/lib/freemius/events';
import { offerProviderLinkStore } from '@/lib/freemius/links';
import { duplicatePlanIdMappings } from '@/lib/freemius/verification';
import { checkoutStatus, type CheckoutStatus } from '@/lib/freemius/readiness';
import { encryptionConfigured } from '@/lib/settings/crypto';
import { SETTING_KEYS } from '@/lib/settings/keys';
import { getPlainSetting } from '@/lib/settings/service';
import { latestWebhookEvent } from '@/lib/settings/webhook-status';
import { requireAdmin } from '@/lib/admin/guard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إدارة الاشتراكات',
  description: 'الفصول الدراسية والباقات والأسعار واشتراكات الطلاب وحالة الربط مع فريميوس.',
};

export default async function AdminSubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; section?: string; q?: string }>;
}) {
  await requireAdmin('/admin/subscriptions');
  const params = await searchParams;
  const section = normalizeSubscriptionSection(params.section);
  const search = (params.q ?? '').trim();
  const message = messageFromQuery(params.status, params.error);

  const billing = billingStore();
  const admin = adminStore();
  const now = new Date();

  const [grades, fields, subjects, terms, offers] = await Promise.all([
    admin.listGrades(),
    admin.listFields(),
    admin.listSubjects(),
    billing.listAcademicTerms(),
    billing.listSubscriptionOffers(),
  ]);

  const gradeName = new Map(grades.map((grade) => [grade.id, grade.name]));
  const subjectName = new Map(subjects.map((subject) => [subject.id, subject.name]));
  const fieldName = new Map(fields.map((field) => [field.id, field.name]));
  const termName = new Map(terms.map((term) => [term.id, term.name]));

  const views: OfferAdminView[] = [];
  const links = new Map((await offerProviderLinkStore().listAll()).map((link) => [link.offerId, link]));
  for (const offer of offers) {
    const bundleScope = offer.kind === 'BUNDLE' ? await billing.listBundleSubjectIds(offer.id) : [];
    const term = offer.academicTermId ? terms.find((candidate) => candidate.id === offer.academicTermId) ?? null : null;
    const readiness = offerReadiness({
      kind: offer.kind,
      type: offer.type,
      freemiusPlanId: offer.freemiusPlanId,
      priceMinor: offer.priceMinor,
      term,
      bundleSubjectIds: bundleScope,
      now,
    });
    const link = links.get(offer.id) ?? null;
    const eligibleSubjects = subjects
      .filter((subject) => {
        if (subject.gradeId !== offer.gradeId) return false;
        if (offer.academicFieldId === null) return subject.academicFieldId === null;
        return subject.academicFieldId === null || subject.academicFieldId === offer.academicFieldId;
      })
      .map((subject) => ({ id: subject.id, name: subject.name }));
    views.push({
      offer,
      title: offerDisplayTitle(offer, { subjectNames: subjectName, gradeNames: gradeName, fieldNames: fieldName, termNames: termName }),
      readiness,
      bundleScope,
      eligibleSubjects,
      termLabel: term ? `${term.name} · ${formatTermDate(term.startsAt)} — ${formatTermDate(term.endsAt)}` : null,
      coveredNames: bundleScope.map((id) => subjectName.get(id) ?? 'مادة'),
      checkout: checkoutStatus({ offerActive: offer.isActive, link }),
      link: link
        ? {
            planId: link.planId,
            currency: link.currency,
            priceMinor: link.priceMinor,
            verified: link.verified,
            lastSyncedAt: link.lastSyncedAt,
            lastError: link.lastError,
            attempts: link.attempts,
          }
        : null,
    });
  }

  const offersByTerm = new Map<string, TermOfferSummary[]>();
  for (const view of views) {
    if (!view.offer.academicTermId) continue;
    const list = offersByTerm.get(view.offer.academicTermId) ?? [];
    list.push({
      id: view.offer.id,
      title: view.title,
      priceMinor: view.offer.priceMinor,
      currency: view.offer.currency,
      isActive: view.offer.isActive,
      ready: view.readiness.ready,
    });
    offersByTerm.set(view.offer.academicTermId, list);
  }

  const soldCounts = new Map<string, number>();
  for (const term of terms) soldCounts.set(term.id, await billing.countSoldEntitlementsForTerm(term.id));

  const wizardCatalog: WizardCatalog = {
    grades: grades.map((grade) => ({ id: grade.id, name: grade.name })),
    fields: fields.map((field) => ({ id: field.id, gradeId: field.gradeId, name: field.name })),
    subjects: subjects.map((subject) => ({
      id: subject.id,
      gradeId: subject.gradeId,
      academicFieldId: subject.academicFieldId,
      name: subject.name,
    })),
    terms: terms.map((term) => ({
      id: term.id,
      name: term.name,
      gradeId: term.gradeId,
      academicFieldId: term.academicFieldId,
      startsAt: term.startsAt.toISOString(),
      endsAt: term.endsAt.toISOString(),
      isActive: term.isActive,
      phase: termPhase(term.startsAt, term.endsAt, now),
    })),
  };

  let subscribersSection = null;
  if (section === 'subscribers') {
    const rows = await billing.listEntitlementsWithUsers(50, search || null);
    const scopes = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.subjectId) scopes.set(row.id, await billing.listEntitlementSubjectIds(row.id));
    }
    subscribersSection = (
      <SubscribersSection
        rows={rows}
        search={search}
        offers={offers}
        subjectName={subjectName}
        termName={termName}
        scopes={scopes}
      />
    );
  }

  let freemiusSection = null;
  if (section === 'freemius') {
    const legacyPlans: {
      id: string;
      subjectName: string;
      type: PlanType;
      priceMinor: number | null;
      currency: string;
      planId: string | null;
      isActive: boolean;
    }[] = [];
    for (const subject of subjects) {
      const plans = await billing.listSubjectPlans(subject.id);
      for (const plan of plans) {
        legacyPlans.push({
          id: plan.id,
          subjectName: subject.name,
          type: plan.type,
          priceMinor: plan.priceMinor,
          currency: plan.currency,
          planId: plan.freemiusPlanId,
          isActive: plan.isActive,
        });
      }
    }
    const [credentials, lastVerifiedAt, lastVerifiedSummaryRaw, syncEnabledRaw, webhookEvent] = await Promise.all([
      freemiusCredentials(),
      getPlainSetting(SETTING_KEYS.freemiusLastVerifiedAt),
      getPlainSetting(SETTING_KEYS.freemiusLastVerifiedSummary),
      getPlainSetting(SETTING_KEYS.freemiusSyncEnabled),
      latestWebhookEvent(),
    ]);
    let summary: { ok?: boolean; productId?: string | null; productTitle?: string | null; planCount?: number; developerConfigured?: boolean } = {};
    try {
      summary = JSON.parse(lastVerifiedSummaryRaw ?? '{}');
    } catch {
      summary = {};
    }
    const statusCounts: Record<CheckoutStatus, number> = { DRAFT: 0, PENDING_LINK: 0, SYNCING: 0, SYNC_FAILED: 0, READY: 0 };
    for (const view of views) statusCounts[view.checkout] += 1;

    const events = await billingEventStore().list(10);
    const planOwner = new Map<string, string[]>();
    for (const view of views) {
      if (!view.offer.freemiusPlanId) continue;
      planOwner.set(view.offer.freemiusPlanId, [...(planOwner.get(view.offer.freemiusPlanId) ?? []), view.title]);
    }
    for (const plan of legacyPlans) {
      if (!plan.planId) continue;
      planOwner.set(plan.planId, [...(planOwner.get(plan.planId) ?? []), `${plan.subjectName} (قديم)`]);
    }
    const planConflicts = duplicatePlanIdMappings(
      [
        ...views.map((view) => ({ id: view.offer.id, freemiusPlanId: view.offer.freemiusPlanId })),
        ...legacyPlans.map((plan) => ({ id: plan.id, freemiusPlanId: plan.planId })),
      ],
    ).map((conflict) => ({ planId: conflict.planId, offerTitles: planOwner.get(conflict.planId) ?? [] }));

    freemiusSection = (
      <FreemiusSection
        connection={{
          configured: Boolean(credentials.productId && credentials.apiKey && credentials.secretKey && credentials.publicKey),
          productId: summary.productId ?? credentials.productId,
          productTitle: summary.productTitle ?? null,
          planCount: summary.planCount ?? 0,
          developerConfigured: Boolean(credentials.developerId && credentials.developerSecret),
          lastVerifiedAt,
          lastVerifiedOk: typeof summary.ok === 'boolean' ? summary.ok : null,
          syncEnabled: syncEnabledRaw === 'true',
          encryptionReady: encryptionConfigured(),
          webhookLast: webhookEvent ? `${webhookEvent.type} · ${new Date(webhookEvent.createdAt).toLocaleString('ar-JO')}` : null,
        }}
        statusCounts={statusCounts}
        offers={views.map((view) => ({ id: view.offer.id, title: view.title, status: view.checkout }))}
        legacyPlans={legacyPlans}
        events={events.map((event) => ({
          id: event.id,
          type: event.type,
          summary: event.summary,
          userEmail: event.userEmail,
          createdAt: event.createdAt.toISOString(),
        }))}
        planConflicts={planConflicts}
      />
    );
  }

  // Unified semester management view: each semester with its subscriber count and
  // granted/consumed credit totals from the real ledger.
  let semestersSection = null;
  if (section === 'semesters') {
    const allSemesters = await semesterStore().listSemesters();
    const termLedger = await ledgerExport(5000);
    const semesterViews: SemesterAdminView[] = [];
    for (const semester of allSemesters) {
      const subs = await semesterStore().listSubscribers(semester.id);
      const granted = termLedger
        .filter((row) => row.kind === 'GRANT' && row.bucket === 'SEMESTER')
        .reduce((sum, row) => sum + row.delta, 0);
      const consumed = termLedger
        .filter((row) => row.kind === 'CONSUME' && row.bucket === 'SEMESTER')
        .reduce((sum, row) => sum + -row.delta, 0);
      semesterViews.push({
        semester,
        subscribers: subs.length,
        grantedCredits: semester.includedCredits * subs.length,
        consumedCredits: granted > 0 ? Math.round((consumed * (semester.includedCredits * subs.length)) / granted) : 0,
      });
    }
    semestersSection = (
      <SemestersSection
        semesters={semesterViews}
        grades={grades.map((grade) => ({ id: grade.id, name: grade.name }))}
        fields={fields.map((field) => ({ id: field.id, gradeId: field.gradeId, name: field.name }))}
      />
    );
  }

  let creditsSection = null;
  if (section === 'credits') {
    const [offers, ledger] = await Promise.all([topupStore().listOffers(), creditWalletStore().listLedger('', 0).catch(() => [])]);
    creditsSection = (
      <div className="fn-stack">
        <TopupsSection offers={offers} />
        <CreditAdjustForm />
        <section className="fn-section">
          <h2 className="fn-section__title">سجل الكريدت الأخير</h2>
          <LedgerTable rows={ledger} />
        </section>
      </div>
    );
  }

  let paymentsSection = null;
  let reportsSection = null;
  if (section === 'payments' || section === 'reports') {
    const summary = await financialSummary({});
    if (section === 'payments') {
      paymentsSection = <PaymentsSection summary={summary} />;
    } else {
      const assumptions = {
        semesterPriceMinor: 29_000,
        includedCredits: 300,
        expectedSubscribers: 100,
        avgAiCostPerStudentUsd: 0.5,
        paymentFeePercent: 3,
        paymentFeeFixedMinor: 100,
        acquisitionCostPerCustomerMinor: 0,
        fixedOperatingExpensesMinor: 500_000,
        avgTopupRevenuePerStudentMinor: 2_000,
        avgTopupCreditsCostUsd: 0.3,
      };
      const result = projectProfitability({ assumptions, usdToMinor: 1000 });
      const assumptionsSummary = [
        `سعر الفصل: ${formatMinor(assumptions.semesterPriceMinor)}`,
        `الرصيد المُضمّن: ${assumptions.includedCredits} كريدت`,
        `عدد المشتركين المتوقع: ${assumptions.expectedSubscribers}`,
        `متوسط كلفة الذكاء الاصطناعي لكل طالب: $${assumptions.avgAiCostPerStudentUsd}`,
        `رسوم الدفع: ${assumptions.paymentFeePercent}% + ${formatMinor(assumptions.paymentFeeFixedMinor)}`,
        `تكلفة استقطاب لكل عميل: ${formatMinor(assumptions.acquisitionCostPerCustomerMinor)}`,
        `مصروفات تشغيل ثابتة: ${formatMinor(assumptions.fixedOperatingExpensesMinor)}`,
      ];
      reportsSection = (
        <div className="fn-stack">
          <FinancialOverview summary={summary} />
          <ProfitabilityPanel result={result} assumptionsSummary={assumptionsSummary} />
        </div>
      );
    }
  }

  let consumptionSection = null;
  if (section === 'consumption') {
    const costs = await creditCostTable();
    consumptionSection = (
      <div className="fn-stack">
        <ConsumptionSection costs={costs} saved={false} />
        <p className="fn-caption">
          {AI_SERVICE_KEYS.map((key) => `${AI_SERVICE_LABELS[key]}: ${costs[key]}`).join(' · ')}
        </p>
      </div>
    );
  }

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title="إدارة الفصول والاشتراكات"
        description="اشتراك فصلي واحد لكل الصف، ورصيد موحّد، وتقارير مالية مع أقسام واضحة."
      />
      <AdminMessage message={message} />
      <SubscriptionTabs active={section} />

      {section === 'semesters' ? semestersSection : null}
      {section === 'offers' ? (
        <div className="fn-stack">
          <OffersSection catalog={wizardCatalog} views={views} />
          <TermsSection
            terms={terms}
            grades={grades.map((grade) => ({ id: grade.id, name: grade.name }))}
            fields={fields.map((field) => ({ id: field.id, gradeId: field.gradeId, name: field.name }))}
            gradeName={gradeName}
            soldCounts={soldCounts}
            offersByTerm={offersByTerm}
            now={now}
          />
        </div>
      ) : null}
      {section === 'credits' ? creditsSection : null}
      {section === 'payments' ? paymentsSection : null}
      {section === 'reports' ? reportsSection : null}
      {section === 'consumption' ? consumptionSection : null}
      {subscribersSection}
      {freemiusSection}
    </div>
  );
}
