CREATE TABLE IF NOT EXISTS "mgm_stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_code" text NOT NULL,
	"name" text NOT NULL,
	"il" text NOT NULL,
	"ilce" text,
	"lat" real NOT NULL,
	"lon" real NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mgm_stations_station_code_unique" UNIQUE("station_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mgm_degree_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"station_code" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"hdd" real DEFAULT 0 NOT NULL,
	"cdd" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mgm_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"status" text DEFAULT 'running' NOT NULL,
	"stations_synced" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"notes" text
);
