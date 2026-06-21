CREATE TABLE "energy_use_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"group_type" text DEFAULT 'other' NOT NULL,
	"energy_source_id" integer,
	"unit_id" integer,
	"sub_unit_id" integer,
	"description" text,
	"is_seu_candidate" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer DEFAULT 1 NOT NULL,
	"risk_id" integer NOT NULL,
	"user_id" integer,
	"user_name" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meters" ADD COLUMN "energy_use_group_id" integer;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "foreseen_impact" text;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "response_type" text DEFAULT 'izleme' NOT NULL;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "target_probability" integer;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "target_severity" integer;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "target_score" integer;--> statement-breakpoint
ALTER TABLE "energy_use_groups" ADD CONSTRAINT "energy_use_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_use_groups" ADD CONSTRAINT "energy_use_groups_energy_source_id_energy_sources_id_fk" FOREIGN KEY ("energy_source_id") REFERENCES "public"."energy_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_use_groups" ADD CONSTRAINT "energy_use_groups_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_use_groups" ADD CONSTRAINT "energy_use_groups_sub_unit_id_sub_units_id_fk" FOREIGN KEY ("sub_unit_id") REFERENCES "public"."sub_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_notes" ADD CONSTRAINT "risk_notes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_notes" ADD CONSTRAINT "risk_notes_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_notes" ADD CONSTRAINT "risk_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_energy_use_group_id_energy_use_groups_id_fk" FOREIGN KEY ("energy_use_group_id") REFERENCES "public"."energy_use_groups"("id") ON DELETE set null ON UPDATE no action;