CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "request_id" text NOT NULL,
  "actor_user_id" integer,
  "actor_role" text,
  "company_id" integer,
  "unit_id" integer,
  "action" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "outcome" text NOT NULL,
  "changes_json" jsonb,
  "metadata_json" jsonb
);

DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "audit_events_company_occurred_idx" ON "audit_events" USING btree ("company_id","occurred_at");
CREATE INDEX IF NOT EXISTS "audit_events_actor_occurred_idx" ON "audit_events" USING btree ("actor_user_id","occurred_at");
CREATE INDEX IF NOT EXISTS "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");
CREATE INDEX IF NOT EXISTS "audit_events_action_occurred_idx" ON "audit_events" USING btree ("action","occurred_at");
CREATE INDEX IF NOT EXISTS "audit_events_request_id_idx" ON "audit_events" USING btree ("request_id");
