import { createHash } from "node:crypto";
import {
  REPORT_DATA_MANIFEST_IDENTITY_ALGORITHM,
  REPORT_DATA_MANIFEST_SCHEMA_VERSION,
  reportDataManifestSummarySchema,
  reportDataManifestV1Schema,
  type ReportDataManifestSource,
  type ReportDataManifestSummary,
  type ReportDataManifestV1,
  type ReportDataQualityWarning,
} from "@workspace/api-zod";

type ReportType = ReportDataManifestV1["reportType"];
type SourceType = ReportDataManifestSource["sourceType"];
type SafePrimitive = string | number | boolean | null;
type SafeRecord = Record<string, SafePrimitive>;
type RowLike = object;

export const REPORT_DATA_MANIFEST_TIMEZONE = "Europe/Istanbul";

export type ManifestAuditMetadata = {
  dataManifest: {
    schemaVersion: 1;
    manifestHash: string;
    sourceCount: number;
    warningCount: number;
    isPartial: boolean;
  };
};

type BaseManifestInput = {
  reportType: ReportType;
  companyId: number;
  unitId: number | null;
  year: number;
  periodStart: string;
  periodEnd: string;
  filters?: SafeRecord;
  settings: {
    profileVersion?: number | null;
    typeSettingsVersion?: number | null;
    documentNumber?: string | null;
    revisionNumber?: string | null;
    revisionDate?: string | null;
  };
  generatedAt: string | Date;
  sources: ReportDataManifestSource[];
  qualityWarnings: ReportDataQualityWarning[];
};

export type AnnualReportManifestInput = {
  companyId: number;
  unitId: number | null;
  year: number;
  generatedAt: string | Date;
  settings: BaseManifestInput["settings"];
  filters?: SafeRecord;
  consumptionRows: RowLike[];
  meters: RowLike[];
  swotItems: RowLike[];
  riskItems: RowLike[];
  seuItems: RowLike[];
  seuAssessmentCount: number;
};

export type EnergyTargetsManifestInput = {
  companyId: number;
  unitId: number | null;
  year: number;
  generatedAt: string | Date;
  settings: BaseManifestInput["settings"];
  filters?: SafeRecord;
  targets: RowLike[];
  actions: RowLike[];
  progressRows: RowLike[];
  vapProjects: RowLike[];
};

export type EnergyPerformanceManifestInput = {
  companyId: number;
  unitId: number | null;
  year: number;
  generatedAt: string | Date;
  settings: BaseManifestInput["settings"];
  filters?: SafeRecord;
  baseline: RowLike;
  baselineVariables: RowLike[];
  results: RowLike[];
  seuAssessmentItemId: number | null;
  technicalProfile: RowLike;
  equipmentInventory: RowLike;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeIsoDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid manifest generatedAt.");
  return date.toISOString();
}

function canonicalScalar(value: unknown): string {
  if (value === undefined || value === null || value === "") return "null";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(12).replace(/0+$/u, "").replace(/\.$/u, "");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toISOString();
    return JSON.stringify(value);
  }
  if (typeof value === "object") return stableStringify(value);
  return "null";
}

function stableStringify(value: unknown): string {
  if (value === undefined || value === null || value === "") return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "number") return canonicalScalar(value);
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return "null";
}

function readField(row: RowLike, field: string): unknown {
  return (row as Record<string, unknown>)[field];
}

function sourceFromRows(
  sourceType: SourceType,
  rows: readonly RowLike[],
  fields: readonly string[],
  summary?: SafeRecord,
): ReportDataManifestSource {
  const lines = rows
    .map((row) => fields.map((field) => `${field}=${canonicalScalar(readField(row, field))}`).join("|"))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const hashInput = `report-data-manifest-source-v1|${sourceType}|${REPORT_DATA_MANIFEST_IDENTITY_ALGORITHM}\n${lines.join("\n")}`;
  return {
    sourceType,
    recordCount: rows.length,
    identityHash: sha256Hex(hashInput),
    identityAlgorithm: REPORT_DATA_MANIFEST_IDENTITY_ALGORITHM,
    identitySchemaVersion: 1,
    ...(summary ? { summary } : {}),
  };
}

function sourceFromSyntheticRecord(sourceType: SourceType, record: SafeRecord | null, summary?: SafeRecord): ReportDataManifestSource {
  return sourceFromRows(sourceType, record === null ? [] : [record], Object.keys(record ?? {}).sort(), summary);
}

function warning(input: ReportDataQualityWarning): ReportDataQualityWarning {
  return input;
}

function settingsForManifest(settings: BaseManifestInput["settings"]): BaseManifestInput["settings"] {
  return {
    profileVersion: settings.profileVersion ?? null,
    typeSettingsVersion: settings.typeSettingsVersion ?? null,
    documentNumber: settings.documentNumber ?? null,
    revisionNumber: settings.revisionNumber ?? null,
    revisionDate: settings.revisionDate ?? null,
  };
}

