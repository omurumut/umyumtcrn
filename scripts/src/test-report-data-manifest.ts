import { fileURLToPath, pathToFileURL } from "node:url";
import path, { resolve } from "node:path";
import { pool } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ManifestModule = {
  buildAnnualReportDataManifest(input: Record<string, unknown>): ReportManifest;
  buildEnergyTargetsReportDataManifest(input: Record<string, unknown>): ReportManifest;
  buildEnergyPerformanceReportDataManifest(input: Record<string, unknown>): ReportManifest;
  summarizeReportDataManifest(value: unknown): ReportManifestSummary | null;
  manifestAuditMetadata(value: ReportManifest): { dataManifest: { schemaVersion: number; manifestHash: string; sourceCount: number; warningCount: number; isPartial: boolean } };
};

type ReportManifest = {
  schemaVersion: 1;
  reportType: string;
  scope: { companyId: number; unitId: number | null; companyWide: boolean; periodStart: string; periodEnd: string; year: number; timezone: string };
  filters: Record<string, unknown>;
  sources: Array<{ sourceType: string; recordCount: number; identityHash: string; identityAlgorithm: string; identitySchemaVersion: number }>;
  qualityWarnings: Array<{ code: string; severity: string; sourceType: string | null }>;
  isPartial: boolean;
  manifestHash: string;
};

type ReportManifestSummary = {
  schemaVersion: 1;
  period: { periodStart: string; periodEnd: string; year: number; timezone: string };
  sources: Array<{ sourceType: string; recordCount: number; identityHash: string }>;
  qualityWarnings: Array<{ code: string }>;
  isPartial: boolean;
  manifestHash: string;
};

const manifestModule = await import(pathToFileURL(resolve(__dirname, "../../artifacts/api-server/src/lib/report-data-manifest.ts")).href) as ManifestModule;

const counters = { reportDataManifestScenarios: 0 };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function bump(count = 1): void {
  counters.reportDataManifestScenarios += count;
}

function source(manifest: ReportManifest, sourceType: string) {
  const found = manifest.sources.find((item) => item.sourceType === sourceType);
  assert(found, `Source missing: ${sourceType}`);
  return found;
}

const settings = {
  profileVersion: 7,
  typeSettingsVersion: 9,
  documentNumber: "DOC-42",
  revisionNumber: "R1",
  revisionDate: "2026-07-23",
};

const annualRows = Array.from({ length: 12 }, (_, index) => ({
  id: index + 1,
  meterId: index % 2 === 0 ? 10 : 11,
  year: 2026,
  month: index + 1,
  kwh: 100 + index,
  tep: 1.2345 + index,
  co2: 2.5 + index,
  hdd: index,
  cdd: 12 - index,
  notes: `secret note ${index}`,
  createdAt: new Date(Date.UTC(2026, index, 1)),
}));
const annualInput = {
  companyId: 1,
  unitId: 2,
  year: 2026,
  generatedAt: "2026-07-23T10:00:00.000Z",
  settings,
  filters: { includeSwot: true, includeRisks: true, includeSeu: true, includeRegression: false },
  consumptionRows: annualRows,
  meters: [{ id: 10, unitId: 2, subUnitId: null, energySourceId: 5, active: true, createdAt: "2026-01-01T00:00:00.000Z" }],
  swotItems: [{ id: 20, unitId: 2, category: "strength", title: "not hashed", score: 4, impact: "high", createdAt: "2026-02-01T00:00:00.000Z" }],
  riskItems: [{ id: 30, unitId: 2, type: "risk", title: "not hashed", probability: 2, severity: 3, score: 6, status: "open", createdAt: "2026-03-01T00:00:00.000Z" }],
  seuItems: [{ assessmentId: 40, itemId: 41, unitId: 2, energySourceId: 5, energyTep: 12.5, consumptionSharePercent: 66.7, priorityResult: "A", userDecision: "accepted_as_seu", assessmentYear: 2026, decisionReason: "secret" }],
  seuAssessmentCount: 1,
};

