CREATE TABLE IF NOT EXISTS "report_archives" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "unit_id" integer,
  "report_type" text NOT NULL,
  "report_year" integer,
  "period_label" text,
  "title" text NOT NULL,
  "output_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer,
  "checksum_sha256" text,
  "storage_provider" text,
  "storage_key" text,
  "status" text DEFAULT 'generating' NOT NULL,
  "generated_by" integer,
  "generated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "failed_at" timestamp,
  "failure_category" text,
  "snapshot_id" integer,
  "legacy_report_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "report_archives_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "report_archives_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "report_archives_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "report_archives_snapshot_id_report_generation_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."report_generation_snapshots"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "report_archives_report_type_check" CHECK ("report_type" IN ('annual_energy_performance','energy_targets_management','energy_performance_monitoring')),
  CONSTRAINT "report_archives_status_check" CHECK ("status" IN ('generating','completed','failed','deleted')),
  CONSTRAINT "report_archives_content_type_check" CHECK ("content_type" IN ('text/html; charset=utf-8','application/pdf')),
  CONSTRAINT "report_archives_year_check" CHECK ("report_year" IS NULL OR ("report_year" BETWEEN 1900 AND 3000)),
  CONSTRAINT "report_archives_output_name_check" CHECK (char_length("output_name") BETWEEN 1 AND 180),
  CONSTRAINT "report_archives_storage_key_check" CHECK ("storage_key" IS NULL OR ("storage_key" !~ '(^/|\\\\|\\.\\.)' AND char_length("storage_key") BETWEEN 20 AND 500)),
  CONSTRAINT "report_archives_size_check" CHECK ("size_bytes" IS NULL OR "size_bytes" > 0),
  CONSTRAINT "report_archives_checksum_check" CHECK ("checksum_sha256" IS NULL OR "checksum_sha256" ~ '^[a-f0-9]{64}$')
);

ALTER TABLE "report_generation_snapshots" DROP CONSTRAINT IF EXISTS "report_generation_snapshots_storage_status_check";
ALTER TABLE "report_generation_snapshots" ADD CONSTRAINT "report_generation_snapshots_storage_status_check"
  CHECK ("storage_status" IN ('not_stored','stored','storage_failed'));

CREATE UNIQUE INDEX IF NOT EXISTS "report_archives_storage_key_unique"
  ON "report_archives" ("storage_key");

CREATE INDEX IF NOT EXISTS "report_archives_company_generated_idx"
  ON "report_archives" ("company_id", "generated_at");

CREATE INDEX IF NOT EXISTS "report_archives_company_report_status_idx"
  ON "report_archives" ("company_id", "report_type", "status", "generated_at");

CREATE INDEX IF NOT EXISTS "report_archives_snapshot_idx"
  ON "report_archives" ("snapshot_id");
