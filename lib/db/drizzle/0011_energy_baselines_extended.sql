ALTER TABLE "energy_baselines" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint
ALTER TABLE "energy_baselines" ADD COLUMN IF NOT EXISTS "formula_text" text;
--> statement-breakpoint
ALTER TABLE "energy_baselines" ADD COLUMN IF NOT EXISTS "sample_size" integer;
--> statement-breakpoint
ALTER TABLE "energy_baseline_variables" ADD COLUMN IF NOT EXISTS "variable_code" text;
--> statement-breakpoint
ALTER TABLE "energy_baseline_variables" ADD COLUMN IF NOT EXISTS "standard_error" real;
--> statement-breakpoint
ALTER TABLE "energy_baseline_variables" ADD COLUMN IF NOT EXISTS "t_stat" real;
