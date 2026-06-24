CREATE TABLE IF NOT EXISTS "variables" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer DEFAULT 1 NOT NULL,
  "name" text NOT NULL,
  "code" text,
  "category" text DEFAULT 'operational' NOT NULL,
  "unit_label" text,
  "variable_type" text DEFAULT 'numeric' NOT NULL,
  "source_type" text DEFAULT 'operation_manual' NOT NULL,
  "scope_type" text DEFAULT 'company' NOT NULL,
  "description" text,
  "is_system_variable" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "variable_values" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer DEFAULT 1 NOT NULL,
  "variable_id" integer NOT NULL,
  "unit_id" integer,
  "sub_unit_id" integer,
  "meter_id" integer,
  "period_start" text NOT NULL,
  "period_end" text NOT NULL,
  "period_type" text DEFAULT 'monthly' NOT NULL,
  "value" real NOT NULL,
  "source" text,
  "location_province" text,
  "location_district" text,
  "data_quality" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "variables" ADD CONSTRAINT "variables_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "variable_values" ADD CONSTRAINT "variable_values_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "variable_values" ADD CONSTRAINT "variable_values_variable_id_variables_id_fk" FOREIGN KEY ("variable_id") REFERENCES "public"."variables"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "variable_values" ADD CONSTRAINT "variable_values_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "variable_values" ADD CONSTRAINT "variable_values_sub_unit_id_sub_units_id_fk" FOREIGN KEY ("sub_unit_id") REFERENCES "public"."sub_units"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "variable_values" ADD CONSTRAINT "variable_values_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE set null ON UPDATE no action;
