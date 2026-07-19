CREATE TABLE IF NOT EXISTS "unit_technical_profile_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id"),
  "unit_id" integer NOT NULL REFERENCES "units"("id"),
  "source_profile_id" integer REFERENCES "unit_technical_profiles"("id") ON DELETE SET NULL,
  "snapshot_number" integer NOT NULL,
  "profile_version" integer NOT NULL,
  "profile_status" text NOT NULL DEFAULT 'published',
  "valid_from" text NOT NULL,
  "valid_to" text,
  "published_at" timestamp NOT NULL DEFAULT now(),
  "published_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "standard_values_json" jsonb NOT NULL,
  "custom_values_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "custom_definition_snapshot_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "completion_percentage" integer NOT NULL DEFAULT 0,
  "change_summary" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "utp_snapshots_snapshot_number_check" CHECK ("snapshot_number" >= 1),
  CONSTRAINT "utp_snapshots_profile_version_check" CHECK ("profile_version" >= 1),
  CONSTRAINT "utp_snapshots_profile_status_check" CHECK ("profile_status" = 'published'),
  CONSTRAINT "utp_snapshots_valid_from_check" CHECK ("valid_from" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT "utp_snapshots_valid_to_check" CHECK ("valid_to" IS NULL OR "valid_to" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT "utp_snapshots_completion_check" CHECK ("completion_percentage" >= 0 AND "completion_percentage" <= 100),
  CONSTRAINT "utp_snapshots_valid_range_check" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from")
);

CREATE UNIQUE INDEX IF NOT EXISTS "utp_snapshots_unit_snapshot_number_unique"
ON "unit_technical_profile_snapshots" ("unit_id", "snapshot_number");

CREATE UNIQUE INDEX IF NOT EXISTS "utp_snapshots_unit_valid_from_unique"
ON "unit_technical_profile_snapshots" ("unit_id", "valid_from");

CREATE INDEX IF NOT EXISTS "utp_snapshots_company_unit_valid_from_idx"
ON "unit_technical_profile_snapshots" ("company_id", "unit_id", "valid_from");

CREATE INDEX IF NOT EXISTS "utp_snapshots_company_unit_valid_to_idx"
ON "unit_technical_profile_snapshots" ("company_id", "unit_id", "valid_to");
