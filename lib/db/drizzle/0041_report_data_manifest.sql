ALTER TABLE "report_generation_snapshots"
  ADD COLUMN IF NOT EXISTS "data_manifest_json" jsonb;
