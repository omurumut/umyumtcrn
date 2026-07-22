ALTER TABLE "company_ai_settings"
  ADD COLUMN IF NOT EXISTS "daily_analysis_limit" integer,
  ADD COLUMN IF NOT EXISTS "monthly_analysis_limit" integer,
  ADD COLUMN IF NOT EXISTS "max_concurrent_analyses" integer DEFAULT 2 NOT NULL,
  ADD COLUMN IF NOT EXISTS "fallback_enabled" boolean DEFAULT true NOT NULL;

ALTER TABLE "company_ai_settings"
  DROP CONSTRAINT IF EXISTS "company_ai_settings_daily_limit_check";
ALTER TABLE "company_ai_settings"
  ADD CONSTRAINT "company_ai_settings_daily_limit_check"
  CHECK ("daily_analysis_limit" IS NULL OR "daily_analysis_limit" BETWEEN 1 AND 10000);

ALTER TABLE "company_ai_settings"
  DROP CONSTRAINT IF EXISTS "company_ai_settings_monthly_limit_check";
ALTER TABLE "company_ai_settings"
  ADD CONSTRAINT "company_ai_settings_monthly_limit_check"
  CHECK ("monthly_analysis_limit" IS NULL OR "monthly_analysis_limit" BETWEEN 1 AND 300000);

ALTER TABLE "company_ai_settings"
  DROP CONSTRAINT IF EXISTS "company_ai_settings_concurrent_check";
ALTER TABLE "company_ai_settings"
  ADD CONSTRAINT "company_ai_settings_concurrent_check"
  CHECK ("max_concurrent_analyses" BETWEEN 1 AND 20);

CREATE INDEX IF NOT EXISTS "ai_analyses_company_provider_created_idx"
  ON "ai_analyses" ("company_id", "provider", "created_at");

CREATE INDEX IF NOT EXISTS "ai_analyses_requested_status_idx"
  ON "ai_analyses" ("requested_by_user_id", "status", "started_at");
