CREATE TABLE IF NOT EXISTS "energy_review_records" (
        "id" serial PRIMARY KEY NOT NULL,
        "company_id" integer NOT NULL,
        "unit_id" integer,
        "review_name" text NOT NULL,
        "review_year" integer NOT NULL,
        "period_type" text NOT NULL DEFAULT 'annual',
        "period_start" text NOT NULL,
        "period_end" text NOT NULL,
        "scope_type" text NOT NULL DEFAULT 'unit',
        "status" text NOT NULL DEFAULT 'draft',
        "prepared_by_user_id" integer NOT NULL,
        "completed_by_user_id" integer,
        "completed_at" timestamp,
        "revision_no" integer NOT NULL DEFAULT 1,
        "previous_revision_id" integer,
        "general_notes" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_review_records" ADD CONSTRAINT "energy_review_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_review_records" ADD CONSTRAINT "energy_review_records_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_review_records" ADD CONSTRAINT "energy_review_records_prepared_by_user_id_users_id_fk" FOREIGN KEY ("prepared_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_review_records" ADD CONSTRAINT "energy_review_records_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_review_records" ADD CONSTRAINT "energy_review_records_previous_revision_id_energy_review_records_id_fk" FOREIGN KEY ("previous_revision_id") REFERENCES "public"."energy_review_records"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_review_records_company_id_idx" ON "energy_review_records" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_review_records_company_year_idx" ON "energy_review_records" USING btree ("company_id","review_year");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_review_records_company_unit_idx" ON "energy_review_records" USING btree ("company_id","unit_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_review_records_previous_revision_idx" ON "energy_review_records" USING btree ("previous_revision_id");
