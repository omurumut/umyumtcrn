-- energy_targets tablosuna yeni kolonlar ekle
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "objective_text" text;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "target_text" text;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "target_type" text;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "sub_unit_id" integer;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "energy_source_id" integer;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "seu_assessment_id" integer;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "baseline_value" real;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "target_value" real;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "actual_value" real;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "unit_label" text;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();
--> statement-breakpoint

-- energy_action_plans tablosu
CREATE TABLE IF NOT EXISTS "energy_action_plans" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL DEFAULT 1 REFERENCES "companies"("id"),
  "target_id" integer NOT NULL REFERENCES "energy_targets"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "responsible_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "responsible_name" text,
  "priority" text NOT NULL DEFAULT 'medium',
  "expected_saving_value" real,
  "expected_saving_unit" text,
  "expected_cost_saving" real,
  "investment_cost" real,
  "payback_months" real,
  "start_date" text,
  "due_date" text,
  "completion_date" text,
  "progress_percent" real NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'planned',
  "is_vap" boolean NOT NULL DEFAULT false,
  "notes" text,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- energy_target_progress tablosu
CREATE TABLE IF NOT EXISTS "energy_target_progress" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL DEFAULT 1 REFERENCES "companies"("id"),
  "target_id" integer NOT NULL REFERENCES "energy_targets"("id") ON DELETE CASCADE,
  "period_year" integer NOT NULL,
  "period_month" integer,
  "actual_value" real NOT NULL,
  "actual_saving_value" real,
  "comment" text,
  "recorded_by" text,
  "recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- vap_projects tablosu
CREATE TABLE IF NOT EXISTS "vap_projects" (
  "id" serial PRIMARY KEY,
  "company_id" integer NOT NULL DEFAULT 1 REFERENCES "companies"("id"),
  "action_plan_id" integer NOT NULL REFERENCES "energy_action_plans"("id") ON DELETE CASCADE,
  "project_code" text,
  "project_title" text NOT NULL,
  "project_type" text,
  "current_situation" text,
  "proposed_solution" text,
  "technical_description" text,
  "annual_energy_saving_value" real,
  "annual_energy_saving_unit" text,
  "annual_cost_saving" real,
  "investment_cost" real,
  "payback_months" real,
  "co2_reduction_ton" real,
  "measurement_verification_method" text,
  "incentive_status" text DEFAULT 'none',
  "feasibility_status" text DEFAULT 'not_started',
  "start_date" text,
  "end_date" text,
  "status" text NOT NULL DEFAULT 'idea',
  "notes" text,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
