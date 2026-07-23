import { z } from "zod/v4";

export const REPORT_DATA_MANIFEST_SCHEMA_VERSION = 1;
export const REPORT_DATA_MANIFEST_IDENTITY_ALGORITHM = "sha256";

export const reportDataManifestReportTypes = [
  "annual_energy_performance",
  "energy_targets_management",
  "energy_performance_monitoring",
] as const;

export const reportDataManifestSourceTypes = [
  "annual_consumption",
  "annual_meters",
  "annual_swot",
  "annual_risks",
  "annual_seu",
  "energy_targets",
  "target_progress",
  "action_plans",
  "vap_projects",
  "report_units",
  "energy_baseline",
  "energy_baseline_variables",
  "energy_performance_results",
  "energy_performance_seu",
  "technical_profile",
  "equipment_inventory",
] as const;

export const reportDataQualityWarningCodes = [
  "MISSING_CONSUMPTION_MONTHS",
  "PARTIAL_PERIOD",
  "MISSING_TARGET_PROGRESS",
  "MISSING_PERFORMANCE_RESULTS",
  "MISSING_MODEL_VARIABLES",
  "MISSING_TECHNICAL_PROFILE",
  "MISSING_EQUIPMENT_INVENTORY",
  "NO_SOURCE_RECORDS",
] as const;

const safePrimitiveSchema = z.union([z.string().max(240), z.number().finite(), z.boolean(), z.null()]);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const reportDataQualityWarningSchema = z.object({
  code: z.enum(reportDataQualityWarningCodes),
  severity: z.enum(["info", "warning"]),
  sourceType: z.enum(reportDataManifestSourceTypes).nullable(),
  count: z.number().int().nonnegative().optional(),
  periods: z.array(z.string().max(32)).max(36).optional(),
  message: z.string().max(240).optional(),
});

export const reportDataManifestSourceSchema = z.object({
  sourceType: z.enum(reportDataManifestSourceTypes),
  recordCount: z.number().int().nonnegative(),
  identityHash: hashSchema,
  identityAlgorithm: z.literal(REPORT_DATA_MANIFEST_IDENTITY_ALGORITHM),
  identitySchemaVersion: z.literal(1),
  summary: z.record(z.string(), safePrimitiveSchema).optional(),
});

export const reportDataManifestScopeSchema = z.object({
  companyId: z.number().int().positive(),
  unitId: z.number().int().positive().nullable(),
  companyWide: z.boolean(),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  year: z.number().int(),
  timezone: z.string().min(1).max(64),
});

export const reportDataManifestSettingsSchema = z.object({
  profileVersion: z.number().int().nonnegative().nullable(),
  typeSettingsVersion: z.number().int().nonnegative().nullable(),
  documentNumber: z.string().max(120).nullable(),
  revisionNumber: z.string().max(80).nullable(),
  revisionDate: z.string().max(32).nullable(),
});

export const reportDataManifestV1Schema = z.object({
  schemaVersion: z.literal(REPORT_DATA_MANIFEST_SCHEMA_VERSION),
  reportType: z.enum(reportDataManifestReportTypes),
  scope: reportDataManifestScopeSchema,
  filters: z.record(z.string(), safePrimitiveSchema),
  sources: z.array(reportDataManifestSourceSchema).min(1).max(24),
  qualityWarnings: z.array(reportDataQualityWarningSchema).max(24),
  isPartial: z.boolean(),
  settings: reportDataManifestSettingsSchema,
  generatedAt: z.string().datetime(),
  manifestHash: hashSchema,
});

export const reportDataManifestSummarySchema = z.object({
  schemaVersion: z.literal(REPORT_DATA_MANIFEST_SCHEMA_VERSION),
  period: z.object({
    periodStart: z.string(),
    periodEnd: z.string(),
    year: z.number().int(),
    timezone: z.string(),
  }),
  sources: z.array(reportDataManifestSourceSchema.pick({
    sourceType: true,
    recordCount: true,
    identityHash: true,
    identityAlgorithm: true,
    identitySchemaVersion: true,
  })).max(24),
  qualityWarnings: z.array(reportDataQualityWarningSchema).max(24),
  isPartial: z.boolean(),
  manifestHash: hashSchema,
});

export type ReportDataManifestV1 = z.infer<typeof reportDataManifestV1Schema>;
export type ReportDataManifestSource = z.infer<typeof reportDataManifestSourceSchema>;
export type ReportDataQualityWarning = z.infer<typeof reportDataQualityWarningSchema>;
export type ReportDataManifestSummary = z.infer<typeof reportDataManifestSummarySchema>;
