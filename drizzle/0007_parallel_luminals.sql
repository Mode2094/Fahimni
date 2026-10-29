CREATE TYPE "public"."trial_status" AS ENUM('CLAIMED', 'ACTIVE', 'EXPIRED', 'EXHAUSTED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "free_trials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"browser_identity_hash" text NOT NULL,
	"status" "trial_status" DEFAULT 'CLAIMED' NOT NULL,
	"total_credits" integer NOT NULL,
	"remaining_credits" integer NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "free_trials_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "free_trials_browser_identity_hash_unique" UNIQUE("browser_identity_hash")
);
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "trial_id" text;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "estimated_cost_micro_usd" integer;--> statement-breakpoint
ALTER TABLE "free_trials" ADD CONSTRAINT "free_trials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "free_trials_status_idx" ON "free_trials" USING btree ("status");--> statement-breakpoint
CREATE INDEX "free_trials_user_idx" ON "free_trials" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_trial_id_free_trials_id_fk" FOREIGN KEY ("trial_id") REFERENCES "public"."free_trials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_events_trial_idx" ON "ai_usage_events" USING btree ("trial_id");