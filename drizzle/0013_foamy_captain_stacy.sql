CREATE TYPE "public"."semester_grant_status" AS ENUM('ACTIVE', 'EXPIRED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "credit_grant_debits" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"amount" integer NOT NULL,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semester_credit_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"semester_id" text NOT NULL,
	"purchase_id" text,
	"entitlement_id" text,
	"granted_credits" integer NOT NULL,
	"remaining_credits" integer NOT NULL,
	"status" "semester_grant_status" DEFAULT 'ACTIVE' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"grant_request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semester_credit_grants_grant_request_id_unique" UNIQUE("grant_request_id")
);
--> statement-breakpoint
ALTER TABLE "credit_grant_debits" ADD CONSTRAINT "credit_grant_debits_grant_id_semester_credit_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."semester_credit_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_credit_grants" ADD CONSTRAINT "semester_credit_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_credit_grants" ADD CONSTRAINT "semester_credit_grants_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_credit_grants" ADD CONSTRAINT "semester_credit_grants_purchase_id_subscription_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."subscription_purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_credit_grants" ADD CONSTRAINT "semester_credit_grants_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_grant_debits_grant_idx" ON "credit_grant_debits" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "credit_grant_debits_request_idx" ON "credit_grant_debits" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_debits_request_grant_unique" ON "credit_grant_debits" USING btree ("request_id","grant_id");--> statement-breakpoint
CREATE INDEX "semester_credit_grants_user_idx" ON "semester_credit_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "semester_credit_grants_semester_idx" ON "semester_credit_grants" USING btree ("semester_id");--> statement-breakpoint
CREATE INDEX "semester_credit_grants_user_status_idx" ON "semester_credit_grants" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "semester_credit_grants_purchase_idx" ON "semester_credit_grants" USING btree ("purchase_id");