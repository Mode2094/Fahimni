CREATE TABLE "academic_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"grade_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grades_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"grade_id" text NOT NULL,
	"academic_field_id" text,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"grade_id" text NOT NULL,
	"academic_field_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"short_description" text,
	"image" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "academic_fields" ADD CONSTRAINT "academic_fields_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_academic_field_id_academic_fields_id_fk" FOREIGN KEY ("academic_field_id") REFERENCES "public"."academic_fields"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_academic_field_id_academic_fields_id_fk" FOREIGN KEY ("academic_field_id") REFERENCES "public"."academic_fields"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_fields_grade_slug_idx" ON "academic_fields" USING btree ("grade_id","slug");--> statement-breakpoint
CREATE INDEX "student_profiles_grade_id_idx" ON "student_profiles" USING btree ("grade_id");--> statement-breakpoint
CREATE INDEX "student_profiles_academic_field_id_idx" ON "student_profiles" USING btree ("academic_field_id");--> statement-breakpoint
CREATE INDEX "subjects_grade_id_idx" ON "subjects" USING btree ("grade_id");--> statement-breakpoint
CREATE INDEX "subjects_academic_field_id_idx" ON "subjects" USING btree ("academic_field_id");