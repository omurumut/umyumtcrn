CREATE TABLE IF NOT EXISTS "equipment_field_definitions" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "description" text,
  "section" text DEFAULT 'other' NOT NULL,
  "field_type" text NOT NULL,
  "unit_label" text,
  "options_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_required" boolean DEFAULT false NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "validation_config_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "definition_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "created_by" integer,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" integer,
  "archived_at" timestamp,
  "archived_by" integer
);

ALTER TABLE "equipment" ADD COLUMN IF NOT EXISTS "custom_values_json" jsonb DEFAULT '{}'::jsonb NOT NULL;

DO $$ BEGIN
  ALTER TABLE "equipment_field_definitions" ADD CONSTRAINT "equipment_field_definitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id");
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "equipment_field_definitions" ADD CONSTRAINT "equipment_field_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "equipment_field_definitions" ADD CONSTRAINT "equipment_field_definitions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "equipment_field_definitions" ADD CONSTRAINT "equipment_field_definitions_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "equipment_field_definitions_company_code_unique" ON "equipment_field_definitions" ("company_id", "code");
CREATE INDEX IF NOT EXISTS "equipment_field_definitions_company_active_display_idx" ON "equipment_field_definitions" ("company_id", "is_active", "display_order");
CREATE INDEX IF NOT EXISTS "equipment_field_definitions_company_section_idx" ON "equipment_field_definitions" ("company_id", "section");
