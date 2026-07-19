CREATE TABLE IF NOT EXISTS "company_report_retention_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "retention_enabled" boolean DEFAULT false NOT NULL,
  "completed_retention_days" integer DEFAULT 3650 NOT NULL,
  "failed_retention_days" integer DEFAULT 90 NOT NULL,
  "deleted_grace_days" integer DEFAULT 30 NOT NULL,
  "automatic_cleanup_allowed" boolean DEFAULT false NOT NULL,
  "settings_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" integer,
  CONSTRAINT "company_report_retention_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "company_report_retention_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "company_report_retention_settings_days_check" CHECK (
    "completed_retention_days" BETWEEN 365 AND 36500
    AND "failed_retention_days" BETWEEN 30 AND 3650
    AND "deleted_grace_days" BETWEEN 7 AND 365
  ),
  CONSTRAINT "company_report_retention_settings_version_check" CHECK ("settings_version" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_report_retention_settings_company_id_unique"
  ON "company_report_retention_settings" ("company_id");

ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "deleted_by" integer;
ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "delete_reason" text;
ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "purge_eligible_at" timestamp;
ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "purged_at" timestamp;
ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "purged_by" integer;
ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "purge_failure_category" text;
ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "retention_expires_at" timestamp;
ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "deletion_locked" boolean DEFAULT false NOT NULL;
ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "previous_status" text;
ALTER TABLE "report_archives" ADD COLUMN IF NOT EXISTS "lifecycle_version" integer DEFAULT 1 NOT NULL;

ALTER TABLE "report_archives" DROP CONSTRAINT IF EXISTS "report_archives_deleted_by_users_id_fk";
ALTER TABLE "report_archives" ADD CONSTRAINT "report_archives_deleted_by_users_id_fk"
  FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "report_archives" DROP CONSTRAINT IF EXISTS "report_archives_purged_by_users_id_fk";
ALTER TABLE "report_archives" ADD CONSTRAINT "report_archives_purged_by_users_id_fk"
  FOREIGN KEY ("purged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "report_archives" DROP CONSTRAINT IF EXISTS "report_archives_status_check";
ALTER TABLE "report_archives" ADD CONSTRAINT "report_archives_status_check"
  CHECK ("status" IN ('generating','completed','failed','deleted','purging','purged','purge_failed'));

ALTER TABLE "report_archives" DROP CONSTRAINT IF EXISTS "report_archives_lifecycle_status_check";
ALTER TABLE "report_archives" ADD CONSTRAINT "report_archives_lifecycle_status_check"
  CHECK (
    ("status" <> 'deleted' OR "deleted_at" IS NOT NULL)
    AND ("status" <> 'purged' OR "purged_at" IS NOT NULL)
    AND ("previous_status" IS NULL OR "previous_status" IN ('completed','failed'))
    AND "lifecycle_version" >= 1
  );

ALTER TABLE "report_archives" DROP CONSTRAINT IF EXISTS "report_archives_delete_reason_check";
ALTER TABLE "report_archives" ADD CONSTRAINT "report_archives_delete_reason_check"
  CHECK ("delete_reason" IS NULL OR (char_length("delete_reason") BETWEEN 3 AND 160 AND "delete_reason" !~ '[\x00-\x1f\x7f]'));

CREATE INDEX IF NOT EXISTS "report_archives_company_retention_idx"
  ON "report_archives" ("company_id", "status", "retention_expires_at");

CREATE INDEX IF NOT EXISTS "report_archives_company_purge_eligible_idx"
  ON "report_archives" ("company_id", "status", "purge_eligible_at");
