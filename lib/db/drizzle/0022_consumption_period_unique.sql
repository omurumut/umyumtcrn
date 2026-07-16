CREATE UNIQUE INDEX "consumption_meter_year_month_unique" ON "consumption" USING btree ("meter_id","year","month");
