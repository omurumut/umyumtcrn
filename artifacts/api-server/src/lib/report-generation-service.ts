import { and, asc, desc, eq, gte, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import {
  companiesTable,
  consumptionTable,
  db,
  energyActionPlansTable,
  energyBaselineVariablesTable,
  energyBaselinesTable,
  energyPerformanceResultsTable,
  energySourcesTable,
  energyTargetProgressTable,
  energyTargetsTable,
  metersTable,
  reportGenerationSnapshotsTable,
  reportsTable,
  risksTable,
  seuAssessmentItemsTable,
  seuAssessmentsTable,
  swotTable,
  unitsTable,
  vapProjectsTable,
} from "@workspace/db";
import type { ReportDataManifestV1 } from "@workspace/api-zod";
import {
  ANNUAL_ENERGY_REPORT_TYPE,
  AnnualEnergyReportSnapshotError,
  buildAnnualEnergyReportSnapshot,
  parseAnnualEnergyLegacyOverrides,
  visibleAnnualEnergySections,
  type AnnualEnergyReportSnapshot,
} from "./annual-energy-report-snapshot.js";
import {
  ENERGY_PERFORMANCE_REPORT_TYPE,
  EnergyPerformanceReportSnapshotError,
  buildEnergyPerformanceReportSnapshot,
  visibleEnergyPerformanceSections,
  type EnergyPerformanceReportSnapshot,
} from "./energy-performance-report-snapshot.js";
import {
  ENERGY_TARGETS_REPORT_TYPE,
  ReportSettingsSnapshotError,
  buildEnergyTargetsReportSnapshot,
  parseEnergyTargetsLegacyOverrides,
  visibleEnergyTargetsSections,
  type EnergyTargetsReportSnapshot,
} from "./energy-targets-report-snapshot.js";
import { resolveEffectiveCompanyReportSettings } from "./company-report-settings-resolver.js";
import { renderHtmlToPdf } from "./pdf-render.js";
import {
  buildAnnualReportDataManifest,
  buildEnergyPerformanceReportDataManifest,
  buildEnergyTargetsReportDataManifest,
  manifestAuditMetadata,
} from "./report-data-manifest.js";
import {
  buildCorporateReportHtml,
  buildCorporateSectionHeading,
  logoBufferToDataUri,
} from "./report-pdf-layout.js";
import type { ArchiveContentType, ArchiveReportType } from "./report-archive.js";
import { ReportStorageError } from "./report-storage.js";
import {
  buildEquipmentInventoryContext,
  toEquipmentReportSnapshot,
} from "./equipment-inventory-context.js";
import {
  buildTechnicalProfileReportContext,
  endOfYearEffectiveDate,
} from "./unit-technical-profile-effective.js";

export type ReportGenerationTrigger = "initial" | "retry";

export type ReportGenerationRequest =
  | {
      reportType: typeof ANNUAL_ENERGY_REPORT_TYPE;
      companyId: number;
      unitId: number | null;
      year: number;
      requestedByUserId: number | null;
      requestedByName?: string | null;
      trigger: ReportGenerationTrigger;
      retryOfArchiveId?: number | null;
      legacyOverrides?: ReturnType<typeof parseAnnualEnergyLegacyOverrides>;
    }
  | {
      reportType: typeof ENERGY_TARGETS_REPORT_TYPE;
      companyId: number;
      unitId: number | null;
      year: number;
      requestedByUserId: number | null;
      requestedByName?: string | null;
      trigger: ReportGenerationTrigger;
      retryOfArchiveId?: number | null;
      status?: string | null;
      legacyOverrides?: ReturnType<typeof parseEnergyTargetsLegacyOverrides>;
    }
  | {
      reportType: typeof ENERGY_PERFORMANCE_REPORT_TYPE;
      companyId: number | null;
      unitId: number | null;
      baselineId: number;
      year: number;
      requestedByUserId: number | null;
      requestedByName?: string | null;
      trigger: ReportGenerationTrigger;
      retryOfArchiveId?: number | null;
    };

type ArchiveStartInput = {
  companyId: number;
  unitId: number | null;
  reportType: ArchiveReportType;
  reportYear: number | null;
  periodLabel?: string | null;
  title: string;
  outputName: string;
  contentType: ArchiveContentType;
  snapshotId: number;
  retryOfArchiveId?: number | null;
  legacyReportId?: number | null;
};

type ArchiveCompleteInput = {
  archiveId: number;
  companyId: number;
  unitId: number | null;
  reportType: ArchiveReportType;
  reportYear: number | null;
  outputName: string;
  contentType: ArchiveContentType;
  content: Buffer;
  snapshotId: number;
};

type ArchiveFailInput = {
  archiveId: number | null;
  companyId: number | null;
  unitId: number | null;
  reportType: ArchiveReportType;
  snapshotId: number | null;
  failureCategory: string;
  outputName?: string | null;
};

type AuditInput = {
  companyId: number | null;
  unitId: number | null;
  action:
    | "annual_energy_performance_report.generation_started"
    | "annual_energy_performance_report.generation_completed"
    | "annual_energy_performance_report.generation_failed"
    | "energy_targets_report.generation_started"
    | "energy_targets_report.generation_completed"
    | "energy_targets_report.generation_failed"
    | "energy_performance_report.generation_started"
    | "energy_performance_report.generation_completed"
    | "energy_performance_report.generation_failed";
  entityType: string;
  entityId?: string | number | null;
  outcome?: "success" | "failure";
  metadata?: unknown;
};

export type ReportGenerationRuntime = {
  createArchive(input: ArchiveStartInput): Promise<number>;
  completeArchive(input: ArchiveCompleteInput): Promise<{ storageKey: string; checksumSha256: string; sizeBytes: number }>;
  failArchive(input: ArchiveFailInput): Promise<void>;
  writeAudit(input: AuditInput): Promise<void>;
};

export type ReportGenerationResult = {
  reportType: ArchiveReportType;
  archiveId: number;
  snapshotId: number;
  companyId: number;
  unitId: number | null;
  year: number;
  outputName: string;
  contentType: ArchiveContentType;
  content: Buffer;
  archiveResult: { storageKey: string; checksumSha256: string; sizeBytes: number };
  legacyReport?: {
    id: number;
    year: number;
    status: string;
    createdAt: Date | null;
  } | null;
  manifest: ReportDataManifestV1;
};

export class ReportGenerationError extends Error {
  constructor(public status: number, message: string, public failureCategory: string) {
    super(message);
  }
}

const MONTH_NAMES = ["", "Ocak", "Subat", "Mart", "Nisan", "Mayis", "Haziran", "Temmuz", "Agustos", "Eylul", "Ekim", "Kasim", "Aralik"];
const TARGET_STATUS_LABELS: Record<string, string> = {
  active: "Aktif",
  completed: "Tamamlandi",
  cancelled: "Iptal",
  on_hold: "Beklemede",
};
const ACTION_STATUS_LABELS: Record<string, string> = {
  planned: "Planlandi",
  in_progress: "Devam Ediyor",
  completed: "Tamamlandi",
  cancelled: "Iptal",
  on_hold: "Beklemede",
};

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function reportStorageFailureCategory(error: unknown, fallback: string): string {
  return error instanceof ReportStorageError ? error.category : fallback;
}

function generationFailureCategory(error: unknown, settingsError: boolean): string {
  if (settingsError) return "settings_snapshot";
  if (error instanceof ReportGenerationError) return error.failureCategory;
  return reportStorageFailureCategory(error, "render_or_storage");
}

function reportManifestSettings(snapshot: {
  profileVersion?: number | null;
  typeSettingsVersion?: number | null;
  documentNumber?: string | null;
  revisionNumber?: string | null;
  revisionDate?: string | null;
}) {
  return {
    profileVersion: snapshot.profileVersion ?? null,
    typeSettingsVersion: snapshot.typeSettingsVersion ?? null,
    documentNumber: snapshot.documentNumber ?? null,
    revisionNumber: snapshot.revisionNumber ?? null,
    revisionDate: snapshot.revisionDate ?? null,
  };
}

async function persistReportDataManifest(snapshotId: number, manifest: ReportDataManifestV1): Promise<void> {
  await db.update(reportGenerationSnapshotsTable)
    .set({ dataManifest: manifest })
    .where(eq(reportGenerationSnapshotsTable.id, snapshotId));
}

async function companyIdentity(companyId: number) {
  const [company] = await db.select({
    name: companiesTable.name,
    legalName: companiesTable.legalName,
    shortName: companiesTable.shortName,
    address: companiesTable.address,
  }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) throw new ReportGenerationError(400, "Gecersiz companyId", "validation");
  return company;
}

async function unitLabel(companyId: number, unitId: number | null): Promise<string> {
  if (unitId === null) return "Tum Birimler";
  const [unit] = await db.select({ name: unitsTable.name })
    .from(unitsTable)
    .where(and(eq(unitsTable.id, unitId), eq(unitsTable.companyId, companyId)))
    .limit(1);
  return unit?.name ?? `Birim #${unitId}`;
}

async function getOfficialSeuReportSection(input: {
  companyId: number;
  unitId: number | null;
  year: number;
}) {
  const assessmentConditions: SQL[] = [
    eq(seuAssessmentsTable.companyId, input.companyId),
    eq(unitsTable.companyId, input.companyId),
    eq(seuAssessmentsTable.year, input.year),
    eq(seuAssessmentsTable.recordType, "unit_official"),
    eq(seuAssessmentsTable.isOfficial, true),
  ];
  if (input.unitId !== null) assessmentConditions.push(eq(seuAssessmentsTable.unitId, input.unitId));

  const candidates = await db
    .select({
      id: seuAssessmentsTable.id,
      unitId: seuAssessmentsTable.unitId,
      createdAt: seuAssessmentsTable.createdAt,
    })
    .from(seuAssessmentsTable)
    .innerJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
    .where(and(...assessmentConditions))
    .orderBy(asc(seuAssessmentsTable.unitId), desc(seuAssessmentsTable.createdAt), desc(seuAssessmentsTable.id));

  const latestByUnit = new Map<number, number>();
  for (const assessment of candidates) {
    if (assessment.unitId !== null && !latestByUnit.has(assessment.unitId)) {
      latestByUnit.set(assessment.unitId, assessment.id);
    }
  }

  const assessmentIds = [...latestByUnit.values()];
  if (assessmentIds.length === 0) return { assessmentCount: 0, items: [] };

  const items = await db
    .select({
      assessmentId: seuAssessmentsTable.id,
      assessmentYear: seuAssessmentsTable.year,
      unitId: seuAssessmentsTable.unitId,
      unitName: unitsTable.name,
      id: seuAssessmentItemsTable.id,
      name: seuAssessmentItemsTable.name,
      energySourceName: energySourcesTable.name,
      energyTep: seuAssessmentItemsTable.energyTep,
      consumptionSharePercent: seuAssessmentItemsTable.consumptionSharePercent,
      priorityResult: seuAssessmentItemsTable.priorityResult,
      userDecision: seuAssessmentItemsTable.userDecision,
      decisionReason: seuAssessmentItemsTable.decisionReason,
    })
    .from(seuAssessmentItemsTable)
    .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
    .innerJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
    .leftJoin(energySourcesTable, and(
      eq(seuAssessmentItemsTable.energySourceId, energySourcesTable.id),
      eq(energySourcesTable.companyId, input.companyId),
      or(isNull(energySourcesTable.unitId), eq(energySourcesTable.unitId, seuAssessmentsTable.unitId)),
    ))
    .where(and(
      inArray(seuAssessmentsTable.id, assessmentIds),
      eq(seuAssessmentsTable.companyId, input.companyId),
      eq(unitsTable.companyId, input.companyId),
      eq(seuAssessmentsTable.year, input.year),
      eq(seuAssessmentsTable.recordType, "unit_official"),
      eq(seuAssessmentsTable.isOfficial, true),
      ...(input.unitId !== null ? [eq(seuAssessmentsTable.unitId, input.unitId)] : []),
    ))
    .orderBy(
      asc(seuAssessmentsTable.unitId),
      asc(seuAssessmentItemsTable.consumptionSharePercent),
      asc(seuAssessmentItemsTable.id),
    );

  return { assessmentCount: assessmentIds.length, items };
}

function auditBase(input: {
  request: ReportGenerationRequest;
  snapshotId: number;
  archiveId: number;
  snapshot: AnnualEnergyReportSnapshot | EnergyTargetsReportSnapshot | EnergyPerformanceReportSnapshot;
  manifest?: ReportDataManifestV1;
}) {
  return {
    companyId: input.request.reportType === ENERGY_PERFORMANCE_REPORT_TYPE ? null : input.request.companyId,
    reportType: input.request.reportType,
    snapshotId: input.snapshotId,
    archiveId: input.archiveId,
    trigger: input.request.trigger,
    retryOfArchiveId: input.request.retryOfArchiveId ?? null,
    profileVersion: input.snapshot.profileVersion,
    typeSettingsVersion: input.snapshot.typeSettingsVersion,
    outputName: input.snapshot.filename,
    ...(input.manifest ? manifestAuditMetadata(input.manifest) : {}),
  };
}

async function insertSnapshot(input: {
  companyId: number;
  unitId: number | null;
  reportType: ArchiveReportType;
  year: number;
  filename: string;
  settingsSnapshot: unknown;
  requestedByUserId: number | null;
}): Promise<number> {
  const [snapshotRecord] = await db.insert(reportGenerationSnapshotsTable).values({
    companyId: input.companyId,
    unitId: input.unitId,
    reportType: input.reportType,
    year: input.year,
    status: "generating",
    storageStatus: "not_stored",
    filename: input.filename,
    settingsSnapshot: input.settingsSnapshot,
    generatedBy: input.requestedByUserId,
  }).returning({ id: reportGenerationSnapshotsTable.id });
  return snapshotRecord.id;
}

async function completeGeneration(input: {
  runtime: ReportGenerationRuntime;
  request: ReportGenerationRequest;
  archiveId: number;
  snapshotId: number;
  snapshot: AnnualEnergyReportSnapshot | EnergyTargetsReportSnapshot | EnergyPerformanceReportSnapshot;
  companyId: number;
  unitId: number | null;
  year: number;
  contentType: ArchiveContentType;
  content: Buffer;
  manifest: ReportDataManifestV1;
}): Promise<ReportGenerationResult> {
  const outputName = input.snapshot.filename;
  const archiveResult = await input.runtime.completeArchive({
    archiveId: input.archiveId,
    companyId: input.companyId,
    unitId: input.unitId,
    reportType: input.request.reportType,
    reportYear: input.year,
    outputName,
    contentType: input.contentType,
    content: input.content,
    snapshotId: input.snapshotId,
  });
  return {
    reportType: input.request.reportType,
    archiveId: input.archiveId,
    snapshotId: input.snapshotId,
    companyId: input.companyId,
    unitId: input.unitId,
    year: input.year,
    outputName,
    contentType: input.contentType,
    content: input.content,
    archiveResult,
    manifest: input.manifest,
  };
}

async function generateAnnual(request: Extract<ReportGenerationRequest, { reportType: typeof ANNUAL_ENERGY_REPORT_TYPE }>, runtime: ReportGenerationRuntime): Promise<ReportGenerationResult> {
  let reportId: number | null = null;
  let snapshotId: number | null = null;
  let archiveId: number | null = null;
  let snapshotForFailure: AnnualEnergyReportSnapshot | null = null;
  let manifestForFailure: ReportDataManifestV1 | null = null;
  const legacyOverrides = request.legacyOverrides ?? parseAnnualEnergyLegacyOverrides({});
  try {
    const consumptionConditions: SQL[] = [
      eq(consumptionTable.year, request.year),
      eq(consumptionTable.companyId, request.companyId),
      eq(metersTable.companyId, request.companyId),
    ];
    const meterConditions: SQL[] = [eq(metersTable.companyId, request.companyId)];
    const swotConditions: SQL[] = [eq(swotTable.companyId, request.companyId)];
    const riskConditions: SQL[] = [eq(risksTable.companyId, request.companyId)];
    if (request.unitId !== null) {
      consumptionConditions.push(eq(metersTable.unitId, request.unitId));
      meterConditions.push(eq(metersTable.unitId, request.unitId));
      swotConditions.push(eq(swotTable.unitId, request.unitId));
      riskConditions.push(eq(risksTable.unitId, request.unitId));
    }
    const consumptionRows = await db.select({
      id: consumptionTable.id,
      meterId: consumptionTable.meterId,
      year: consumptionTable.year,
      month: consumptionTable.month,
      kwh: consumptionTable.kwh,
      tep: consumptionTable.tep,
      co2: consumptionTable.co2,
      hdd: consumptionTable.hdd,
      cdd: consumptionTable.cdd,
      notes: consumptionTable.notes,
      createdAt: consumptionTable.createdAt,
    }).from(consumptionTable).innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id)).where(and(...consumptionConditions));
    const meters = await db.select().from(metersTable).where(and(...meterConditions));
    const swotItems = await db.select().from(swotTable).where(and(...swotConditions));
    const riskItems = await db.select().from(risksTable).where(and(...riskConditions));
    const officialSeu = await getOfficialSeuReportSection({
      companyId: request.companyId,
      unitId: request.unitId,
      year: request.year,
    });
    const company = await companyIdentity(request.companyId);
    const label = await unitLabel(request.companyId, request.unitId);
    const effective = await resolveEffectiveCompanyReportSettings({ companyId: request.companyId, reportType: ANNUAL_ENERGY_REPORT_TYPE });
    const [report] = await db.insert(reportsTable).values({
      companyId: request.companyId,
      year: request.year,
      unitId: request.unitId,
      status: "pending",
      includeSwot: legacyOverrides.swot?.value ?? true,
      includeRisks: legacyOverrides.risks?.value ?? true,
      includeSeu: legacyOverrides.seu?.value ?? true,
      includeRegression: legacyOverrides.regression?.value ?? true,
    }).returning();
    reportId = report.id;
    const snapshot = buildAnnualEnergyReportSnapshot({
      effective,
      companyId: request.companyId,
      unitId: request.unitId,
      companyName: company.name,
      unitLabel: label,
      year: request.year,
      legacyReportId: report.id,
      generatedAt: new Date(),
      generatedBy: request.requestedByUserId,
      data: {
        consumptionRows: consumptionRows.length,
        meterCount: meters.length,
        swotCount: swotItems.length,
        riskCount: riskItems.length,
        seuAssessmentCount: officialSeu.assessmentCount,
        seuItemCount: officialSeu.items.length,
        hasRegressionRenderer: false,
      },
      legacyOverrides,
    });
    snapshotForFailure = snapshot;
    snapshotId = await insertSnapshot({
      companyId: request.companyId,
      unitId: request.unitId,
      reportType: ANNUAL_ENERGY_REPORT_TYPE,
      year: request.year,
      filename: snapshot.outputName,
      settingsSnapshot: snapshot,
      requestedByUserId: request.requestedByUserId,
    });
    archiveId = await runtime.createArchive({
      companyId: request.companyId,
      unitId: request.unitId,
      reportType: ANNUAL_ENERGY_REPORT_TYPE,
      reportYear: request.year,
      periodLabel: String(request.year),
      title: snapshot.title,
      outputName: snapshot.outputName,
      contentType: "text/html; charset=utf-8",
      snapshotId,
      retryOfArchiveId: request.retryOfArchiveId ?? null,
      legacyReportId: report.id,
    });
    await runtime.writeAudit({
      companyId: request.companyId,
      unitId: request.unitId,
      action: "annual_energy_performance_report.generation_started",
      entityType: "report",
      entityId: report.id,
      metadata: auditBase({ request, snapshotId, archiveId, snapshot }),
    });
    const manifest = buildAnnualReportDataManifest({
      companyId: request.companyId,
      unitId: request.unitId,
      year: request.year,
      generatedAt: snapshot.generatedAt,
      settings: reportManifestSettings(snapshot),
      filters: {
        includeSwot: snapshot.legacyOverrides.swot?.value ?? true,
        includeRisks: snapshot.legacyOverrides.risks?.value ?? true,
        includeSeu: snapshot.legacyOverrides.seu?.value ?? true,
        includeRegression: snapshot.legacyOverrides.regression?.value ?? true,
      },
      consumptionRows,
      meters,
      swotItems,
      riskItems,
      seuItems: officialSeu.items,
      seuAssessmentCount: officialSeu.assessmentCount,
    });
    manifestForFailure = manifest;
    await persistReportDataManifest(snapshotId, manifest);
    const byMonth: Record<number, { kwh: number; tep: number; co2: number }> = {};
    for (let month = 1; month <= 12; month += 1) byMonth[month] = { kwh: 0, tep: 0, co2: 0 };
    for (const row of consumptionRows) {
      byMonth[row.month]!.kwh += row.kwh;
      byMonth[row.month]!.tep += row.tep;
      byMonth[row.month]!.co2 += row.co2;
    }
    const totalKwh = consumptionRows.reduce((sum, row) => sum + row.kwh, 0);
    const totalTep = consumptionRows.reduce((sum, row) => sum + row.tep, 0);
    const totalCo2 = consumptionRows.reduce((sum, row) => sum + row.co2, 0);
    const fmt = (value: number, digits = 0) => value.toLocaleString(snapshot.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const rows = Array.from({ length: 12 }, (_, index) => index + 1)
      .map((month) => `<tr><td>${MONTH_NAMES[month]}</td><td>${fmt(Math.round(byMonth[month]!.kwh))}</td><td>${fmt(byMonth[month]!.tep, 3)}</td><td>${fmt(byMonth[month]!.co2, 1)}</td></tr>`)
      .join("");
    const renderedSections = visibleAnnualEnergySections(snapshot)
      .map((section) => section.code === "cover"
        ? `<div class="cover"><h1>${escapeHtml(snapshot.title)} - ${request.year}</h1><p>${escapeHtml(snapshot.companyName)} | ${escapeHtml(snapshot.unitLabel)}</p></div>`
        : `<h2>${escapeHtml(section.finalTitle)}</h2>${section.code === "monthly_consumption" ? `<table><tr><th>Ay</th><th>kWh</th><th>TEP</th><th>CO2</th></tr>${rows}</table>` : ""}`)
      .join("\n");
    const html = Buffer.from(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>body{font-family:Arial,sans-serif;max-width:900px;margin:0 auto;padding:40px;color:#1a202c}h1{color:#0f766e;border-bottom:3px solid #0f766e;padding-bottom:10px}h2{color:#1e3a5f;margin-top:30px}table{width:100%;border-collapse:collapse;margin:15px 0}th,td{border:1px solid #e2e8f0;padding:8px 12px;text-align:left}.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.kpi-box{background:#f8fafc;border:1px solid #e2e8f0;padding:16px;text-align:center}.kpi-value{font-size:28px;font-weight:700;color:#0f766e}</style></head><body>${renderedSections}<div class="kpi-grid"><div class="kpi-box"><div class="kpi-value">${fmt(Math.round(totalKwh))}</div><div>kWh</div></div><div class="kpi-box"><div class="kpi-value">${fmt(totalTep, 3)}</div><div>TEP</div></div><div class="kpi-box"><div class="kpi-value">${fmt(totalCo2, 1)}</div><div>CO2</div></div></div><div class="footer">${escapeHtml(snapshot.footerText ?? "")}<br>Rapor ID: ${report.id} | Snapshot ID: ${snapshotId}</div></body></html>`, "utf8");
    const result = await completeGeneration({ runtime, request, archiveId, snapshotId, snapshot, companyId: request.companyId, unitId: request.unitId, year: request.year, contentType: "text/html; charset=utf-8", content: html, manifest });
    const [updated] = await db.update(reportsTable).set({ status: "complete", downloadUrl: null }).where(and(eq(reportsTable.id, report.id), eq(reportsTable.companyId, request.companyId))).returning();
    result.legacyReport = { id: updated.id, year: updated.year, status: updated.status, createdAt: updated.createdAt };
    await runtime.writeAudit({
      companyId: request.companyId,
      unitId: request.unitId,
      action: "annual_energy_performance_report.generation_completed",
      entityType: "report",
      entityId: report.id,
      metadata: auditBase({ request, snapshotId, archiveId, snapshot, manifest }),
    });
    return result;
  } catch (error) {
    if (archiveId !== null) {
      await runtime.failArchive({
        archiveId,
        companyId: snapshotForFailure?.companyId ?? request.companyId,
        unitId: snapshotForFailure?.unitId ?? request.unitId,
        reportType: ANNUAL_ENERGY_REPORT_TYPE,
        snapshotId,
        outputName: snapshotForFailure?.outputName ?? null,
        failureCategory: generationFailureCategory(error, error instanceof AnnualEnergyReportSnapshotError),
      });
    }
    if (snapshotId !== null) {
      const failureCategory = generationFailureCategory(error, error instanceof AnnualEnergyReportSnapshotError);
      await db.update(reportGenerationSnapshotsTable).set({ status: "failed", storageStatus: "storage_failed", failedAt: new Date(), failureReason: failureCategory }).where(eq(reportGenerationSnapshotsTable.id, snapshotId));
      await runtime.writeAudit({
        companyId: snapshotForFailure?.companyId ?? request.companyId,
        unitId: snapshotForFailure?.unitId ?? request.unitId,
        action: "annual_energy_performance_report.generation_failed",
        entityType: "report",
        entityId: reportId,
        outcome: "failure",
        metadata: { reportType: ANNUAL_ENERGY_REPORT_TYPE, reportId, snapshotId, ...(manifestForFailure ? manifestAuditMetadata(manifestForFailure) : {}), failureCategory },
      });
    }
    if (reportId !== null) await db.update(reportsTable).set({ status: "failed" }).where(eq(reportsTable.id, reportId));
    if (error instanceof AnnualEnergyReportSnapshotError) throw new ReportGenerationError(error.status, error.message, "settings_snapshot");
    throw error;
  }
}

async function generateTargets(request: Extract<ReportGenerationRequest, { reportType: typeof ENERGY_TARGETS_REPORT_TYPE }>, runtime: ReportGenerationRuntime): Promise<ReportGenerationResult> {
  let snapshotId: number | null = null;
  let archiveId: number | null = null;
  let snapshotForFailure: EnergyTargetsReportSnapshot | null = null;
  let manifestForFailure: ReportDataManifestV1 | null = null;
  const legacyOverrides = request.legacyOverrides ?? parseEnergyTargetsLegacyOverrides({});
  try {
    const targetConditions: SQL[] = [lte(energyTargetsTable.baselineYear, request.year), gte(energyTargetsTable.targetYear, request.year), eq(energyTargetsTable.companyId, request.companyId)];
    if (request.unitId !== null) targetConditions.push(eq(energyTargetsTable.unitId, request.unitId));
    if (request.status) targetConditions.push(eq(energyTargetsTable.status, request.status));
    const targets = await db.select({
      id: energyTargetsTable.id,
      name: energyTargetsTable.name,
      objectiveText: energyTargetsTable.objectiveText,
      targetText: energyTargetsTable.targetText,
      unitLabel: energyTargetsTable.unitLabel,
      baselineYear: energyTargetsTable.baselineYear,
      targetYear: energyTargetsTable.targetYear,
      baselineValue: energyTargetsTable.baselineValue,
      targetValue: energyTargetsTable.targetValue,
      actualValue: energyTargetsTable.actualValue,
      targetReductionPercent: energyTargetsTable.targetReductionPercent,
      status: energyTargetsTable.status,
      unitId: energyTargetsTable.unitId,
      unitName: unitsTable.name,
    }).from(energyTargetsTable).leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id)).where(and(...targetConditions)).orderBy(energyTargetsTable.createdAt);
    const targetIds = targets.map((target) => target.id);
    const actions = targetIds.length > 0 ? await db.select().from(energyActionPlansTable).where(and(inArray(energyActionPlansTable.targetId, targetIds), eq(energyActionPlansTable.companyId, request.companyId))).orderBy(energyActionPlansTable.createdAt) : [];
    const progressRows = targetIds.length > 0 ? await db.select().from(energyTargetProgressTable).where(and(inArray(energyTargetProgressTable.targetId, targetIds), eq(energyTargetProgressTable.periodYear, request.year), eq(energyTargetProgressTable.companyId, request.companyId))).orderBy(energyTargetProgressTable.targetId, energyTargetProgressTable.periodYear, energyTargetProgressTable.periodMonth) : [];
    const vapActionIds = actions.filter((action) => action.isVap).map((action) => action.id);
    const vapProjects = vapActionIds.length > 0 ? await db.select().from(vapProjectsTable).where(and(inArray(vapProjectsTable.actionPlanId, vapActionIds), eq(vapProjectsTable.companyId, request.companyId))).orderBy(vapProjectsTable.createdAt) : [];
    const company = await companyIdentity(request.companyId);
    const label = await unitLabel(request.companyId, request.unitId);
    const effective = await resolveEffectiveCompanyReportSettings({ companyId: request.companyId, reportType: ENERGY_TARGETS_REPORT_TYPE });
    const snapshot = buildEnergyTargetsReportSnapshot({
      effective,
      companyId: request.companyId,
      unitId: request.unitId,
      companyName: company.name,
      companyLegalName: company.legalName ?? null,
      companyShortName: company.shortName ?? null,
      companyAddress: company.address ?? null,
      unitLabel: label,
      year: request.year,
      generatedAt: new Date(),
      generatedBy: request.requestedByUserId,
      hasVapProjects: vapProjects.length > 0,
      hasProgressRows: progressRows.length > 0,
      legacyOverrides,
    });
    snapshotForFailure = snapshot;
    snapshotId = await insertSnapshot({ companyId: request.companyId, unitId: request.unitId, reportType: ENERGY_TARGETS_REPORT_TYPE, year: request.year, filename: snapshot.filename, settingsSnapshot: snapshot, requestedByUserId: request.requestedByUserId });
    archiveId = await runtime.createArchive({ companyId: request.companyId, unitId: request.unitId, reportType: ENERGY_TARGETS_REPORT_TYPE, reportYear: request.year, periodLabel: String(request.year), title: snapshot.title, outputName: snapshot.filename, contentType: "application/pdf", snapshotId, retryOfArchiveId: request.retryOfArchiveId ?? null });
    await runtime.writeAudit({ companyId: request.companyId, unitId: request.unitId, action: "energy_targets_report.generation_started", entityType: "report_generation_snapshot", entityId: snapshotId, metadata: auditBase({ request, snapshotId, archiveId, snapshot }) });
    const manifest = buildEnergyTargetsReportDataManifest({
      companyId: request.companyId,
      unitId: request.unitId,
      year: request.year,
      generatedAt: snapshot.generatedAt,
      settings: reportManifestSettings(snapshot),
      filters: { status: request.status ?? null, includeVap: legacyOverrides.vap_portfolio?.value ?? null, includeProgress: legacyOverrides.progress_chronology?.value ?? null },
      targets,
      actions,
      progressRows,
      vapProjects,
    });
    manifestForFailure = manifest;
    await persistReportDataManifest(snapshotId, manifest);
    const fmt = (value: number | null | undefined, digits = 0) => value == null ? "-" : value.toLocaleString(snapshot.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const statusBadge = (value: string | null | undefined) => `<span class="badge">${escapeHtml(TARGET_STATUS_LABELS[value ?? ""] ?? value ?? "-")}</span>`;
    const actionBadge = (value: string | null | undefined) => `<span class="badge">${escapeHtml(ACTION_STATUS_LABELS[value ?? ""] ?? value ?? "-")}</span>`;
    const targetRows = targets.map((target) => `<tr><td>${escapeHtml(target.name)}</td><td>${escapeHtml(target.objectiveText ?? "-")}</td><td>${escapeHtml(target.targetText ?? "-")}</td><td>${target.baselineYear}</td><td>${target.targetYear}</td><td>${fmt(target.baselineValue, 2)}</td><td>${fmt(target.targetValue, 2)}</td><td>${statusBadge(target.status)}</td></tr>`).join("");
    const actionRows = actions.map((action) => `<tr><td>${escapeHtml(targets.find((target) => target.id === action.targetId)?.name ?? "-")}</td><td>${escapeHtml(action.title)}</td><td>${escapeHtml(action.responsibleName ?? "-")}</td><td>${actionBadge(action.status)}</td><td>${action.progressPercent ?? "-"}</td><td>${action.isVap ? "Evet" : "Hayir"}</td></tr>`).join("");
    const sectionFragments: Record<string, string> = {
      executive_summary: `<div class="kpi-grid"><div class="kpi-box"><div class="kpi-value">${targets.length}</div><div>Toplam Hedef</div></div><div class="kpi-box"><div class="kpi-value">${actions.length}</div><div>Eylem</div></div><div class="kpi-box"><div class="kpi-value">${vapProjects.length}</div><div>VAP</div></div></div>`,
      energy_targets: targets.length > 0 ? `<table><tr><th>Hedef</th><th>Amac</th><th>Metin</th><th>Baz</th><th>Hedef</th><th>Baz Deger</th><th>Hedef Deger</th><th>Durum</th></tr>${targetRows}</table>` : "<p>Kayitli enerji hedefi bulunamadi.</p>",
      action_plans: actions.length > 0 ? `<table><tr><th>Hedef</th><th>Eylem</th><th>Sorumlu</th><th>Durum</th><th>Ilerleme</th><th>VAP</th></tr>${actionRows}</table>` : "<p>Eylem plani bulunamadi.</p>",
      vap_portfolio: vapProjects.length > 0 ? `<p>VAP proje sayisi: ${vapProjects.length}</p>` : "",
      progress_chronology: progressRows.length > 0 ? `<p>Gerceklesme kaydi: ${progressRows.length}</p>` : "",
    };
    const renderedSections = visibleEnergyTargetsSections(snapshot).filter((section) => section.code !== "cover").map((section, index) => `${buildCorporateSectionHeading(index + 1, section.finalTitle)}${sectionFragments[section.code] ?? ""}`).join("\n");
    const corporatePdf = buildCorporateReportHtml({
      identity: {
        companyName: snapshot.companyName,
        companyLegalName: snapshot.companyLegalName,
        companyShortName: snapshot.companyShortName,
        companyAddress: snapshot.companyAddress,
        reportTitle: snapshot.title,
        reportDisplayName: snapshot.reportDisplayName,
        reportPeriod: String(request.year),
        unitLabel: snapshot.unitLabel,
        documentNumber: snapshot.documentNumber,
        revisionNumber: snapshot.revisionNumber,
        revisionDate: snapshot.revisionDate,
        preparedBy: snapshot.preparedBy,
        checkedBy: snapshot.checkedBy,
        approvedBy: snapshot.approvedBy,
        confidentialityLabel: snapshot.confidentialityLabel,
        footerText: snapshot.footerText,
        generatedAt: new Date(snapshot.generatedAt),
        generatedByName: request.requestedByName ?? null,
        locale: snapshot.locale,
        showSignatureFields: snapshot.showSignatureFields,
        showPageNumbers: snapshot.showPageNumbers,
        logoDataUri: snapshot.showLogo ? logoBufferToDataUri({ mimeType: effective.logo?.mimeType, content: effective.logo?.content }) : null,
        logoAltText: snapshot.logo?.altText ?? null,
      },
      bodyHtml: renderedSections,
      extraCss: ".kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.kpi-box{border:1px solid #e2e8f0;padding:10px;text-align:center}.kpi-value{font-size:22px;font-weight:700;color:#0f766e}.badge{font-weight:700}",
    });
    const pdf = await renderHtmlToPdf({ html: corporatePdf.html, title: `Enerji Hedefleri ${request.year}`, landscape: true, displayHeaderFooter: corporatePdf.displayHeaderFooter, headerTemplate: corporatePdf.headerTemplate, footerTemplate: corporatePdf.footerTemplate });
    const result = await completeGeneration({ runtime, request, archiveId, snapshotId, snapshot, companyId: request.companyId, unitId: request.unitId, year: request.year, contentType: "application/pdf", content: pdf, manifest });
    await runtime.writeAudit({ companyId: request.companyId, unitId: request.unitId, action: "energy_targets_report.generation_completed", entityType: "report_generation_snapshot", entityId: snapshotId, metadata: auditBase({ request, snapshotId, archiveId, snapshot, manifest }) });
    return result;
  } catch (error) {
    const failureCategory = generationFailureCategory(error, error instanceof ReportSettingsSnapshotError);
    if (archiveId !== null) await runtime.failArchive({ archiveId, companyId: snapshotForFailure?.companyId ?? request.companyId, unitId: snapshotForFailure?.unitId ?? request.unitId, reportType: ENERGY_TARGETS_REPORT_TYPE, snapshotId, outputName: snapshotForFailure?.filename ?? null, failureCategory });
    if (snapshotId !== null) {
      await db.update(reportGenerationSnapshotsTable).set({ status: "failed", storageStatus: "storage_failed", failedAt: new Date(), failureReason: failureCategory }).where(eq(reportGenerationSnapshotsTable.id, snapshotId));
      await runtime.writeAudit({ companyId: snapshotForFailure?.companyId ?? request.companyId, unitId: snapshotForFailure?.unitId ?? request.unitId, action: "energy_targets_report.generation_failed", entityType: "report_generation_snapshot", entityId: snapshotId, outcome: "failure", metadata: { reportType: ENERGY_TARGETS_REPORT_TYPE, snapshotId, ...(manifestForFailure ? manifestAuditMetadata(manifestForFailure) : {}), failureCategory } });
    }
    if (error instanceof ReportSettingsSnapshotError) throw new ReportGenerationError(error.status, error.message, "settings_snapshot");
    throw error;
  }
}

async function generatePerformance(request: Extract<ReportGenerationRequest, { reportType: typeof ENERGY_PERFORMANCE_REPORT_TYPE }>, runtime: ReportGenerationRuntime): Promise<ReportGenerationResult> {
  let snapshotId: number | null = null;
  let archiveId: number | null = null;
  let snapshotForFailure: EnergyPerformanceReportSnapshot | null = null;
  let manifestForFailure: ReportDataManifestV1 | null = null;
  try {
    const baselineConditions: SQL[] = [eq(energyBaselinesTable.id, request.baselineId)];
    if (request.companyId !== null) baselineConditions.push(eq(energyBaselinesTable.companyId, request.companyId));
    if (request.unitId !== null) baselineConditions.push(eq(energyBaselinesTable.unitId, request.unitId));
    const [baseline] = await db.select({
      id: energyBaselinesTable.id,
      baselineYear: energyBaselinesTable.baselineYear,
      periodStart: energyBaselinesTable.periodStart,
      periodEnd: energyBaselinesTable.periodEnd,
      modelType: energyBaselinesTable.modelType,
      intercept: energyBaselinesTable.intercept,
      rSquared: energyBaselinesTable.rSquared,
      adjustedRSquared: energyBaselinesTable.adjustedRSquared,
      sampleSize: energyBaselinesTable.sampleSize,
      formulaText: energyBaselinesTable.formulaText,
      isValid: energyBaselinesTable.isValid,
      status: energyBaselinesTable.status,
      rawUnit: energyBaselinesTable.dependentVariableUnit,
      companyId: energyBaselinesTable.companyId,
      unitId: energyBaselinesTable.unitId,
      seuAssessmentItemId: energyBaselinesTable.seuAssessmentItemId,
    }).from(energyBaselinesTable).where(and(...baselineConditions));
    if (!baseline) throw new ReportGenerationError(404, "EnRC bulunamadi", "validation");
    const company = await companyIdentity(baseline.companyId);
    const variables = await db.select().from(energyBaselineVariablesTable).where(eq(energyBaselineVariablesTable.baselineId, request.baselineId)).orderBy(asc(energyBaselineVariablesTable.id));
    const results = await db.select().from(energyPerformanceResultsTable).where(and(eq(energyPerformanceResultsTable.baselineId, request.baselineId), eq(energyPerformanceResultsTable.year, request.year), eq(energyPerformanceResultsTable.companyId, baseline.companyId))).orderBy(asc(energyPerformanceResultsTable.month));
    let seuItemName = "-";
    let unitName = await unitLabel(baseline.companyId, baseline.unitId);
    let energySourceName = "-";
    if (baseline.seuAssessmentItemId) {
      const [seu] = await db.select({ itemName: seuAssessmentItemsTable.name, unitName: unitsTable.name, energySourceName: energySourcesTable.name })
        .from(seuAssessmentItemsTable)
        .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
        .leftJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
        .leftJoin(energySourcesTable, eq(seuAssessmentItemsTable.energySourceId, energySourcesTable.id))
        .where(and(eq(seuAssessmentItemsTable.id, baseline.seuAssessmentItemId), eq(seuAssessmentsTable.companyId, baseline.companyId), ...(request.unitId !== null ? [eq(seuAssessmentsTable.unitId, request.unitId)] : [])));
      if (!seu) throw new ReportGenerationError(404, "EnRC iliskisi bulunamadi", "validation");
      seuItemName = seu.itemName ?? "-";
      unitName = seu.unitName ?? unitName;
      energySourceName = seu.energySourceName ?? "-";
    }
    const effective = await resolveEffectiveCompanyReportSettings({ companyId: baseline.companyId, reportType: ENERGY_PERFORMANCE_REPORT_TYPE });
    const technicalProfile = await buildTechnicalProfileReportContext({ companyId: baseline.companyId, unitId: baseline.unitId, effectiveDate: endOfYearEffectiveDate(request.year) });
    const equipmentInventory = toEquipmentReportSnapshot(await buildEquipmentInventoryContext({ companyId: baseline.companyId, unitId: baseline.unitId, effectiveDate: endOfYearEffectiveDate(request.year), itemLimit: 10 }));
    const snapshot = buildEnergyPerformanceReportSnapshot({
      effective,
      companyId: baseline.companyId,
      unitId: baseline.unitId,
      companyName: company.name,
      companyLegalName: company.legalName ?? null,
      companyShortName: company.shortName ?? null,
      companyAddress: company.address ?? null,
      unitLabel: unitName,
      year: request.year,
      baselineId: request.baselineId,
      seuAssessmentItemId: baseline.seuAssessmentItemId ?? null,
      modelType: baseline.modelType ?? null,
      generatedAt: new Date(),
      generatedBy: request.requestedByUserId,
      hasModelVariables: variables.length > 0,
      technicalProfile,
      equipmentInventory,
    });
    snapshotForFailure = snapshot;
    snapshotId = await insertSnapshot({ companyId: baseline.companyId, unitId: baseline.unitId, reportType: ENERGY_PERFORMANCE_REPORT_TYPE, year: request.year, filename: snapshot.filename, settingsSnapshot: snapshot, requestedByUserId: request.requestedByUserId });
    archiveId = await runtime.createArchive({ companyId: baseline.companyId, unitId: baseline.unitId, reportType: ENERGY_PERFORMANCE_REPORT_TYPE, reportYear: request.year, periodLabel: String(request.year), title: snapshot.title, outputName: snapshot.filename, contentType: "application/pdf", snapshotId, retryOfArchiveId: request.retryOfArchiveId ?? null });
    await runtime.writeAudit({ companyId: baseline.companyId, unitId: baseline.unitId, action: "energy_performance_report.generation_started", entityType: "report_generation_snapshot", entityId: snapshotId, metadata: auditBase({ request: { ...request, companyId: baseline.companyId }, snapshotId, archiveId, snapshot }) });
    const manifest = buildEnergyPerformanceReportDataManifest({
      companyId: baseline.companyId,
      unitId: baseline.unitId,
      year: request.year,
      generatedAt: snapshot.generatedAt,
      settings: reportManifestSettings(snapshot),
      filters: { baselineId: request.baselineId },
      baseline,
      baselineVariables: variables,
      results,
      seuAssessmentItemId: baseline.seuAssessmentItemId ?? null,
      technicalProfile: snapshot.technicalProfile,
      equipmentInventory: snapshot.equipmentInventory,
    });
    manifestForFailure = manifest;
    await persistReportDataManifest(snapshotId, manifest);
    const fmt = (value: number | null | undefined, digits = 2) => value == null ? "-" : value.toLocaleString(snapshot.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const rows = results.map((result) => `<tr><td>${MONTH_NAMES[result.month] ?? result.month}</td><td>${fmt(result.actualConsumption)}</td><td>${fmt(result.expectedConsumption)}</td><td>${fmt(result.difference)}</td><td>${fmt(result.cusum)}</td><td>${result.eei?.toFixed(4) ?? "-"}</td><td>${escapeHtml(result.status ?? "-")}</td></tr>`).join("");
    const bodyHtml = `
      <p><strong>OEK:</strong> ${escapeHtml(seuItemName)} | <strong>Enerji kaynagi:</strong> ${escapeHtml(energySourceName)}</p>
      ${buildCorporateSectionHeading(1, "Regresyon Modeli")}
      <p>${escapeHtml(baseline.formulaText ?? "Formul kaydedilmemis")}</p>
      ${visibleEnergyPerformanceSections(snapshot).some((section) => section.code === "monthly_results") ? `${buildCorporateSectionHeading(2, `Aylik EnPG Sonuclari (${request.year})`)}<table><tr><th>Ay</th><th>Gerceklesen</th><th>Beklenen</th><th>Sapma</th><th>CUSUM</th><th>EEI</th><th>Durum</th></tr>${rows}</table>` : ""}
    `;
    const corporatePdf = buildCorporateReportHtml({
      identity: {
        companyName: snapshot.companyName,
        companyLegalName: snapshot.companyLegalName,
        companyShortName: snapshot.companyShortName,
        companyAddress: snapshot.companyAddress,
        reportTitle: snapshot.title,
        reportDisplayName: snapshot.reportDisplayName,
        reportPeriod: String(request.year),
        unitLabel: snapshot.unitLabel,
        documentNumber: snapshot.documentNumber,
        revisionNumber: snapshot.revisionNumber,
        revisionDate: snapshot.revisionDate,
        preparedBy: snapshot.preparedBy,
        checkedBy: snapshot.checkedBy,
        approvedBy: snapshot.approvedBy,
        confidentialityLabel: snapshot.confidentialityLabel,
        footerText: snapshot.footerText,
        generatedAt: new Date(snapshot.generatedAt),
        generatedByName: request.requestedByName ?? null,
        locale: snapshot.locale,
        showSignatureFields: snapshot.showSignatureFields,
        showPageNumbers: snapshot.showPageNumbers,
        logoDataUri: snapshot.showLogo ? logoBufferToDataUri({ mimeType: effective.logo?.mimeType, content: effective.logo?.content }) : null,
        logoAltText: snapshot.logo?.altText ?? null,
      },
      bodyHtml,
      extraCss: "table{font-size:11px}.report-note{font-size:12px}",
    });
    const pdf = await renderHtmlToPdf({ html: corporatePdf.html, title: `Enerji Performansi ${request.year}`, landscape: true, displayHeaderFooter: corporatePdf.displayHeaderFooter, headerTemplate: corporatePdf.headerTemplate, footerTemplate: corporatePdf.footerTemplate });
    const normalizedRequest = { ...request, companyId: baseline.companyId };
    const result = await completeGeneration({ runtime, request: normalizedRequest, archiveId, snapshotId, snapshot, companyId: baseline.companyId, unitId: baseline.unitId, year: request.year, contentType: "application/pdf", content: pdf, manifest });
    await runtime.writeAudit({ companyId: baseline.companyId, unitId: baseline.unitId, action: "energy_performance_report.generation_completed", entityType: "report_generation_snapshot", entityId: snapshotId, metadata: auditBase({ request: normalizedRequest, snapshotId, archiveId, snapshot, manifest }) });
    return result;
  } catch (error) {
    const failureCategory = generationFailureCategory(error, error instanceof EnergyPerformanceReportSnapshotError);
    if (archiveId !== null) await runtime.failArchive({ archiveId, companyId: snapshotForFailure?.companyId ?? request.companyId, unitId: snapshotForFailure?.unitId ?? request.unitId, reportType: ENERGY_PERFORMANCE_REPORT_TYPE, snapshotId, outputName: snapshotForFailure?.filename ?? null, failureCategory });
    if (snapshotId !== null) {
      await db.update(reportGenerationSnapshotsTable).set({ status: "failed", storageStatus: "storage_failed", failedAt: new Date(), failureReason: failureCategory }).where(eq(reportGenerationSnapshotsTable.id, snapshotId));
      await runtime.writeAudit({ companyId: snapshotForFailure?.companyId ?? request.companyId, unitId: snapshotForFailure?.unitId ?? request.unitId, action: "energy_performance_report.generation_failed", entityType: "report_generation_snapshot", entityId: snapshotId, outcome: "failure", metadata: { reportType: ENERGY_PERFORMANCE_REPORT_TYPE, snapshotId, ...(manifestForFailure ? manifestAuditMetadata(manifestForFailure) : {}), failureCategory } });
    }
    if (error instanceof EnergyPerformanceReportSnapshotError) throw new ReportGenerationError(error.status, error.message, "settings_snapshot");
    throw error;
  }
}

export async function generateReport(request: ReportGenerationRequest, runtime: ReportGenerationRuntime): Promise<ReportGenerationResult> {
  if (request.reportType === ANNUAL_ENERGY_REPORT_TYPE) return generateAnnual(request, runtime);
  if (request.reportType === ENERGY_TARGETS_REPORT_TYPE) return generateTargets(request, runtime);
  return generatePerformance(request, runtime);
}
