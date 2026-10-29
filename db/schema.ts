import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['STUDENT', 'ADMIN']);

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  image: text('image'),
  role: userRole('role').notNull().default('STUDENT'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('accounts_provider_account_idx').on(table.provider, table.providerAccountId),
    index('accounts_user_id_idx').on(table.userId),
  ],
);

// Session ids are HMAC-SHA256 digests of the raw cookie token; the raw token is
// never stored, so a database leak cannot be replayed as a login.
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type Session = typeof sessions.$inferSelect;

export const grades = pgTable('grades', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const academicFields = pgTable(
  'academic_fields',
  {
    id: text('id').primaryKey(),
    gradeId: text('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (table) => [uniqueIndex('academic_fields_grade_slug_idx').on(table.gradeId, table.slug)],
);

export const subjects = pgTable(
  'subjects',
  {
    id: text('id').primaryKey(),
    gradeId: text('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    academicFieldId: text('academic_field_id').references(() => academicFields.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    shortDescription: text('short_description'),
    image: text('image'),
    isActive: boolean('is_active').notNull().default(true),
    isFeatured: boolean('is_featured').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    // Payment-intent values only (Phase 6 will consume them); stored as integer
    // minor units so money never touches floating point.
    monthlyPriceMinor: integer('monthly_price_minor'),
    semesterPriceMinor: integer('semester_price_minor'),
    currency: text('currency').notNull().default('JOD'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('subjects_grade_id_idx').on(table.gradeId), index('subjects_academic_field_id_idx').on(table.academicFieldId)],
);

// One profile per student; the authenticated user id is the key, so a browser
// can never address another student's profile.
export const studentProfiles = pgTable(
  'student_profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    gradeId: text('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'restrict' }),
    academicFieldId: text('academic_field_id').references(() => academicFields.id, { onDelete: 'set null' }),
    onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('student_profiles_grade_id_idx').on(table.gradeId), index('student_profiles_academic_field_id_idx').on(table.academicFieldId)],
);

export type Grade = typeof grades.$inferSelect;
export type AcademicField = typeof academicFields.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type StudentProfile = typeof studentProfiles.$inferSelect;

export const bookStatus = pgEnum('book_status', ['UPLOADED', 'PROCESSING', 'READY', 'FAILED']);

export const books = pgTable(
  'books',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    originalFileName: text('original_file_name').notNull(),
    // Relative to DATA_DIR; absolute filesystem paths are never stored or exposed.
    storedFilePath: text('stored_file_path').notNull(),
    sha256: text('sha256'),
    totalPages: integer('total_pages').notNull().default(0),
    indexedPages: integer('indexed_pages').notNull().default(0),
    status: bookStatus('status').notNull().default('UPLOADED'),
    errorMessage: text('error_message'),
    // A replacement upload is tracked here, independently of the active version.
    // While pending_staged_token is set the row's status/sha256/totalPages/
    // indexedPages keep describing the live, working book, so
    // findReadyBookBySubject() still serves it to students until the replacement
    // is fully extracted, validated and promoted. NULL means "no replacement
    // in progress". Only one replacement may be pending per book (enforced by a
    // conditional update that requires this column to be NULL).
    pendingStagedToken: text('pending_staged_token'),
    pendingStagedAt: timestamp('pending_staged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // V1: one primary book per subject.
  (table) => [uniqueIndex('books_subject_id_unique').on(table.subjectId), index('books_status_idx').on(table.status)],
);

export const textbookChunks = pgTable(
  'textbook_chunks',
  {
    id: text('id').primaryKey(),
    bookId: text('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    pdfPage: integer('pdf_page').notNull(),
    printedPage: integer('printed_page'),
    unit: text('unit'),
    lesson: text('lesson'),
    heading: text('heading'),
    text: text('text').notNull(),
    equations: jsonb('equations').$type<string[]>().notNull().default([]),
    pageImagePath: text('page_image_path'),
    searchText: text('search_text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('textbook_chunks_book_id_idx').on(table.bookId),
    index('textbook_chunks_subject_id_idx').on(table.subjectId),
    index('textbook_chunks_book_page_idx').on(table.bookId, table.pdfPage),
    index('textbook_chunks_search_idx').using('gin', sql`to_tsvector('simple', ${table.searchText})`),
    uniqueIndex('textbook_chunks_book_page_unique').on(table.bookId, table.pdfPage),
  ],
);

export type Book = typeof books.$inferSelect;
export type TextbookChunk = typeof textbookChunks.$inferSelect;

export const planType = pgEnum('plan_type', ['MONTHLY', 'SEMESTER']);
export const entitlementStatus = pgEnum('entitlement_status', ['ACTIVE', 'CANCELED', 'EXPIRED', 'REFUNDED', 'PENDING']);

export const subjectPlans = pgTable(
  'subject_plans',
  {
    id: text('id').primaryKey(),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    type: planType('type').notNull(),
    // Freemius plan id; set by admins, never accepted from the browser.
    freemiusPlanId: text('freemius_plan_id'),
    priceMinor: integer('price_minor'),
    // Fahimni credits granted for every monthly usage period.
    monthlyCreditAllowance: integer('monthly_credit_allowance').notNull().default(0),
    currency: text('currency').notNull().default('JOD'),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('subject_plans_subject_type_unique').on(table.subjectId, table.type),
    index('subject_plans_freemius_plan_id_idx').on(table.freemiusPlanId),
  ],
);

// Academic calendar terms are admin-managed; all date boundaries are stored as
// UTC instants converted from Asia/Amman calendar dates (lib/billing/terms.ts).
export const academicTerms = pgTable(
  'academic_terms',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    academicYear: text('academic_year').notNull(),
    gradeId: text('grade_id')
      .notNull()
      .references(() => grades.id, { onDelete: 'cascade' }),
    academicFieldId: text('academic_field_id').references(() => academicFields.id, { onDelete: 'set null' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('academic_terms_identity_unique')
      .on(table.gradeId, table.academicFieldId, table.academicYear, table.name)
      .nullsNotDistinct(),
    index('academic_terms_grade_idx').on(table.gradeId),
    index('academic_terms_field_idx').on(table.academicFieldId),
  ],
);

export const offerKind = pgEnum('offer_kind', ['SUBJECT', 'BUNDLE']);

// One canonical offer entity for all four combinations:
// SUBJECT/BUNDLE × MONTHLY/SEMESTER. `dedupe_key` is computed server-side so a
// single combination can only ever have one row.
export const subscriptionOffers = pgTable(
  'subscription_offers',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    kind: offerKind('kind').notNull(),
    type: planType('type').notNull(),
    subjectId: text('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    gradeId: text('grade_id').references(() => grades.id, { onDelete: 'cascade' }),
    academicFieldId: text('academic_field_id').references(() => academicFields.id, { onDelete: 'set null' }),
    academicTermId: text('academic_term_id').references(() => academicTerms.id, { onDelete: 'set null' }),
    // Freemius plan id; set by admins, never accepted from the browser.
    freemiusPlanId: text('freemius_plan_id'),
    priceMinor: integer('price_minor'),
    // Fahimni credits granted for every monthly usage period.
    monthlyCreditAllowance: integer('monthly_credit_allowance').notNull().default(0),
    currency: text('currency').notNull().default('JOD'),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('subscription_offers_kind_idx').on(table.kind),
    index('subscription_offers_grade_idx').on(table.gradeId),
    index('subscription_offers_freemius_plan_id_idx').on(table.freemiusPlanId),
    index('subscription_offers_term_idx').on(table.academicTermId),
  ],
);

// Declared scope of a bundle offer (admin-managed). Purchases snapshot this set
// into entitlement_subjects so a later edit never changes sold access.
export const bundleSubjects = pgTable(
  'bundle_subjects',
  {
    offerId: text('offer_id')
      .notNull()
      .references(() => subscriptionOffers.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.offerId, table.subjectId] }),
    index('bundle_subjects_subject_idx').on(table.subjectId),
  ],
);

export const entitlements = pgTable(
  'entitlements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // NULL for bundle entitlements; bundle coverage lives in entitlement_subjects.
    subjectId: text('subject_id').references(() => subjects.id, { onDelete: 'cascade' }),
    subjectPlanId: text('subject_plan_id').references(() => subjectPlans.id, { onDelete: 'set null' }),
    offerId: text('offer_id').references(() => subscriptionOffers.id, { onDelete: 'set null' }),
    academicTermId: text('academic_term_id').references(() => academicTerms.id, { onDelete: 'set null' }),
    freemiusLicenseId: text('freemius_license_id').unique(),
    freemiusSubscriptionId: text('freemius_subscription_id'),
    status: entitlementStatus('status').notNull().default('PENDING'),
    // True when the renewal is canceled but access continues until expiresAt.
    renewalCanceled: boolean('renewal_canceled').notNull().default(false),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    creditBalance: integer('credit_balance').notNull().default(0),
    creditPeriodStartedAt: timestamp('credit_period_started_at', { withTimezone: true }),
    creditPeriodEndsAt: timestamp('credit_period_ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('entitlements_user_id_idx').on(table.userId),
    index('entitlements_subject_id_idx').on(table.subjectId),
    index('entitlements_user_subject_idx').on(table.userId, table.subjectId),
    index('entitlements_offer_idx').on(table.offerId),
  ],
);

// Frozen per-purchase bundle coverage: the subjects a verified bundle purchase
// grants. Written once from the offer's declared scope at grant time.
export const entitlementSubjects = pgTable(
  'entitlement_subjects',
  {
    entitlementId: text('entitlement_id')
      .notNull()
      .references(() => entitlements.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.entitlementId, table.subjectId] }),
    index('entitlement_subjects_subject_idx').on(table.subjectId),
  ],
);

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  externalEventId: text('external_event_id').notNull().unique(),
  type: text('type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SubjectPlan = typeof subjectPlans.$inferSelect;
export type AcademicTerm = typeof academicTerms.$inferSelect;
export type SubscriptionOffer = typeof subscriptionOffers.$inferSelect;
export type Entitlement = typeof entitlements.$inferSelect;
export type WebhookEvent = typeof webhookEvents.$inferSelect;

// Admin-visible billing timeline: renewals, failures, cancellations, refunds
// and expiry notes derived from verified provider webhook events. This table
// never grants or removes access; entitlements remain the single source.
export const billingEvents = pgTable(
  'billing_events',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull().default('freemius'),
    type: text('type').notNull(),
    licenseId: text('license_id'),
    subscriptionId: text('subscription_id'),
    userEmail: text('user_email'),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('billing_events_created_idx').on(table.createdAt)],
);

export type BillingEvent = typeof billingEvents.$inferSelect;

export const trialStatus = pgEnum('trial_status', ['CLAIMED', 'ACTIVE', 'EXPIRED', 'EXHAUSTED', 'REVOKED']);

// One free trial per Google account, permanently. The browser identity hash is
// a separate anti-reuse layer: HMAC of a random cookie token, never a
// fingerprint and never a raw device identifier.
export const freeTrials = pgTable(
  'free_trials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),
    browserIdentityHash: text('browser_identity_hash').notNull().unique(),
    status: trialStatus('status').notNull().default('CLAIMED'),
    totalCredits: integer('total_credits').notNull(),
    remainingCredits: integer('remaining_credits').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull(),
    // Set on the first accepted billable AI request, never on signup or page views.
    startedAt: timestamp('started_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('free_trials_status_idx').on(table.status), index('free_trials_user_idx').on(table.userId)],
);

export type FreeTrial = typeof freeTrials.$inferSelect;

// Cost/usage accounting only: never stores questions, images, audio or prompts.
export const aiUsageEvents = pgTable(
  'ai_usage_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    entitlementId: text('entitlement_id').references(() => entitlements.id, { onDelete: 'set null' }),
    // Free-trial usage is auditable without fabricating a paid entitlement.
    trialId: text('trial_id').references(() => freeTrials.id, { onDelete: 'set null' }),
    operation: text('operation').notNull(),
    creditsCharged: integer('credits_charged').notNull(),
    // Conservative reservation (micro-USD) for the trial cost budget.
    estimatedCostMicroUsd: integer('estimated_cost_micro_usd'),
    requestId: text('request_id').notNull().unique(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    audioSeconds: integer('audio_seconds'),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ai_usage_events_user_idx').on(table.userId),
    index('ai_usage_events_subject_idx').on(table.subjectId),
    index('ai_usage_events_trial_idx').on(table.trialId),
  ],
);

export const registeredDevices = pgTable(
  'registered_devices',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // HMAC-SHA256 of the cookie token; the raw token is never stored.
    deviceTokenHash: text('device_token_hash').notNull().unique(),
    name: text('name').notNull(),
    userAgentSummary: text('user_agent_summary'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('registered_devices_user_idx').on(table.userId)],
);

// Small key/value system settings (V1: maxDevicesPerUser only).
export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Admin-managed sensitive credentials, always encrypted at rest with an
// authenticated cipher. The encryption root key lives outside the database
// (SETTINGS_ENCRYPTION_KEY env / KMS) and is never stored here.
export const secureSettings = pgTable('secure_settings', {
  key: text('key').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

// Append-only audit trail for credential and settings changes. Secret values
// are never recorded here.
export const settingAuditLog = pgTable(
  'setting_audit_log',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    action: text('action').notNull(),
    actorId: text('actor_id'),
    actorEmail: text('actor_email'),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('setting_audit_log_key_idx').on(table.key, table.createdAt)],
);

// Verified mapping between a local offer and its provider plan/pricing. A row
// only reaches SYNCED after the provider confirms plan, pricing, currency and
// billing cycle. Demo identifiers can never produce a SYNCED row.
export const offerProviderLinks = pgTable(
  'offer_provider_links',
  {
    offerId: text('offer_id')
      .primaryKey()
      .references(() => subscriptionOffers.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('freemius'),
    planId: text('plan_id'),
    pricingId: text('pricing_id'),
    currency: text('currency'),
    priceMinor: integer('price_minor'),
    billingCycle: text('billing_cycle'),
    status: text('status').notNull().default('PENDING'),
    verified: boolean('verified').notNull().default(false),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('offer_provider_links_provider_plan_unique').on(table.provider, table.planId),
    index('offer_provider_links_status_idx').on(table.status),
  ],
);

// Per-student learning evidence. Progress is private to the authenticated
// student, grows from real assessment outcomes only, and never claims mastery
// from a single correct answer.
export const learningProgress = pgTable(
  'learning_progress',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    state: text('state').notNull().default('NEEDS_PRACTICE'),
    correctCount: integer('correct_count').notNull().default(0),
    incorrectCount: integer('incorrect_count').notNull().default(0),
    lastMisconception: text('last_misconception'),
    lastPracticedAt: timestamp('last_practiced_at', { withTimezone: true }).notNull().defaultNow(),
    reviewDueAt: timestamp('review_due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('learning_progress_user_subject_topic_unique').on(table.userId, table.subjectId, table.topic),
    index('learning_progress_review_idx').on(table.userId, table.reviewDueAt),
  ],
);

export type AiUsageEvent = typeof aiUsageEvents.$inferSelect;
export type RegisteredDevice = typeof registeredDevices.$inferSelect;
