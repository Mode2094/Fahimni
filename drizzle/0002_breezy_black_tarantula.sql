ALTER TABLE "subjects" ADD COLUMN "monthly_price_minor" integer;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "semester_price_minor" integer;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "currency" text DEFAULT 'JOD' NOT NULL;