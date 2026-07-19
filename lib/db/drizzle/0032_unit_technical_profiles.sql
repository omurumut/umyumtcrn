CREATE TABLE IF NOT EXISTS "unit_technical_profiles" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "unit_id" integer NOT NULL,
  "facility_use_type" text,
  "main_activity" text,
  "building_count" integer,
  "total_enclosed_area_m2" real,
  "heated_area_m2" real,
  "cooled_area_m2" real,
  "open_area_m2" real,
  "personnel_count" integer,
  "average_daily_users" integer,
  "daily_operating_hours" real,
  "weekly_operating_days" real,
  "annual_operating_days" integer,
  "shift_count" integer,
  "shift_type" text,
  "seasonal_operation_status" text,
  "insulation_status" text,
  "heating_system_type" text,
  "cooling_system_type" text,
  "domestic_hot_water_system" text,
  "building_automation_status" text,
  "compressed_air_status" text,
  "steam_system_status" text,
  "generator_status" text,
  "renewable_energy_status" text,
  "main_process_description" text,
  "energy_infrastructure_description" text,
  "known_energy_issues" text,
  "technical_improvements" text,
  "planned_infrastructure_changes" text,
  "profile_status" text DEFAULT 'draft' NOT NULL,
  "profile_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "created_by" integer,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" integer,
  CONSTRAINT "unit_technical_profiles_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id"),
  CONSTRAINT "unit_technical_profiles_unit_fk" FOREIGN KEY ("unit_id") REFERENCES "units"("id"),
  CONSTRAINT "unit_technical_profiles_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "unit_technical_profiles_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "unit_technical_profiles_status_check" CHECK ("profile_status" IN ('draft','published')),
  CONSTRAINT "unit_technical_profiles_version_check" CHECK ("profile_version" >= 1),
  CONSTRAINT "unit_technical_profiles_non_negative_check" CHECK (
    ("building_count" IS NULL OR "building_count" >= 0)
    AND ("total_enclosed_area_m2" IS NULL OR "total_enclosed_area_m2" >= 0)
    AND ("heated_area_m2" IS NULL OR "heated_area_m2" >= 0)
    AND ("cooled_area_m2" IS NULL OR "cooled_area_m2" >= 0)
    AND ("open_area_m2" IS NULL OR "open_area_m2" >= 0)
    AND ("personnel_count" IS NULL OR "personnel_count" >= 0)
    AND ("average_daily_users" IS NULL OR "average_daily_users" >= 0)
    AND ("daily_operating_hours" IS NULL OR "daily_operating_hours" >= 0)
    AND ("weekly_operating_days" IS NULL OR "weekly_operating_days" >= 0)
    AND ("annual_operating_days" IS NULL OR "annual_operating_days" >= 0)
    AND ("shift_count" IS NULL OR "shift_count" >= 0)
  ),
  CONSTRAINT "unit_technical_profiles_operating_bounds_check" CHECK (
    ("daily_operating_hours" IS NULL OR "daily_operating_hours" <= 24)
    AND ("weekly_operating_days" IS NULL OR "weekly_operating_days" <= 7)
    AND ("annual_operating_days" IS NULL OR "annual_operating_days" <= 366)
    AND ("shift_count" IS NULL OR "shift_count" <= 4)
  ),
  CONSTRAINT "unit_technical_profiles_text_length_check" CHECK (
    ("facility_use_type" IS NULL OR char_length("facility_use_type") <= 80)
    AND ("main_activity" IS NULL OR char_length("main_activity") <= 250)
    AND ("shift_type" IS NULL OR char_length("shift_type") <= 80)
    AND ("heating_system_type" IS NULL OR char_length("heating_system_type") <= 120)
    AND ("cooling_system_type" IS NULL OR char_length("cooling_system_type") <= 120)
    AND ("domestic_hot_water_system" IS NULL OR char_length("domestic_hot_water_system") <= 120)
    AND ("main_process_description" IS NULL OR char_length("main_process_description") <= 2000)
    AND ("energy_infrastructure_description" IS NULL OR char_length("energy_infrastructure_description") <= 2000)
    AND ("known_energy_issues" IS NULL OR char_length("known_energy_issues") <= 2000)
    AND ("technical_improvements" IS NULL OR char_length("technical_improvements") <= 2000)
    AND ("planned_infrastructure_changes" IS NULL OR char_length("planned_infrastructure_changes") <= 2000)
  ),
  CONSTRAINT "unit_technical_profiles_status_enum_check" CHECK (
    ("seasonal_operation_status" IS NULL OR "seasonal_operation_status" IN ('yes','no','unknown','not_applicable'))
    AND ("insulation_status" IS NULL OR "insulation_status" IN ('yes','no','unknown','not_applicable'))
    AND ("building_automation_status" IS NULL OR "building_automation_status" IN ('yes','no','unknown','not_applicable'))
    AND ("compressed_air_status" IS NULL OR "compressed_air_status" IN ('yes','no','unknown','not_applicable'))
    AND ("steam_system_status" IS NULL OR "steam_system_status" IN ('yes','no','unknown','not_applicable'))
    AND ("generator_status" IS NULL OR "generator_status" IN ('yes','no','unknown','not_applicable'))
    AND ("renewable_energy_status" IS NULL OR "renewable_energy_status" IN ('yes','no','unknown','not_applicable'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "unit_technical_profiles_unit_id_unique"
  ON "unit_technical_profiles" ("unit_id");

CREATE INDEX IF NOT EXISTS "unit_technical_profiles_company_unit_idx"
  ON "unit_technical_profiles" ("company_id", "unit_id");
