import { sql } from "drizzle-orm";
import { pgTable, serial, text, integer, real, timestamp, boolean, index, uniqueIndex, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ── Companies (Firmalar) ──────────────────────────────────
export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subdomain: text("subdomain").notNull().unique(),
  legalName: text("legal_name"),
  shortName: text("short_name"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  taxOffice: text("tax_office"),
  taxNumber: text("tax_number"),
  industry: text("industry"),
  reportIntroduction: text("report_introduction"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
  profileVersion: integer("profile_version").notNull().default(1),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({ id: true, createdAt: true, updatedAt: true, profileVersion: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;

// ── Users ────────────────────────────────────────────────
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
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

export const companySettingsTable = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull(),
  defaultLocale: text("default_locale").notNull().default("tr-TR"),
  defaultCurrency: text("default_currency").notNull().default("TRY"),
  fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
  dateFormat: text("date_format").notNull().default("DD.MM.YYYY"),
  decimalSeparator: text("decimal_separator").notNull().default("comma"),
  energyDisplayUnit: text("energy_display_unit").notNull().default("auto"),
  tepDisplayMode: text("tep_display_mode").notNull().default("auto"),
  co2DisplayMode: text("co2_display_mode").notNull().default("tonne"),
  settingsVersion: integer("settings_version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (table) => ({
  companyUnique: uniqueIndex("company_settings_company_id_unique").on(table.companyId),
}));

export const insertCompanySettingsSchema = createInsertSchema(companySettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanySettings = z.infer<typeof insertCompanySettingsSchema>;
export type CompanySettings = typeof companySettingsTable.$inferSelect;

export const companyAssetsTable = pgTable("company_assets", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull(),
  assetType: text("asset_type").notNull(),
  storageProvider: text("storage_provider").notNull(),
  storageKey: text("storage_key").notNull(),
  originalFileName: text("original_file_name"),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  contentHash: text("content_hash").notNull(),
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (table) => ({
  companyTypeStatusIdx: index("company_assets_company_type_status_idx").on(table.companyId, table.assetType, table.status),
  storageKeyUnique: uniqueIndex("company_assets_storage_key_unique").on(table.storageKey),
}));

export const insertCompanyAssetSchema = createInsertSchema(companyAssetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyAsset = z.infer<typeof insertCompanyAssetSchema>;
export type CompanyAsset = typeof companyAssetsTable.$inferSelect;

export const companyBrandSettingsTable = pgTable("company_brand_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull(),
  showLogoInReports: boolean("show_logo_in_reports").notNull().default(true),
  logoAltText: text("logo_alt_text").notNull().default("Firma logosu"),
  logoPosition: text("logo_position").notNull().default("left"),
  logoSize: text("logo_size").notNull().default("medium"),
  brandSettingsVersion: integer("brand_settings_version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (table) => ({
  companyUnique: uniqueIndex("company_brand_settings_company_id_unique").on(table.companyId),
}));

export const insertCompanyBrandSettingsSchema = createInsertSchema(companyBrandSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyBrandSettings = z.infer<typeof insertCompanyBrandSettingsSchema>;
export type CompanyBrandSettings = typeof companyBrandSettingsTable.$inferSelect;

export const companyReportProfilesTable = pgTable("company_report_profiles", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull(),
  showLogo: boolean("show_logo").notNull().default(true),
  defaultLocale: text("default_locale").notNull().default("tr-TR"),
  defaultTitle: text("default_title"),
  defaultSubtitle: text("default_subtitle"),
  documentNumber: text("document_number"),
  revisionNumber: text("revision_number"),
  revisionDate: text("revision_date"),
  preparedBy: text("prepared_by"),
  checkedBy: text("checked_by"),
  approvedBy: text("approved_by"),
  confidentialityLevel: text("confidentiality_level").notNull().default("internal"),
  footerText: text("footer_text"),
  showSignatureFields: boolean("show_signature_fields").notNull().default(true),
  showPageNumbers: boolean("show_page_numbers").notNull().default(true),
  coverStyle: text("cover_style").notNull().default("standard"),
  fileNamePattern: text("file_name_pattern").notNull().default("{company}_{reportType}_{year}"),
  profileVersion: integer("profile_version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (table) => ({
  companyUnique: uniqueIndex("company_report_profiles_company_id_unique").on(table.companyId),
}));

export const insertCompanyReportProfileSchema = createInsertSchema(companyReportProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyReportProfile = z.infer<typeof insertCompanyReportProfileSchema>;
export type CompanyReportProfile = typeof companyReportProfilesTable.$inferSelect;

export const companyReportTypeSettingsTable = pgTable("company_report_type_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull(),
  reportType: text("report_type").notNull(),
  titleOverride: text("title_override"),
  subtitleOverride: text("subtitle_override"),
  localeOverride: text("locale_override"),
  coverStyleOverride: text("cover_style_override"),
  typeSettingsVersion: integer("type_settings_version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (table) => ({
  companyReportTypeUnique: uniqueIndex("company_report_type_settings_company_report_type_unique").on(table.companyId, table.reportType),
}));

export const insertCompanyReportTypeSettingsSchema = createInsertSchema(companyReportTypeSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyReportTypeSettings = z.infer<typeof insertCompanyReportTypeSettingsSchema>;
export type CompanyReportTypeSettings = typeof companyReportTypeSettingsTable.$inferSelect;

export const companyReportSectionSettingsTable = pgTable("company_report_section_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull(),
  reportType: text("report_type").notNull(),
  sectionCode: text("section_code").notNull(),
  isVisible: boolean("is_visible").notNull().default(true),
  displayOrder: integer("display_order").notNull(),
  labelOverride: text("label_override"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (table) => ({
  companyReportSectionUnique: uniqueIndex("company_report_section_settings_company_report_section_unique").on(table.companyId, table.reportType, table.sectionCode),
  companyReportTypeIndex: index("company_report_section_settings_company_report_type_idx").on(table.companyId, table.reportType),
}));

export const insertCompanyReportSectionSettingsSchema = createInsertSchema(companyReportSectionSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompanyReportSectionSettings = z.infer<typeof insertCompanyReportSectionSettingsSchema>;
export type CompanyReportSectionSettings = typeof companyReportSectionSettingsTable.$inferSelect;

export const reportGenerationSnapshotsTable = pgTable("report_generation_snapshots", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
  reportType: text("report_type").notNull(),
  year: integer("year"),
  status: text("status").notNull().default("generating"),
  storageStatus: text("storage_status").notNull().default("not_stored"),
  filename: text("filename"),
  settingsSnapshot: jsonb("settings_snapshot_json").notNull(),
  generatedBy: integer("generated_by").references(() => usersTable.id, { onDelete: "set null" }),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),
  failureReason: text("failure_reason"),
}, (table) => ({
  companyReportGeneratedIndex: index("report_generation_snapshots_company_report_generated_idx").on(table.companyId, table.reportType, table.generatedAt),
  statusIndex: index("report_generation_snapshots_status_idx").on(table.status),
}));

export const insertReportGenerationSnapshotSchema = createInsertSchema(reportGenerationSnapshotsTable).omit({ id: true, generatedAt: true });
export type InsertReportGenerationSnapshot = z.infer<typeof insertReportGenerationSnapshotSchema>;
export type ReportGenerationSnapshot = typeof reportGenerationSnapshotsTable.$inferSelect;

// Shared authentication state.
export const authSessionsTable = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
}, (table) => ({
  tokenHashUnique: uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
  expiresAtIndex: index("auth_sessions_expires_at_idx").on(table.expiresAt),
  userIdIndex: index("auth_sessions_user_id_idx").on(table.userId),
}));

export type AuthSession = typeof authSessionsTable.$inferSelect;

export const authRateLimitsTable = pgTable("auth_rate_limits", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  keyHash: text("key_hash").notNull(),
  windowStartedAt: timestamp("window_started_at").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  blockedUntil: timestamp("blocked_until"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  scopeKeyUnique: uniqueIndex("auth_rate_limits_scope_key_unique").on(table.scope, table.keyHash),
  blockedUntilIndex: index("auth_rate_limits_blocked_until_idx").on(table.blockedUntil),
  updatedAtIndex: index("auth_rate_limits_updated_at_idx").on(table.updatedAt),
}));

export type AuthRateLimit = typeof authRateLimitsTable.$inferSelect;

// ── Units (Birimler) ──────────────────────────────────────
export const auditEventsTable = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  requestId: text("request_id").notNull(),
  actorUserId: integer("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorRole: text("actor_role"),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  unitId: integer("unit_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  outcome: text("outcome").notNull(),
  changes: jsonb("changes_json"),
  metadata: jsonb("metadata_json"),
}, (table) => ({
  companyOccurredIdx: index("audit_events_company_occurred_idx").on(table.companyId, table.occurredAt),
  actorOccurredIdx: index("audit_events_actor_occurred_idx").on(table.actorUserId, table.occurredAt),
  entityIdx: index("audit_events_entity_idx").on(table.entityType, table.entityId),
  actionOccurredIdx: index("audit_events_action_occurred_idx").on(table.action, table.occurredAt),
  requestIdx: index("audit_events_request_id_idx").on(table.requestId),
}));

export type AuditEvent = typeof auditEventsTable.$inferSelect;

export const unitsTable = pgTable("units", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
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
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
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
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
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

// ── Energy Use Groups (Enerji Kullanım Grupları) ──────────
export const energyUseGroupsTable = pgTable("energy_use_groups", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  name: text("name").notNull(),
  code: text("code"),
  groupType: text("group_type").notNull().default("other"), // production | building | utility | vehicle | process | hvac | lighting | other
  energySourceId: integer("energy_source_id").references(() => energySourcesTable.id, { onDelete: "set null" }),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
  subUnitId: integer("sub_unit_id").references(() => subUnitsTable.id, { onDelete: "set null" }),
  description: text("description"),
  isSeuCandidate: boolean("is_seu_candidate").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEnergyUseGroupSchema = createInsertSchema(energyUseGroupsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnergyUseGroup = z.infer<typeof insertEnergyUseGroupSchema>;
export type EnergyUseGroup = typeof energyUseGroupsTable.$inferSelect;

// ── Meters ───────────────────────────────────────────────
export const metersTable = pgTable("meters", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
  subUnitId: integer("sub_unit_id").references(() => subUnitsTable.id, { onDelete: "set null" }),
  energySourceId: integer("energy_source_id").references(() => energySourcesTable.id, { onDelete: "set null" }),
  energyUseGroupId: integer("energy_use_group_id").references(() => energyUseGroupsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // elektrik | dogalgaz | buhar | su | diger
  recordType: text("record_type").notNull().default("physical_meter"), // physical_meter | virtual_meter | invoice_based | manual_consumption_point | calculated
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
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  meterId: integer("meter_id").references(() => metersTable.id, { onDelete: "cascade" }).notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  // "kwh" teknik kolon adıdır; gerçekte ham tüketim değerini (rawConsumption) saklar.
  // Birim enerji kaynağına göre değişir: elektrik → kWh, doğalgaz → m³, vb.
  // TEP dönüşümü için ayrıca "tep" kolonu vardır.
  // Yeni kodlarda select alias olarak rawConsumption kullanılması önerilir.
  kwh: real("kwh").notNull().default(0),
  tep: real("tep").notNull().default(0),
  co2: real("co2").notNull().default(0),
  hdd: real("hdd"),
  cdd: real("cdd"),
  notes: text("notes"),
  weatherStationName: text("weather_station_name"),
  weatherStationNote: text("weather_station_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  meterYearMonthUnique: uniqueIndex("consumption_meter_year_month_unique")
    .on(table.meterId, table.year, table.month),
}));

export const insertConsumptionSchema = createInsertSchema(consumptionTable).omit({ id: true, createdAt: true });
export type InsertConsumption = z.infer<typeof insertConsumptionSchema>;
export type ConsumptionRecord = typeof consumptionTable.$inferSelect;

// ── MGM Stations (Global, not per company) ───────────────
export const mgmStationsTable = pgTable("mgm_stations", {
  id: serial("id").primaryKey(),
  stationCode: text("station_code").notNull().unique(),
  name: text("name").notNull(),
  il: text("il").notNull(),
  ilce: text("ilce"),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMgmStationSchema = createInsertSchema(mgmStationsTable).omit({ id: true, createdAt: true });
export type InsertMgmStation = z.infer<typeof insertMgmStationSchema>;
export type MgmStation = typeof mgmStationsTable.$inferSelect;

// ── MGM Degree Data (HDD/CDD pool, global) ───────────────
export const mgmDegreeDataTable = pgTable("mgm_degree_data", {
  id: serial("id").primaryKey(),
  stationCode: text("station_code").notNull(),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  hdd: real("hdd").notNull().default(0),
  cdd: real("cdd").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMgmDegreeDataSchema = createInsertSchema(mgmDegreeDataTable).omit({ id: true });
export type InsertMgmDegreeData = z.infer<typeof insertMgmDegreeDataSchema>;
export type MgmDegreeData = typeof mgmDegreeDataTable.$inferSelect;

// ── MGM Sync Log ─────────────────────────────────────────
export const mgmSyncLogTable = pgTable("mgm_sync_log", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull().default("running"), // running | success | error
  stationsSynced: integer("stations_synced").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  notes: text("notes"),
});

export type MgmSyncLog = typeof mgmSyncLogTable.$inferSelect;

// ── Weather ──────────────────────────────────────────────
export const weatherTable = pgTable("weather", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
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
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
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
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("risk"),
  title: text("title").notNull(),
  description: text("description"),
  foreseenImpact: text("foreseen_impact"),
  probability: integer("probability").notNull().default(3),
  severity: integer("severity").notNull().default(3),
  score: integer("score").notNull().default(9),
  responseType: text("response_type").notNull().default("izleme"),
  mitigationPlan: text("mitigation_plan"),
  targetProbability: integer("target_probability"),
  targetSeverity: integer("target_severity"),
  targetScore: integer("target_score"),
  owner: text("owner"),
  status: text("status").notNull().default("acik"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRiskSchema = createInsertSchema(risksTable).omit({ id: true, createdAt: true });
export type InsertRisk = z.infer<typeof insertRiskSchema>;
export type RiskItem = typeof risksTable.$inferSelect;

// ── Risk Notes (Gerçekleşme Notları) ─────────────────────
export const riskNotesTable = pgTable("risk_notes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  riskId: integer("risk_id").references(() => risksTable.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  userName: text("user_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRiskNoteSchema = createInsertSchema(riskNotesTable).omit({ id: true, createdAt: true });
export type InsertRiskNote = z.infer<typeof insertRiskNoteSchema>;
export type RiskNote = typeof riskNotesTable.$inferSelect;

// ── SEU / ÖEK ────────────────────────────────────────────
export const seuTable = pgTable("seu_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
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

// ── SEU Assessments (ÖEK Değerlendirmeleri) ─────────────
export const seuAssessmentsTable = pgTable("seu_assessments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  periodStart: integer("period_start").notNull().default(1),
  periodEnd: integer("period_end").notNull().default(12),
  analysisLevel: text("analysis_level").notNull().default("energyUseGroup"),
  methodType: text("method_type").notNull().default("consumption_share_opportunity_matrix"),
  recordType: text("record_type").notNull().default("unit_official"),
  isOfficial: boolean("is_official").notNull().default(true),
  unitTotalTep: real("unit_total_tep").notNull().default(0),
  energySourceId: integer("energy_source_id").references(() => energySourcesTable.id, { onDelete: "set null" }),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSeuAssessmentSchema = createInsertSchema(seuAssessmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSeuAssessment = z.infer<typeof insertSeuAssessmentSchema>;
export type SeuAssessment = typeof seuAssessmentsTable.$inferSelect;

// ── SEU Assessment Items (ÖEK Kalem Sonuçları) ──────────
export const seuAssessmentItemsTable = pgTable("seu_assessment_items", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").references(() => seuAssessmentsTable.id, { onDelete: "cascade" }).notNull(),
  energyUseGroupId: integer("energy_use_group_id").references(() => energyUseGroupsTable.id, { onDelete: "set null" }),
  meterId: integer("meter_id").references(() => metersTable.id, { onDelete: "set null" }),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
  subUnitId: integer("sub_unit_id").references(() => subUnitsTable.id, { onDelete: "set null" }),
  energySourceId: integer("energy_source_id").references(() => energySourcesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  energyTep: real("energy_tep").notNull().default(0),
  consumptionSharePercent: real("consumption_share_percent").notNull().default(0),
  hasOpportunity: boolean("has_opportunity").notNull().default(false),
  priorityResult: integer("priority_result"),
  systemRecommendation: text("system_recommendation").notNull().default("not_seu"),
  userDecision: text("user_decision"),
  decisionReason: text("decision_reason"),
  responsible: text("responsible"),
  targetReductionPercent: real("target_reduction_percent"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSeuAssessmentItemSchema = createInsertSchema(seuAssessmentItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSeuAssessmentItem = z.infer<typeof insertSeuAssessmentItemSchema>;
export type SeuAssessmentItem = typeof seuAssessmentItemsTable.$inferSelect;

// ── Energy Targets (Enerji Hedefleri) ────────────────────
export const energyTargetsTable = pgTable("energy_targets", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baselineYear: integer("baseline_year").notNull(),
  targetYear: integer("target_year").notNull(),
  targetReductionPercent: real("target_reduction_percent").notNull(),
  notes: text("notes"),
  objectiveText: text("objective_text"),
  targetText: text("target_text"),
  targetType: text("target_type"),
  subUnitId: integer("sub_unit_id").references(() => subUnitsTable.id, { onDelete: "set null" }),
  energySourceId: integer("energy_source_id").references(() => energySourcesTable.id, { onDelete: "set null" }),
  seuAssessmentId: integer("seu_assessment_id"),
  seuAssessmentItemId: integer("seu_assessment_item_id").references(() => seuAssessmentItemsTable.id, { onDelete: "no action" }),
  baselineId: integer("baseline_id").references(() => energyBaselinesTable.id, { onDelete: "no action" }),
  baselineValue: real("baseline_value"),
  targetValue: real("target_value"),
  actualValue: real("actual_value"),
  unitLabel: text("unit_label"),
  status: text("status").default("active"),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  seuAssessmentItemIdIdx: index("energy_targets_seu_assessment_item_id_idx").on(table.seuAssessmentItemId),
  baselineIdIdx: index("energy_targets_baseline_id_idx").on(table.baselineId),
  subUnitIdIdx: index("energy_targets_sub_unit_id_idx").on(table.subUnitId),
  energySourceIdIdx: index("energy_targets_energy_source_id_idx").on(table.energySourceId),
  companyUnitItemYearUnique: uniqueIndex("energy_targets_company_unit_item_year_unique")
    .on(table.companyId, table.unitId, table.seuAssessmentItemId, table.targetYear)
    .where(sql`${table.seuAssessmentItemId} is not null and ${table.unitId} is not null`),
}));

export const insertEnergyTargetSchema = createInsertSchema(energyTargetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnergyTarget = z.infer<typeof insertEnergyTargetSchema>;
export type EnergyTarget = typeof energyTargetsTable.$inferSelect;

// ── Energy Action Plans (Eylem Planları) ─────────────────
export const energyActionPlansTable = pgTable("energy_action_plans", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  targetId: integer("target_id").references(() => energyTargetsTable.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  responsibleUserId: integer("responsible_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  responsibleName: text("responsible_name"),
  priority: text("priority").notNull().default("medium"),
  expectedSavingValue: real("expected_saving_value"),
  expectedSavingUnit: text("expected_saving_unit"),
  expectedCostSaving: real("expected_cost_saving"),
  investmentCost: real("investment_cost"),
  paybackMonths: real("payback_months"),
  startDate: text("start_date"),
  dueDate: text("due_date"),
  completionDate: text("completion_date"),
  progressPercent: real("progress_percent").notNull().default(0),
  status: text("status").notNull().default("planned"),
  isVap: boolean("is_vap").notNull().default(false),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEnergyActionPlanSchema = createInsertSchema(energyActionPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnergyActionPlan = z.infer<typeof insertEnergyActionPlanSchema>;
export type EnergyActionPlan = typeof energyActionPlansTable.$inferSelect;

// ── Energy Target Progress (İzleme ve Gerçekleşme) ───────
export const energyTargetProgressTable = pgTable("energy_target_progress", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  targetId: integer("target_id").references(() => energyTargetsTable.id, { onDelete: "cascade" }).notNull(),
  periodYear: integer("period_year").notNull(),
  periodMonth: integer("period_month"),
  actualValue: real("actual_value").notNull(),
  actualSavingValue: real("actual_saving_value"),
  comment: text("comment"),
  recordedBy: text("recorded_by"),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

export const insertEnergyTargetProgressSchema = createInsertSchema(energyTargetProgressTable).omit({ id: true, recordedAt: true });
export type InsertEnergyTargetProgress = z.infer<typeof insertEnergyTargetProgressSchema>;
export type EnergyTargetProgress = typeof energyTargetProgressTable.$inferSelect;

// ── VAP Projects (Verimlilik Artırıcı Projeler) ───────────
export const vapProjectsTable = pgTable("vap_projects", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  actionPlanId: integer("action_plan_id").references(() => energyActionPlansTable.id, { onDelete: "cascade" }).notNull(),
  projectCode: text("project_code"),
  projectTitle: text("project_title").notNull(),
  projectType: text("project_type"),
  currentSituation: text("current_situation"),
  proposedSolution: text("proposed_solution"),
  technicalDescription: text("technical_description"),
  annualEnergySavingValue: real("annual_energy_saving_value"),
  annualEnergySavingUnit: text("annual_energy_saving_unit"),
  annualCostSaving: real("annual_cost_saving"),
  investmentCost: real("investment_cost"),
  paybackMonths: real("payback_months"),
  co2ReductionTon: real("co2_reduction_ton"),
  measurementVerificationMethod: text("measurement_verification_method"),
  incentiveStatus: text("incentive_status").default("none"),
  feasibilityStatus: text("feasibility_status").default("not_started"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status").notNull().default("idea"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVapProjectSchema = createInsertSchema(vapProjectsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVapProject = z.infer<typeof insertVapProjectSchema>;
export type VapProject = typeof vapProjectsTable.$inferSelect;

// ── Energy Review Records (Dönemsel Gözden Geçirme Kayıtları) ────
export const energyReviewRecordsTable = pgTable("energy_review_records", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
  reviewName: text("review_name").notNull(),
  reviewYear: integer("review_year").notNull(),
  periodType: text("period_type").notNull().default("annual"), // annual | semi_annual | custom
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  scopeType: text("scope_type").notNull().default("unit"), // company | unit
  status: text("status").notNull().default("draft"), // draft | completed | revised
  preparedByUserId: integer("prepared_by_user_id").references(() => usersTable.id, { onDelete: "no action" }).notNull(),
  completedByUserId: integer("completed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  revisionNo: integer("revision_no").notNull().default(1),
  previousRevisionId: integer("previous_revision_id").references((): AnyPgColumn => energyReviewRecordsTable.id, { onDelete: "no action" }),
  generalNotes: text("general_notes"),
  deletedAt: timestamp("deleted_at"),
  deletedByUserId: integer("deleted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  companyIdIdx: index("energy_review_records_company_id_idx").on(table.companyId),
  companyYearIdx: index("energy_review_records_company_year_idx").on(table.companyId, table.reviewYear),
  companyUnitIdx: index("energy_review_records_company_unit_idx").on(table.companyId, table.unitId),
  deletedAtIdx: index("energy_review_records_deleted_at_idx").on(table.deletedAt),
  previousRevisionIdx: index("energy_review_records_previous_revision_idx").on(table.previousRevisionId),
}));

export const insertEnergyReviewRecordSchema = createInsertSchema(energyReviewRecordsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnergyReviewRecord = z.infer<typeof insertEnergyReviewRecordSchema>;
export type EnergyReviewRecord = typeof energyReviewRecordsTable.$inferSelect;

// ── Variables (Değişkenler) ───────────────────────────────
export const variablesTable = pgTable("variables", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  name: text("name").notNull(),
  code: text("code"),
  category: text("category").notNull().default("operational"), // climate | operational | production | calculated | other
  unitLabel: text("unit_label"), // ölçü birimi etiketi (adet, saat, ton, vb.)
  variableType: text("variable_type").notNull().default("numeric"), // numeric | percentage | boolean
  sourceType: text("source_type").notNull().default("operation_manual"), // weather_auto | weather_manual | production_manual | operation_manual | calculated
  scopeType: text("scope_type").notNull().default("company"), // company | unit | sub_unit | meter
  description: text("description"),
  isSystemVariable: boolean("is_system_variable").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVariableSchema = createInsertSchema(variablesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVariable = z.infer<typeof insertVariableSchema>;
export type Variable = typeof variablesTable.$inferSelect;

// ── Variable Values (Değişken Değerleri) ──────────────────
export const variableValuesTable = pgTable("variable_values", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  variableId: integer("variable_id").references(() => variablesTable.id, { onDelete: "cascade" }).notNull(),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "set null" }),
  subUnitId: integer("sub_unit_id").references(() => subUnitsTable.id, { onDelete: "set null" }),
  meterId: integer("meter_id").references(() => metersTable.id, { onDelete: "set null" }),
  periodStart: text("period_start").notNull(), // ISO date string YYYY-MM-DD
  periodEnd: text("period_end").notNull(),
  periodType: text("period_type").notNull().default("monthly"), // daily | monthly | yearly
  value: real("value").notNull(),
  source: text("source"),
  locationProvince: text("location_province"),
  locationDistrict: text("location_district"),
  dataQuality: text("data_quality"), // good | estimated | uncertain
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertVariableValueSchema = createInsertSchema(variableValuesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVariableValue = z.infer<typeof insertVariableValueSchema>;
export type VariableValue = typeof variableValuesTable.$inferSelect;

// ── Weather Degree Days (İklim Veri Tablosu) ──────────────
export const weatherDegreeDaysTable = pgTable("weather_degree_days", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id),
  province: text("province").notNull(),
  district: text("district"),
  stationKey: text("station_key"),
  stationCode: text("station_code"),
  stationName: text("station_name"),
  date: text("date").notNull(), // YYYY-MM for monthly, YYYY for yearly
  year: integer("year"),
  month: integer("month"),
  periodType: text("period_type").notNull().default("monthly"), // daily | monthly | yearly
  baseTemperatureHeating: real("base_temperature_heating").notNull().default(18),
  baseTemperatureCooling: real("base_temperature_cooling").notNull().default(22),
  hdd: real("hdd").notNull().default(0),
  cdd: real("cdd").notNull().default(0),
  hddDays: integer("hdd_days"),
  cddDays: integer("cdd_days"),
  annualHdd: real("annual_hdd"),
  annualCdd: real("annual_cdd"),
  avgTemperature: real("avg_temperature"),
  source: text("source").notNull().default("mgm"),
  sourceUrl: text("source_url"),
  isOfficial: boolean("is_official").notNull().default(false),
  dataMethod: text("data_method").notNull().default("calculated_daily"), // official_monthly | calculated_daily | fallback
  stationNote: text("station_note"),
  importedAt: timestamp("imported_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWeatherDegreeDaySchema = createInsertSchema(weatherDegreeDaysTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWeatherDegreeDay = z.infer<typeof insertWeatherDegreeDaySchema>;
export type WeatherDegreeDay = typeof weatherDegreeDaysTable.$inferSelect;

// ── MGM Station Mappings (İstasyon Eşleştirme) ────────────
export const mgmStationMappingsTable = pgTable("mgm_station_mappings", {
  id: serial("id").primaryKey(),
  stationKey: text("station_key").notNull().unique(),
  stationName: text("station_name"),
  province: text("province"),
  district: text("district"),
  confidence: text("confidence").default("unknown"),
  note: text("note"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMgmStationMappingSchema = createInsertSchema(mgmStationMappingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMgmStationMapping = z.infer<typeof insertMgmStationMappingSchema>;
export type MgmStationMapping = typeof mgmStationMappingsTable.$inferSelect;

// ── Energy Performance Indicators (EnPG) ──────────────────
export const energyPerformanceIndicatorsTable = pgTable("energy_performance_indicators", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }),
  seuAssessmentItemId: integer("seu_assessment_item_id").references(() => seuAssessmentItemsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  energySourceId: integer("energy_source_id").references(() => energySourcesTable.id, { onDelete: "set null" }),
  energyUseGroupId: integer("energy_use_group_id").references(() => energyUseGroupsTable.id, { onDelete: "set null" }),
  meterId: integer("meter_id").references(() => metersTable.id, { onDelete: "set null" }),
  indicatorType: text("indicator_type").notNull().default("consumption"),
  formulaType: text("formula_type").notNull().default("absolute"),
  unit: text("unit"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEnergyPerformanceIndicatorSchema = createInsertSchema(energyPerformanceIndicatorsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnergyPerformanceIndicator = z.infer<typeof insertEnergyPerformanceIndicatorSchema>;
export type EnergyPerformanceIndicator = typeof energyPerformanceIndicatorsTable.$inferSelect;

// ── Energy Baselines (EnRÇ) ────────────────────────────────
export const energyBaselinesTable = pgTable("energy_baselines", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }),
  seuAssessmentItemId: integer("seu_assessment_item_id").references(() => seuAssessmentItemsTable.id, { onDelete: "set null" }),
  enpiId: integer("enpi_id").references(() => energyPerformanceIndicatorsTable.id, { onDelete: "set null" }),
  baselineYear: integer("baseline_year").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  modelType: text("model_type").notNull().default("linear"),
  intercept: real("intercept"),
  rSquared: real("r_squared"),
  adjustedRSquared: real("adjusted_r_squared"),
  sampleSize: integer("sample_size"),
  formulaText: text("formula_text"),
  isValid: boolean("is_valid").notNull().default(false),
  status: text("status").notNull().default("draft"),
  updateReason: text("update_reason"),
  notes: text("notes"),
  dependentVariableUnit: text("dependent_variable_unit"),
  dependentVariableType: text("dependent_variable_type").default("raw_consumption"),
  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEnergyBaselineSchema = createInsertSchema(energyBaselinesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnergyBaseline = z.infer<typeof insertEnergyBaselineSchema>;
export type EnergyBaseline = typeof energyBaselinesTable.$inferSelect;

// ── Energy Baseline Variables ──────────────────────────────
export const energyBaselineVariablesTable = pgTable("energy_baseline_variables", {
  id: serial("id").primaryKey(),
  baselineId: integer("baseline_id").references(() => energyBaselinesTable.id, { onDelete: "cascade" }).notNull(),
  variableId: integer("variable_id").references(() => variablesTable.id, { onDelete: "set null" }),
  variableName: text("variable_name").notNull(),
  variableCode: text("variable_code"),
  variableSource: text("variable_source").notNull().default("manual"),
  coefficient: real("coefficient"),
  standardError: real("standard_error"),
  tStat: real("t_stat"),
  pValue: real("p_value"),
  isSignificant: boolean("is_significant").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEnergyBaselineVariableSchema = createInsertSchema(energyBaselineVariablesTable).omit({ id: true, createdAt: true });
export type InsertEnergyBaselineVariable = z.infer<typeof insertEnergyBaselineVariableSchema>;
export type EnergyBaselineVariable = typeof energyBaselineVariablesTable.$inferSelect;

// ── Energy Performance Results (EnPG Sonuçları) ───────────
export const energyPerformanceResultsTable = pgTable("energy_performance_results", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
  unitId: integer("unit_id").references(() => unitsTable.id, { onDelete: "cascade" }),
  seuAssessmentItemId: integer("seu_assessment_item_id").references(() => seuAssessmentItemsTable.id, { onDelete: "set null" }),
  enpiId: integer("enpi_id").references(() => energyPerformanceIndicatorsTable.id, { onDelete: "set null" }),
  baselineId: integer("baseline_id").references(() => energyBaselinesTable.id, { onDelete: "set null" }),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  actualConsumption: real("actual_consumption"),
  expectedConsumption: real("expected_consumption"),
  difference: real("difference"),
  cusum: real("cusum"),
  eei: real("eei"),
  setValue: real("set_value"),
  status: text("status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEnergyPerformanceResultSchema = createInsertSchema(energyPerformanceResultsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEnergyPerformanceResult = z.infer<typeof insertEnergyPerformanceResultSchema>;
export type EnergyPerformanceResult = typeof energyPerformanceResultsTable.$inferSelect;

// ── Reports ───────────────────────────────────────────────
export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id).notNull().default(1),
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
