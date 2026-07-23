import { Router } from "express";
import type { Request, Response } from "express";
import { pipeline } from "node:stream/promises";
import { db, pool, companiesTable, reportsTable, reportGenerationSnapshotsTable, reportArchivesTable, usersTable, consumptionTable, swotTable, risksTable, metersTable, weatherTable, energyTargetsTable, energyActionPlansTable, energyTargetProgressTable, vapProjectsTable, unitsTable, subUnitsTable, energySourcesTable, energyBaselinesTable, energyBaselineVariablesTable, energyPerformanceResultsTable, seuAssessmentItemsTable, seuAssessmentsTable } from "@workspace/db";
import { REPORT_TYPE_REGISTRY, type ReportArchiveDetailResponse, type ReportDataManifestV1 } from "@workspace/api-zod";
import { eq, and, or, isNull, SQL, inArray, lte, gte, desc, asc, count, ilike } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { renderHtmlToPdf, safePdfFilename } from "../lib/pdf-render.js";
import { resolveEffectiveCompanyReportSettings } from "../lib/company-report-settings-resolver.js";
import { writeBestEffortAudit } from "../lib/audit.js";
import {
  ENERGY_TARGETS_REPORT_TYPE,
  ReportSettingsSnapshotError,
  buildEnergyTargetsReportSnapshot,
  parseEnergyTargetsLegacyOverrides,
  visibleEnergyTargetsSections,
  type EnergyTargetsReportSnapshot,
} from "../lib/energy-targets-report-snapshot.js";
import {
  ENERGY_PERFORMANCE_REPORT_TYPE,
  EnergyPerformanceReportSnapshotError,
  buildEnergyPerformanceReportSnapshot,
  visibleEnergyPerformanceSections,
  type EnergyPerformanceReportSnapshot,
} from "../lib/energy-performance-report-snapshot.js";
import {
  ANNUAL_ENERGY_REPORT_TYPE,
  AnnualEnergyReportSnapshotError,
  buildAnnualEnergyReportSnapshot,
  parseAnnualEnergyLegacyOverrides,
  visibleAnnualEnergySections,
  type AnnualEnergyReportSnapshot,
} from "../lib/annual-energy-report-snapshot.js";
import { createReportArchiveRecord, completeReportArchive, failReportArchive, sanitizeArchiveFilename, type ArchiveReportType } from "../lib/report-archive.js";
import { ReportStorageError, reportStorage } from "../lib/report-storage.js";
import {
  archiveDownloadable,
  archiveIdFromStorageKey,
  calculatePurgeEligibleAt,
  companyReportPrefix,
  getReportRetentionSettings,
  normalizeDeleteReason,
  redactedObjectIdentifier,
} from "../lib/report-retention.js";
import {
  buildTechnicalProfileReportContext,
  endOfYearEffectiveDate,
  type TechnicalProfileReportContext,
} from "../lib/unit-technical-profile-effective.js";
import {
  buildEquipmentInventoryContext,
  toEquipmentReportSnapshot,
} from "../lib/equipment-inventory-context.js";
import {
  buildCorporateReportHtml,
  buildCorporateSectionHeading,
  logoBufferToDataUri,
} from "../lib/report-pdf-layout.js";
import {
  buildAnnualReportDataManifest,
  buildEnergyPerformanceReportDataManifest,
  buildEnergyTargetsReportDataManifest,
  manifestAuditMetadata,
  summarizeReportDataManifest,
} from "../lib/report-data-manifest.js";

const router = Router();
const TARGET_REPORT_STATUSES = new Set(["draft", "active", "completed", "cancelled"]);
const SEU_DECISION_LABELS: Record<string, string> = {
  accepted_as_seu: "ÖEK",
  not_seu: "ÖEK Dışı",
  monitor: "İzleme",
};

class ReportScopeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function reportStorageFailureCategory(error: unknown, fallback: string): string {
  return error instanceof ReportStorageError ? error.category : fallback;
}

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function technicalProfileReportContextHtml(context: TechnicalProfileReportContext): string {
  const title = "Birim Teknik Profili";
  if (context.status !== "resolved") {
    return `<h2>${title}</h2>
    <div class="warning-box">
      <strong>Teknik profil baglami:</strong> ${escapeHtml(context.warning ?? "Secilen kapsam icin teknik profil snapshot'i kullanilmadi.")}
      <br><span>Etki tarihi: ${escapeHtml(context.effectiveDate)}</span>
    </div>`;
  }

  const metaRows = [
    ["Birim", context.unitName ?? "-"],
    ["Snapshot", context.snapshotNumber ? `#${context.snapshotNumber}` : "-"],
    ["Profil versiyonu", context.profileVersion ?? "-"],
    ["Gecerlilik", `${context.validFrom ?? "-"} - ${context.validTo ?? "devam"}`],
    ["Yayim tarihi", context.publishedAt ? context.publishedAt.slice(0, 10) : "-"],
    ["Tamamlanma", context.completionPercentage !== null ? `%${context.completionPercentage}` : "-"],
  ];
  const fieldRows = [...context.standardSummary.slice(0, 14), ...context.customSummary.slice(0, 8)]
    .map((field) => `<tr><td>${escapeHtml(field.label)}</td><td>${escapeHtml(field.displayValue)}</td></tr>`)
    .join("");

  return `<h2>${title}</h2>
    <div class="meta-grid">
      ${metaRows.map(([label, value]) => `<div class="meta-item"><div class="meta-label">${escapeHtml(label)}</div><div class="meta-value">${escapeHtml(value)}</div></div>`).join("")}
    </div>
    ${fieldRows
      ? `<table><tr><th>Alan</th><th>Deger</th></tr>${fieldRows}</table>`
      : `<div class="warning-box">Yayimlanmis snapshot bulundu ancak rapora uygun dolu teknik profil alani yok.</div>`}`;
}

function equipmentInventoryReportContextHtml(context: ReturnType<typeof toEquipmentReportSnapshot>): string {
  const rows = context.keyEquipment
    .map((item) => `<tr>
      <td>${escapeHtml(item.equipmentCode)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.category)}</td>
      <td>${escapeHtml(item.unitName ?? "-")}</td>
      <td style="text-align:center">${item.isCritical ? "Evet" : "Hayir"}</td>
      <td style="text-align:right">${item.installedPowerKw !== null ? item.installedPowerKw.toLocaleString("tr-TR") : "-"}</td>
      <td style="text-align:center">${item.meterCount}</td>
      <td style="text-align:center">${item.energySourceCount}</td>
    </tr>`)
    .join("");
  return `<h2>Enerji Tuketen Ekipman Envanteri</h2>
    <div class="meta-grid">
      <div class="meta-item"><div class="meta-label">Aktif Ekipman</div><div class="meta-value">${context.scope.activeEquipment}</div></div>
      <div class="meta-item"><div class="meta-label">Kritik</div><div class="meta-value">${context.scope.criticalEquipment}</div></div>
      <div class="meta-item"><div class="meta-label">Enerji Yogun</div><div class="meta-value">${context.scope.energyIntensiveEquipment}</div></div>
      <div class="meta-item"><div class="meta-label">Birincil Sayac</div><div class="meta-value">${context.coverage.withPrimaryMeter}</div></div>
      <div class="meta-item"><div class="meta-label">Enerji Kaynagi</div><div class="meta-value">${context.coverage.withAnyEnergySource}</div></div>
      <div class="meta-item"><div class="meta-label">Kurulu Guc</div><div class="meta-value">${context.aggregates.installedPowerKw !== null ? `${context.aggregates.installedPowerKw.toLocaleString("tr-TR")} kW` : "-"}</div></div>
    </div>
    ${context.warnings.length > 0 ? `<div class="warning-box">Kaynak notlari: ${escapeHtml(context.warnings.slice(0, 4).join(", "))}</div>` : ""}
    ${rows ? `<table><tr><th>Kod</th><th>Ad</th><th>Kategori</th><th>Birim</th><th>Kritik</th><th style="text-align:right">Kurulu Guc kW</th><th>Sayac</th><th>Kaynak</th></tr>${rows}</table>` : `<div class="warning-box">Kapsamda rapora eklenebilecek aktif ekipman bulunamadi.</div>`}
    <p style="font-size:11px;color:#64748b">Bu bolum mevcut ekipman envanterinden uretilen ozet baglamdir; seri numarasi, varlik kodu, notlar ve uzun ozel alanlar rapora alinmaz.</p>`;
}

function parsePositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new ReportScopeError(400, `Geçersiz ${field}`);
}

function parseTargetReportStatus(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !TARGET_REPORT_STATUSES.has(value)) {
    throw new ReportScopeError(400, "Geçersiz status");
  }
  return value;
}

function parseRequiredId(value: unknown, field: string): number {
  const parsed = parsePositiveInteger(value, field);
  if (parsed === undefined) throw new ReportScopeError(400, `${field} zorunludur`);
  return parsed;
}

function parseReportYear(value: unknown): number {
  const year = parseRequiredId(value, "year");
  if (year < 1900 || year > 3000) throw new ReportScopeError(400, "Geçersiz year");
  return year;
}

function parseOptionalReportYear(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return parseReportYear(value);
}

function parseArchiveLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return 20;
  const parsed = parsePositiveInteger(value, "limit");
  if (parsed === undefined) return 20;
  return Math.min(parsed, 50);
}

function parseArchiveOffset(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  throw new ReportScopeError(400, "Gecersiz offset");
}

const ARCHIVE_REPORT_TYPES: ReadonlySet<ArchiveReportType> = new Set([ANNUAL_ENERGY_REPORT_TYPE, ENERGY_TARGETS_REPORT_TYPE, ENERGY_PERFORMANCE_REPORT_TYPE]);
const ARCHIVE_STATUSES = new Set(["generating", "completed", "failed", "deleted", "purging", "purged", "purge_failed"]);

function isArchiveReportType(value: string): value is ArchiveReportType {
  return ARCHIVE_REPORT_TYPES.has(value as ArchiveReportType);
}

function parseArchiveReportType(value: unknown): ArchiveReportType | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !isArchiveReportType(value)) throw new ReportScopeError(400, "Gecersiz reportType");
  return value;
}

function parseArchiveStatus(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !ARCHIVE_STATUSES.has(value)) throw new ReportScopeError(400, "Gecersiz status");
  return value;
}

function parseArchiveDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ReportScopeError(400, `Gecersiz ${field}`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new ReportScopeError(400, `Gecersiz ${field}`);
  return parsed;
}

function safeContentDisposition(filename: string): string {
  const safe = sanitizeArchiveFilename(filename).replace(/"/g, "");
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"`;
}

async function readCompanyPdfIdentity(companyId: number) {
  const [company] = await db.select({
    name: companiesTable.name,
    legalName: companiesTable.legalName,
    shortName: companiesTable.shortName,
    address: companiesTable.address,
  })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  return company ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.length <= 1_000 ? value : null;
}

function safeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateToIso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function reportNameFor(reportType: string, snapshot: unknown): string {
  const snapshotTitle = isRecord(snapshot) ? safeString(snapshot.reportDisplayName) ?? safeString(snapshot.title) : null;
  return snapshotTitle ?? REPORT_TYPE_REGISTRY.find((item) => item.code === reportType)?.displayName ?? reportType;
}

function safeFailureCategory(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return /^[a-z][a-z0-9_-]{0,79}$/.test(value) ? value : "redacted";
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

function buildArchiveDetailResponse(input: {
  archive: typeof reportArchivesTable.$inferSelect;
  snapshot: typeof reportGenerationSnapshotsTable.$inferSelect | null;
}): ReportArchiveDetailResponse {
  const { archive, snapshot } = input;
  const snapshotJson = snapshot?.settingsSnapshot;
  const snapshotRecord = isRecord(snapshotJson) ? snapshotJson : null;
  const profileVersion = safeNumber(snapshotRecord?.profileVersion);
  const typeSettingsVersion = safeNumber(snapshotRecord?.typeSettingsVersion);
  const previousStatus = archive.previousStatus;
  const failureCategory = safeFailureCategory(archive.status === "purge_failed" ? archive.purgeFailureCategory : archive.failureCategory);
  const canRestore = archive.status === "deleted"
    && archive.deletionLocked !== true
    && Boolean(archive.storageKey)
    && (previousStatus === "completed" || previousStatus === "failed");

  return {
    archive: {
      id: archive.id,
      reportType: archive.reportType,
      reportName: reportNameFor(archive.reportType, snapshotJson),
      status: archive.status as ReportArchiveDetailResponse["archive"]["status"],
      fileName: archive.outputName,
      mimeType: archive.contentType,
      sizeBytes: archive.sizeBytes,
      checksum: archive.checksumSha256,
      createdAt: archive.createdAt.toISOString(),
      completedAt: dateToIso(archive.completedAt),
      failedAt: dateToIso(archive.failedAt),
      deletedAt: dateToIso(archive.deletedAt),
      restoredAt: null,
      expiresAt: dateToIso(archive.retentionExpiresAt),
      lifecycleVersion: archive.lifecycleVersion,
      canDownload: archiveDownloadable(archive.status),
      canRestore,
    },
    scope: {
      companyId: archive.companyId,
      unitId: archive.unitId,
      periodStart: safeString(snapshotRecord?.periodStart),
      periodEnd: safeString(snapshotRecord?.periodEnd),
    },
    generation: {
      generatedByUserId: archive.generatedBy ?? snapshot?.generatedBy ?? null,
      generatedAt: dateToIso(archive.generatedAt ?? snapshot?.generatedAt ?? null),
      snapshotId: archive.snapshotId,
      settingsProfileVersion: profileVersion,
      reportTypeSettingsVersion: typeSettingsVersion,
    },
    document: {
      documentNumber: safeString(snapshotRecord?.documentNumber),
      revisionNumber: safeString(snapshotRecord?.revisionNumber),
      revisionDate: safeString(snapshotRecord?.revisionDate),
      preparedBy: safeString(snapshotRecord?.preparedBy),
      checkedBy: safeString(snapshotRecord?.checkedBy),
      approvedBy: safeString(snapshotRecord?.approvedBy),
      confidentialityLevel: safeString(snapshotRecord?.confidentiality),
      footerText: safeString(snapshotRecord?.footerText),
    },
    dataScope: summarizeReportDataManifest(snapshot?.dataManifest),
    failure: {
      category: failureCategory,
      message: failureCategory,
      retryable: false,
    },
  };
}

async function findScopedArchiveDetail(req: Request, archiveId: number) {
  const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
  if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
  const conditions: SQL[] = [
    eq(reportArchivesTable.id, archiveId),
    eq(reportArchivesTable.companyId, scope.companyId),
  ];
  if (scope.unitId !== null) conditions.push(eq(reportArchivesTable.unitId, scope.unitId));
  const [row] = await db.select({
    archive: reportArchivesTable,
    snapshot: reportGenerationSnapshotsTable,
  })
    .from(reportArchivesTable)
    .leftJoin(reportGenerationSnapshotsTable, and(
      eq(reportArchivesTable.snapshotId, reportGenerationSnapshotsTable.id),
      eq(reportGenerationSnapshotsTable.companyId, reportArchivesTable.companyId),
    ))
    .where(and(...conditions))
    .limit(1);
  return row ?? null;
}

async function getOfficialSeuReportSection({
  companyId,
  unitId,
  year,
}: {
  companyId: number;
  unitId: number | null;
  year: number;
}) {
  const assessmentConditions: SQL[] = [
    eq(seuAssessmentsTable.companyId, companyId),
    eq(unitsTable.companyId, companyId),
    eq(seuAssessmentsTable.year, year),
    eq(seuAssessmentsTable.recordType, "unit_official"),
    eq(seuAssessmentsTable.isOfficial, true),
  ];
  if (unitId !== null) assessmentConditions.push(eq(seuAssessmentsTable.unitId, unitId));

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

  // Official kayıt üretim sözleşmesindeki gibi her birim için en son kaydı kullan.
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
      eq(energySourcesTable.companyId, companyId),
      or(isNull(energySourcesTable.unitId), eq(energySourcesTable.unitId, seuAssessmentsTable.unitId)),
    ))
    .where(and(
      inArray(seuAssessmentsTable.id, assessmentIds),
      eq(seuAssessmentsTable.companyId, companyId),
      eq(unitsTable.companyId, companyId),
      eq(seuAssessmentsTable.year, year),
      eq(seuAssessmentsTable.recordType, "unit_official"),
      eq(seuAssessmentsTable.isOfficial, true),
      ...(unitId !== null ? [eq(seuAssessmentsTable.unitId, unitId)] : []),
    ))
    .orderBy(
      asc(seuAssessmentsTable.unitId),
      asc(seuAssessmentItemsTable.consumptionSharePercent),
      asc(seuAssessmentItemsTable.id),
    );

  return { assessmentCount: assessmentIds.length, items };
}

