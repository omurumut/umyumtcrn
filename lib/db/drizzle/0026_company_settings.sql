CREATE TABLE "company_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL,
  "default_locale" text DEFAULT 'tr-TR' NOT NULL,
  "default_currency" text DEFAULT 'TRY' NOT NULL,
  "fiscal_year_start_month" integer DEFAULT 1 NOT NULL,
  "date_format" text DEFAULT 'DD.MM.YYYY' NOT NULL,
  "decimal_separator" text DEFAULT 'comma' NOT NULL,
  "energy_display_unit" text DEFAULT 'auto' NOT NULL,
  "tep_display_mode" text DEFAULT 'auto' NOT NULL,
  "co2_display_mode" text DEFAULT 'tonne' NOT NULL,
  "settings_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" integer
);
--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "company_settings_company_id_unique" ON "company_settings" USING btree ("company_id");
