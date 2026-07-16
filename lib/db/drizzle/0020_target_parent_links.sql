ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "seu_assessment_item_id" integer;
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD COLUMN IF NOT EXISTS "baseline_id" integer;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_targets" ADD CONSTRAINT "energy_targets_seu_assessment_item_id_seu_assessment_items_id_fk" FOREIGN KEY ("seu_assessment_item_id") REFERENCES "public"."seu_assessment_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_targets" ADD CONSTRAINT "energy_targets_baseline_id_energy_baselines_id_fk" FOREIGN KEY ("baseline_id") REFERENCES "public"."energy_baselines"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_targets_seu_assessment_item_id_idx" ON "energy_targets" USING btree ("seu_assessment_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_targets_baseline_id_idx" ON "energy_targets" USING btree ("baseline_id");
