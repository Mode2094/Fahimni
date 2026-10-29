CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'freemius' NOT NULL,
	"type" text NOT NULL,
	"license_id" text,
	"subscription_id" text,
	"user_email" text,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "billing_events_created_idx" ON "billing_events" USING btree ("created_at");