import type { Metadata } from 'next';

import { AdminMessage, AdminPageHeader } from '@/components/admin/admin-ui';
import { FreemiusSection } from '@/components/admin/freemius-section';
import { OffersSection, type OfferAdminView } from '@/components/admin/offers-section';
import { SubscribersSection } from '@/components/admin/subscribers-section';
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

  return (
    <div className="fn-stack fn-stack--lg">
      <AdminPageHeader
        title="الاشتراكات"
        description="أربعة أقسام واضحة: الفصول، الباقات والأسعار، اشتراكات الطلاب، وحالة الربط مع فريميوس."
      />
      <AdminMessage message={message} />
      <SubscriptionTabs active={section} />

      {section === 'terms' ? (
        <TermsSection
          terms={terms}
          grades={grades.map((grade) => ({ id: grade.id, name: grade.name }))}
          fields={fields.map((field) => ({ id: field.id, gradeId: field.gradeId, name: field.name }))}
          gradeName={gradeName}
          soldCounts={soldCounts}
          offersByTerm={offersByTerm}
          now={now}
        />
      ) : null}
      {section === 'offers' ? <OffersSection catalog={wizardCatalog} views={views} /> : null}
      {subscribersSection}
      {freemiusSection}
    </div>
  );
}