const annualManifest = manifestModule.buildAnnualReportDataManifest(annualInput);
const annualReordered = manifestModule.buildAnnualReportDataManifest({ ...annualInput, consumptionRows: [...annualRows].reverse() });
assert(annualManifest.manifestHash === annualReordered.manifestHash, "Row order changed annual manifest hash.");
assert(annualManifest.isPartial === false, "Complete annual coverage should not be partial.");
assert(source(annualManifest, "annual_consumption").recordCount === 12, "Annual consumption source count mismatch.");
assert(!JSON.stringify(annualManifest).includes("secret note"), "Annual manifest leaked row note text.");
bump(4);

const annualChanged = manifestModule.buildAnnualReportDataManifest({
  ...annualInput,
  consumptionRows: annualRows.map((row, index) => index === 0 ? { ...row, kwh: row.kwh + 1 } : row),
});
assert(source(annualManifest, "annual_consumption").identityHash !== source(annualChanged, "annual_consumption").identityHash, "Annual consumption hash did not change.");
const annualGeneratedLater = manifestModule.buildAnnualReportDataManifest({ ...annualInput, generatedAt: "2026-07-23T11:00:00.000Z" });
assert(source(annualManifest, "annual_consumption").identityHash === source(annualGeneratedLater, "annual_consumption").identityHash, "GeneratedAt changed source identity hash.");
assert(annualManifest.manifestHash !== annualGeneratedLater.manifestHash, "GeneratedAt did not change manifest hash.");
const annualPartial = manifestModule.buildAnnualReportDataManifest({ ...annualInput, consumptionRows: annualRows.slice(0, 10) });
assert(annualPartial.isPartial === true && annualPartial.qualityWarnings.some((item) => item.code === "MISSING_CONSUMPTION_MONTHS"), "Missing months warning failed.");
const annualEmpty = manifestModule.buildAnnualReportDataManifest({ ...annualInput, consumptionRows: [], meters: [], seuItems: [] });
assert(annualEmpty.qualityWarnings.some((item) => item.code === "NO_SOURCE_RECORDS"), "No source rows warning failed.");
bump(5);

