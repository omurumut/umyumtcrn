CREATE TABLE IF NOT EXISTS "company_ai_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "data_policy" text DEFAULT 'disabled' NOT NULL,
  "retention_days" integer,
  "settings_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" integer,
  CONSTRAINT "company_ai_settings_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "company_ai_settings_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "company_ai_settings_data_policy_check"
    CHECK ("data_policy" IN ('disabled','synthetic_only','production_allowed')),
  CONSTRAINT "company_ai_settings_retention_days_check"
    CHECK ("retention_days" IS NULL OR "retention_days" BETWEEN 30 AND 3650),
  CONSTRAINT "company_ai_settings_version_check" CHECK ("settings_version" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "company_ai_settings_company_id_unique"
  ON "company_ai_settings" ("company_id");

CREATE TABLE IF NOT EXISTS "ai_analyses" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "unit_id" integer,
  "requested_by_user_id" integer,
  "analysis_type" text NOT NULL,
  "period_start" text NOT NULL,
  "period_end" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "context_schema_version" text NOT NULL,
  "output_schema_version" text NOT NULL,
  "prompt_policy_version" text NOT NULL,
  "builder_version" text NOT NULL,
  "redaction_policy_version" text NOT NULL,
  "limit_policy_version" text NOT NULL,
  "data_version" text NOT NULL,
  "cache_key" text NOT NULL,
  "cache_hit" boolean DEFAULT false NOT NULL,
  "source_analysis_id" integer,
  "fallback_used" boolean DEFAULT false NOT NULL,
  "data_sufficiency" text NOT NULL,
  "context_truncated" boolean DEFAULT false NOT NULL,
  "context_warnings_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "result_json" jsonb,
  "error_code" text,
  "error_message_safe" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ai_analyses_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action,
  CONSTRAINT "ai_analyses_unit_id_units_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "ai_analyses_requested_by_user_id_users_id_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "ai_analyses_source_analysis_id_fk"
    FOREIGN KEY ("source_analysis_id") REFERENCES "public"."ai_analyses"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "ai_analyses_analysis_type_check"
    CHECK ("analysis_type" IN ('energy_performance_overview','equipment_improvement_opportunities','data_quality_and_monitoring')),
  CONSTRAINT "ai_analyses_status_check" CHECK ("status" IN ('pending','processing','completed','failed')),
  CONSTRAINT "ai_analyses_data_sufficiency_check" CHECK ("data_sufficiency" IN ('sufficient','partial','insufficient')),
  CONSTRAINT "ai_analyses_error_safe_check"
    CHECK ("error_message_safe" IS NULL OR (char_length("error_message_safe") <= 300 AND "error_message_safe" !~ '[\x00-\x1f\x7f]')),
  CONSTRAINT "ai_analyses_cache_source_check"
    CHECK (
      ("cache_hit" = false AND "source_analysis_id" IS NULL)
      OR ("cache_hit" = true AND "source_analysis_id" IS NOT NULL AND "result_json" IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_analyses_completed_cache_key_unique"
  ON "ai_analyses" ("company_id", "cache_key")
  WHERE "status" = 'completed' AND "cache_hit" = false AND "result_json" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_analyses_processing_cache_key_unique"
  ON "ai_analyses" ("company_id", "cache_key")
  WHERE "status" = 'processing' AND "cache_hit" = false;

CREATE INDEX IF NOT EXISTS "ai_analyses_company_unit_created_idx"
  ON "ai_analyses" ("company_id", "unit_id", "created_at");

CREATE INDEX IF NOT EXISTS "ai_analyses_company_status_created_idx"
  ON "ai_analyses" ("company_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "ai_analyses_source_analysis_idx"
  ON "ai_analyses" ("source_analysis_id");

CREATE TABLE IF NOT EXISTS "ai_analysis_attempts" (
  "id" serial PRIMARY KEY NOT NULL,
  "analysis_id" integer NOT NULL,
  "attempt_number" integer NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "started_at" timestamp NOT NULL,
  "completed_at" timestamp,
  "success" boolean DEFAULT false NOT NULL,
  "retryable" boolean DEFAULT false NOT NULL,
  "error_code" text,
  "provider_http_status" integer,
  "provider_error_code" text,
  "provider_request_id" text,
  "input_tokens" integer,
  "output_tokens" integer,
  "thinking_tokens" integer,
  "cached_tokens" integer,
  "total_tokens" integer,
  "estimated_cost" numeric(14,6),
  "currency" text,
  "cost_calculation_version" text,
  "latency_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ai_analysis_attempts_analysis_id_ai_analyses_id_fk"
    FOREIGN KEY ("analysis_id") REFERENCES "public"."ai_analyses"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "ai_analysis_attempts_attempt_number_check" CHECK ("attempt_number" >= 1),
  CONSTRAINT "ai_analysis_attempts_token_check" CHECK (
    ("input_tokens" IS NULL OR "input_tokens" >= 0)
    AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
    AND ("thinking_tokens" IS NULL OR "thinking_tokens" >= 0)
    AND ("cached_tokens" IS NULL OR "cached_tokens" >= 0)
    AND ("total_tokens" IS NULL OR "total_tokens" >= 0)
  ),
  CONSTRAINT "ai_analysis_attempts_cost_check"
    CHECK ("estimated_cost" IS NULL OR "estimated_cost" >= 0),
  CONSTRAINT "ai_analysis_attempts_latency_check"
    CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_analysis_attempts_analysis_attempt_unique"
  ON "ai_analysis_attempts" ("analysis_id", "attempt_number");

CREATE INDEX IF NOT EXISTS "ai_analysis_attempts_analysis_created_idx"
  ON "ai_analysis_attempts" ("analysis_id", "created_at");
