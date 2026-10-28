CREATE TYPE "public"."entitlement_status" AS ENUM('ACTIVE', 'CANCELED', 'EXPIRED', 'REFUNDED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('MONTHLY', 'SEMESTER');--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_plan_id" text,
	"freemius_license_id" text,
	"freemius_subscription_id" text,
	"status" "entitlement_status" DEFAULT 'PENDING' NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_freemius_license_id_unique" UNIQUE("freemius_license_id")
);
--> statement-breakpoint
CREATE TABLE "subject_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"type" "plan_type" NOT NULL,
	"freemius_plan_id" text,
	"price_minor" integer,
	"currency" text DEFAULT 'JOD' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"external_event_id" text NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_external_event_id_unique" UNIQUE("external_event_id")
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_subject_plan_id_subject_plans_id_fk" FOREIGN KEY ("subject_plan_id") REFERENCES "public"."subject_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_plans" ADD CONSTRAINT "subject_plans_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlements_user_id_idx" ON "entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entitlements_subject_id_idx" ON "entitlements" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "entitlements_user_subject_idx" ON "entitlements" USING btree ("user_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_plans_subject_type_unique" ON "subject_plans" USING btree ("subject_id","type");--> statement-breakpoint
CREATE INDEX "subject_plans_freemius_plan_id_idx" ON "subject_plans" USING btree ("freemius_plan_id");