const targetInput = {
  companyId: 1,
  unitId: null,
  year: 2026,
  generatedAt: "2026-07-23T10:00:00.000Z",
  settings,
  filters: { status: "active", includeVap: true, includeProgress: true },
  targets: [{ id: 101, baselineYear: 2025, targetYear: 2027, baselineValue: 1000, targetValue: 900, actualValue: 950, targetReductionPercent: 10, status: "active", unitId: null, name: "not hashed" }],
  actions: [{ id: 201, targetId: 101, status: "in_progress", progressPercent: 40, isVap: true, startDate: "2026-01-01", dueDate: "2026-12-31", expectedSavingValue: 50, expectedSavingUnit: "kWh", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z", title: "not hashed" }],
  progressRows: [{ id: 301, targetId: 101, periodYear: 2026, periodMonth: 6, actualValue: 960, actualSavingValue: 40, recordedAt: "2026-06-30T00:00:00.000Z", comment: "secret" }],
  vapProjects: [{ id: 401, actionPlanId: 201, investmentCost: 10000, annualCostSaving: 2000, annualEnergySavingValue: 50, annualEnergySavingUnit: "kWh", paybackMonths: 60, feasibilityStatus: "feasible", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-02-03T00:00:00.000Z", projectTitle: "not hashed" }],
};
const targetManifest = manifestModule.buildEnergyTargetsReportDataManifest(targetInput);
assert(targetManifest.reportType === "energy_targets_management" && targetManifest.scope.companyWide === true, "Target manifest company-wide scope failed.");
assert(source(targetManifest, "energy_targets").recordCount === 1 && source(targetManifest, "target_progress").recordCount === 1, "Target source counts failed.");
assert(source(targetManifest, "report_units").recordCount === 0, "Company-wide unit source should be empty.");
assert(targetManifest.filters.status === "active" && targetManifest.isPartial === false, "Target filters or partial flag failed.");
assert(!JSON.stringify(targetManifest).includes("secret"), "Target manifest leaked free text.");
bump(5);

const targetMissingProgress = manifestModule.buildEnergyTargetsReportDataManifest({ ...targetInput, progressRows: [] });
assert(targetMissingProgress.isPartial === true && targetMissingProgress.qualityWarnings.some((item) => item.code === "MISSING_TARGET_PROGRESS"), "Missing target progress warning failed.");
const targetUnit = manifestModule.buildEnergyTargetsReportDataManifest({ ...targetInput, unitId: 2 });
assert(source(targetUnit, "report_units").recordCount === 1, "Scoped target report unit source failed.");
const targetNoRows = manifestModule.buildEnergyTargetsReportDataManifest({ ...targetInput, targets: [], actions: [], progressRows: [], vapProjects: [] });
assert(targetNoRows.qualityWarnings.some((item) => item.code === "NO_SOURCE_RECORDS"), "Target no source warning failed.");
bump(3);

const performanceInput = {
  companyId: 1,
  unitId: 2,
  year: 2026,
  generatedAt: "2026-07-23T10:00:00.000Z",
  settings,
  filters: { baselineId: 500 },
  baseline: { id: 500, baselineYear: 2025, periodStart: "2025-01-01", periodEnd: "2025-12-31", modelType: "single_regression", intercept: 10, rSquared: 0.91, adjustedRSquared: 0.9, sampleSize: 12, formulaText: "y=10+x", isValid: true, status: "approved", rawUnit: "kWh", unitId: 2, seuAssessmentItemId: 700 },
  baselineVariables: [{ id: 501, baselineId: 500, variableName: "hdd", coefficient: 1.2, standardError: 0.1, tStat: 12, pValue: 0.01, isSignificant: true }],
  results: [{ id: 601, baselineId: 500, year: 2026, month: 1, actualConsumption: 100, expectedConsumption: 95, difference: 5, cusum: 5, eei: 1.05, status: "deterioration", calculatedAt: "2026-02-01T00:00:00.000Z" }],
  seuAssessmentItemId: 700,
  technicalProfile: { status: "resolved", effectiveDate: "2026-12-31", snapshotId: 800, snapshotNumber: 3, profileVersion: 4, publishedAt: "2026-01-01T00:00:00.000Z", completionPercentage: 90, warning: "secret" },
  equipmentInventory: { source: { includedCount: 3 }, scope: { activeEquipment: 4 }, coverage: { withPrimaryMeter: 2 }, aggregates: { installedPowerKw: 100 }, readiness: { status: "ready" }, warnings: ["secret"] },
};
const performanceManifest = manifestModule.buildEnergyPerformanceReportDataManifest(performanceInput);
assert(performanceManifest.reportType === "energy_performance_monitoring" && performanceManifest.isPartial === false, "Performance manifest partial flag failed.");
assert(source(performanceManifest, "energy_baseline").recordCount === 1 && source(performanceManifest, "energy_performance_results").recordCount === 1, "Performance source counts failed.");
assert(source(performanceManifest, "energy_performance_seu").recordCount === 1, "Performance SEU source failed.");
assert(!JSON.stringify(performanceManifest).includes("secret"), "Performance manifest leaked warning/free text.");
bump(4);

const performanceMissing = manifestModule.buildEnergyPerformanceReportDataManifest({
  ...performanceInput,
  baselineVariables: [],
  results: [],
  technicalProfile: { status: "missing", effectiveDate: "2026-12-31" },
  equipmentInventory: { source: { includedCount: 0 }, scope: {}, coverage: {}, aggregates: {}, readiness: { status: "missing" } },
});
assert(performanceMissing.isPartial === true, "Performance missing context should be partial.");
assert(performanceMissing.qualityWarnings.some((item) => item.code === "MISSING_PERFORMANCE_RESULTS"), "Missing performance results warning failed.");
assert(performanceMissing.qualityWarnings.some((item) => item.code === "MISSING_MODEL_VARIABLES"), "Missing model variables warning failed.");
assert(performanceMissing.qualityWarnings.some((item) => item.code === "MISSING_TECHNICAL_PROFILE"), "Missing technical profile warning failed.");
assert(performanceMissing.qualityWarnings.some((item) => item.code === "MISSING_EQUIPMENT_INVENTORY"), "Missing equipment inventory warning failed.");
bump(5);

const summary = manifestModule.summarizeReportDataManifest(performanceManifest);
assert(summary !== null && summary.manifestHash === performanceManifest.manifestHash, "Manifest summary failed.");
assert(summary.sources.every((item) => !("summary" in item)), "Summary exposed source internals.");
assert(manifestModule.summarizeReportDataManifest({ schemaVersion: 999 }) === null, "Unknown manifest version should return null.");
const audit = manifestModule.manifestAuditMetadata(performanceManifest);
assert(audit.dataManifest.sourceCount === performanceManifest.sources.length && audit.dataManifest.warningCount === 0, "Audit manifest metadata failed.");
bump(4);

const client = await pool.connect();
try {
  const userResult = await client.query<{ id: number; company_id: number; unit_id: number | null }>("SELECT id, company_id, unit_id FROM users ORDER BY id LIMIT 1");
  const user = userResult.rows[0];
  assert(user, "No user available for manifest DB smoke.");
  const columnResult = await client.query<{ data_type: string; is_nullable: string }>(
    `SELECT data_type, is_nullable
     FROM information_schema.columns
     WHERE table_name='report_generation_snapshots' AND column_name='data_manifest_json'`,
  );
  assert(columnResult.rows[0]?.data_type === "jsonb", "Manifest column is not jsonb.");
  assert(columnResult.rows[0]?.is_nullable === "YES", "Manifest column should be nullable.");
  bump(2);
  const insert = await client.query<{ id: number }>(
    `INSERT INTO report_generation_snapshots(
       company_id, unit_id, report_type, year, status, storage_status, filename,
       settings_snapshot_json, data_manifest_json, generated_by, completed_at
     )
     VALUES($1,$2,'energy_performance_monitoring',2026,'completed','stored','manifest-fixture.json',$3::jsonb,$4::jsonb,$5,now())
     RETURNING id`,
    [
      user.company_id,
      user.unit_id,
      JSON.stringify({ fixture: "report-data-manifest", profileVersion: 7, typeSettingsVersion: 9 }),
      JSON.stringify(performanceManifest),
      user.id,
    ],
  );
  const snapshotId = insert.rows[0]!.id;
  const selected = await client.query<{ source_count: string; manifest_hash: string }>(
    "SELECT jsonb_array_length(data_manifest_json->'sources')::text AS source_count, data_manifest_json->>'manifestHash' AS manifest_hash FROM report_generation_snapshots WHERE id=$1",
    [snapshotId],
  );
  assert(Number(selected.rows[0]?.source_count) === performanceManifest.sources.length, "Manifest source count was not persisted.");
  assert(selected.rows[0]?.manifest_hash === performanceManifest.manifestHash, "Manifest hash was not persisted.");
  const legacyInsert = await client.query<{ id: number }>(
    `INSERT INTO report_generation_snapshots(
       company_id, unit_id, report_type, year, status, storage_status, filename,
       settings_snapshot_json, generated_by, completed_at
     )
     VALUES($1,$2,'annual_energy_performance',2026,'completed','not_stored','manifest-legacy-fixture.json',$3::jsonb,$4,now())
     RETURNING id`,
    [
      user.company_id,
      user.unit_id,
      JSON.stringify({ fixture: "report-data-manifest-legacy", profileVersion: 1, typeSettingsVersion: 1 }),
      user.id,
    ],
  );
  const legacySnapshotId = legacyInsert.rows[0]!.id;
  const legacySelected = await client.query<{ data_manifest_json: unknown }>(
    "SELECT data_manifest_json FROM report_generation_snapshots WHERE id=$1",
    [legacySnapshotId],
  );
  assert(legacySelected.rows[0]?.data_manifest_json === null, "Legacy snapshot should allow null manifest.");
  await client.query("DELETE FROM report_generation_snapshots WHERE id=ANY($1::int[])", [[snapshotId, legacySnapshotId]]);
  bump(2);
} finally {
  client.release();
}

console.log(JSON.stringify(counters));
