ALTER TABLE "energy_baselines" ADD COLUMN IF NOT EXISTS "dependent_variable_unit" text;
ALTER TABLE "energy_baselines" ADD COLUMN IF NOT EXISTS "dependent_variable_type" text DEFAULT 'raw_consumption';
