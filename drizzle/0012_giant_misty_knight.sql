CREATE TYPE "public"."credit_bucket" AS ENUM('SEMESTER', 'TOPUP');--> statement-breakpoint
CREATE TYPE "public"."credit_ledger_kind" AS ENUM('GRANT', 'CONSUME', 'REFUND', 'TOPUP_PURCHASE', 'ADMIN_ADJUSTMENT', 'REVERSAL', 'EXPIRE');--> statement-breakpoint
CREATE TYPE "public"."late_enrollment_policy" AS ENUM('FULL_PRICE', 'PRORATED');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('PENDING', 'ACTIVE', 'CANCELED', 'EXPIRED', 'REFUNDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."semester_status" AS ENUM('DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."topup_offer_status" AS ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"bucket" "credit_bucket" NOT NULL,
	"kind" "credit_ledger_kind" NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"subject_id" text,
	"semester_id" text,
	"entitlement_id" text,
	"topup_purchase_id" text,
	"request_id" text NOT NULL,
	"reverses_request_id" text,
	"note" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "credit_wallets" (
	"user_id" text PRIMARY KEY NOT NULL,
	"semester_balance" integer DEFAULT 0 NOT NULL,
	"topup_balance" integer DEFAULT 0 NOT NULL,
	"semester_granted_at" timestamp with time zone,
	"semester_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semesters" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"academic_year" text NOT NULL,
	"grade_id" text NOT NULL,
	"academic_field_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"sales_start_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sales_end_at" timestamp with time zone,
	"price_minor" integer NOT NULL,
	"currency" text DEFAULT 'JOD' NOT NULL,
	"included_credits" integer DEFAULT 0 NOT NULL,
	"status" "semester_status" DEFAULT 'DRAFT' NOT NULL,
	"late_enrollment_policy" "late_enrollment_policy" DEFAULT 'FULL_PRICE' NOT NULL,
	"top_up_enabled" boolean DEFAULT true NOT NULL,
	"freemius_plan_id" text,
	"admin_notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"semester_id" text NOT NULL,
	"entitlement_id" text,
	"semester_name" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"included_credits" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"late_enrollment" boolean DEFAULT false NOT NULL,
	"status" "purchase_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text DEFAULT 'freemius' NOT NULL,
	"provider_license_id" text,
	"provider_subscription_id" text,
	"provider_plan_id" text,
	"credits_granted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_purchases_provider_license_id_unique" UNIQUE("provider_license_id")
);
--> statement-breakpoint
CREATE TABLE "topup_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"credits" integer NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text DEFAULT 'JOD' NOT NULL,
	"status" "topup_offer_status" DEFAULT 'DRAFT' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"freemius_plan_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topup_purchases" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"offer_id" text,
	"offer_name" text NOT NULL,
	"credits" integer NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "purchase_status" DEFAULT 'PENDING' NOT NULL,
	"provider" text DEFAULT 'freemius' NOT NULL,
	"provider_transaction_id" text,
	"provider_license_id" text,
	"provider_plan_id" text,
	"credits_granted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topup_purchases_provider_transaction_id_unique" UNIQUE("provider_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_academic_field_id_academic_fields_id_fk" FOREIGN KEY ("academic_field_id") REFERENCES "public"."academic_fields"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topup_purchases" ADD CONSTRAINT "topup_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topup_purchases" ADD CONSTRAINT "topup_purchases_offer_id_topup_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."topup_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_bucket_idx" ON "credit_ledger" USING btree ("user_id","bucket");--> statement-breakpoint
CREATE INDEX "credit_ledger_semester_idx" ON "credit_ledger" USING btree ("semester_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_kind_idx" ON "credit_ledger" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "semesters_status_idx" ON "semesters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "semesters_grade_idx" ON "semesters" USING btree ("grade_id");--> statement-breakpoint
CREATE INDEX "semesters_scope_idx" ON "semesters" USING btree ("grade_id","academic_field_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "semesters_freemius_plan_idx" ON "semesters" USING btree ("freemius_plan_id");--> statement-breakpoint
CREATE INDEX "subscription_purchases_user_idx" ON "subscription_purchases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_purchases_semester_idx" ON "subscription_purchases" USING btree ("semester_id");--> statement-breakpoint
CREATE INDEX "subscription_purchases_status_idx" ON "subscription_purchases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscription_purchases_user_semester_idx" ON "subscription_purchases" USING btree ("user_id","semester_id");--> statement-breakpoint
CREATE INDEX "topup_offers_status_idx" ON "topup_offers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "topup_offers_freemius_plan_idx" ON "topup_offers" USING btree ("freemius_plan_id");--> statement-breakpoint
CREATE INDEX "topup_purchases_user_idx" ON "topup_purchases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "topup_purchases_status_idx" ON "topup_purchases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "topup_purchases_offer_idx" ON "topup_purchases" USING btree ("offer_id");