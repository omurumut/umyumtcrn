ALTER TABLE "consumption" ADD COLUMN IF NOT EXISTS "weather_station_name" text;--> statement-breakpoint
ALTER TABLE "consumption" ADD COLUMN IF NOT EXISTS "weather_station_note" text;
