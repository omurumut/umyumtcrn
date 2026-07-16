DO $$ BEGIN
 ALTER TABLE "energy_targets" ADD CONSTRAINT "energy_targets_sub_unit_id_sub_units_id_fk" FOREIGN KEY ("sub_unit_id") REFERENCES "public"."sub_units"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_targets" ADD CONSTRAINT "energy_targets_energy_source_id_energy_sources_id_fk" FOREIGN KEY ("energy_source_id") REFERENCES "public"."energy_sources"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_targets_sub_unit_id_idx" ON "energy_targets" USING btree ("sub_unit_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_targets_energy_source_id_idx" ON "energy_targets" USING btree ("energy_source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "energy_targets_company_unit_item_year_unique" ON "energy_targets" USING btree ("company_id","unit_id","seu_assessment_item_id","target_year") WHERE "seu_assessment_item_id" IS NOT NULL AND "unit_id" IS NOT NULL;