function finalizeManifest(input: BaseManifestInput): ReportDataManifestV1 {
  const sources = [...input.sources].sort((left, right) => left.sourceType < right.sourceType ? -1 : left.sourceType > right.sourceType ? 1 : 0);
  const manifestWithoutHash = {
    schemaVersion: REPORT_DATA_MANIFEST_SCHEMA_VERSION,
    reportType: input.reportType,
    scope: {
      companyId: input.companyId,
      unitId: input.unitId,
      companyWide: input.unitId === null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      year: input.year,
      timezone: REPORT_DATA_MANIFEST_TIMEZONE,
    },
    filters: input.filters ?? {},
    sources,
    qualityWarnings: input.qualityWarnings,
    isPartial: input.qualityWarnings.some((item) => item.severity === "warning"),
    settings: settingsForManifest(input.settings),
    generatedAt: safeIsoDateTime(input.generatedAt),
  };
  const manifestHash = sha256Hex(`report-data-manifest-v1|${REPORT_DATA_MANIFEST_IDENTITY_ALGORITHM}\n${stableStringify(manifestWithoutHash)}`);
  return reportDataManifestV1Schema.parse({ ...manifestWithoutHash, manifestHash });
}

function missingMonths(year: number, rows: readonly RowLike[]): string[] {
  const months = new Set(rows
    .map((row) => readField(row, "month"))
    .filter((month): month is number => typeof month === "number" && Number.isInteger(month) && month >= 1 && month <= 12));
  return Array.from({ length: 12 }, (_, index) => index + 1)
    .filter((month) => !months.has(month))
    .map((month) => `${year}-${String(month).padStart(2, "0")}`);
}

export function buildAnnualReportDataManifest(input: AnnualReportManifestInput): ReportDataManifestV1 {
  const missing = missingMonths(input.year, input.consumptionRows);
  const qualityWarnings: ReportDataQualityWarning[] = [];
  if (missing.length > 0) {
    qualityWarnings.push(warning({
      code: "MISSING_CONSUMPTION_MONTHS",
      severity: "warning",
      sourceType: "annual_consumption",
      count: missing.length,
      periods: missing,
      message: "Annual report consumption coverage has missing months.",
    }));
  }
  if (input.consumptionRows.length === 0 && input.meters.length === 0 && input.seuItems.length === 0) {
    qualityWarnings.push(warning({
      code: "NO_SOURCE_RECORDS",
      severity: "warning",
      sourceType: null,
      message: "Annual report was generated without primary evidence rows.",
    }));
  }
  return finalizeManifest({
    reportType: "annual_energy_performance",
    companyId: input.companyId,
    unitId: input.unitId,
    year: input.year,
    periodStart: `${input.year}-01-01`,
    periodEnd: `${input.year}-12-31`,
    filters: input.filters,
    settings: input.settings,
    generatedAt: input.generatedAt,
    qualityWarnings,
    sources: [
      sourceFromRows("annual_consumption", input.consumptionRows, ["id", "meterId", "year", "month", "kwh", "tep", "co2", "hdd", "cdd", "createdAt"]),
      sourceFromRows("annual_meters", input.meters, ["id", "unitId", "subUnitId", "energySourceId", "active", "createdAt"]),
      sourceFromRows("annual_swot", input.swotItems, ["id", "unitId", "category", "score", "impact", "createdAt"]),
      sourceFromRows("annual_risks", input.riskItems, ["id", "unitId", "type", "probability", "severity", "score", "status", "createdAt"]),
      sourceFromRows("annual_seu", input.seuItems, ["assessmentId", "itemId", "unitId", "energySourceId", "energyTep", "consumptionSharePercent", "priorityResult", "userDecision", "assessmentYear"], { assessmentCount: input.seuAssessmentCount }),
    ],
  });
}

export function buildEnergyTargetsReportDataManifest(input: EnergyTargetsManifestInput): ReportDataManifestV1 {
  const qualityWarnings: ReportDataQualityWarning[] = [];
  if (input.targets.length > 0 && input.progressRows.length === 0) {
    qualityWarnings.push(warning({
      code: "MISSING_TARGET_PROGRESS",
      severity: "warning",
      sourceType: "target_progress",
      message: "No progress rows were available for the target report period.",
    }));
  }
  if (input.targets.length === 0) {
    qualityWarnings.push(warning({
      code: "NO_SOURCE_RECORDS",
      severity: "warning",
      sourceType: "energy_targets",
      message: "Target report was generated without target rows.",
    }));
  }
  return finalizeManifest({
    reportType: "energy_targets_management",
    companyId: input.companyId,
    unitId: input.unitId,
    year: input.year,
    periodStart: `${input.year}-01-01`,
    periodEnd: `${input.year}-12-31`,
    filters: input.filters,
    settings: input.settings,
    generatedAt: input.generatedAt,
    qualityWarnings,
    sources: [
      sourceFromRows("energy_targets", input.targets, ["id", "baselineYear", "targetYear", "baselineValue", "targetValue", "actualValue", "targetReductionPercent", "status", "unitId"]),
      sourceFromRows("action_plans", input.actions, ["id", "targetId", "status", "progressPercent", "isVap", "startDate", "dueDate", "expectedSavingValue", "expectedSavingUnit", "createdAt", "updatedAt"]),
      sourceFromRows("target_progress", input.progressRows, ["id", "targetId", "periodYear", "periodMonth", "actualValue", "actualSavingValue", "recordedAt"]),
      sourceFromRows("vap_projects", input.vapProjects, ["id", "actionPlanId", "investmentCost", "annualCostSaving", "annualEnergySavingValue", "annualEnergySavingUnit", "paybackMonths", "feasibilityStatus", "createdAt", "updatedAt"]),
      sourceFromSyntheticRecord("report_units", input.unitId === null ? null : { unitId: input.unitId }, { companyWide: input.unitId === null }),
    ],
  });
}

