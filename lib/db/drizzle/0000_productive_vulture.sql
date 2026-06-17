CREATE TABLE "consumption" (
	"id" serial PRIMARY KEY NOT NULL,
	"meter_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"kwh" real DEFAULT 0 NOT NULL,
	"tep" real DEFAULT 0 NOT NULL,
	"co2" real DEFAULT 0 NOT NULL,
	"hdd" real,
	"cdd" real,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "energy_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'kWh' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meters" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer,
	"sub_unit_id" integer,
	"energy_source_id" integer,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"location" text NOT NULL,
	"city" text DEFAULT 'Istanbul' NOT NULL,
	"unit" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer,
	"year" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"download_url" text,
	"include_swot" boolean DEFAULT true,
	"include_risks" boolean DEFAULT true,
	"include_seu" boolean DEFAULT true,
	"include_regression" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer,
	"type" text DEFAULT 'risk' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"probability" integer DEFAULT 3 NOT NULL,
	"severity" integer DEFAULT 3 NOT NULL,
	"score" integer DEFAULT 9 NOT NULL,
	"mitigation_plan" text,
	"owner" text,
	"status" text DEFAULT 'acik' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seu_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"annual_kwh" real DEFAULT 0 NOT NULL,
	"percentage" real DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"target_reduction_percent" real,
	"responsible" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sub_units" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer NOT NULL,
	"name" text NOT NULL,
	"city" text DEFAULT 'Istanbul' NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swot_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"unit_id" integer,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"score" integer DEFAULT 3 NOT NULL,
	"impact" text DEFAULT 'orta' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"location" text NOT NULL,
	"type" text DEFAULT 'fabrika' NOT NULL,
	"city" text DEFAULT 'Istanbul' NOT NULL,
	"responsible" text,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"unit_id" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "weather" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"hdd" real DEFAULT 0 NOT NULL,
	"cdd" real DEFAULT 0 NOT NULL,
	"location" text NOT NULL,
	"avg_temp" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consumption" ADD CONSTRAINT "consumption_meter_id_meters_id_fk" FOREIGN KEY ("meter_id") REFERENCES "public"."meters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "energy_sources" ADD CONSTRAINT "energy_sources_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_sub_unit_id_sub_units_id_fk" FOREIGN KEY ("sub_unit_id") REFERENCES "public"."sub_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meters" ADD CONSTRAINT "meters_energy_source_id_energy_sources_id_fk" FOREIGN KEY ("energy_source_id") REFERENCES "public"."energy_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seu_items" ADD CONSTRAINT "seu_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_units" ADD CONSTRAINT "sub_units_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swot_items" ADD CONSTRAINT "swot_items_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;