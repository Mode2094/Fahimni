CREATE TABLE "offer_provider_links" (
	"offer_id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'freemius' NOT NULL,
	"plan_id" text,
	"pricing_id" text,
	"currency" text,
	"price_minor" integer,
	"billing_cycle" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secure_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "setting_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offer_provider_links" ADD CONSTRAINT "offer_provider_links_offer_id_subscription_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."subscription_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_provider_links_provider_plan_unique" ON "offer_provider_links" USING btree ("provider","plan_id");--> statement-breakpoint
CREATE INDEX "offer_provider_links_status_idx" ON "offer_provider_links" USING btree ("status");--> statement-breakpoint
CREATE INDEX "setting_audit_log_key_idx" ON "setting_audit_log" USING btree ("key","created_at");