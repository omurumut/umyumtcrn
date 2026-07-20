CREATE TABLE IF NOT EXISTS "equipment" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id"),
  "unit_id" integer NOT NULL REFERENCES "units"("id"),
  "sub_unit_id" integer REFERENCES "sub_units"("id") ON DELETE SET NULL,
  "equipment_code" text NOT NULL,
  "name" text NOT NULL,
  "equipment_kind" text NOT NULL DEFAULT 'physical',
  "category" text NOT NULL,
  "sub_type" text,
  "status" text NOT NULL DEFAULT 'active',
  "asset_code" text,
  "manufacturer" text,
  "brand" text,
  "model" text,
  "serial_number" text,
  "tag_code" text,
  "location_text" text,
  "building_text" text,
  "process_text" text,
  "parent_equipment_id" integer REFERENCES "equipment"("id") ON DELETE SET NULL,
  "energy_use_group_id" integer REFERENCES "energy_use_groups"("id") ON DELETE SET NULL,
  "measurement_method" text NOT NULL DEFAULT 'unknown',
  "measurement_confidence" text NOT NULL DEFAULT 'unknown',
  "rated_power_value" real,
  "rated_power_unit" text,
  "installed_power_kw" real,
  "capacity_value" real,
  "capacity_unit" text,
  "nominal_efficiency_percent" real,
  "operational_status" text,
  "daily_operating_hours" real,
  "annual_operating_hours" real,
  "average_load_percent" real,
  "seasonal_operation_status" text,
  "purchase_date" text,
  "commissioning_date" text,
  "manufacture_year" integer,
  "expected_life_years" integer,
  "planned_replacement_year" integer,
  "is_energy_intensive" boolean NOT NULL DEFAULT false,
  "is_critical" boolean NOT NULL DEFAULT false,
  "criticality_reason" text,
  "saving_potential" text,
  "technical_notes" text,
  "maintenance_notes" text,
  "efficiency_opportunities" text,
  "planned_improvements" text,
  "equipment_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "archived_at" timestamp,
  "archived_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "equipment_code_check" CHECK ("equipment_code" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  CONSTRAINT "equipment_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 160),
  CONSTRAINT "equipment_kind_check" CHECK ("equipment_kind" IN ('physical','logical')),
  CONSTRAINT "equipment_category_check" CHECK ("category" IN ('motor','pump','fan','compressor','boiler','chiller','hvac','transformer','generator','ups','lighting','renewable','process_line','other')),
  CONSTRAINT "equipment_status_check" CHECK ("status" IN ('active','standby','maintenance','faulty','out_of_service','archived')),
  CONSTRAINT "equipment_measurement_method_check" CHECK ("measurement_method" IN ('direct','shared','allocated','estimated','unmeasured','unknown')),
  CONSTRAINT "equipment_measurement_confidence_check" CHECK ("measurement_confidence" IN ('high','medium','low','unknown')),
  CONSTRAINT "equipment_operational_status_check" CHECK ("operational_status" IS NULL OR "operational_status" IN ('running','stopped','standby','unknown','not_applicable')),
  CONSTRAINT "equipment_seasonal_operation_check" CHECK ("seasonal_operation_status" IS NULL OR "seasonal_operation_status" IN ('yes','no','unknown','not_applicable')),
  CONSTRAINT "equipment_non_negative_check" CHECK (
    ("rated_power_value" IS NULL OR "rated_power_value" >= 0)
    AND ("installed_power_kw" IS NULL OR "installed_power_kw" >= 0)
    AND ("capacity_value" IS NULL OR "capacity_value" >= 0)
  ),
  CONSTRAINT "equipment_percent_check" CHECK (
    ("nominal_efficiency_percent" IS NULL OR ("nominal_efficiency_percent" >= 0 AND "nominal_efficiency_percent" <= 100))
    AND ("average_load_percent" IS NULL OR ("average_load_percent" >= 0 AND "average_load_percent" <= 100))
  ),
  CONSTRAINT "equipment_hours_check" CHECK (
    ("daily_operating_hours" IS NULL OR ("daily_operating_hours" >= 0 AND "daily_operating_hours" <= 24))
    AND ("annual_operating_hours" IS NULL OR ("annual_operating_hours" >= 0 AND "annual_operating_hours" <= 8784))
  ),
  CONSTRAINT "equipment_year_check" CHECK (
    ("manufacture_year" IS NULL OR ("manufacture_year" BETWEEN 1900 AND 3000))
    AND ("planned_replacement_year" IS NULL OR ("planned_replacement_year" BETWEEN 1900 AND 3000))
    AND ("expected_life_years" IS NULL OR ("expected_life_years" BETWEEN 0 AND 200))
  ),
  CONSTRAINT "equipment_date_check" CHECK (
    ("purchase_date" IS NULL OR "purchase_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    AND ("commissioning_date" IS NULL OR "commissioning_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  ),
  CONSTRAINT "equipment_text_length_check" CHECK (
    ("sub_type" IS NULL OR char_length("sub_type") <= 120)
    AND ("asset_code" IS NULL OR char_length("asset_code") <= 120)
    AND ("manufacturer" IS NULL OR char_length("manufacturer") <= 120)
    AND ("brand" IS NULL OR char_length("brand") <= 120)
    AND ("model" IS NULL OR char_length("model") <= 120)
    AND ("serial_number" IS NULL OR char_length("serial_number") <= 120)
    AND ("tag_code" IS NULL OR char_length("tag_code") <= 120)
    AND ("location_text" IS NULL OR char_length("location_text") <= 240)
    AND ("building_text" IS NULL OR char_length("building_text") <= 160)
    AND ("process_text" IS NULL OR char_length("process_text") <= 160)
    AND ("rated_power_unit" IS NULL OR char_length("rated_power_unit") <= 24)
    AND ("capacity_unit" IS NULL OR char_length("capacity_unit") <= 40)
    AND ("criticality_reason" IS NULL OR char_length("criticality_reason") <= 500)
    AND ("saving_potential" IS NULL OR char_length("saving_potential") <= 500)
    AND ("technical_notes" IS NULL OR char_length("technical_notes") <= 1000)
    AND ("maintenance_notes" IS NULL OR char_length("maintenance_notes") <= 1000)
    AND ("efficiency_opportunities" IS NULL OR char_length("efficiency_opportunities") <= 1000)
    AND ("planned_improvements" IS NULL OR char_length("planned_improvements") <= 1000)
  ),
  CONSTRAINT "equipment_version_check" CHECK ("equipment_version" >= 1),
  CONSTRAINT "equipment_parent_not_self_check" CHECK ("parent_equipment_id" IS NULL OR "parent_equipment_id" <> "id"),
  CONSTRAINT "equipment_archive_metadata_check" CHECK (("status" <> 'archived') OR ("archived_at" IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS "equipment_company_code_unique" ON "equipment" ("company_id", "equipment_code");
CREATE INDEX IF NOT EXISTS "equipment_company_unit_idx" ON "equipment" ("company_id", "unit_id");
CREATE INDEX IF NOT EXISTS "equipment_company_unit_status_idx" ON "equipment" ("company_id", "unit_id", "status");
CREATE INDEX IF NOT EXISTS "equipment_company_category_idx" ON "equipment" ("company_id", "category");
CREATE INDEX IF NOT EXISTS "equipment_company_archived_idx" ON "equipment" ("company_id", "archived_at");
CREATE INDEX IF NOT EXISTS "equipment_parent_idx" ON "equipment" ("parent_equipment_id");

CREATE TABLE IF NOT EXISTS "equipment_meter_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id"),
  "equipment_id" integer NOT NULL REFERENCES "equipment"("id") ON DELETE NO ACTION,
  "meter_id" integer NOT NULL REFERENCES "meters"("id") ON DELETE NO ACTION,
  "relation_role" text NOT NULL DEFAULT 'direct',
  "share_percent" real,
  "measurement_confidence" text NOT NULL DEFAULT 'unknown',
  "is_primary" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "equipment_meter_links_role_check" CHECK ("relation_role" IN ('direct','shared','sub_meter','estimated_reference')),
  CONSTRAINT "equipment_meter_links_confidence_check" CHECK ("measurement_confidence" IN ('high','medium','low','unknown')),
  CONSTRAINT "equipment_meter_links_share_check" CHECK ("share_percent" IS NULL OR ("share_percent" >= 0 AND "share_percent" <= 100))
);

CREATE UNIQUE INDEX IF NOT EXISTS "equipment_meter_links_equipment_meter_unique" ON "equipment_meter_links" ("equipment_id", "meter_id");
CREATE UNIQUE INDEX IF NOT EXISTS "equipment_meter_links_one_primary_unique" ON "equipment_meter_links" ("equipment_id") WHERE "is_primary" = true;
CREATE INDEX IF NOT EXISTS "equipment_meter_links_company_equipment_idx" ON "equipment_meter_links" ("company_id", "equipment_id");
CREATE INDEX IF NOT EXISTS "equipment_meter_links_company_meter_idx" ON "equipment_meter_links" ("company_id", "meter_id");

CREATE TABLE IF NOT EXISTS "equipment_energy_source_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id"),
  "equipment_id" integer NOT NULL REFERENCES "equipment"("id") ON DELETE NO ACTION,
  "energy_source_id" integer NOT NULL REFERENCES "energy_sources"("id") ON DELETE NO ACTION,
  "relation_role" text NOT NULL DEFAULT 'primary',
  "share_percent" real,
  "measurement_confidence" text NOT NULL DEFAULT 'unknown',
  "is_primary" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "equipment_energy_source_links_role_check" CHECK ("relation_role" IN ('primary','secondary','startup','backup')),
  CONSTRAINT "equipment_energy_source_links_confidence_check" CHECK ("measurement_confidence" IN ('high','medium','low','unknown')),
  CONSTRAINT "equipment_energy_source_links_share_check" CHECK ("share_percent" IS NULL OR ("share_percent" >= 0 AND "share_percent" <= 100))
);

CREATE UNIQUE INDEX IF NOT EXISTS "equipment_energy_source_links_equipment_source_unique" ON "equipment_energy_source_links" ("equipment_id", "energy_source_id");
CREATE UNIQUE INDEX IF NOT EXISTS "equipment_energy_source_links_one_primary_unique" ON "equipment_energy_source_links" ("equipment_id") WHERE "is_primary" = true;
CREATE INDEX IF NOT EXISTS "equipment_energy_source_links_company_equipment_idx" ON "equipment_energy_source_links" ("company_id", "equipment_id");
CREATE INDEX IF NOT EXISTS "equipment_energy_source_links_company_source_idx" ON "equipment_energy_source_links" ("company_id", "energy_source_id");
