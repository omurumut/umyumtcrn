import { pgTable, serial, text, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Users ────────────────────────────────────────────────
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("user"), // admin | user
  unitId: integer("unit_id"),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UserRecord = typeof usersTable.$inferSelect;

// ── Units (Birimler) ──────────────────────────────────────
export const unitsTable = pgTable("units", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location").notNull(),
  type: text("type").notNull().default("fabrika"),
  city: text("city").notNull().default("Istanbul"),
  responsible: text("responsible"),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUnitSchema = createInsertSchema(unitsTable).omit({ id: true, createdAt: true });
export type InsertUnit = z.infer<typeof insertUnitSchema>;
export type Unit = typeof unitsTable.$inferSelect;

// ── Sub-Units / Locations (Alt Birimler / Lokasyonlar) ────
export const subUnitsTable = pgTable("sub_units", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  city: text("city").notNull().default("Istanbul"),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSubUnitSchema = createInsertSchema(subUnitsTable).omit({ id: true, createdAt: true });
export type InsertSubUnit = z.infer<typeof insertSubUnitSchema>;
export type SubUnit = typeof subUnitsTable.$inferSelect;

// ── Energy Sources (Enerji Kaynakları) ────────────────────
export const energySourcesTable = pgTable("energy_sources", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }).notNull(),
  type: text("type").notNull(), // elektrik | dogalgaz | buhar | su | diger
  name: text("name").notNull(),
  unit: text("unit").notNull().default("kWh"), // kWh | m3 | ton | litre | MWh | GJ
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEnergySourceSchema = createInsertSchema(energySourcesTable).omit({ id: true, createdAt: true });
export type InsertEnergySource = z.infer<typeof insertEnergySourceSchema>;
export type EnergySource = typeof energySourcesTable.$inferSelect;

// ── Meters ───────────────────────────────────────────────
export const metersTable = pgTable("meters", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
  subUnitId: integer("sub_unit_id").references(() => subUnitsTable.id, { onDelete: "set null" }),
  energySourceId: integer("energy_source_id").references(() => energySourcesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // elektrik | dogalgaz | buhar | su | diger
  location: text("location").notNull(),
  city: text("city").notNull().default("Istanbul"),
  unit: text("unit").notNull(), // kWh | m3 | ton | litre
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMeterSchema = createInsertSchema(metersTable).omit({ id: true, createdAt: true });
export type InsertMeter = z.infer<typeof insertMeterSchema>;
export type Meter = typeof metersTable.$inferSelect;

// ── Consumption ──────────────────────────────────────────
export const consumptionTable = pgTable("consumption", {
  id: serial("id").primaryKey(),
  meterId: integer("meter_id").references(() => metersTable.id, { onDelete: "cascade" }).notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  kwh: real("kwh").notNull().default(0),
  tep: real("tep").notNull().default(0),
  co2: real("co2").notNull().default(0),
  hdd: real("hdd"),
  cdd: real("cdd"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertConsumptionSchema = createInsertSchema(consumptionTable).omit({ id: true, createdAt: true });
export type InsertConsumption = z.infer<typeof insertConsumptionSchema>;
export type ConsumptionRecord = typeof consumptionTable.$inferSelect;

// ── Weather ──────────────────────────────────────────────
export const weatherTable = pgTable("weather", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  hdd: real("hdd").notNull().default(0),
  cdd: real("cdd").notNull().default(0),
  location: text("location").notNull(),
  avgTemp: real("avg_temp"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWeatherSchema = createInsertSchema(weatherTable).omit({ id: true, createdAt: true });
export type InsertWeather = z.infer<typeof insertWeatherSchema>;
export type WeatherRecord = typeof weatherTable.$inferSelect;

// ── SWOT ─────────────────────────────────────────────────
export const swotTable = pgTable("swot_items", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  score: integer("score").notNull().default(3),
  impact: text("impact").notNull().default("orta"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSwotSchema = createInsertSchema(swotTable).omit({ id: true, createdAt: true });
export type InsertSwot = z.infer<typeof insertSwotSchema>;
export type SwotItem = typeof swotTable.$inferSelect;

// ── Risks ────────────────────────────────────────────────
export const risksTable = pgTable("risks", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("risk"),
  title: text("title").notNull(),
  description: text("description"),
  probability: integer("probability").notNull().default(3),
  severity: integer("severity").notNull().default(3),
  score: integer("score").notNull().default(9),
  mitigationPlan: text("mitigation_plan"),
  owner: text("owner"),
  status: text("status").notNull().default("acik"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRiskSchema = createInsertSchema(risksTable).omit({ id: true, createdAt: true });
export type InsertRisk = z.infer<typeof insertRiskSchema>;
export type RiskItem = typeof risksTable.$inferSelect;

// ── SEU / ÖEK ────────────────────────────────────────────
export const seuTable = pgTable("seu_items", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  annualKwh: real("annual_kwh").notNull().default(0),
  percentage: real("percentage").notNull().default(0),
  priority: integer("priority").notNull().default(1),
  targetReductionPercent: real("target_reduction_percent"),
  responsible: text("responsible"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSeuSchema = createInsertSchema(seuTable).omit({ id: true, createdAt: true });
export type InsertSeu = z.infer<typeof insertSeuSchema>;
export type SeuItem = typeof seuTable.$inferSelect;

// ── Energy Targets (Enerji Hedefleri) ────────────────────
export const energyTargetsTable = pgTable("energy_targets", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baselineYear: integer("baseline_year").notNull(),
  targetYear: integer("target_year").notNull(),
  targetReductionPercent: real("target_reduction_percent").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEnergyTargetSchema = createInsertSchema(energyTargetsTable).omit({ id: true, createdAt: true });
export type InsertEnergyTarget = z.infer<typeof insertEnergyTargetSchema>;
export type EnergyTarget = typeof energyTargetsTable.$inferSelect;

// ── Reports ───────────────────────────────────────────────
export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
  year: integer("year").notNull(),
  status: text("status").notNull().default("pending"),
  downloadUrl: text("download_url"),
  includeSwot: boolean("include_swot").default(true),
  includeRisks: boolean("include_risks").default(true),
  includeSeu: boolean("include_seu").default(true),
  includeRegression: boolean("include_regression").default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, createdAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
