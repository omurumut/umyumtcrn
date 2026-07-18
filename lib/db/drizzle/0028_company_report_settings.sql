CREATE TABLE IF NOT EXISTS "company_report_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "show_logo" boolean DEFAULT true NOT NULL,
  "default_locale" text DEFAULT 'tr-TR' NOT NULL,
  "default_title" text,
  "default_subtitle" text,
  "document_number" text,
  "revision_number" text,
  "revision_date" text,
  "prepared_by" text,
  "checked_by" text,
  "approved_by" text,
  "confidentiality_level" text DEFAULT 'internal' NOT NULL,
  "footer_text" text,
  "show_signature_fields" boolean DEFAULT true NOT NULL,
  "show_page_numbers" boolean DEFAULT true NOT NULL,
  "cover_style" text DEFAULT 'standard' NOT NULL,
  "file_name_pattern" text DEFAULT '{company}_{reportType}_{year}' NOT NULL,
  "profile_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" integer,
  CONSTRAINT "company_report_profiles_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id"),
  CONSTRAINT "company_report_profiles_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "company_report_profiles_locale_check" CHECK ("default_locale" IN ('tr-TR')),
  CONSTRAINT "company_report_profiles_confidentiality_check" CHECK ("confidentiality_level" IN ('public','internal','confidential','restricted')),
  CONSTRAINT "company_report_profiles_cover_style_check" CHECK ("cover_style" IN ('standard','compact','none')),
  CONSTRAINT "company_report_profiles_profile_version_check" CHECK ("profile_version" >= 1),
  CONSTRAINT "company_report_profiles_file_name_pattern_check" CHECK (char_length("file_name_pattern") BETWEEN 1 AND 250)
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_report_profiles_company_id_unique"
  ON "company_report_profiles" ("company_id");

CREATE TABLE IF NOT EXISTS "company_report_type_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "report_type" text NOT NULL,
  "title_override" text,
  "subtitle_override" text,
  "locale_override" text,
  "cover_style_override" text,
  "type_settings_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" integer,
  CONSTRAINT "company_report_type_settings_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id"),
  CONSTRAINT "company_report_type_settings_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "company_report_type_settings_report_type_check" CHECK ("report_type" IN ('annual_energy_performance','energy_targets_management','energy_performance_monitoring')),
  CONSTRAINT "company_report_type_settings_locale_check" CHECK ("locale_override" IS NULL OR "locale_override" IN ('tr-TR')),
  CONSTRAINT "company_report_type_settings_cover_style_check" CHECK ("cover_style_override" IS NULL OR "cover_style_override" IN ('standard','compact','none')),
  CONSTRAINT "company_report_type_settings_version_check" CHECK ("type_settings_version" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_report_type_settings_company_report_type_unique"
  ON "company_report_type_settings" ("company_id", "report_type");

CREATE TABLE IF NOT EXISTS "company_report_section_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "report_type" text NOT NULL,
  "section_code" text NOT NULL,
  "is_visible" boolean DEFAULT true NOT NULL,
  "display_order" integer NOT NULL,
  "label_override" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" integer,
  CONSTRAINT "company_report_section_settings_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id"),
  CONSTRAINT "company_report_section_settings_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "company_report_section_settings_report_type_check" CHECK ("report_type" IN ('annual_energy_performance','energy_targets_management','energy_performance_monitoring')),
  CONSTRAINT "company_report_section_settings_section_code_check" CHECK ("section_code" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT "company_report_section_settings_display_order_check" CHECK ("display_order" BETWEEN 1 AND 1000),
  CONSTRAINT "company_report_section_settings_label_length_check" CHECK ("label_override" IS NULL OR char_length("label_override") <= 150)
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_report_section_settings_company_report_section_unique"
  ON "company_report_section_settings" ("company_id", "report_type", "section_code");

CREATE INDEX IF NOT EXISTS "company_report_section_settings_company_report_type_idx"
  ON "company_report_section_settings" ("company_id", "report_type");
