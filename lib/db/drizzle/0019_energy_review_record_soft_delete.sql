ALTER TABLE "energy_review_records" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "energy_review_records" ADD COLUMN IF NOT EXISTS "deleted_by_user_id" integer;
--> statement-breakpoint
ALTER TABLE "energy_review_records" ADD COLUMN IF NOT EXISTS "delete_reason" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_review_records" ADD CONSTRAINT "energy_review_records_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_review_records_deleted_at_idx" ON "energy_review_records" USING btree ("deleted_at");
