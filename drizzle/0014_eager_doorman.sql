CREATE TYPE "public"."credit_operation_kind" AS ENUM('SPEND');--> statement-breakpoint
CREATE TABLE "credit_operations" (
	"request_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" "credit_operation_kind" DEFAULT 'SPEND' NOT NULL,
	"credits" integer NOT NULL,
	"semester_credits" integer DEFAULT 0 NOT NULL,
	"topup_credits" integer DEFAULT 0 NOT NULL,
	"subject_id" text,
	"entitlement_id" text,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_operations" ADD CONSTRAINT "credit_operations_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_operations_user_idx" ON "credit_operations" USING btree ("user_id","created_at");