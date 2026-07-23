ALTER TABLE "ai_analysis_attempts"
  ADD COLUMN IF NOT EXISTS "data_policy" text,
  ADD COLUMN IF NOT EXISTS "production_data_enabled" boolean,
  ADD COLUMN IF NOT EXISTS "context_schema_version" text,
  ADD COLUMN IF NOT EXISTS "redaction_policy_version" text,
  ADD COLUMN IF NOT EXISTS "context_truncated" boolean,
  ADD COLUMN IF NOT EXISTS "data_sufficiency" text,
  ADD COLUMN IF NOT EXISTS "synthetic_context" boolean,
  ADD COLUMN IF NOT EXISTS "provider_data_classification" text,
  ADD COLUMN IF NOT EXISTS "pricing_catalog_version" text;

ALTER TABLE "ai_analysis_attempts"
  DROP CONSTRAINT IF EXISTS "ai_analysis_attempts_data_policy_check";
ALTER TABLE "ai_analysis_attempts"
  ADD CONSTRAINT "ai_analysis_attempts_data_policy_check"
  CHECK ("data_policy" IS NULL OR "data_policy" IN ('disabled','synthetic_only','production_allowed'));

ALTER TABLE "ai_analysis_attempts"
  DROP CONSTRAINT IF EXISTS "ai_analysis_attempts_data_sufficiency_check";
ALTER TABLE "ai_analysis_attempts"
  ADD CONSTRAINT "ai_analysis_attempts_data_sufficiency_check"
  CHECK ("data_sufficiency" IS NULL OR "data_sufficiency" IN ('sufficient','partial','insufficient'));

CREATE TABLE IF NOT EXISTS "ai_provider_circuit_state" (
  "id" serial PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "state" text DEFAULT 'closed' NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "window_started_at" timestamp,
  "opened_at" timestamp,
  "next_probe_at" timestamp,
  "probe_lease_owner" text,
  "probe_lease_expires_at" timestamp,
  "last_failure_code" text,
  "last_failure_at" timestamp,
  "last_success_at" timestamp,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ai_provider_circuit_state_state_check" CHECK ("state" IN ('closed','open','half_open')),
  CONSTRAINT "ai_provider_circuit_state_failure_count_check" CHECK ("failure_count" >= 0),
  CONSTRAINT "ai_provider_circuit_state_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_circuit_state_provider_model_unique"
  ON "ai_provider_circuit_state" ("provider", "model");

CREATE INDEX IF NOT EXISTS "ai_provider_circuit_state_next_probe_idx"
  ON "ai_provider_circuit_state" ("state", "next_probe_at");

CREATE INDEX IF NOT EXISTS "ai_provider_circuit_state_probe_lease_idx"
  ON "ai_provider_circuit_state" ("state", "probe_lease_expires_at");

CREATE TABLE IF NOT EXISTS "ai_operational_state" (
  "id" serial PRIMARY KEY NOT NULL,
  "state_key" text NOT NULL,
  "value_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_operational_state_key_unique"
  ON "ai_operational_state" ("state_key");
