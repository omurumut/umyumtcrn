CREATE TABLE "energy_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer,
	"name" text NOT NULL,
	"baseline_year" integer NOT NULL,
	"target_year" integer NOT NULL,
	"target_reduction_percent" real NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "energy_targets" ADD CONSTRAINT "energy_targets_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;