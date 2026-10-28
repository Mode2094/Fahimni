CREATE TYPE "public"."offer_kind" AS ENUM('SUBJECT', 'BUNDLE');--> statement-breakpoint
CREATE TABLE "academic_terms" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"academic_year" text NOT NULL,
	"grade_id" text NOT NULL,
	"academic_field_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_terms_identity_unique" UNIQUE NULLS NOT DISTINCT("grade_id","academic_field_id","academic_year","name")
);
--> statement-breakpoint
CREATE TABLE "bundle_subjects" (
	"offer_id" text NOT NULL,
	"subject_id" text NOT NULL,
	CONSTRAINT "bundle_subjects_offer_id_subject_id_pk" PRIMARY KEY("offer_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "entitlement_subjects" (
	"entitlement_id" text NOT NULL,
	"subject_id" text NOT NULL,
	CONSTRAINT "entitlement_subjects_entitlement_id_subject_id_pk" PRIMARY KEY("entitlement_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "subscription_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" "offer_kind" NOT NULL,
	"type" "plan_type" NOT NULL,
	"subject_id" text,
	"grade_id" text,
	"academic_field_id" text,
	"academic_term_id" text,
	"freemius_plan_id" text,
	"price_minor" integer,
	"monthly_credit_allowance" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'JOD' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_offers_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "subject_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "offer_id" text;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "academic_term_id" text;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "renewal_canceled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_terms" ADD CONSTRAINT "academic_terms_academic_field_id_academic_fields_id_fk" FOREIGN KEY ("academic_field_id") REFERENCES "public"."academic_fields"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_subjects" ADD CONSTRAINT "bundle_subjects_offer_id_subscription_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."subscription_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bundle_subjects" ADD CONSTRAINT "bundle_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_subjects" ADD CONSTRAINT "entitlement_subjects_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_subjects" ADD CONSTRAINT "entitlement_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_offers" ADD CONSTRAINT "subscription_offers_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_offers" ADD CONSTRAINT "subscription_offers_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_offers" ADD CONSTRAINT "subscription_offers_academic_field_id_academic_fields_id_fk" FOREIGN KEY ("academic_field_id") REFERENCES "public"."academic_fields"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_offers" ADD CONSTRAINT "subscription_offers_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academic_terms_grade_idx" ON "academic_terms" USING btree ("grade_id");--> statement-breakpoint
CREATE INDEX "academic_terms_field_idx" ON "academic_terms" USING btree ("academic_field_id");--> statement-breakpoint
CREATE INDEX "bundle_subjects_subject_idx" ON "bundle_subjects" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "entitlement_subjects_subject_idx" ON "entitlement_subjects" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "subscription_offers_kind_idx" ON "subscription_offers" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "subscription_offers_grade_idx" ON "subscription_offers" USING btree ("grade_id");--> statement-breakpoint
CREATE INDEX "subscription_offers_freemius_plan_id_idx" ON "subscription_offers" USING btree ("freemius_plan_id");--> statement-breakpoint
CREATE INDEX "subscription_offers_term_idx" ON "subscription_offers" USING btree ("academic_term_id");--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_offer_id_subscription_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."subscription_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_academic_term_id_academic_terms_id_fk" FOREIGN KEY ("academic_term_id") REFERENCES "public"."academic_terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlements_offer_idx" ON "entitlements" USING btree ("offer_id");--> statement-breakpoint
INSERT INTO "subscription_offers" (
	"id", "dedupe_key", "kind", "type", "subject_id", "freemius_plan_id", "price_minor",
	"monthly_credit_allowance", "currency", "is_active", "created_at", "updated_at"
)
SELECT
	"id",
	'SUBJECT:' || "subject_id" || ':' || "type"::text || ':-',
	'SUBJECT'::"offer_kind",
	"type",
	"subject_id",
	"freemius_plan_id",
	"price_minor",
	"monthly_credit_allowance",
	"currency",
	"is_active",
	"created_at",
	"updated_at"
FROM "subject_plans"
ON CONFLICT ("dedupe_key") DO NOTHING;--> statement-breakpoint
UPDATE "entitlements"
SET "offer_id" = "subject_plan_id"
WHERE "subject_plan_id" IS NOT NULL AND "offer_id" IS NULL;