async function resolveReportScope(
  req: Request,
  source: Record<string, unknown>,
  requireSuperAdminCompany: boolean,
) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const requestedCompanyId = parsePositiveInteger(source.companyId, "companyId");
  const requestedUnitId = parsePositiveInteger(source.unitId, "unitId");

  if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
    if (sessionUnitId === null) throw new ReportScopeError(403, "Bu rapor için birim yetkisi gerekli");
    if (requestedUnitId !== undefined && requestedUnitId !== sessionUnitId) {
      throw new ReportScopeError(403, "Bu birim için yetkiniz yok");
    }
    return { companyId: sessionCompanyId, unitId: sessionUnitId };
  }

  if (isSuperAdmin(role) && requireSuperAdminCompany && requestedCompanyId === undefined) {
    throw new ReportScopeError(400, "companyId zorunludur");
  }

  if (isSuperAdmin(role) && requestedCompanyId !== undefined) {
    const [company] = await db.select({ id: companiesTable.id })
      .from(companiesTable).where(eq(companiesTable.id, requestedCompanyId));
    if (!company) throw new ReportScopeError(400, "Geçersiz companyId");
  }

  let companyId = isSuperAdmin(role) ? requestedCompanyId : sessionCompanyId;
  const unitId = requestedUnitId;

  if (unitId !== undefined) {
    const [unit] = await db.select({ companyId: unitsTable.companyId })
      .from(unitsTable).where(eq(unitsTable.id, unitId));
    if (!unit) throw new ReportScopeError(400, "Geçersiz unitId");
    if (companyId !== undefined && unit.companyId !== companyId) {
      throw new ReportScopeError(403, "Bu birim için yetkiniz yok");
    }
    if (isSuperAdmin(role) && companyId === undefined) companyId = unit.companyId;
  }

  return { companyId, unitId: unitId ?? null };
}

function handleReportScopeError(res: Response, err: unknown) {
  if (!(err instanceof ReportScopeError)) return false;
  res.status(err.status).json({ error: err.message });
  return true;
}

function requireArchiveMutationRole(req: Request): void {
  const role = req.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    throw new ReportScopeError(403, "Bu islem icin yetkiniz yok");
  }
}

function safeDiagnosticsCategory(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return /^[a-z][a-z0-9_-]{0,63}$/.test(value) ? value : "redacted";
}

async function purgeArchiveClaimed(input: {
  request: Request;
  archiveId: number;
  companyId: number;
  actorUserId: number;
  forceRetention?: boolean;
}) {
  const claim = await pool.query<{
    id: number;
    company_id: number;
    unit_id: number | null;
    report_type: ArchiveReportType;
    storage_key: string | null;
  }>(
    `
      UPDATE report_archives
      SET status='purging', updated_at=now(), lifecycle_version=lifecycle_version+1
      WHERE id=$1
        AND company_id=$2
        AND deletion_locked=false
        AND (
          (status='deleted' AND purge_eligible_at IS NOT NULL AND purge_eligible_at <= now())
          OR ($3::boolean = true AND status IN ('completed','failed') AND retention_expires_at IS NOT NULL AND retention_expires_at <= now())
          OR status='purge_failed'
        )
      RETURNING id, company_id, unit_id, report_type, storage_key
    `,
    [input.archiveId, input.companyId, input.forceRetention === true],
  );
  const archive = claim.rows[0];
  if (!archive) return { status: "not-eligible" as const };
  await writeBestEffortAudit(db, {
    request: input.request,
    companyId: archive.company_id,
    unitId: archive.unit_id,
    action: "report_archive.purge_started",
    entityType: "report_archive",
    entityId: archive.id,
    metadata: { archiveId: archive.id, reportType: archive.report_type },
  });
  try {
    if (archive.storage_key) await reportStorage.delete(archive.storage_key);
    await pool.query(
      `
        UPDATE report_archives
        SET status='purged',
            purged_at=now(),
            purged_by=$2,
            storage_key=NULL,
            storage_provider=NULL,
            purge_failure_category=NULL,
            updated_at=now(),
            lifecycle_version=lifecycle_version+1
        WHERE id=$1 AND company_id=$3 AND status='purging'
      `,
      [archive.id, input.actorUserId, input.companyId],
    );
    await writeBestEffortAudit(db, {
      request: input.request,
      companyId: archive.company_id,
      unitId: archive.unit_id,
      action: "report_archive.purged",
      entityType: "report_archive",
      entityId: archive.id,
      metadata: { archiveId: archive.id, reportType: archive.report_type },
    });
    return { status: "purged" as const };
  } catch (error) {
    const category = error instanceof ReportStorageError ? error.category : "storage_delete_failed";
    await pool.query(
      `
        UPDATE report_archives
        SET status='purge_failed',
            purge_failure_category=$2,
            updated_at=now(),
            lifecycle_version=lifecycle_version+1
        WHERE id=$1 AND company_id=$3
      `,
      [archive.id, category, input.companyId],
    );
    await writeBestEffortAudit(db, {
      request: input.request,
      companyId: archive.company_id,
      unitId: archive.unit_id,
      action: "report_archive.purge_failed",
      entityType: "report_archive",
      entityId: archive.id,
      outcome: "failure",
      metadata: { archiveId: archive.id, reportType: archive.report_type, failureCategory: category },
    });
    return { status: "failed" as const, category };
  }
}

const MONTH_NAMES = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// GET /api/reports
router.get("/reports", requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    parsePositiveInteger(req.query.companyId, "companyId");
    parsePositiveInteger(req.query.unitId, "unitId");

    if (!isCompanyAdmin(user.role) && !isSuperAdmin(user.role) && user.unitId === null) {
      res.json([]);
      return;
    }

    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, false);
    const conditions: SQL[] = [
      or(
        isNull(reportsTable.unitId),
        eq(unitsTable.companyId, reportsTable.companyId),
      )!,
    ];
    if (scope.companyId !== undefined) conditions.push(eq(reportsTable.companyId, scope.companyId));
    if (scope.unitId !== null) conditions.push(eq(reportsTable.unitId, scope.unitId));

    const items = await db.select({
      id: reportsTable.id,
      unitId: reportsTable.unitId,
      year: reportsTable.year,
      status: reportsTable.status,
      downloadUrl: reportsTable.downloadUrl,
      createdAt: reportsTable.createdAt,
    })
      .from(reportsTable)
      .leftJoin(unitsTable, eq(reportsTable.unitId, unitsTable.id))
      .where(and(...conditions))
      .orderBy(reportsTable.createdAt);

    res.json(items.map(r => ({
      id: r.id,
      unitId: r.unitId,
      year: r.year,
      status: r.status,
      downloadUrl: r.downloadUrl,
      createdAt: r.createdAt,
    })));
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// GET /api/reports/archive
router.get("/reports/archive", requireAuth, async (req, res) => {
  try {
    const user = req.user!;
    if (!isCompanyAdmin(user.role) && !isSuperAdmin(user.role) && user.unitId === null) {
      res.json({ items: [], total: 0, limit: 20, offset: 0, hasNext: false });
      return;
    }
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const limit = parseArchiveLimit(req.query.limit);
    const offset = parseArchiveOffset(req.query.offset);
    const reportType = parseArchiveReportType(req.query.reportType);
    const status = parseArchiveStatus(req.query.status);
    const year = parseOptionalReportYear(req.query.year);
    const generatedBy = parsePositiveInteger(req.query.generatedBy, "generatedBy");
    const dateFrom = parseArchiveDate(req.query.dateFrom, "dateFrom");
    const dateTo = parseArchiveDate(req.query.dateTo, "dateTo");
    const search = typeof req.query.search === "string" && req.query.search.trim().length > 0
      ? req.query.search.trim().slice(0, 80)
      : undefined;

    const conditions: SQL[] = [eq(reportArchivesTable.companyId, scope.companyId)];
    if (scope.unitId !== null) conditions.push(eq(reportArchivesTable.unitId, scope.unitId));
    if (reportType) conditions.push(eq(reportArchivesTable.reportType, reportType));
    if (status) conditions.push(eq(reportArchivesTable.status, status));
    else conditions.push(inArray(reportArchivesTable.status, ["generating", "completed", "failed"]));
    if (year !== undefined) conditions.push(eq(reportArchivesTable.reportYear, year));
    if (generatedBy !== undefined) conditions.push(eq(reportArchivesTable.generatedBy, generatedBy));
    if (dateFrom) conditions.push(gte(reportArchivesTable.generatedAt, dateFrom));
    if (dateTo) {
      const until = new Date(dateTo);
      until.setUTCDate(until.getUTCDate() + 1);
      conditions.push(lte(reportArchivesTable.generatedAt, until));
    }
    if (search) {
      const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
      conditions.push(or(ilike(reportArchivesTable.title, pattern), ilike(reportArchivesTable.outputName, pattern))!);
    }
    const where = and(...conditions);
    const [{ total }] = await db.select({ total: count() }).from(reportArchivesTable).where(where);
    const items = await db.select({
      id: reportArchivesTable.id,
      reportType: reportArchivesTable.reportType,
      title: reportArchivesTable.title,
      outputName: reportArchivesTable.outputName,
      status: reportArchivesTable.status,
      sizeBytes: reportArchivesTable.sizeBytes,
      generatedBy: reportArchivesTable.generatedBy,
      generatedByName: usersTable.name,
      generatedAt: reportArchivesTable.generatedAt,
      completedAt: reportArchivesTable.completedAt,
      reportYear: reportArchivesTable.reportYear,
      periodLabel: reportArchivesTable.periodLabel,
      snapshotId: reportArchivesTable.snapshotId,
      failureCategory: reportArchivesTable.failureCategory,
      deletedAt: reportArchivesTable.deletedAt,
      purgeEligibleAt: reportArchivesTable.purgeEligibleAt,
      purgedAt: reportArchivesTable.purgedAt,
      retentionExpiresAt: reportArchivesTable.retentionExpiresAt,
      deletionLocked: reportArchivesTable.deletionLocked,
      purgeFailureCategory: reportArchivesTable.purgeFailureCategory,
    })
      .from(reportArchivesTable)
      .leftJoin(usersTable, eq(reportArchivesTable.generatedBy, usersTable.id))
      .where(where)
      .orderBy(desc(reportArchivesTable.generatedAt), desc(reportArchivesTable.id))
      .limit(limit)
      .offset(offset);

    res.json({
      items: items.map((item) => ({
        id: item.id,
        reportType: item.reportType,
        title: item.title,
        outputName: item.outputName,
        status: item.status,
        sizeBytes: item.sizeBytes,
        generatedBy: item.generatedByName ? { id: item.generatedBy, name: item.generatedByName } : null,
        generatedAt: item.generatedAt,
        completedAt: item.completedAt,
        year: item.reportYear,
        periodLabel: item.periodLabel,
        downloadable: item.status === "completed",
        lifecycle: {
          deletedAt: item.deletedAt,
          purgeEligibleAt: item.purgeEligibleAt,
          purgedAt: item.purgedAt,
          retentionExpiresAt: item.retentionExpiresAt,
          deletionLocked: item.deletionLocked,
        },
        snapshot: item.snapshotId ? { id: item.snapshotId } : null,
        failureCategory: item.status === "failed" ? item.failureCategory : item.status === "purge_failed" ? item.purgeFailureCategory : null,
      })),
      total,
      limit,
      offset,
      hasNext: offset + items.length < total,
    });
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor arsivi listelenemedi" });
  }
});

// GET /api/reports/archive/:id/detail
router.get("/reports/archive/:id/detail", requireAuth, async (req, res) => {
  try {
    const archiveId = parseRequiredId(req.params.id, "id");
    const row = await findScopedArchiveDetail(req, archiveId);
    if (!row) {
      res.status(404).json({ error: "Rapor bulunamadi" });
      return;
    }
    res.json(buildArchiveDetailResponse(row));
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor detayi alinamadi" });
  }
});

// GET /api/reports/archive/:id/download
router.get("/reports/archive/:id/download", requireAuth, async (req, res) => {
  try {
    const archiveId = parseRequiredId(req.params.id, "id");
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const conditions: SQL[] = [
      eq(reportArchivesTable.id, archiveId),
      eq(reportArchivesTable.companyId, scope.companyId),
    ];
    if (scope.unitId !== null) conditions.push(eq(reportArchivesTable.unitId, scope.unitId));
    const [archive] = await db.select().from(reportArchivesTable).where(and(...conditions)).limit(1);
    if (!archive) {
      res.status(404).json({ error: "Rapor bulunamadi" });
      return;
    }
    if (archive.status !== "completed" || !archive.storageKey || !archive.storageProvider) {
      res.status(409).json({ error: "Rapor indirilebilir durumda degil" });
      return;
    }
    const stored = await reportStorage.get(archive.storageKey);
    if (archive.sizeBytes !== null && stored.contentLength !== archive.sizeBytes) throw new Error("archive_size_mismatch");
    if (archive.checksumSha256 && stored.checksumSha256 !== archive.checksumSha256) throw new Error("archive_checksum_mismatch");
    res.set({
      "Content-Type": archive.contentType,
      "Content-Disposition": safeContentDisposition(archive.outputName),
      "Cache-Control": "no-store",
      "Content-Length": String(stored.contentLength),
    });
    req.on("aborted", () => stored.stream.destroy());
    await pipeline(stored.stream, res);
    await writeBestEffortAudit(db, {
      request: req,
      companyId: archive.companyId,
      unitId: archive.unitId,
      action: "report_archive.downloaded",
      entityType: "report_archive",
      entityId: archive.id,
      metadata: {
        archiveId: archive.id,
        reportType: archive.reportType,
        outputName: archive.outputName,
        sizeBytes: archive.sizeBytes,
      },
    });
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Rapor indirilemedi" });
    else res.destroy();
  }
});

