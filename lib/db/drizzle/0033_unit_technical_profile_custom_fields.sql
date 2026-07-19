ALTER TABLE "unit_technical_profiles"
ADD COLUMN IF NOT EXISTS "custom_values_json" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "unit_technical_profile_field_definitions" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "field_type" text NOT NULL,
  "unit_label" text,
  "options_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "is_required_for_publish" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "validation_config_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "definition_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "unit_technical_profile_field_definitions_code_check"
    CHECK ("code" ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT "unit_technical_profile_field_definitions_field_type_check"
    CHECK ("field_type" IN ('short_text', 'long_text', 'integer', 'decimal', 'boolean', 'single_select', 'multi_select', 'date', 'unit_number')),
  CONSTRAINT "unit_technical_profile_field_definitions_sort_order_check"
    CHECK ("sort_order" >= 0),
  CONSTRAINT "unit_technical_profile_field_definitions_version_check"
    CHECK ("definition_version" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "utp_field_definitions_company_code_unique"
ON "unit_technical_profile_field_definitions" ("company_id", "code");

CREATE INDEX IF NOT EXISTS "utp_field_definitions_company_active_sort_idx"
ON "unit_technical_profile_field_definitions" ("company_id", "is_active", "sort_order");
