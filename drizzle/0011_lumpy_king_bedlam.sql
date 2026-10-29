ALTER TABLE "books" ADD COLUMN "pending_staged_token" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "pending_staged_at" timestamp with time zone;