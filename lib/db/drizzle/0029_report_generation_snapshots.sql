CREATE TABLE IF NOT EXISTS "report_generation_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "unit_id" integer,
  "report_type" text NOT NULL,
  "year" integer,
  "status" text DEFAULT 'generating' NOT NULL,
  "storage_status" text DEFAULT 'not_stored' NOT NULL,
  "filename" text,
  "settings_snapshot_json" jsonb NOT NULL,
  "generated_by" integer,
  "generated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "failed_at" timestamp,
  "failure_reason" text,
  CONSTRAINT "report_generation_snapshots_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id"),
  CONSTRAINT "report_generation_snapshots_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL,
  CONSTRAINT "report_generation_snapshots_generated_by_fk" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "report_generation_snapshots_report_type_check" CHECK ("report_type" IN ('annual_energy_performance','energy_targets_management','energy_performance_monitoring')),
  CONSTRAINT "report_generation_snapshots_status_check" CHECK ("status" IN ('generating','completed','failed')),
  CONSTRAINT "report_generation_snapshots_storage_status_check" CHECK ("storage_status" IN ('not_stored')),
  CONSTRAINT "report_generation_snapshots_year_check" CHECK ("year" IS NULL OR ("year" BETWEEN 2000 AND 3000)),
  CONSTRAINT "report_generation_snapshots_filename_check" CHECK ("filename" IS NULL OR char_length("filename") BETWEEN 1 AND 160)
);

CREATE INDEX IF NOT EXISTS "report_generation_snapshots_company_report_generated_idx"
  ON "report_generation_snapshots" ("company_id", "report_type", "generated_at");

CREATE INDEX IF NOT EXISTS "report_generation_snapshots_status_idx"
  ON "report_generation_snapshots" ("status");