export function buildEnergyPerformanceReportDataManifest(input: EnergyPerformanceManifestInput): ReportDataManifestV1 {
  const qualityWarnings: ReportDataQualityWarning[] = [];
  if (input.results.length === 0) {
    qualityWarnings.push(warning({
      code: "MISSING_PERFORMANCE_RESULTS",
      severity: "warning",
      sourceType: "energy_performance_results",
      message: "No performance result rows were available for the monitoring period.",
    }));
  }
  if (input.baselineVariables.length === 0) {
    qualityWarnings.push(warning({
      code: "MISSING_MODEL_VARIABLES",
      severity: "warning",
      sourceType: "energy_baseline_variables",
      message: "The selected baseline has no model variable rows.",
    }));
  }
  if (readField(input.technicalProfile, "status") !== "resolved") {
    qualityWarnings.push(warning({
      code: "MISSING_TECHNICAL_PROFILE",
      severity: "warning",
      sourceType: "technical_profile",
      message: "No resolved technical profile snapshot was available for the report scope.",
    }));
  }
  const equipmentSource = readField(input.equipmentInventory, "source");
  const equipmentIncludedCount = typeof equipmentSource === "object" && equipmentSource !== null
    ? readField(equipmentSource, "includedCount")
    : null;
  if (typeof equipmentIncludedCount !== "number" || equipmentIncludedCount <= 0) {
    qualityWarnings.push(warning({
      code: "MISSING_EQUIPMENT_INVENTORY",
      severity: "warning",
      sourceType: "equipment_inventory",
      message: "No equipment inventory rows were included in the report context.",
    }));
  }
  return finalizeManifest({
    reportType: "energy_performance_monitoring",
    companyId: input.companyId,
    unitId: input.unitId,
    year: input.year,
    periodStart: `${input.year}-01-01`,
    periodEnd: `${input.year}-12-31`,
    filters: input.filters,
    settings: input.settings,
    generatedAt: input.generatedAt,
    qualityWarnings,
    sources: [
      sourceFromRows("energy_baseline", [input.baseline], ["id", "baselineYear", "periodStart", "periodEnd", "modelType", "intercept", "rSquared", "adjustedRSquared", "sampleSize", "formulaText", "isValid", "status", "rawUnit", "unitId", "seuAssessmentItemId"]),
      sourceFromRows("energy_baseline_variables", input.baselineVariables, ["id", "baselineId", "variableName", "coefficient", "standardError", "tStat", "pValue", "isSignificant"]),
      sourceFromRows("energy_performance_results", input.results, ["id", "baselineId", "year", "month", "actualConsumption", "expectedConsumption", "difference", "cusum", "eei", "status", "calculatedAt"]),
      sourceFromSyntheticRecord("energy_performance_seu", input.seuAssessmentItemId === null ? null : { seuAssessmentItemId: input.seuAssessmentItemId }),
      sourceFromRows("technical_profile", [input.technicalProfile], ["status", "effectiveDate", "snapshotId", "snapshotNumber", "profileVersion", "publishedAt", "completionPercentage"]),
      sourceFromRows("equipment_inventory", [input.equipmentInventory], ["source", "scope", "coverage", "aggregates", "readiness"]),
    ],
  });
}

export function summarizeReportDataManifest(value: unknown): ReportDataManifestSummary | null {
  const parsed = reportDataManifestV1Schema.safeParse(value);
  if (!parsed.success) return null;
  const manifest = parsed.data;
  return reportDataManifestSummarySchema.parse({
    schemaVersion: manifest.schemaVersion,
    period: {
      periodStart: manifest.scope.periodStart,
      periodEnd: manifest.scope.periodEnd,
      year: manifest.scope.year,
      timezone: manifest.scope.timezone,
    },
    sources: manifest.sources.map((source) => ({
      sourceType: source.sourceType,
      recordCount: source.recordCount,
      identityHash: source.identityHash,
      identityAlgorithm: source.identityAlgorithm,
      identitySchemaVersion: source.identitySchemaVersion,
    })),
    qualityWarnings: manifest.qualityWarnings,
    isPartial: manifest.isPartial,
    manifestHash: manifest.manifestHash,
  });
}

export function manifestAuditMetadata(manifest: ReportDataManifestV1): ManifestAuditMetadata {
  return {
    dataManifest: {
      schemaVersion: manifest.schemaVersion,
      manifestHash: manifest.manifestHash,
      sourceCount: manifest.sources.length,
      warningCount: manifest.qualityWarnings.length,
      isPartial: manifest.isPartial,
    },
  };
}
