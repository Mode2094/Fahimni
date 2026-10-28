CREATE TYPE "public"."book_status" AS ENUM('UPLOADED', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "books" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"title" text NOT NULL,
	"original_file_name" text NOT NULL,
	"stored_file_path" text NOT NULL,
	"sha256" text,
	"total_pages" integer DEFAULT 0 NOT NULL,
	"indexed_pages" integer DEFAULT 0 NOT NULL,
	"status" "book_status" DEFAULT 'UPLOADED' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "textbook_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"source_id" text NOT NULL,
	"pdf_page" integer NOT NULL,
	"printed_page" integer,
	"unit" text,
	"lesson" text,
	"heading" text,
	"text" text NOT NULL,
	"equations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page_image_path" text,
	"search_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_chunks" ADD CONSTRAINT "textbook_chunks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_chunks" ADD CONSTRAINT "textbook_chunks_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "books_subject_id_unique" ON "books" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "books_status_idx" ON "books" USING btree ("status");--> statement-breakpoint
CREATE INDEX "textbook_chunks_book_id_idx" ON "textbook_chunks" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "textbook_chunks_subject_id_idx" ON "textbook_chunks" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "textbook_chunks_book_page_idx" ON "textbook_chunks" USING btree ("book_id","pdf_page");--> statement-breakpoint
CREATE INDEX "textbook_chunks_search_idx" ON "textbook_chunks" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint
CREATE UNIQUE INDEX "textbook_chunks_book_page_unique" ON "textbook_chunks" USING btree ("book_id","pdf_page");