// DELETE /api/reports/archive/:id
router.delete("/reports/archive/:id", requireAuth, async (req, res) => {
  try {
    requireArchiveMutationRole(req);
    const archiveId = parseRequiredId(req.params.id, "id");
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const settings = await getReportRetentionSettings(scope.companyId);
    const reason = normalizeDeleteReason((req.body as { reason?: unknown } | undefined)?.reason);
    const deletedAt = new Date();
    const purgeEligibleAt = calculatePurgeEligibleAt(deletedAt, settings.deletedGraceDays);
    const result = await pool.query<{ id: number; unit_id: number | null; report_type: ArchiveReportType; status: string; purge_eligible_at: Date | null }>(
      `
        UPDATE report_archives
        SET status='deleted',
            previous_status=status,
            deleted_at=$3,
            deleted_by=$4,
            delete_reason=$5,
            purge_eligible_at=$6,
            updated_at=$3,
            lifecycle_version=lifecycle_version+1
        WHERE id=$1
          AND company_id=$2
          AND status IN ('completed','failed')
          AND deletion_locked=false
          ${scope.unitId !== null ? "AND unit_id=$7" : ""}
        RETURNING id, unit_id, report_type, status, purge_eligible_at
      `,
      scope.unitId !== null
        ? [archiveId, scope.companyId, deletedAt, req.user!.userId, reason, purgeEligibleAt, scope.unitId]
        : [archiveId, scope.companyId, deletedAt, req.user!.userId, reason, purgeEligibleAt],
    );
    const row = result.rows[0];
    if (!row) {
      const exists = await pool.query("SELECT status FROM report_archives WHERE id=$1 AND company_id=$2 LIMIT 1", [archiveId, scope.companyId]);
      res.status(exists.rowCount === 0 ? 404 : 409).json({ error: exists.rowCount === 0 ? "Rapor bulunamadi" : "Rapor silinebilir durumda degil" });
      return;
    }
    await writeBestEffortAudit(db, {
      request: req,
      companyId: scope.companyId,
      unitId: row.unit_id,
      action: "report_archive.soft_deleted",
      entityType: "report_archive",
      entityId: row.id,
      metadata: { archiveId: row.id, reportType: row.report_type, reasonCategory: reason === "manual_admin_delete" ? reason : "admin_provided", policyVersion: settings.settingsVersion },
    });
    res.json({ id: row.id, status: row.status, purgeEligibleAt: row.purge_eligible_at });
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor silinemedi" });
  }
});

router.post("/reports/archive/:id/restore", requireAuth, async (req, res) => {
  try {
    requireArchiveMutationRole(req);
    const archiveId = parseRequiredId(req.params.id, "id");
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const found = await pool.query<{
      id: number;
      unit_id: number | null;
      report_type: ArchiveReportType;
      status: string;
      previous_status: string | null;
      storage_key: string | null;
      deletion_locked: boolean;
    }>(
      `SELECT id, unit_id, report_type, status, previous_status, storage_key, deletion_locked
       FROM report_archives
       WHERE id=$1 AND company_id=$2 ${scope.unitId !== null ? "AND unit_id=$3" : ""}
       LIMIT 1`,
      scope.unitId !== null ? [archiveId, scope.companyId, scope.unitId] : [archiveId, scope.companyId],
    );
    const archive = found.rows[0];
    if (!archive) {
      res.status(404).json({ error: "Rapor bulunamadi" });
      return;
    }
    if (archive.status !== "deleted" || archive.deletion_locked || !archive.storage_key || !["completed", "failed"].includes(archive.previous_status ?? "")) {
      res.status(409).json({ error: "Rapor geri alinabilir durumda degil" });
      return;
    }
    if (!await reportStorage.exists(archive.storage_key)) {
      res.status(409).json({ error: "Storage nesnesi bulunamadigi icin geri alinamaz", category: "storage_object_not_found" });
      return;
    }
    const restored = await pool.query<{ id: number; status: string }>(
      `
        UPDATE report_archives
        SET status=previous_status,
            previous_status=NULL,
            deleted_at=NULL,
            deleted_by=NULL,
            delete_reason=NULL,
            purge_eligible_at=NULL,
            updated_at=now(),
            lifecycle_version=lifecycle_version+1
        WHERE id=$1 AND company_id=$2 AND status='deleted'
        RETURNING id, status
      `,
      [archiveId, scope.companyId],
    );
    if (!restored.rows[0]) {
      res.status(409).json({ error: "Rapor geri alma yarisi nedeniyle tamamlanamadi" });
      return;
    }
    await writeBestEffortAudit(db, {
      request: req,
      companyId: scope.companyId,
      unitId: archive.unit_id,
      action: "report_archive.restored",
      entityType: "report_archive",
      entityId: archive.id,
      metadata: { archiveId: archive.id, reportType: archive.report_type },
    });
    res.json(restored.rows[0]);
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor geri alinamadi" });
  }
});

router.post("/reports/archive/:id/purge", requireAuth, async (req, res) => {
  try {
    requireArchiveMutationRole(req);
    const archiveId = parseRequiredId(req.params.id, "id");
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const body = req.body as { mode?: unknown; ack?: unknown } | undefined;
    if (body?.ack !== `PURGE_ARCHIVE_${archiveId}`) {
      res.status(400).json({ error: "Kalici silme icin explicit ACK zorunludur" });
      return;
    }
    const settings = await getReportRetentionSettings(scope.companyId);
    const result = await purgeArchiveClaimed({
      request: req,
      archiveId,
      companyId: scope.companyId,
      actorUserId: req.user!.userId,
      forceRetention: settings.retentionEnabled && body?.mode === "retention",
    });
    if (result.status === "not-eligible") {
      const scopedExists = await pool.query(
        `SELECT id FROM report_archives WHERE id=$1 AND company_id=$2 ${scope.unitId !== null ? "AND unit_id=$3" : ""} LIMIT 1`,
        scope.unitId !== null ? [archiveId, scope.companyId, scope.unitId] : [archiveId, scope.companyId],
      );
      if (scopedExists.rowCount === 0) {
        res.status(404).json({ error: "Rapor bulunamadi" });
        return;
      }
      res.status(409).json({ error: "Rapor purge icin uygun degil" });
      return;
    }
    res.json(result);
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor kalici silinemedi" });
  }
});

router.get("/reports/archive/diagnostics/missing", requireAuth, async (req, res) => {
  try {
    if (!req.user || !["admin", "kontrol_admin", "superadmin"].includes(req.user.role)) throw new ReportScopeError(req.user ? 403 : 401, "Bu islem icin yetkiniz yok");
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const limit = parseArchiveLimit(req.query.limit);
    const candidates = await pool.query<{
      id: number;
      report_type: ArchiveReportType;
      status: string;
      generated_at: Date;
      completed_at: Date | null;
      deleted_at: Date | null;
      output_name: string;
      storage_key: string | null;
    }>(
      `
        SELECT id, report_type, status, generated_at, completed_at, deleted_at, output_name, storage_key
        FROM report_archives
        WHERE company_id=$1 AND status IN ('completed','deleted') AND storage_key IS NOT NULL
        ORDER BY generated_at ASC
        LIMIT $2
      `,
      [scope.companyId, limit],
    );
    const missing = [];
    for (const archive of candidates.rows) {
      try {
        if (archive.storage_key && !await reportStorage.exists(archive.storage_key)) {
          missing.push({ archiveId: archive.id, reportType: archive.report_type, status: archive.status, generatedAt: archive.generated_at, completedAt: archive.completed_at, deletedAt: archive.deleted_at, outputName: archive.output_name, category: "storage_object_not_found" });
        }
      } catch (error) {
        missing.push({ archiveId: archive.id, reportType: archive.report_type, status: archive.status, generatedAt: archive.generated_at, completedAt: archive.completed_at, deletedAt: archive.deleted_at, outputName: archive.output_name, category: error instanceof ReportStorageError ? error.category : "storage_unknown_error" });
      }
    }
    await writeBestEffortAudit(db, {
      request: req,
      companyId: scope.companyId,
      action: "report_archive.missing_diagnostics_run",
      entityType: "report_archive",
      entityId: scope.companyId,
      metadata: { candidateCount: candidates.rows.length, missingCount: missing.length },
    });
    res.json({
      companyId: scope.companyId,
      candidateCount: candidates.rows.length,
      missingCount: missing.length,
      byReportType: Object.entries(missing.reduce<Record<string, number>>((acc, item) => {
        acc[item.reportType] = (acc[item.reportType] ?? 0) + 1;
        return acc;
      }, {})).map(([reportType, count]) => ({ reportType, count })),
      oldest: missing[0] ?? null,
      items: missing,
    });
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Missing object diagnostics calistirilamadi" });
  }
});

router.get("/reports/archive/diagnostics/orphans", requireAuth, async (req, res) => {
  try {
    if (!req.user || !["admin", "kontrol_admin", "superadmin"].includes(req.user.role)) throw new ReportScopeError(req.user ? 403 : 401, "Bu islem icin yetkiniz yok");
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    if (!reportStorage.list) {
      res.status(501).json({ error: "Storage listing desteklenmiyor" });
      return;
    }
    const companyId = scope.companyId;
    const maxKeys = parseArchiveLimit(req.query.limit);
    const listed = await reportStorage.list({ prefix: companyReportPrefix(companyId), maxKeys, continuationToken: typeof req.query.continuationToken === "string" ? req.query.continuationToken : null });
    const archiveIds = listed.objects.map((object) => archiveIdFromStorageKey(object.key, companyId)).filter((id): id is number => id !== null);
    const existing = archiveIds.length > 0
      ? await pool.query<{ id: number }>("SELECT id FROM report_archives WHERE company_id=$1 AND id = ANY($2::int[])", [companyId, archiveIds])
      : { rows: [] as Array<{ id: number }> };
    const existingIds = new Set(existing.rows.map((row) => row.id));
    const items = listed.objects.flatMap((object) => {
      const archiveId = archiveIdFromStorageKey(object.key, companyId);
      if (archiveId !== null && existingIds.has(archiveId)) return [];
      return [{ objectId: redactedObjectIdentifier(object.key), parsedArchiveId: archiveId, sizeBytes: object.sizeBytes, lastModified: object.lastModified, reason: archiveId === null ? "invalid_key_format" : "archive_record_missing" }];
    });
    await writeBestEffortAudit(db, {
      request: req,
      companyId: scope.companyId,
      action: "report_archive.orphan_diagnostics_run",
      entityType: "report_archive",
      entityId: scope.companyId,
      metadata: { listedCount: listed.objects.length, orphanCount: items.length, dryRun: true },
    });
    res.json({
      companyId: scope.companyId,
      prefixScope: "company_reports",
      dryRun: true,
      listedCount: listed.objects.length,
      orphanCount: items.length,
      totalBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
      items,
      nextContinuationToken: listed.nextContinuationToken,
      truncated: listed.truncated,
    });
  } catch (err) {
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Orphan diagnostics calistirilamadi" });
  }
});

// POST /api/reports/generate
router.post("/reports/generate", requireAuth, async (req, res) => {
  let reportId: number | null = null;
  let snapshotRecordId: number | null = null;
  let archiveRecordId: number | null = null;
  let snapshotForFailure: AnnualEnergyReportSnapshot | null = null;
  let dataManifestForFailure: ReportDataManifestV1 | null = null;
  try {
    const { year, unitId: bodyUnitId, includeSwot, includeRisks, includeSeu, includeRegression } = req.body;
    const allowedBodyKeys = new Set(["year", "unitId", "companyId", "includeSwot", "includeRisks", "includeSeu", "includeRegression"]);
    for (const key of Object.keys(req.body ?? {})) {
      if (!allowedBodyKeys.has(key)) throw new ReportScopeError(400, `Geçersiz alan: ${key}`);
    }
    const legacyOverrides = parseAnnualEnergyLegacyOverrides(req.body as Record<string, unknown>);
    const yr = parseReportYear(year ?? new Date().getFullYear());
    const scope = await resolveReportScope(req, { ...req.body, unitId: bodyUnitId }, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const effectiveCompanyId = scope.companyId;
    const resolvedUnitId = scope.unitId;

    // consumptionTable has no unitId directly — filter via meters join
    const consumptionConditions: SQL[] = [
      eq(consumptionTable.year, yr),
      eq(consumptionTable.companyId, effectiveCompanyId),
      eq(metersTable.companyId, effectiveCompanyId),
    ];
    const meterConditions: SQL[] = [eq(metersTable.companyId, effectiveCompanyId)];
    const swotConditions: SQL[] = [eq(swotTable.companyId, effectiveCompanyId)];
    const riskConditions: SQL[] = [eq(risksTable.companyId, effectiveCompanyId)];
    if (resolvedUnitId !== null) {
      consumptionConditions.push(eq(metersTable.unitId, resolvedUnitId));
      meterConditions.push(eq(metersTable.unitId, resolvedUnitId));
      swotConditions.push(eq(swotTable.unitId, resolvedUnitId));
      riskConditions.push(eq(risksTable.unitId, resolvedUnitId));
    }

    const consumptionRows = await db
      .select({ id: consumptionTable.id, meterId: consumptionTable.meterId, year: consumptionTable.year, month: consumptionTable.month, kwh: consumptionTable.kwh, tep: consumptionTable.tep, co2: consumptionTable.co2, hdd: consumptionTable.hdd, cdd: consumptionTable.cdd, notes: consumptionTable.notes, createdAt: consumptionTable.createdAt })
      .from(consumptionTable)
      .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
      .where(and(...consumptionConditions));
    const meters = await db.select().from(metersTable).where(and(...meterConditions));
    const swotItems = await db.select().from(swotTable).where(and(...swotConditions));
    const riskItems = await db.select().from(risksTable).where(and(...riskConditions));
    const officialSeu = await getOfficialSeuReportSection({
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      year: yr,
    });
    const acceptedSeuCount = officialSeu.items.filter((item) => item.userDecision === "accepted_as_seu").length;

    const [company] = await db.select({ name: companiesTable.name })
      .from(companiesTable)
      .where(eq(companiesTable.id, effectiveCompanyId))
      .limit(1);
    if (!company) throw new ReportScopeError(400, "Geçersiz companyId");

    let unitLabel = "Tüm Birimler";
    if (resolvedUnitId !== null) {
      const [unit] = await db.select({ name: unitsTable.name })
        .from(unitsTable)
        .where(and(eq(unitsTable.id, resolvedUnitId), eq(unitsTable.companyId, effectiveCompanyId)))
        .limit(1);
      unitLabel = unit?.name ?? `Birim #${resolvedUnitId}`;
    }

    const effectiveSettings = await resolveEffectiveCompanyReportSettings({
      companyId: effectiveCompanyId,
      reportType: ANNUAL_ENERGY_REPORT_TYPE,
    });
    const [report] = await db.insert(reportsTable).values({
      companyId: effectiveCompanyId,
      year: yr,
      unitId: resolvedUnitId,
      status: "pending",
      includeSwot: legacyOverrides.swot?.value ?? true,
      includeRisks: legacyOverrides.risks?.value ?? true,
      includeSeu: legacyOverrides.seu?.value ?? true,
      includeRegression: legacyOverrides.regression?.value ?? true,
    }).returning();
    reportId = report.id;

    const snapshot = buildAnnualEnergyReportSnapshot({
      effective: effectiveSettings,
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      companyName: company.name,
      unitLabel,
      year: yr,
      legacyReportId: report.id,
      generatedAt: new Date(),
      generatedBy: req.user?.userId ?? null,
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
    const [snapshotRecord] = await db.insert(reportGenerationSnapshotsTable).values({
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      reportType: ANNUAL_ENERGY_REPORT_TYPE,
      year: yr,
      status: "generating",
      storageStatus: "not_stored",
      filename: snapshot.outputName,
      settingsSnapshot: snapshot,
      generatedBy: req.user?.userId ?? null,
    }).returning({ id: reportGenerationSnapshotsTable.id });
    snapshotRecordId = snapshotRecord.id;
    archiveRecordId = await createReportArchiveRecord({
      request: req,
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      reportType: ANNUAL_ENERGY_REPORT_TYPE,
      reportYear: yr,
      periodLabel: String(yr),
      title: snapshot.title,
      outputName: snapshot.outputName,
      contentType: "text/html; charset=utf-8",
      snapshotId: snapshotRecordId,
      legacyReportId: report.id,
    });

    const auditMetadata = {
      companyId: effectiveCompanyId,
      reportType: ANNUAL_ENERGY_REPORT_TYPE,
      reportId: report.id,
      snapshotId: snapshotRecordId,
      archiveId: archiveRecordId,
      year: yr,
      profileVersion: snapshot.profileVersion,
      typeSettingsVersion: snapshot.typeSettingsVersion,
      outputName: snapshot.outputName,
      sectionCodes: snapshot.sections.filter((section) => section.finalVisibility).map((section) => section.code),
      legacyOverrides: Object.values(legacyOverrides).map((override) => override.param),
    };
    await writeBestEffortAudit(db, {
      request: req,
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      action: "annual_energy_performance_report.generation_started",
      entityType: "report",
      entityId: report.id,
      metadata: auditMetadata,
    });

    const dataManifest = buildAnnualReportDataManifest({
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      year: yr,
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
    dataManifestForFailure = dataManifest;
    await persistReportDataManifest(snapshotRecordId, dataManifest);
    const completedAuditMetadata = { ...auditMetadata, ...manifestAuditMetadata(dataManifest) };

    const totalKwh = consumptionRows.reduce((a, r) => a + r.kwh, 0);
    const totalTep = consumptionRows.reduce((a, r) => a + r.tep, 0);
    const totalCo2 = consumptionRows.reduce((a, r) => a + r.co2, 0);

    const byMonth: Record<number, { kwh: number; tep: number; co2: number }> = {};
    for (let m = 1; m <= 12; m++) byMonth[m] = { kwh: 0, tep: 0, co2: 0 };
    for (const r of consumptionRows) {
      byMonth[r.month].kwh += r.kwh;
      byMonth[r.month].tep += r.tep;
      byMonth[r.month].co2 += r.co2;
    }

    const locale = snapshot.locale;
    const generatedDate = new Date(snapshot.generatedAt);
    const fmtAnnualNumber = (value: number | null | undefined, digits = 0) =>
      typeof value === "number" && Number.isFinite(value)
        ? value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
        : "—";
    const annualTableRows = Array.from({ length: 12 }, (_, i) => i + 1)
      .map(m => `<tr><td>${MONTH_NAMES[m]}</td><td>${fmtAnnualNumber(Math.round(byMonth[m].kwh))}</td><td>${fmtAnnualNumber(Math.round(byMonth[m].tep * 1000) / 1000, 3)}</td><td>${fmtAnnualNumber(Math.round(byMonth[m].co2 * 10) / 10, 1)}</td></tr>`)
      .join("\n");
    const annualSwotHtml = swotItems.length > 0
      ? `<table><tr><th>Kategori</th><th>Madde</th><th>Puan</th><th>Etki</th></tr>
         ${swotItems.map(s => `<tr><td>${escapeHtml(s.category)}</td><td>${escapeHtml(s.title)}</td><td>${s.score}/5</td><td>${escapeHtml(s.impact)}</td></tr>`).join("")}
         </table>` : "";
    const annualRiskHtml = riskItems.length > 0
      ? `<table><tr><th>Tür</th><th>Başlık</th><th>Olasılık</th><th>Etki</th><th>Skor</th><th>Durum</th></tr>
         ${riskItems.map(r => `<tr><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.title)}</td><td>${r.probability}/5</td><td>${r.severity}/5</td><td>${r.score}</td><td>${escapeHtml(r.status)}</td></tr>`).join("")}
         </table>` : "";
    const annualSeuHtml = officialSeu.items.length > 0
      ? `<table><tr><th>Sıra</th><th>Birim</th><th>Ad</th><th>Enerji Kaynağı</th><th>TEP</th><th>Pay (%)</th><th>Öncelik</th><th>Karar</th><th>Karar Gerekçesi</th><th>Değerlendirme Yılı</th></tr>
         ${officialSeu.items.map((item, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(item.unitName)}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.energySourceName ?? "—")}</td><td>${fmtAnnualNumber(item.energyTep, 4)}</td><td>${fmtAnnualNumber(item.consumptionSharePercent, 1)}</td><td>${item.priorityResult ?? "—"}</td><td>${escapeHtml(SEU_DECISION_LABELS[item.userDecision ?? ""] ?? "—")}</td><td>${escapeHtml(item.decisionReason ?? "—")}</td><td>${item.assessmentYear}</td></tr>`).join("")}
         </table>` : "";
    const coverClass = snapshot.coverStyle === "compact" ? "cover cover-compact" : "cover";
    const subtitleHtml = snapshot.subtitle ? `<p>${escapeHtml(snapshot.subtitle)}</p>` : "";
    const documentNumberHtml = snapshot.documentNumber ? `<p><strong>Dokuman No:</strong> ${escapeHtml(snapshot.documentNumber)}</p>` : "";
    const revisionHtml = snapshot.revisionNumber ? `<p><strong>Revizyon:</strong> ${escapeHtml(snapshot.revisionNumber)}</p>` : "";
    const signatureHtml = snapshot.showSignatureFields
      ? `<p><strong>Hazirlayan:</strong> ${escapeHtml(snapshot.preparedBy ?? "")} | <strong>Kontrol:</strong> ${escapeHtml(snapshot.checkedBy ?? "")} | <strong>Onay:</strong> ${escapeHtml(snapshot.approvedBy ?? "")}</p>`
      : "";
    const footerText = snapshot.footerText ?? "Bu rapor ISO 50001 Enerji Yonetim Sistemi kapsaminda otomatik olarak uretilmistir.";
    const annualSectionFragments: Record<string, string> = {
      cover: `<div class="${coverClass}">
        <h1>${escapeHtml(snapshot.title)} — ${yr}</h1>
        ${subtitleHtml}
        <p><strong>Firma:</strong> ${escapeHtml(snapshot.companyName)} | <strong>Birim:</strong> ${escapeHtml(snapshot.unitLabel)}</p>
        <p><strong>Gizlilik:</strong> ${escapeHtml(snapshot.confidentialityLabel)} | <strong>Rapor tarihi:</strong> ${generatedDate.toLocaleDateString(locale)}</p>
        ${documentNumberHtml}
        ${revisionHtml}
        ${signatureHtml}
      </div>`,
      summary_indicators: `<div class="kpi-grid">
        <div class="kpi-box"><div class="kpi-value">${fmtAnnualNumber(Math.round(totalKwh))}</div><div class="kpi-label">Toplam Enerji (kWh)</div></div>
        <div class="kpi-box"><div class="kpi-value">${fmtAnnualNumber(Math.round(totalTep * 1000) / 1000, 3)}</div><div class="kpi-label">Toplam TEP</div></div>
        <div class="kpi-box"><div class="kpi-value">${fmtAnnualNumber(Math.round(totalCo2 * 10) / 10, 1)}</div><div class="kpi-label">CO₂ Emisyonu (ton)</div></div>
      </div>
      <p>Aktif Sayaç Sayısı: ${meters.length} | Toplam ÖEK: ${acceptedSeuCount}</p>`,
      monthly_consumption: `<table>
        <tr><th>Ay</th><th>kWh</th><th>TEP</th><th>CO₂ (ton)</th></tr>
        ${annualTableRows}
        <tr style="font-weight:600; background:#f1f5f9"><td>TOPLAM</td><td>${fmtAnnualNumber(Math.round(totalKwh))}</td><td>${fmtAnnualNumber(Math.round(totalTep * 1000) / 1000, 3)}</td><td>${fmtAnnualNumber(Math.round(totalCo2 * 10) / 10, 1)}</td></tr>
      </table>`,
      swot: annualSwotHtml,
      risks: annualRiskHtml,
      seu: annualSeuHtml,
      regression: "",
    };
    const renderedAnnualSectionsHtml = visibleAnnualEnergySections(snapshot)
      .map((section) => section.code === "cover"
        ? annualSectionFragments.cover
        : `<h2>${escapeHtml(section.finalTitle)}</h2>\n${annualSectionFragments[section.code] ?? ""}`)
      .join("\n\n");

    const htmlContent = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(snapshot.title)} ${yr}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 900px; margin: 0 auto; padding: 40px; color: #1a202c; }
    h1 { color: #0f766e; border-bottom: 3px solid #0f766e; padding-bottom: 10px; }
    h2 { color: #1e3a5f; margin-top: 30px; }
    .cover { margin-bottom: 28px; }
    .cover-compact { margin-bottom: 18px; }
    .cover-compact h1 { font-size: 22px; padding-bottom: 6px; }
    .cover p { color: #64748b; font-size: 13px; margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 20px 0; }
    .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
    .kpi-value { font-size: 28px; font-weight: 700; color: #0f766e; }
    .kpi-label { font-size: 12px; color: #64748b; margin-top: 4px; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 16px; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  ${renderedAnnualSectionsHtml}

  <div class="footer">
    ${escapeHtml(footerText)}<br>
    Rapor ID: ${report.id} | Snapshot ID: ${snapshotRecordId} | Cikti adi: ${escapeHtml(snapshot.outputName)} | Gizlilik: ${escapeHtml(snapshot.confidentialityLabel)}
  </div>
</body>
</html>`;

    const htmlBuffer = Buffer.from(htmlContent, "utf8");
    const archiveResult = await completeReportArchive({
      request: req,
      archiveId: archiveRecordId,
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      reportType: ANNUAL_ENERGY_REPORT_TYPE,
      reportYear: yr,
      outputName: snapshot.outputName,
      contentType: "text/html; charset=utf-8",
      content: htmlBuffer,
      snapshotId: snapshotRecordId,
    });

    const [updated] = await db.update(reportsTable)
      .set({ status: "complete", downloadUrl: null })
      .where(and(eq(reportsTable.id, report.id), eq(reportsTable.companyId, effectiveCompanyId)))
      .returning();

    await writeBestEffortAudit(db, {
      request: req,
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      action: "annual_energy_performance_report.generation_completed",
      entityType: "report",
      entityId: report.id,
      metadata: completedAuditMetadata,
    });

    res.json({
      id: updated.id,
      year: updated.year,
      status: updated.status,
      downloadUrl: `/api/reports/archive/${archiveRecordId}/download`,
      dataUrl: `data:text/html;base64,${htmlBuffer.toString("base64")}`,
      archiveId: archiveRecordId,
      sizeBytes: archiveResult.sizeBytes,
      checksumSha256: archiveResult.checksumSha256,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    if (archiveRecordId !== null) {
      await failReportArchive({
        request: req,
        archiveId: archiveRecordId,
        companyId: snapshotForFailure?.companyId ?? req.user?.companyId ?? null,
        unitId: snapshotForFailure?.unitId ?? req.user?.unitId ?? null,
        reportType: ANNUAL_ENERGY_REPORT_TYPE,
        snapshotId: snapshotRecordId,
        outputName: snapshotForFailure?.outputName ?? null,
        failureCategory: err instanceof AnnualEnergyReportSnapshotError ? "settings_snapshot" : reportStorageFailureCategory(err, "render_or_storage"),
      });
    }
    if (snapshotRecordId !== null) {
      await db.update(reportGenerationSnapshotsTable)
        .set({
          status: "failed",
          storageStatus: "storage_failed",
          failedAt: new Date(),
          failureReason: reportStorageFailureCategory(err, err instanceof AnnualEnergyReportSnapshotError ? "settings_snapshot" : "render_or_storage"),
        })
        .where(eq(reportGenerationSnapshotsTable.id, snapshotRecordId));
      await writeBestEffortAudit(db, {
        request: req,
        companyId: snapshotForFailure?.companyId ?? req.user?.companyId ?? null,
        unitId: snapshotForFailure?.unitId ?? req.user?.unitId ?? null,
        action: "annual_energy_performance_report.generation_failed",
        entityType: "report",
        entityId: reportId,
        outcome: "failure",
        metadata: {
          reportType: ANNUAL_ENERGY_REPORT_TYPE,
          reportId,
          snapshotId: snapshotRecordId,
          year: snapshotForFailure?.year ?? null,
          profileVersion: snapshotForFailure?.profileVersion ?? null,
          typeSettingsVersion: snapshotForFailure?.typeSettingsVersion ?? null,
          outputName: snapshotForFailure?.outputName ?? null,
          sectionCodes: snapshotForFailure?.sections.filter((section) => section.finalVisibility).map((section) => section.code) ?? [],
          legacyOverrides: snapshotForFailure ? Object.values(snapshotForFailure.legacyOverrides).map((override) => override.param) : [],
          ...(dataManifestForFailure ? manifestAuditMetadata(dataManifestForFailure) : {}),
          failureCategory: err instanceof AnnualEnergyReportSnapshotError ? "settings_snapshot" : reportStorageFailureCategory(err, "render_or_update"),
        },
      });
    }
    if (reportId !== null) {
      await db.update(reportsTable)
        .set({ status: "failed" })
        .where(eq(reportsTable.id, reportId));
    }
    if (err instanceof AnnualEnergyReportSnapshotError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ── Label maps ──────────────────────────────────────────────────────────────
const TARGET_STATUS_LABELS: Record<string, string> = {
  active: "Aktif", completed: "Tamamlandı", cancelled: "İptal", on_hold: "Beklemede",
};
const ACTION_STATUS_LABELS: Record<string, string> = {
  planned: "Planlandı", in_progress: "Devam Ediyor", completed: "Tamamlandı",
  cancelled: "İptal", on_hold: "Beklemede",
};
const FEASIBILITY_STATUS_LABELS: Record<string, string> = {
  not_started: "Başlanmadı", in_progress: "Devam Ediyor", completed: "Tamamlandı",
  approved: "Onaylandı", rejected: "Reddedildi",
};

// GET /api/reports/energy-targets/pdf
router.get("/reports/energy-targets/pdf", requireAuth, async (req, res) => {
  let snapshotRecordId: number | null = null;
  let archiveRecordId: number | null = null;
  let snapshotForFailure: EnergyTargetsReportSnapshot | null = null;
  let dataManifestForFailure: ReportDataManifestV1 | null = null;
  try {
    const statusParam = parseTargetReportStatus(req.query.status);
    const legacyOverrides = parseEnergyTargetsLegacyOverrides({
      includeVap: req.query.includeVap,
      includeProgress: req.query.includeProgress,
    });
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const effectiveCompanyId = scope.companyId;

    // ── Auth / scope ─────────────────────────────────────────────────────────
    const yearParam = parseReportYear(req.query.year ?? new Date().getFullYear());

    // ── Fetch targets (baselineYear <= year <= targetYear) ────────────────────
    // Auth scope mirrors targets.ts: admin → companyId filter; superadmin → no companyId filter; user → own unitId
    const targetConditions: SQL[] = [
      lte(energyTargetsTable.baselineYear, yearParam),
      gte(energyTargetsTable.targetYear, yearParam),
    ];

    const resolvedUnitId = scope.unitId;
    targetConditions.push(eq(energyTargetsTable.companyId, effectiveCompanyId));
    if (resolvedUnitId !== null) targetConditions.push(eq(energyTargetsTable.unitId, resolvedUnitId));

    if (statusParam) targetConditions.push(eq(energyTargetsTable.status, statusParam));

    const targets = await db
      .select({
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
      })
      .from(energyTargetsTable)
      .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
      .where(and(...targetConditions))
      .orderBy(energyTargetsTable.createdAt);

    const targetIds = targets.map((t) => t.id);

    // ── Fetch action plans ────────────────────────────────────────────────────
    const actions =
      targetIds.length > 0
        ? await db
            .select()
            .from(energyActionPlansTable)
            .where(and(
              inArray(energyActionPlansTable.targetId, targetIds),
              eq(energyActionPlansTable.companyId, effectiveCompanyId),
            ))
            .orderBy(energyActionPlansTable.createdAt)
        : [];

    const actionsByTarget: Record<number, typeof actions> = {};
    for (const a of actions) {
      if (!actionsByTarget[a.targetId]) actionsByTarget[a.targetId] = [];
      actionsByTarget[a.targetId].push(a);
    }

    // ── Fetch latest progress per target (scoped to yearParam) ───────────────
    const progressLatestMap: Record<number, { actualValue: number; actualSavingValue: number | null; periodYear: number; periodMonth: number | null; comment: string | null }> = {};
    if (targetIds.length > 0) {
      const yearProgress = await db
        .select()
        .from(energyTargetProgressTable)
        .where(and(
          inArray(energyTargetProgressTable.targetId, targetIds),
          eq(energyTargetProgressTable.periodYear, yearParam),
          eq(energyTargetProgressTable.companyId, effectiveCompanyId),
        ))
        .orderBy(desc(energyTargetProgressTable.recordedAt));

      for (const p of yearProgress) {
        if (!progressLatestMap[p.targetId]) {
          progressLatestMap[p.targetId] = {
            actualValue: p.actualValue,
            actualSavingValue: p.actualSavingValue ?? null,
            periodYear: p.periodYear,
            periodMonth: p.periodMonth ?? null,
            comment: p.comment ?? null,
          };
        }
      }
    }

    // ── Fetch chronology progress rows (yearParam only) ───────────────────────
    const allProgressRows =
      targetIds.length > 0
        ? await db
            .select()
            .from(energyTargetProgressTable)
            .where(and(
              inArray(energyTargetProgressTable.targetId, targetIds),
              eq(energyTargetProgressTable.periodYear, yearParam),
              eq(energyTargetProgressTable.companyId, effectiveCompanyId),
            ))
            .orderBy(energyTargetProgressTable.targetId, energyTargetProgressTable.periodYear, energyTargetProgressTable.periodMonth)
        : [];

    // ── Fetch VAP projects via action plan join ───────────────────────────────
    const vapActionIds = actions.filter((a) => a.isVap).map((a) => a.id);
    const vapProjects =
      vapActionIds.length > 0
        ? await db
            .select()
            .from(vapProjectsTable)
            .where(and(
              inArray(vapProjectsTable.actionPlanId, vapActionIds),
              eq(vapProjectsTable.companyId, effectiveCompanyId),
            ))
            .orderBy(vapProjectsTable.createdAt)
        : [];

    // ── Build unit label for header ───────────────────────────────────────────
    let unitLabel = "Tüm Birimler";
    if (resolvedUnitId !== null) {
      const unitRow = targets.find((t) => t.unitId === resolvedUnitId);
      if (unitRow?.unitName) unitLabel = unitRow.unitName;
      else {
        const [fallbackUnit] = await db.select({ name: unitsTable.name })
          .from(unitsTable)
          .where(and(eq(unitsTable.id, resolvedUnitId), eq(unitsTable.companyId, effectiveCompanyId)))
          .limit(1);
        if (fallbackUnit?.name) unitLabel = fallbackUnit.name;
      }
    }
    const unitLabelHtml = escapeHtml(unitLabel);

    const [company] = await db.select({
      name: companiesTable.name,
      legalName: companiesTable.legalName,
      shortName: companiesTable.shortName,
      address: companiesTable.address,
    })
      .from(companiesTable)
      .where(eq(companiesTable.id, effectiveCompanyId))
      .limit(1);
    if (!company) throw new ReportScopeError(400, "Gecersiz companyId");
    const companyIdentity = await readCompanyPdfIdentity(effectiveCompanyId);

    const effectiveSettings = await resolveEffectiveCompanyReportSettings({
      companyId: effectiveCompanyId,
      reportType: ENERGY_TARGETS_REPORT_TYPE,
    });
    const snapshot = buildEnergyTargetsReportSnapshot({
      effective: effectiveSettings,
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      companyName: company.name,
      companyLegalName: companyIdentity?.legalName ?? null,
      companyShortName: companyIdentity?.shortName ?? null,
      companyAddress: companyIdentity?.address ?? null,
      unitLabel,
      year: yearParam,
      generatedAt: new Date(),
      generatedBy: req.user?.userId ?? null,
      hasVapProjects: vapProjects.length > 0,
      hasProgressRows: allProgressRows.length > 0,
      legacyOverrides,
    });
    snapshotForFailure = snapshot;
    const [snapshotRecord] = await db.insert(reportGenerationSnapshotsTable).values({
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      reportType: ENERGY_TARGETS_REPORT_TYPE,
      year: yearParam,
      status: "generating",
      storageStatus: "not_stored",
      filename: snapshot.filename,
      settingsSnapshot: snapshot,
      generatedBy: req.user?.userId ?? null,
    }).returning({ id: reportGenerationSnapshotsTable.id });
    snapshotRecordId = snapshotRecord.id;
    archiveRecordId = await createReportArchiveRecord({
      request: req,
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      reportType: ENERGY_TARGETS_REPORT_TYPE,
      reportYear: yearParam,
      periodLabel: String(yearParam),
      title: snapshot.title,
      outputName: snapshot.filename,
      contentType: "application/pdf",
      snapshotId: snapshotRecordId,
    });

    const auditMetadata = {
      companyId: effectiveCompanyId,
      reportType: ENERGY_TARGETS_REPORT_TYPE,
      snapshotId: snapshotRecordId,
      archiveId: archiveRecordId,
      profileVersion: snapshot.profileVersion,
      typeSettingsVersion: snapshot.typeSettingsVersion,
      filename: snapshot.filename,
      outputName: snapshot.filename,
      sectionCodes: snapshot.sections.filter((section) => section.visibilityResult).map((section) => section.code),
      legacyOverrideUsed: Object.keys(legacyOverrides).length > 0,
    };
    await writeBestEffortAudit(db, {
      request: req,
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      action: "energy_targets_report.generation_started",
      entityType: "report_generation_snapshot",
      entityId: snapshotRecordId,
      metadata: auditMetadata,
    });

    const dataManifest = buildEnergyTargetsReportDataManifest({
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      year: yearParam,
      generatedAt: snapshot.generatedAt,
      settings: reportManifestSettings(snapshot),
      filters: {
        status: statusParam ?? null,
        includeVap: legacyOverrides.vap_portfolio?.value ?? null,
        includeProgress: legacyOverrides.progress_chronology?.value ?? null,
      },
      targets,
      actions,
      progressRows: allProgressRows,
      vapProjects,
    });
    dataManifestForFailure = dataManifest;
    await persistReportDataManifest(snapshotRecordId, dataManifest);
    const completedAuditMetadata = { ...auditMetadata, ...manifestAuditMetadata(dataManifest) };

    // ── Summary stats ─────────────────────────────────────────────────────────
    const totalTargets = targets.length;
    const activeTargets = targets.filter((t) => t.status === "active").length;
    const completedTargets = targets.filter((t) => t.status === "completed").length;
    const openActions = actions.filter((a) => a.status === "planned" || a.status === "in_progress").length;
    const today = new Date();
    const overdueActions = actions.filter((a) =>
      (a.status === "planned" || a.status === "in_progress") && a.dueDate && new Date(a.dueDate) < today
    ).length;
    const vapCount = vapProjects.length;
    const totalCostSaving = vapProjects.reduce((s, v) => s + (v.annualCostSaving ?? 0), 0);
    const totalInvestment = vapProjects.reduce((s, v) => s + (v.investmentCost ?? 0), 0);
    const locale = snapshot.locale;
    const generatedDate = new Date(snapshot.generatedAt);

    // ── HTML helpers ──────────────────────────────────────────────────────────
    const fmtNum = (n: number | null | undefined, dec = 0) =>
      n != null ? n.toLocaleString(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";
    const fmtDate = (d: string | null | undefined) => escapeHtml(d ?? "—");
    const statusBadge = (s: string | null | undefined) => {
      const statusClass = escapeHtml(s ?? "active");
      const statusText = escapeHtml(TARGET_STATUS_LABELS[s ?? ""] ?? s ?? "—");
      return `<span class="badge badge-${statusClass}">${statusText}</span>`;
    };
    const actionBadge = (s: string | null | undefined) => {
      const statusClass = escapeHtml(s ?? "planned");
      const statusText = escapeHtml(ACTION_STATUS_LABELS[s ?? ""] ?? s ?? "—");
      return `<span class="badge badge-${statusClass}">${statusText}</span>`;
    };

    // ── Section: targets table ────────────────────────────────────────────────
    const targetsHtml = targets.length > 0
      ? `<table>
          <tr>
            <th>Hedef Adı</th><th>Amaç</th><th>Hedef Metni</th><th>Birim</th>
            <th>Baz Yıl</th><th>Hedef Yıl</th><th>Baz Değer</th><th>Hedef Değer</th>
            <th>Son Gerçekleşme (${yearParam})</th><th>Durum</th>
          </tr>
          ${targets.map((t) => {
            const latest = progressLatestMap[t.id];
            const actualDisplay = latest
              ? `${fmtNum(latest.actualValue, 2)} ${escapeHtml(t.unitLabel ?? "")}`.trim()
              : "Gerçekleşme girilmedi";
            return `<tr>
              <td><strong>${escapeHtml(t.name)}</strong></td>
              <td>${escapeHtml(t.objectiveText?.trim() || "Tanımlanmadı")}</td>
              <td>${escapeHtml(t.targetText?.trim() || "Tanımlanmadı")}</td>
              <td>${escapeHtml(t.unitName ?? "—")}</td>
              <td>${t.baselineYear}</td>
              <td>${t.targetYear}</td>
              <td>${fmtNum(t.baselineValue, 2)} ${escapeHtml(t.unitLabel ?? "")}</td>
              <td>${fmtNum(t.targetValue, 2)} ${escapeHtml(t.unitLabel ?? "")}</td>
              <td>${actualDisplay}</td>
              <td>${statusBadge(t.status)}</td>
            </tr>`;
          }).join("")}
        </table>`
      : "<p>Bu kapsam ve yıl için kayıtlı enerji hedefi bulunamadı.</p>";

    // ── Section: action plans table ───────────────────────────────────────────
    const actionsHtml = actions.length > 0
      ? `<table>
          <tr>
            <th>Bağlı Hedef</th><th>Eylem Adı</th><th>Sorumlu</th>
            <th>Başlangıç</th><th>Bitiş</th><th>Durum</th><th>İlerleme</th>
            <th>Beklenen Tasarruf</th><th>VAP mı?</th>
          </tr>
          ${actions.map((a) => {
            const targetName = targets.find((t) => t.id === a.targetId)?.name ?? "—";
            const saving = a.expectedSavingValue != null
              ? `${fmtNum(a.expectedSavingValue, 2)} ${escapeHtml(a.expectedSavingUnit ?? "")}`
              : "—";
            return `<tr>
              <td>${escapeHtml(targetName)}</td>
              <td>${escapeHtml(a.title)}</td>
              <td>${escapeHtml(a.responsibleName ?? "—")}</td>
              <td>${fmtDate(a.startDate)}</td>
              <td>${fmtDate(a.dueDate)}</td>
              <td>${actionBadge(a.status)}</td>
              <td>${a.progressPercent != null ? `%${a.progressPercent}` : "—"}</td>
              <td>${saving}</td>
              <td>${a.isVap ? "<strong>Evet</strong>" : "Hayır"}</td>
            </tr>`;
          }).join("")}
        </table>`
      : "<p>Bu hedeflere bağlı eylem planı bulunamadı.</p>";

    // ── Section: VAP portfolio ────────────────────────────────────────────────
    const vapHtml = vapProjects.length > 0
      ? `<table>
            <tr>
              <th>Proje Kodu</th><th>Proje Adi</th><th>Bagli Eylem</th>
              <th>Yatirim (TRY)</th><th>Yillik Mali Tasarruf (TRY)</th>
              <th>Yillik Enerji Tasarrufu</th><th>Geri Odeme (ay)</th><th>Fizibilite</th>
            </tr>
            ${vapProjects.map((v) => {
              const linkedAction = actions.find((a) => a.id === v.actionPlanId);
              const energySaving = v.annualEnergySavingValue != null
                ? `${fmtNum(v.annualEnergySavingValue, 2)} ${escapeHtml(v.annualEnergySavingUnit ?? "")}`.trim()
                : "Henuz girilmedi";
              return `<tr>
                <td>${escapeHtml(v.projectCode ?? "-")}</td>
                <td>${escapeHtml(v.projectTitle)}</td>
                <td>${escapeHtml(linkedAction?.title ?? "-")}</td>
                <td>${fmtNum(v.investmentCost, 0)}</td>
                <td>${fmtNum(v.annualCostSaving, 0)}</td>
                <td>${energySaving}</td>
                <td>${fmtNum(v.paybackMonths, 1)}</td>
                <td>${escapeHtml(FEASIBILITY_STATUS_LABELS[v.feasibilityStatus ?? ""] ?? v.feasibilityStatus ?? "-")}</td>
              </tr>`;
            }).join("")}
          </table>`
      : "";

    const progressHtml = allProgressRows.length > 0
      ? `<table>
            <tr>
              <th>Hedef Adi</th><th>Donem</th><th>Gerceklesen Deger</th><th>Tasarruf</th><th>Aciklama</th>
            </tr>
            ${allProgressRows.map((p) => {
              const targetName = targets.find((t) => t.id === p.targetId)?.name ?? "-";
              const period = p.periodMonth ? `${MONTH_NAMES[p.periodMonth]} ${p.periodYear}` : String(p.periodYear);
              return `<tr>
                <td>${escapeHtml(targetName)}</td>
                <td>${period}</td>
                <td>${fmtNum(p.actualValue, 2)}</td>
                <td>${p.actualSavingValue != null ? fmtNum(p.actualSavingValue, 2) : "-"}</td>
                <td>${escapeHtml(p.comment ?? "-")}</td>
              </tr>`;
            }).join("")}
          </table>`
      : "";

    const executiveSummaryHtml = `<div class="kpi-grid">
    <div class="kpi-box"><div class="kpi-value">${totalTargets}</div><div class="kpi-label">Toplam Hedef</div></div>
    <div class="kpi-box"><div class="kpi-value">${activeTargets}</div><div class="kpi-label">Aktif Hedef</div></div>
    <div class="kpi-box"><div class="kpi-value">${completedTargets}</div><div class="kpi-label">Tamamlanan Hedef</div></div>
    <div class="kpi-box"><div class="kpi-value">${openActions}</div><div class="kpi-label">Acik Eylem</div></div>
    <div class="kpi-box"><div class="kpi-value">${overdueActions}</div><div class="kpi-label">Gecikmis Eylem</div></div>
    <div class="kpi-box"><div class="kpi-value">${vapCount}</div><div class="kpi-label">VAP Sayisi</div></div>
    <div class="kpi-box"><div class="kpi-value">${fmtNum(totalCostSaving, 0)} TRY</div><div class="kpi-label">Toplam Yillik Mali Tasarruf</div></div>
    <div class="kpi-box"><div class="kpi-value">${fmtNum(totalInvestment, 0)} TRY</div><div class="kpi-label">Toplam Yatirim</div></div>
  </div>`;

    const sectionFragments: Record<string, string> = {
      executive_summary: executiveSummaryHtml,
      energy_targets: targetsHtml,
      action_plans: actionsHtml,
      vap_portfolio: vapHtml,
      progress_chronology: progressHtml,
    };
    const renderedSectionsHtml = visibleEnergyTargetsSections(snapshot)
      .filter((section) => section.code !== "cover")
      .map((section, index) => `${buildCorporateSectionHeading(index + 1, section.finalTitle)}\n${sectionFragments[section.code] ?? ""}`)
      .join("\n\n");
    const coverClass = snapshot.coverStyle === "compact" ? "cover cover-compact" : "cover";
    const subtitleHtml = snapshot.subtitle ? `<p>${escapeHtml(snapshot.subtitle)}</p>` : "";
    const documentNumberHtml = snapshot.documentNumber ? `<p><strong>Dokuman No:</strong> ${escapeHtml(snapshot.documentNumber)}</p>` : "";
    const revisionHtml = snapshot.revisionNumber ? `<p><strong>Revizyon:</strong> ${escapeHtml(snapshot.revisionNumber)}</p>` : "";
    const signatureHtml = snapshot.showSignatureFields
      ? `<p><strong>Hazirlayan:</strong> ${escapeHtml(snapshot.preparedBy ?? "")} | <strong>Kontrol:</strong> ${escapeHtml(snapshot.checkedBy ?? "")} | <strong>Onay:</strong> ${escapeHtml(snapshot.approvedBy ?? "")}</p>`
      : "";
    const footerText = snapshot.footerText ?? "Bu rapor ISO 50001 Enerji Yonetim Sistemi kapsaminda otomatik olarak uretilmistir.";

    // ── Full HTML ─────────────────────────────────────────────────────────────
    const htmlContent = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Hedef, Eylem Planı ve VAP Yönetim Raporu — ${yearParam}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1100px; margin: 0 auto; padding: 40px; color: #1a202c; }
    h1 { color: #0f766e; border-bottom: 3px solid #0f766e; padding-bottom: 10px; font-size: 22px; }
    h2 { color: #1e3a5f; margin-top: 36px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 7px 10px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 600; color: #1e3a5f; }
    tr:nth-child(even) td { background: #f8fafc; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 18px 0; }
    .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center; }
    .kpi-value { font-size: 26px; font-weight: 700; color: #0f766e; }
    .kpi-label { font-size: 11px; color: #64748b; margin-top: 4px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .badge-active { background: #d1fae5; color: #065f46; }
    .badge-completed { background: #dbeafe; color: #1d4ed8; }
    .badge-cancelled { background: #fee2e2; color: #991b1b; }
    .badge-on_hold { background: #fef3c7; color: #92400e; }
    .badge-planned { background: #e0f2fe; color: #0369a1; }
    .badge-in_progress { background: #fef9c3; color: #713f12; }
    .cover { margin-bottom: 32px; }
    .cover-compact { margin-bottom: 18px; }
    .cover-compact h1 { font-size: 18px; padding-bottom: 6px; }
    .cover p { color: #64748b; font-size: 14px; margin: 4px 0; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 14px; color: #94a3b8; font-size: 11px; }
  </style>
</head>
<body>

  <div class="${coverClass}">
    <h1>${escapeHtml(snapshot.title)}</h1>
    ${subtitleHtml}
    <p><strong>Gizlilik:</strong> ${escapeHtml(snapshot.confidentialityLabel)}</p>
    <p><strong>Yil:</strong> ${yearParam}</p>
    <p><strong>Birim:</strong> ${unitLabelHtml}</p>
    ${documentNumberHtml}
    ${revisionHtml}
    <p><strong>Olusturma Tarihi:</strong> ${generatedDate.toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" })}</p>
    ${signatureHtml}
    <p style="margin-top:10px; padding:8px 12px; background:#f0fdf4; border-left:3px solid #0f766e; font-size:13px; color:#065f46;">
      Bu rapor, secili yilda aktif olan hedefleri ve secili yila ait gerceklesme kayitlarini icerir.
    </p>
  </div>
  ${renderedSectionsHtml}

  <div class="footer">
    ${escapeHtml(footerText)}
    Referans Yil: ${yearParam} | Birim: ${unitLabelHtml} | Gizlilik: ${escapeHtml(snapshot.confidentialityLabel)} | Uretim: ${generatedDate.toLocaleString(locale)}
  </div>
</body>
</html>`;

    const corporatePdf = buildCorporateReportHtml({
      identity: {
        companyName: snapshot.companyName,
        companyLegalName: snapshot.companyLegalName,
        companyShortName: snapshot.companyShortName,
        companyAddress: snapshot.companyAddress,
        reportTitle: snapshot.title,
        reportDisplayName: snapshot.reportDisplayName,
        reportPeriod: String(yearParam),
        unitLabel: snapshot.unitLabel,
        documentNumber: snapshot.documentNumber,
        revisionNumber: snapshot.revisionNumber,
        revisionDate: snapshot.revisionDate,
        preparedBy: snapshot.preparedBy,
        checkedBy: snapshot.checkedBy,
        approvedBy: snapshot.approvedBy,
        confidentialityLabel: snapshot.confidentialityLabel,
        footerText: snapshot.footerText,
        generatedAt: generatedDate,
        generatedByName: req.user?.name ?? null,
        locale,
        showSignatureFields: snapshot.showSignatureFields,
        showPageNumbers: snapshot.showPageNumbers,
        logoDataUri: snapshot.showLogo ? logoBufferToDataUri({ mimeType: effectiveSettings.logo?.mimeType, content: effectiveSettings.logo?.content }) : null,
        logoAltText: snapshot.logo?.altText ?? null,
      },
      bodyHtml: `<p class="report-note">Bu rapor, secili yilda aktif olan hedefleri ve secili yila ait gerceklesme kayitlarini icerir.</p>${renderedSectionsHtml}`,
      extraCss: `
        .report-note { margin:0 0 18px; padding:8px 12px; background:#f0fdf4; border-left:3px solid #0f766e; font-size:12px; color:#065f46; page-break-inside:avoid; }
        .kpi-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:16px 0; }
        .kpi-box { background:#f8fafc; border:1px solid #e2e8f0; padding:12px; text-align:center; }
        .kpi-value { font-size:22px; font-weight:700; color:#0f766e; }
        .kpi-label { font-size:10px; color:#64748b; margin-top:4px; }
        .badge { display:inline-block; padding:2px 7px; border-radius:3px; font-size:10px; font-weight:700; }
        .badge-active { background:#d1fae5; color:#065f46; }
        .badge-completed { background:#dbeafe; color:#1d4ed8; }
        .badge-cancelled { background:#fee2e2; color:#991b1b; }
        .badge-on_hold { background:#fef3c7; color:#92400e; }
        .badge-planned { background:#e0f2fe; color:#0369a1; }
        .badge-in_progress { background:#fef9c3; color:#713f12; }
      `,
    });

    const pdf = await renderHtmlToPdf({
      html: corporatePdf.html,
      title: `Enerji Hedefleri ${yearParam}`,
      landscape: true,
      displayHeaderFooter: corporatePdf.displayHeaderFooter,
      headerTemplate: corporatePdf.headerTemplate,
      footerTemplate: corporatePdf.footerTemplate,
    });
    await completeReportArchive({
      request: req,
      archiveId: archiveRecordId,
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      reportType: ENERGY_TARGETS_REPORT_TYPE,
      reportYear: yearParam,
      outputName: snapshot.filename,
      contentType: "application/pdf",
      content: pdf,
      snapshotId: snapshotRecordId,
    });
    await writeBestEffortAudit(db, {
      request: req,
      companyId: effectiveCompanyId,
      unitId: resolvedUnitId,
      action: "energy_targets_report.generation_completed",
      entityType: "report_generation_snapshot",
      entityId: snapshotRecordId,
      metadata: completedAuditMetadata,
    });
    const filename = snapshot.filename;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": safeContentDisposition(filename),
      "Cache-Control": "no-store",
      "Content-Length": String(pdf.length),
    });
    res.status(200).send(pdf);
  } catch (err) {
    if (archiveRecordId !== null) {
      await failReportArchive({
        request: req,
        archiveId: archiveRecordId,
        companyId: snapshotForFailure?.companyId ?? req.user?.companyId ?? null,
        unitId: snapshotForFailure?.unitId ?? req.user?.unitId ?? null,
        reportType: ENERGY_TARGETS_REPORT_TYPE,
        snapshotId: snapshotRecordId,
        outputName: snapshotForFailure?.filename ?? null,
        failureCategory: err instanceof ReportSettingsSnapshotError ? "settings_snapshot" : reportStorageFailureCategory(err, "render_or_storage"),
      });
    }
    if (snapshotRecordId !== null) {
      await db.update(reportGenerationSnapshotsTable)
        .set({
          status: "failed",
          storageStatus: "storage_failed",
          failedAt: new Date(),
          failureReason: reportStorageFailureCategory(err, err instanceof ReportSettingsSnapshotError ? "settings_snapshot" : "render_or_storage"),
        })
        .where(eq(reportGenerationSnapshotsTable.id, snapshotRecordId));
      await writeBestEffortAudit(db, {
        request: req,
        companyId: snapshotForFailure?.companyId ?? req.user?.companyId ?? null,
        unitId: snapshotForFailure?.unitId ?? req.user?.unitId ?? null,
        action: "energy_targets_report.generation_failed",
        entityType: "report_generation_snapshot",
        entityId: snapshotRecordId,
        outcome: "failure",
        metadata: {
          reportType: ENERGY_TARGETS_REPORT_TYPE,
          snapshotId: snapshotRecordId,
          profileVersion: snapshotForFailure?.profileVersion ?? null,
          typeSettingsVersion: snapshotForFailure?.typeSettingsVersion ?? null,
          filename: snapshotForFailure?.filename ?? null,
          sectionCodes: snapshotForFailure?.sections.filter((section) => section.visibilityResult).map((section) => section.code) ?? [],
          legacyOverrideUsed: snapshotForFailure?.sections.some((section) => section.legacyOverride !== null) ?? false,
          ...(dataManifestForFailure ? manifestAuditMetadata(dataManifestForFailure) : {}),
        },
      });
    }
    if (err instanceof ReportSettingsSnapshotError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor uretme hatasi" });
  }
});

router.get("/reports/energy-performance/pdf", requireAuth, async (req, res) => {
  let snapshotRecordId: number | null = null;
  let archiveRecordId: number | null = null;
  let snapshotForFailure: EnergyPerformanceReportSnapshot | null = null;
  let dataManifestForFailure: ReportDataManifestV1 | null = null;
  try {
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    const baselineId = parseRequiredId(req.query.baselineId, "baselineId");
    const year = parseReportYear(req.query.year ?? new Date().getFullYear());
    const baselineConditions: SQL[] = [eq(energyBaselinesTable.id, baselineId)];
    if (scope.companyId !== undefined) baselineConditions.push(eq(energyBaselinesTable.companyId, scope.companyId));
    if (scope.unitId !== null) baselineConditions.push(eq(energyBaselinesTable.unitId, scope.unitId));

    // ── Baseline + değişkenler ────────────────────────────────────────────
    const [baseline] = await db
      .select({
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
        // dependentVariableUnit: enerji kaynağının ham birimi (m³, kWh, vb.)
        // kwh kolonu rawConsumption anlamına gelir — baseline bu birimi saklar
        rawUnit: energyBaselinesTable.dependentVariableUnit,
        companyId: energyBaselinesTable.companyId,
        unitId: energyBaselinesTable.unitId,
        seuAssessmentItemId: energyBaselinesTable.seuAssessmentItemId,
      })
      .from(energyBaselinesTable)
      .where(and(...baselineConditions));

    if (!baseline) {
      res.status(404).json({ error: "EnRÇ bulunamadı" });
      return;
    }

    const effectiveCompanyId = baseline.companyId;

    const bvars = await db
      .select()
      .from(energyBaselineVariablesTable)
      .where(eq(energyBaselineVariablesTable.baselineId, baselineId))
      .orderBy(asc(energyBaselineVariablesTable.id));

    // ── SEU kalemi + birim bilgisi ────────────────────────────────────────
    let seuItemName = "—";
    let unitName = "—";
    let energySourceName = "—";

    if (baseline.seuAssessmentItemId) {
      const [seuRow] = await db
        .select({
          itemName: seuAssessmentItemsTable.name,
          unitName: unitsTable.name,
          energySourceName: energySourcesTable.name,
        })
        .from(seuAssessmentItemsTable)
        .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
        .leftJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
        .leftJoin(energySourcesTable, eq(seuAssessmentItemsTable.energySourceId, energySourcesTable.id))
        .where(and(
          eq(seuAssessmentItemsTable.id, baseline.seuAssessmentItemId),
          eq(seuAssessmentsTable.companyId, effectiveCompanyId),
          ...(scope.unitId !== null ? [eq(seuAssessmentsTable.unitId, scope.unitId)] : []),
        ));

      if (seuRow) {
        seuItemName = seuRow.itemName ?? "—";
        unitName = seuRow.unitName ?? "—";
        energySourceName = seuRow.energySourceName ?? "—";
      } else {
        throw new ReportScopeError(404, "EnRÇ ilişkisi bulunamadı");
      }
    }

    // ── EnPG sonuçları ────────────────────────────────────────────────────
    // actualConsumption ve expectedConsumption rawConsumption (ham birim) cinsinden saklanır
    const results = await db
      .select()
      .from(energyPerformanceResultsTable)
      .where(and(
        eq(energyPerformanceResultsTable.baselineId, baselineId),
        eq(energyPerformanceResultsTable.year, year),
        eq(energyPerformanceResultsTable.companyId, effectiveCompanyId),
      ))
      .orderBy(asc(energyPerformanceResultsTable.month));

    const [company] = await db.select({ name: companiesTable.name })
      .from(companiesTable)
      .where(eq(companiesTable.id, effectiveCompanyId))
      .limit(1);
    if (!company) throw new ReportScopeError(400, "Gecersiz companyId");

    const effectiveSettings = await resolveEffectiveCompanyReportSettings({
      companyId: effectiveCompanyId,
      reportType: ENERGY_PERFORMANCE_REPORT_TYPE,
    });
    const companyIdentity = await readCompanyPdfIdentity(effectiveCompanyId);
    const generatedAt = new Date();
    const technicalProfileContext = await buildTechnicalProfileReportContext({
      companyId: effectiveCompanyId,
      unitId: baseline.unitId,
      effectiveDate: endOfYearEffectiveDate(year),
    });
    const equipmentInventory = toEquipmentReportSnapshot(await buildEquipmentInventoryContext({
      companyId: effectiveCompanyId,
      unitId: baseline.unitId,
      effectiveDate: endOfYearEffectiveDate(year),
      itemLimit: 10,
    }));
    const snapshot = buildEnergyPerformanceReportSnapshot({
      effective: effectiveSettings,
      companyId: effectiveCompanyId,
      unitId: baseline.unitId,
      companyName: company.name,
      companyLegalName: companyIdentity?.legalName ?? null,
      companyShortName: companyIdentity?.shortName ?? null,
      companyAddress: companyIdentity?.address ?? null,
      unitLabel: unitName,
      year,
      baselineId,
      seuAssessmentItemId: baseline.seuAssessmentItemId ?? null,
      modelType: baseline.modelType ?? null,
      generatedAt,
      generatedBy: req.user?.userId ?? null,
      hasModelVariables: bvars.length > 0,
      technicalProfile: technicalProfileContext,
      equipmentInventory,
    });
    snapshotForFailure = snapshot;
    const [snapshotRecord] = await db.insert(reportGenerationSnapshotsTable).values({
      companyId: effectiveCompanyId,
      unitId: baseline.unitId,
      reportType: ENERGY_PERFORMANCE_REPORT_TYPE,
      year,
      status: "generating",
      storageStatus: "not_stored",
      filename: snapshot.filename,
      settingsSnapshot: snapshot,
      generatedBy: req.user?.userId ?? null,
    }).returning({ id: reportGenerationSnapshotsTable.id });
    snapshotRecordId = snapshotRecord.id;
    archiveRecordId = await createReportArchiveRecord({
      request: req,
      companyId: effectiveCompanyId,
      unitId: baseline.unitId,
      reportType: ENERGY_PERFORMANCE_REPORT_TYPE,
      reportYear: year,
      periodLabel: String(year),
      title: snapshot.title,
      outputName: snapshot.filename,
      contentType: "application/pdf",
      snapshotId: snapshotRecordId,
    });

    const auditMetadata = {
      companyId: effectiveCompanyId,
      reportType: ENERGY_PERFORMANCE_REPORT_TYPE,
      snapshotId: snapshotRecordId,
      archiveId: archiveRecordId,
      profileVersion: snapshot.profileVersion,
      typeSettingsVersion: snapshot.typeSettingsVersion,
      outputName: snapshot.filename,
      year,
      baselineId,
      seuAssessmentItemId: snapshot.seuAssessmentItemId,
      modelType: snapshot.modelType,
      technicalProfile: {
        status: snapshot.technicalProfile.status,
        effectiveDate: snapshot.technicalProfile.effectiveDate,
        snapshotId: snapshot.technicalProfile.snapshotId,
        snapshotNumber: snapshot.technicalProfile.snapshotNumber,
        warning: snapshot.technicalProfile.warning,
      },
      equipmentInventory: {
        readinessStatus: snapshot.equipmentInventory.readiness.status,
        activeEquipment: snapshot.equipmentInventory.scope.activeEquipment,
        criticalEquipment: snapshot.equipmentInventory.scope.criticalEquipment,
        energyIntensiveEquipment: snapshot.equipmentInventory.scope.energyIntensiveEquipment,
        includedCount: snapshot.equipmentInventory.source.includedCount,
        warnings: snapshot.equipmentInventory.warnings,
      },
      sectionCodes: snapshot.sections.filter((section) => section.visibilityResult).map((section) => section.code),
      requestOverrideUsed: false,
    };
    await writeBestEffortAudit(db, {
      request: req,
      companyId: effectiveCompanyId,
      unitId: baseline.unitId,
      action: "energy_performance_report.generation_started",
      entityType: "report_generation_snapshot",
      entityId: snapshotRecordId,
      metadata: auditMetadata,
    });

    const dataManifest = buildEnergyPerformanceReportDataManifest({
      companyId: effectiveCompanyId,
      unitId: baseline.unitId,
      year,
      generatedAt: snapshot.generatedAt,
      settings: reportManifestSettings(snapshot),
      filters: { baselineId },
      baseline,
      baselineVariables: bvars,
      results,
      seuAssessmentItemId: baseline.seuAssessmentItemId ?? null,
      technicalProfile: snapshot.technicalProfile,
      equipmentInventory: snapshot.equipmentInventory,
    });
    dataManifestForFailure = dataManifest;
    await persistReportDataManifest(snapshotRecordId, dataManifest);
    const completedAuditMetadata = { ...auditMetadata, ...manifestAuditMetadata(dataManifest) };

    // ── Ham birim etiketi ─────────────────────────────────────────────────
    // rawUnit: consumptionTable.kwh alanının gerçek birimi — TEP değil, m³/kWh/vb.
    const rawUnit = baseline.rawUnit ?? "ham tüketim";
    const seuItemNameHtml = escapeHtml(seuItemName);
    const unitNameHtml = escapeHtml(unitName);
    const energySourceNameHtml = escapeHtml(energySourceName);
    const rawUnitHtml = escapeHtml(rawUnit);
    const formulaTextHtml = escapeHtml(baseline.formulaText ?? "Formül kaydedilmemiş");
    const periodStartHtml = escapeHtml(baseline.periodStart);
    const periodEndHtml = escapeHtml(baseline.periodEnd);

    // ── KPI özet ─────────────────────────────────────────────────────────
    const totalActual = results.reduce((s, r) => s + (r.actualConsumption ?? 0), 0);
    const totalExpected = results.reduce((s, r) => s + (r.expectedConsumption ?? 0), 0);
    const totalDiff = totalActual - totalExpected;
    const finalCusum = results.length > 0 ? (results[results.length - 1]?.cusum ?? 0) : 0;
    // Ortalama EEI sadece expected > 0 olan aylar için (negative_expected hariç)
    const eeiRows = results.filter(r => r.eei != null && r.status !== "negative_expected");
    const avgEei = eeiRows.length > 0 ? eeiRows.reduce((s, r) => s + r.eei!, 0) / eeiRows.length : null;

    const locale = snapshot.locale;
    const fmtRaw = (v: number | null | undefined, dec = 2) =>
      v != null ? v.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";
    const fmtPct = (actual: number | null, expected: number | null) => {
      if (actual == null || expected == null || expected <= 0) return "—";
      const pct = ((actual - expected) / expected) * 100;
      return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
    };

    // ── Model tipi etiketi ────────────────────────────────────────────────
    const modelLabel = baseline.modelType === "single_regression" ? "Tekli Regresyon" : "Çoklu Regresyon";

    // ── Durum etiketi ─────────────────────────────────────────────────────
    const statusLabel = (s: string | null) => {
      if (s === "improvement") return '<span style="color:#059669;font-weight:600">✓ İyileşme</span>';
      if (s === "deterioration") return '<span style="color:#dc2626;font-weight:600">✗ Kötüleşme</span>';
      if (s === "negative_expected") return '<span style="color:#d97706" title="Regresyon formülü bu ay için sıfır veya negatif beklenen tüketim üretmiştir. EEI hesaplanmaz.">⚠ Beklenen ≤ 0</span>';
      return "—";
    };

    // ── Aylık tablo satırları ─────────────────────────────────────────────
    const tableRowsHtml = results.map(r => {
      const sapmaRaw = r.difference != null ? fmtRaw(r.difference) : "—";
      const sapmaPct = fmtPct(r.actualConsumption, r.expectedConsumption);
      const rowBg = r.status === "improvement" ? "background:#f0fdf4"
        : r.status === "deterioration" ? "background:#fef2f2"
        : r.status === "negative_expected" ? "background:#fffbeb"
        : "";
      return `<tr style="${rowBg}">
        <td>${MONTH_NAMES[r.month] ?? r.month}</td>
        <td style="text-align:right">${fmtRaw(r.actualConsumption)}</td>
        <td style="text-align:right">${r.status === "negative_expected"
          ? `<span style="color:#d97706">${fmtRaw(r.expectedConsumption)}</span>`
          : fmtRaw(r.expectedConsumption)}</td>
        <td style="text-align:right;${r.difference != null && r.difference < 0 ? "color:#059669" : r.difference != null && r.difference > 0 ? "color:#dc2626" : ""}">${sapmaRaw}</td>
        <td style="text-align:right">${sapmaPct}</td>
        <td style="text-align:right">${fmtRaw(r.cusum)}</td>
        <td style="text-align:right">${r.eei != null ? r.eei.toFixed(4) : "—"}</td>
        <td style="text-align:center">${statusLabel(r.status)}</td>
      </tr>`;
    }).join("\n");

    // ── Toplam / özet satırı ──────────────────────────────────────────────
    const diffPct = totalExpected > 0
      ? ((totalDiff / totalExpected) * 100).toFixed(1)
      : null;
    const totalRowHtml = `<tr style="font-weight:700;background:#f1f5f9;border-top:2px solid #cbd5e1">
      <td>TOPLAM / ORT.</td>
      <td style="text-align:right">${fmtRaw(totalActual)}</td>
      <td style="text-align:right">${fmtRaw(totalExpected)}</td>
      <td style="text-align:right;${totalDiff < 0 ? "color:#059669" : totalDiff > 0 ? "color:#dc2626" : ""}">${fmtRaw(totalDiff)}</td>
      <td style="text-align:right">${diffPct != null ? (parseFloat(diffPct) >= 0 ? "+" : "") + diffPct + "%" : "—"}</td>
      <td style="text-align:right">${fmtRaw(finalCusum)}</td>
      <td style="text-align:right">${avgEei != null ? avgEei.toFixed(4) : "—"}</td>
      <td style="text-align:center">—</td>
    </tr>`;

    // ── Değişkenler tablosu ───────────────────────────────────────────────
    const varsHtml = bvars.length > 0
      ? `<table>
          <tr><th>Değişken</th><th>Katsayı</th><th>Std. Hata</th><th>t İstatistiği</th><th>p Değeri</th><th>Anlamlı?</th></tr>
          ${bvars.map(v => `<tr>
            <td>${escapeHtml(v.variableName)}</td>
            <td style="text-align:right">${v.coefficient?.toFixed(6) ?? "—"}</td>
            <td style="text-align:right">${v.standardError?.toFixed(6) ?? "—"}</td>
            <td style="text-align:right">${v.tStat?.toFixed(4) ?? "—"}</td>
            <td style="text-align:right">${v.pValue?.toFixed(4) ?? "—"}</td>
            <td style="text-align:center">${v.isSignificant ? "✓ Evet" : "✗ Hayır"}</td>
          </tr>`).join("")}
        </table>`
      : "";

    // ── Negatif beklenen aylar notu ───────────────────────────────────────
    const negativeMonths = results.filter(r => r.status === "negative_expected");
    const negativeNoteHtml = negativeMonths.length > 0
      ? `<div style="margin:16px 0;padding:10px 14px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:4px;font-size:12px;color:#78350f">
          <strong>Not:</strong> ${negativeMonths.map(r => MONTH_NAMES[r.month]).join(", ")} aylarında regresyon formülü sıfır veya negatif beklenen tüketim üretmiştir.
          Bu aylar EEI ve ortalama EEI hesabına dahil edilmemiştir. Durum sütununda "Beklenen ≤ 0" olarak işaretlenmiştir.
        </div>`
      : "";
    const visibleSections = visibleEnergyPerformanceSections(snapshot);
    const visibleSectionCodes = new Set(visibleSections.map((section) => section.code));
    const sectionTitle = (code: string, fallback: string) =>
      snapshot.sections.find((section) => section.code === code)?.finalTitle ?? fallback;
    const generatedDate = new Date(snapshot.generatedAt);
    const coverClass = snapshot.coverStyle === "compact" ? "cover cover-compact" : "cover";
    const subtitleHtml = snapshot.subtitle ? `<p>${escapeHtml(snapshot.subtitle)}</p>` : "";
    const documentNumberHtml = snapshot.documentNumber ? `<p><strong>Dokuman No:</strong> ${escapeHtml(snapshot.documentNumber)}</p>` : "";
    const revisionHtml = snapshot.revisionNumber ? `<p><strong>Revizyon:</strong> ${escapeHtml(snapshot.revisionNumber)}</p>` : "";
    const signatureHtml = snapshot.showSignatureFields
      ? `<p><strong>Hazirlayan:</strong> ${escapeHtml(snapshot.preparedBy ?? "")} | <strong>Kontrol:</strong> ${escapeHtml(snapshot.checkedBy ?? "")} | <strong>Onay:</strong> ${escapeHtml(snapshot.approvedBy ?? "")}</p>`
      : "";
    const footerText = snapshot.footerText ?? "Bu rapor ISO 50001 Enerji Yonetim Sistemi kapsaminda otomatik olarak uretilmistir.";

    // ── Tam HTML ──────────────────────────────────────────────────────────
    const htmlContent = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>EnPG İzleme Raporu — ${seuItemNameHtml} — ${year}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1050px; margin: 0 auto; padding: 40px; color: #1a202c; }
    h1 { color: #0f766e; border-bottom: 3px solid #0f766e; padding-bottom: 10px; font-size: 20px; }
    h2 { color: #1e3a5f; margin-top: 28px; font-size: 15px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 7px 10px; vertical-align: top; }
    th { background: #f1f5f9; font-weight: 600; color: #1e3a5f; }
    .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 16px 0; }
    .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
    .kpi-value { font-size: 22px; font-weight: 700; color: #0f766e; }
    .kpi-label { font-size: 11px; color: #64748b; margin-top: 3px; }
    .formula-box { background: #f0fdf4; border: 1px solid #a7f3d0; border-radius: 6px; padding: 12px 16px; margin: 12px 0; font-family: monospace; font-size: 13px; color: #065f46; }
    .warning-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 10px 14px; margin: 12px 0; font-size: 12px; color: #78350f; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 12px 0; font-size: 12px; }
    .meta-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
    .meta-label { color: #64748b; margin-bottom: 3px; }
    .meta-value { font-weight: 600; color: #1e3a5f; }
    .cover { margin-bottom: 30px; }
    .cover-compact { margin-bottom: 18px; }
    .cover-compact h1 { font-size: 18px; padding-bottom: 6px; }
    .cover p { color: #64748b; font-size: 13px; margin: 4px 0; }
    .footer { margin-top: 36px; border-top: 1px solid #e2e8f0; padding-top: 14px; color: #94a3b8; font-size: 11px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>

  <div class="${coverClass}">
  <h1>${escapeHtml(snapshot.title)}</h1>
  ${subtitleHtml}
  <p><strong>Gizlilik:</strong> ${escapeHtml(snapshot.confidentialityLabel)}</p>
  ${documentNumberHtml}
  ${revisionHtml}
  ${signatureHtml}
  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">ÖEK Kalemi</div><div class="meta-value">${seuItemNameHtml}</div></div>
    <div class="meta-item"><div class="meta-label">Enerji Kaynağı</div><div class="meta-value">${energySourceNameHtml}</div></div>
    <div class="meta-item"><div class="meta-label">Birim</div><div class="meta-value">${unitNameHtml}</div></div>
    <div class="meta-item"><div class="meta-label">İzleme Yılı</div><div class="meta-value">${year}</div></div>
    <div class="meta-item"><div class="meta-label">Referans Yılı (EnRÇ)</div><div class="meta-value">${baseline.baselineYear}</div></div>
    <div class="meta-item"><div class="meta-label">Rapor Tarihi</div><div class="meta-value">${generatedDate.toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" })}</div></div>
  </div>
  </div>

  ${technicalProfileReportContextHtml(snapshot.technicalProfile)}
  ${equipmentInventoryReportContextHtml(snapshot.equipmentInventory)}

  <h2>${sectionTitle("regression_model", "Regresyon Modeli")}</h2>
  <div class="formula-box">${formulaTextHtml}</div>
  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">Model Türü</div><div class="meta-value">${modelLabel}</div></div>
    <div class="meta-item"><div class="meta-label">R²</div><div class="meta-value">${baseline.rSquared?.toFixed(4) ?? "—"}</div></div>
    <div class="meta-item"><div class="meta-label">Ayarlı R²</div><div class="meta-value">${baseline.adjustedRSquared?.toFixed(4) ?? "—"}</div></div>
    <div class="meta-item"><div class="meta-label">Örnek Sayısı</div><div class="meta-value">${baseline.sampleSize ?? "—"} ay</div></div>
    <div class="meta-item"><div class="meta-label">Referans Dönemi</div><div class="meta-value">${periodStartHtml} / ${periodEndHtml}</div></div>
    <div class="meta-item"><div class="meta-label">Bağımlı Değişken Birimi</div><div class="meta-value">${rawUnitHtml}</div></div>
  </div>

  ${visibleSectionCodes.has("model_variables") && varsHtml ? `<h2>${sectionTitle("model_variables", "Model Değişkenleri")}</h2>${varsHtml}` : ""}

  <h2>${sectionTitle("performance_summary", "Performans Özeti")} (${year})</h2>
  <div class="kpi-grid">
    <div class="kpi-box">
      <div class="kpi-value">${fmtRaw(totalActual, 0)}</div>
      <div class="kpi-label">Toplam Gerçekleşen (${rawUnitHtml})</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value">${fmtRaw(totalExpected, 0)}</div>
      <div class="kpi-label">Toplam Beklenen (${rawUnitHtml})</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value" style="color:${totalDiff < 0 ? "#059669" : "#dc2626"}">${(totalDiff >= 0 ? "+" : "") + fmtRaw(totalDiff, 0)}</div>
      <div class="kpi-label">Net Sapma (${rawUnitHtml})</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value" style="color:${finalCusum < 0 ? "#059669" : "#dc2626"}">${fmtRaw(finalCusum)}</div>
      <div class="kpi-label">CUSUM Son Değer (${rawUnitHtml})</div>
    </div>
    <div class="kpi-box">
      <div class="kpi-value" style="color:${avgEei != null && avgEei < 1 ? "#059669" : "#dc2626"}">${avgEei != null ? avgEei.toFixed(4) : "—"}</div>
      <div class="kpi-label">Ortalama EEI${negativeMonths.length > 0 ? " *" : ""}</div>
    </div>
  </div>

  ${negativeNoteHtml}

  <h2>${sectionTitle("monthly_results", "Aylık EnPG Sonuçları")} (${year})</h2>
  ${results.length > 0 ? `
  <table>
    <tr>
      <th>Ay</th>
      <th style="text-align:right">Gerçekleşen (${rawUnitHtml})</th>
      <th style="text-align:right">Beklenen (${rawUnitHtml})</th>
      <th style="text-align:right">Sapma (${rawUnitHtml})</th>
      <th style="text-align:right">Sapma (%)</th>
      <th style="text-align:right">CUSUM (${rawUnitHtml})</th>
      <th style="text-align:right">EEI</th>
      <th style="text-align:center">Durum</th>
    </tr>
    ${tableRowsHtml}
    ${totalRowHtml}
  </table>` : "<p>Bu yıl için hesaplanmış EnPG sonucu bulunamadı. Önce EnPG İzleme ekranından hesaplama yapın.</p>"}

  <div class="footer">
    ${escapeHtml(footerText)}<br>
    Bağımlı değişken birimi: <strong>${rawUnitHtml}</strong> — TEP dönüşümü bu raporda ana metrik olarak kullanılmamıştır.<br>
    Referans EnRÇ ID: ${baselineId} | İzleme Yılı: ${year} | Gizlilik: ${escapeHtml(snapshot.confidentialityLabel)} | Üretim: ${generatedDate.toLocaleString(locale)}
  </div>
</body>
</html>`;

    const performanceBodyHtml = `
  ${technicalProfileReportContextHtml(snapshot.technicalProfile)}
  ${equipmentInventoryReportContextHtml(snapshot.equipmentInventory)}

  ${buildCorporateSectionHeading(1, sectionTitle("regression_model", "Regresyon Modeli"))}
  <div class="formula-box">${formulaTextHtml}</div>
  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">Model Turu</div><div class="meta-value">${modelLabel}</div></div>
    <div class="meta-item"><div class="meta-label">R2</div><div class="meta-value">${baseline.rSquared?.toFixed(4) ?? "-"}</div></div>
    <div class="meta-item"><div class="meta-label">Ayarli R2</div><div class="meta-value">${baseline.adjustedRSquared?.toFixed(4) ?? "-"}</div></div>
    <div class="meta-item"><div class="meta-label">Ornek Sayisi</div><div class="meta-value">${baseline.sampleSize ?? "-"} ay</div></div>
    <div class="meta-item"><div class="meta-label">Referans Donemi</div><div class="meta-value">${periodStartHtml} / ${periodEndHtml}</div></div>
    <div class="meta-item"><div class="meta-label">Bagimli Degisken Birimi</div><div class="meta-value">${rawUnitHtml}</div></div>
  </div>

  ${visibleSectionCodes.has("model_variables") && varsHtml ? `${buildCorporateSectionHeading(2, sectionTitle("model_variables", "Model Degiskenleri"))}${varsHtml}` : ""}

  ${buildCorporateSectionHeading(visibleSectionCodes.has("model_variables") && varsHtml ? 3 : 2, `${sectionTitle("performance_summary", "Performans Ozeti")} (${year})`)}
  <div class="kpi-grid">
    <div class="kpi-box"><div class="kpi-value">${fmtRaw(totalActual, 0)}</div><div class="kpi-label">Toplam Gerceklesen (${rawUnitHtml})</div></div>
    <div class="kpi-box"><div class="kpi-value">${fmtRaw(totalExpected, 0)}</div><div class="kpi-label">Toplam Beklenen (${rawUnitHtml})</div></div>
    <div class="kpi-box"><div class="kpi-value diff-${totalDiff < 0 ? "good" : "bad"}">${(totalDiff >= 0 ? "+" : "") + fmtRaw(totalDiff, 0)}</div><div class="kpi-label">Net Sapma (${rawUnitHtml})</div></div>
    <div class="kpi-box"><div class="kpi-value diff-${finalCusum < 0 ? "good" : "bad"}">${fmtRaw(finalCusum)}</div><div class="kpi-label">CUSUM Son Deger (${rawUnitHtml})</div></div>
    <div class="kpi-box"><div class="kpi-value diff-${avgEei != null && avgEei < 1 ? "good" : "bad"}">${avgEei != null ? avgEei.toFixed(4) : "-"}</div><div class="kpi-label">Ortalama EEI${negativeMonths.length > 0 ? " *" : ""}</div></div>
  </div>

  ${negativeNoteHtml}

  ${buildCorporateSectionHeading(visibleSectionCodes.has("model_variables") && varsHtml ? 4 : 3, `${sectionTitle("monthly_results", "Aylik EnPG Sonuclari")} (${year})`)}
  ${results.length > 0 ? `
  <table>
    <tr>
      <th>Ay</th>
      <th style="text-align:right">Gerceklesen (${rawUnitHtml})</th>
      <th style="text-align:right">Beklenen (${rawUnitHtml})</th>
      <th style="text-align:right">Sapma (${rawUnitHtml})</th>
      <th style="text-align:right">Sapma (%)</th>
      <th style="text-align:right">CUSUM (${rawUnitHtml})</th>
      <th style="text-align:right">EEI</th>
      <th style="text-align:center">Durum</th>
    </tr>
    ${tableRowsHtml}
    ${totalRowHtml}
  </table>` : "<p>Bu yil icin hesaplanmis EnPG sonucu bulunamadi. Once EnPG Izleme ekranindan hesaplama yapin.</p>"}`;
    const corporatePdf = buildCorporateReportHtml({
      identity: {
        companyName: snapshot.companyName,
        companyLegalName: snapshot.companyLegalName,
        companyShortName: snapshot.companyShortName,
        companyAddress: snapshot.companyAddress,
        reportTitle: snapshot.title,
        reportDisplayName: snapshot.reportDisplayName,
        reportPeriod: String(year),
        unitLabel: snapshot.unitLabel,
        documentNumber: snapshot.documentNumber,
        revisionNumber: snapshot.revisionNumber,
        revisionDate: snapshot.revisionDate,
        preparedBy: snapshot.preparedBy,
        checkedBy: snapshot.checkedBy,
        approvedBy: snapshot.approvedBy,
        confidentialityLabel: snapshot.confidentialityLabel,
        footerText: snapshot.footerText,
        generatedAt: generatedDate,
        generatedByName: req.user?.name ?? null,
        locale,
        showSignatureFields: snapshot.showSignatureFields,
        showPageNumbers: snapshot.showPageNumbers,
        logoDataUri: snapshot.showLogo ? logoBufferToDataUri({ mimeType: effectiveSettings.logo?.mimeType, content: effectiveSettings.logo?.content }) : null,
        logoAltText: snapshot.logo?.altText ?? null,
      },
      bodyHtml: performanceBodyHtml,
      extraCss: `
        .kpi-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin:14px 0; }
        .kpi-box { background:#f8fafc; border:1px solid #e2e8f0; padding:10px; text-align:center; }
        .kpi-value { font-size:18px; font-weight:700; color:#0f766e; }
        .kpi-label { font-size:10px; color:#64748b; margin-top:3px; }
        .diff-good { color:#059669; }
        .diff-bad { color:#dc2626; }
        .formula-box { background:#f0fdf4; border:1px solid #a7f3d0; padding:10px 12px; margin:10px 0; font-family:monospace; font-size:11px; color:#065f46; overflow-wrap:anywhere; }
        .warning-box { background:#fffbeb; border:1px solid #fde68a; padding:9px 12px; margin:10px 0; font-size:11px; color:#78350f; page-break-inside:avoid; }
        .meta-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:10px 0; font-size:11px; }
        .meta-item { background:#f8fafc; border:1px solid #e2e8f0; padding:8px 10px; }
        .meta-label { color:#64748b; margin-bottom:3px; }
        .meta-value { font-weight:700; color:#1e3a5f; overflow-wrap:anywhere; }
      `,
    });

    const pdf = await renderHtmlToPdf({
      html: corporatePdf.html,
      title: `Enerji Performansi ${year}`,
      landscape: true,
      displayHeaderFooter: corporatePdf.displayHeaderFooter,
      headerTemplate: corporatePdf.headerTemplate,
      footerTemplate: corporatePdf.footerTemplate,
    });
    await completeReportArchive({
      request: req,
      archiveId: archiveRecordId,
      companyId: effectiveCompanyId,
      unitId: baseline.unitId,
      reportType: ENERGY_PERFORMANCE_REPORT_TYPE,
      reportYear: year,
      outputName: snapshot.filename,
      contentType: "application/pdf",
      content: pdf,
      snapshotId: snapshotRecordId,
    });
    await writeBestEffortAudit(db, {
      request: req,
      companyId: effectiveCompanyId,
      unitId: baseline.unitId,
      action: "energy_performance_report.generation_completed",
      entityType: "report_generation_snapshot",
      entityId: snapshotRecordId,
      metadata: completedAuditMetadata,
    });
    const filename = snapshot.filename;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": safeContentDisposition(filename),
      "Cache-Control": "no-store",
      "Content-Length": String(pdf.length),
    });
    res.status(200).send(pdf);
  } catch (err) {
    if (archiveRecordId !== null) {
      await failReportArchive({
        request: req,
        archiveId: archiveRecordId,
        companyId: snapshotForFailure?.companyId ?? req.user?.companyId ?? null,
        unitId: snapshotForFailure?.unitId ?? req.user?.unitId ?? null,
        reportType: ENERGY_PERFORMANCE_REPORT_TYPE,
        snapshotId: snapshotRecordId,
        outputName: snapshotForFailure?.filename ?? null,
        failureCategory: err instanceof EnergyPerformanceReportSnapshotError ? "settings_snapshot" : reportStorageFailureCategory(err, "render_or_storage"),
      });
    }
    if (snapshotRecordId !== null) {
      await db.update(reportGenerationSnapshotsTable)
        .set({
          status: "failed",
          storageStatus: "storage_failed",
          failedAt: new Date(),
          failureReason: reportStorageFailureCategory(err, err instanceof EnergyPerformanceReportSnapshotError ? "settings_snapshot" : "render_or_storage"),
        })
        .where(eq(reportGenerationSnapshotsTable.id, snapshotRecordId));
      await writeBestEffortAudit(db, {
        request: req,
        companyId: snapshotForFailure?.companyId ?? req.user?.companyId ?? null,
        unitId: snapshotForFailure?.unitId ?? req.user?.unitId ?? null,
        action: "energy_performance_report.generation_failed",
        entityType: "report_generation_snapshot",
        entityId: snapshotRecordId,
        outcome: "failure",
        metadata: {
          reportType: ENERGY_PERFORMANCE_REPORT_TYPE,
          snapshotId: snapshotRecordId,
          profileVersion: snapshotForFailure?.profileVersion ?? null,
          typeSettingsVersion: snapshotForFailure?.typeSettingsVersion ?? null,
          outputName: snapshotForFailure?.filename ?? null,
          year: snapshotForFailure?.year ?? null,
          baselineId: snapshotForFailure?.baselineId ?? null,
          seuAssessmentItemId: snapshotForFailure?.seuAssessmentItemId ?? null,
          modelType: snapshotForFailure?.modelType ?? null,
          sectionCodes: snapshotForFailure?.sections.filter((section) => section.visibilityResult).map((section) => section.code) ?? [],
          requestOverrideUsed: false,
          ...(dataManifestForFailure ? manifestAuditMetadata(dataManifestForFailure) : {}),
          failureCategory: err instanceof EnergyPerformanceReportSnapshotError ? "settings_snapshot" : reportStorageFailureCategory(err, "render_or_update"),
        },
      });
    }
    if (err instanceof EnergyPerformanceReportSnapshotError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "EnPG PDF raporu üretme hatası" });
  }
});

export default router;
