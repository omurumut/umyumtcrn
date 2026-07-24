import { Router } from "express";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
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
import {
  generateReport,
  ReportGenerationError,
  type ReportGenerationRuntime,
} from "../lib/report-generation-service.js";

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

function reportGenerationRuntime(req: Request): ReportGenerationRuntime {
  return {
    createArchive: (input) => createReportArchiveRecord({ request: req, ...input }),
    completeArchive: (input) => completeReportArchive({ request: req, ...input }),
    failArchive: (input) => failReportArchive({ request: req, ...input }),
    writeAudit: (input) => writeBestEffortAudit(db, { request: req, ...input }).then(() => undefined),
  };
}

function handleReportGenerationError(res: Response, error: unknown): boolean {
  if (error instanceof ReportGenerationError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
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

function isUniqueViolation(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.code === "23505") return true;
  return isUniqueViolation(error.cause);
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

const REPORT_FAILURE_CATEGORIES = new Set([
  "validation",
  "authorization",
  "data_unavailable",
  "snapshot_failed",
  "settings_snapshot",
  "manifest_failed",
  "render_failed",
  "storage_failed",
  "archive_completion_failed",
  "stale_generation",
  "render_or_storage",
  "unknown",
]);
const RETRYABLE_FAILURE_CATEGORIES = new Set([
  "render_failed",
  "storage_failed",
  "archive_completion_failed",
  "manifest_failed",
  "stale_generation",
  "render_or_storage",
  "unknown",
]);
const ACTIVE_RETRY_CHILD_STATUSES = new Set(["generating", "completed"]);

function normalizedFailureCategory(value: unknown): string | null {
  const safe = safeFailureCategory(value);
  if (!safe) return null;
  return REPORT_FAILURE_CATEGORIES.has(safe) ? safe : "unknown";
}

function safeFailureMessage(category: string | null): string | null {
  if (!category) return null;
  if (category === "stale_generation") return "Rapor uretimi zaman asimina ugradi.";
  if (category === "validation") return "Rapor parametreleri yeniden deneme icin uygun degil.";
  if (category === "authorization") return "Bu rapor icin yetki dogrulamasi basarisiz.";
  if (category === "data_unavailable") return "Rapor verisi su anda kullanilabilir degil.";
  if (category === "snapshot_failed" || category === "settings_snapshot") return "Rapor snapshot'i olusturulamadi.";
  if (category === "manifest_failed") return "Veri kapsam manifesti olusturulamadi.";
  if (category === "render_failed" || category === "render_or_storage") return "Rapor ciktisi olusturulamadi.";
  if (category === "storage_failed" || category === "archive_completion_failed") return "Rapor arsiv kaydi tamamlanamadi.";
  return "Rapor uretimi tamamlanamadi.";
}

function reportGenerationStaleMinutes(): number {
  const raw = process.env.REPORT_GENERATION_STALE_MINUTES;
  if (raw === undefined || raw === "") return 30;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 5 && parsed <= 24 * 60 ? parsed : 30;
}

function isArchiveStaleGenerating(archive: Pick<typeof reportArchivesTable.$inferSelect, "status" | "createdAt" | "generatedAt" | "completedAt" | "failedAt">, now = new Date()): boolean {
  if (archive.status !== "generating" || archive.completedAt || archive.failedAt) return false;
  const start = archive.generatedAt ?? archive.createdAt;
  return now.getTime() - start.getTime() >= reportGenerationStaleMinutes() * 60_000;
}

function retryParamsFromSnapshot(
  archive: Pick<typeof reportArchivesTable.$inferSelect, "companyId" | "unitId" | "reportType" | "reportYear">,
  snapshot: unknown,
): { ok: true; reason: null } | { ok: false; reason: string } {
  if (!isRecord(snapshot)) return { ok: false, reason: "retry parametreleri bulunmuyor" };
  if (snapshot.reportType !== archive.reportType) return { ok: false, reason: "snapshot rapor turu uyusmuyor" };
  if (typeof snapshot.companyId === "number" && snapshot.companyId !== archive.companyId) return { ok: false, reason: "snapshot firma kapsami uyusmuyor" };
  if (typeof snapshot.year !== "number" || !Number.isSafeInteger(snapshot.year)) return { ok: false, reason: "rapor yili eksik" };
  if (snapshot.year !== archive.reportYear) return { ok: false, reason: "snapshot rapor yili uyusmuyor" };
  if (snapshot.unitId !== null && !(typeof snapshot.unitId === "number" && Number.isSafeInteger(snapshot.unitId))) return { ok: false, reason: "birim kapsami eksik" };
  if ((snapshot.unitId ?? null) !== archive.unitId) return { ok: false, reason: "snapshot birim kapsami uyusmuyor" };
  if (archive.reportType === ENERGY_PERFORMANCE_REPORT_TYPE && !(typeof snapshot.baselineId === "number" && Number.isSafeInteger(snapshot.baselineId))) {
    return { ok: false, reason: "baseline bilgisi eksik" };
  }
  return { ok: true, reason: null };
}

async function latestRetryChild(companyId: number, sourceArchiveId: number): Promise<{ id: number; status: ReportArchiveDetailResponse["archive"]["status"] } | null> {
  const result = await pool.query<{ id: number; status: ReportArchiveDetailResponse["archive"]["status"] }>(
    `SELECT id, status
     FROM report_archives
     WHERE company_id=$1 AND retry_of_archive_id=$2
     ORDER BY generated_at DESC, id DESC
     LIMIT 1`,
    [companyId, sourceArchiveId],
  );
  return result.rows[0] ?? null;
}

async function retryInfoForArchive(archive: typeof reportArchivesTable.$inferSelect, snapshot: typeof reportGenerationSnapshotsTable.$inferSelect | null): Promise<ReportArchiveDetailResponse["retry"] & { isStale: boolean; failureRetryable: boolean }> {
  const latest = await latestRetryChild(archive.companyId, archive.id);
  const failureCategory = normalizedFailureCategory(archive.status === "purge_failed" ? archive.purgeFailureCategory : archive.failureCategory);
  const isStale = isArchiveStaleGenerating(archive);
  const snapshotParams = retryParamsFromSnapshot(archive, snapshot?.settingsSnapshot);
  const statusEligible = archive.status === "failed" || isStale;
  const childBlocks = latest !== null && ACTIVE_RETRY_CHILD_STATUSES.has(latest.status);
  const failureRetryable = archive.status === "failed"
    ? RETRYABLE_FAILURE_CATEGORIES.has(failureCategory ?? "unknown") && snapshotParams.ok
    : isStale;
  const canRetry = statusEligible && !childBlocks && failureRetryable && snapshotParams.ok;
  return {
    canRetry,
    retryOfArchiveId: archive.retryOfArchiveId ?? null,
    latestRetryArchiveId: latest?.id ?? null,
    latestRetryStatus: latest?.status ?? null,
    reason: canRetry ? null : childBlocks ? "Aktif retry kaydi mevcut." : snapshotParams.ok ? null : snapshotParams.reason,
    isStale,
    failureRetryable,
  };
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

async function buildArchiveDetailResponse(input: {
  archive: typeof reportArchivesTable.$inferSelect;
  snapshot: typeof reportGenerationSnapshotsTable.$inferSelect | null;
}): Promise<ReportArchiveDetailResponse> {
  const { archive, snapshot } = input;
  const snapshotJson = snapshot?.settingsSnapshot;
  const snapshotRecord = isRecord(snapshotJson) ? snapshotJson : null;
  const profileVersion = safeNumber(snapshotRecord?.profileVersion);
  const typeSettingsVersion = safeNumber(snapshotRecord?.typeSettingsVersion);
  const previousStatus = archive.previousStatus;
  const failureCategory = safeFailureCategory(archive.status === "purge_failed" ? archive.purgeFailureCategory : archive.failureCategory);
  const normalizedCategory = normalizedFailureCategory(failureCategory);
  const retry = await retryInfoForArchive(archive, snapshot);
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
      category: normalizedCategory,
      message: safeFailureMessage(normalizedCategory),
      retryable: retry.failureRetryable,
    },
    retry: {
      canRetry: retry.canRetry,
      retryOfArchiveId: retry.retryOfArchiveId,
      latestRetryArchiveId: retry.latestRetryArchiveId,
      latestRetryStatus: retry.latestRetryStatus,
      reason: retry.reason,
    },
    lifecycle: {
      isStale: retry.isStale,
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

function retryOutputName(sourceName: string, sourceArchiveId: number, now: Date): string {
  const marker = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const dot = sourceName.lastIndexOf(".");
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  const ext = dot > 0 ? sourceName.slice(dot) : "";
  return sanitizeArchiveFilename(`${base}-retry-${sourceArchiveId}-${marker}${ext}`);
}

function cloneManifestForRetry(source: unknown, sourceArchiveId: number, generatedAt: Date): ReportDataManifestV1 | null {
  if (!isRecord(source) || source.schemaVersion !== 1 || typeof source.manifestHash !== "string") return null;
  const next = {
    ...source,
    generatedAt: generatedAt.toISOString(),
    manifestHash: createHash("sha256")
      .update(JSON.stringify({ sourceArchiveId, generatedAt: generatedAt.toISOString(), previousManifestHash: source.manifestHash }))
      .digest("hex"),
  };
  return next as ReportDataManifestV1;
}

function retryHtml(input: {
  title: string;
  reportType: string;
  sourceArchiveId: number;
  newArchiveId: number;
  generatedAt: Date;
}): Buffer {
  return Buffer.from(`<!doctype html>
<html lang="tr">
<head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title></head>
<body>
  <h1>${escapeHtml(input.title)}</h1>
  <p>Bu rapor, #${input.sourceArchiveId} numarali basarisiz/stale arsiv kaydinin yeniden denemesi olarak guncel veri ve ayarlarla olusturulmustur.</p>
  <p>Rapor turu: ${escapeHtml(input.reportType)} | Yeni archive: #${input.newArchiveId} | Uretim: ${escapeHtml(input.generatedAt.toISOString())}</p>
</body>
</html>`, "utf8");
}

async function retryContentBuffer(input: {
  title: string;
  reportType: ArchiveReportType;
  contentType: string;
  sourceArchiveId: number;
  newArchiveId: number;
  generatedAt: Date;
}): Promise<Buffer> {
  const html = retryHtml(input);
  if (input.contentType === "text/html; charset=utf-8") return html;
  return renderHtmlToPdf({
    html: html.toString("utf8"),
    title: input.title,
    landscape: true,
  });
}

async function markStaleArchiveFailed(input: {
  request: Request;
  archive: typeof reportArchivesTable.$inferSelect;
  snapshot: typeof reportGenerationSnapshotsTable.$inferSelect | null;
}): Promise<boolean> {
  const threshold = new Date(Date.now() - reportGenerationStaleMinutes() * 60_000);
  const result = await pool.query<{ id: number; unit_id: number | null; report_type: ArchiveReportType }>(
    `UPDATE report_archives
     SET status='failed',
         failed_at=now(),
         failure_category='stale_generation',
         retention_expires_at=now(),
         updated_at=now(),
         lifecycle_version=lifecycle_version+1
     WHERE id=$1
       AND company_id=$2
       AND status='generating'
       AND completed_at IS NULL
       AND failed_at IS NULL
       AND generated_at <= $3
     RETURNING id, unit_id, report_type`,
    [input.archive.id, input.archive.companyId, threshold],
  );
  const row = result.rows[0];
  if (!row) return false;
  if (input.snapshot) {
    await db.update(reportGenerationSnapshotsTable)
      .set({ status: "failed", failedAt: new Date(), failureReason: "stale_generation" })
      .where(eq(reportGenerationSnapshotsTable.id, input.snapshot.id));
  }
  await writeBestEffortAudit(db, {
    request: input.request,
    companyId: input.archive.companyId,
    unitId: row.unit_id,
    action: "report_archive.stale_marked_failed",
    entityType: "report_archive",
    entityId: row.id,
    outcome: "success",
    metadata: { archiveId: row.id, reportType: row.report_type, failureCategory: "stale_generation" },
  });
  return true;
}

async function createRetryArchive(input: {
  request: Request;
  sourceArchive: typeof reportArchivesTable.$inferSelect;
  sourceSnapshot: typeof reportGenerationSnapshotsTable.$inferSelect;
  reason: string;
}): Promise<{ sourceArchiveId: number; newArchiveId: number; status: string }> {
  const now = new Date();
  const sourceSnapshotJson = input.sourceSnapshot.settingsSnapshot;
  const retryParams = retryParamsFromSnapshot(input.sourceArchive, sourceSnapshotJson);
  if (!retryParams.ok) throw new ReportScopeError(409, "Bu rapor yeniden deneme icin yeterli parametre tasimiyor");

  const activeChild = await latestRetryChild(input.sourceArchive.companyId, input.sourceArchive.id);
  if (activeChild && ACTIVE_RETRY_CHILD_STATUSES.has(activeChild.status)) {
    throw new ReportScopeError(409, "Bu rapor icin aktif retry kaydi zaten var");
  }

  await writeBestEffortAudit(db, {
    request: input.request,
    companyId: input.sourceArchive.companyId,
    unitId: input.sourceArchive.unitId,
    action: "report_archive.retry_requested",
    entityType: "report_archive",
    entityId: input.sourceArchive.id,
    metadata: {
      sourceArchiveId: input.sourceArchive.id,
      reportType: input.sourceArchive.reportType,
      sourceStatus: input.sourceArchive.status,
      retryReason: input.reason,
    },
  });

  if (input.sourceArchive.reportYear === null) throw new ReportScopeError(409, "Bu rapor yeniden deneme icin rapor yili tasimiyor");

  try {
    const base = {
      companyId: input.sourceArchive.companyId,
      unitId: input.sourceArchive.unitId,
      year: input.sourceArchive.reportYear,
      requestedByUserId: input.request.user?.userId ?? null,
      requestedByName: input.request.user?.name ?? null,
      trigger: "retry" as const,
      retryOfArchiveId: input.sourceArchive.id,
    };
    const generated = input.sourceArchive.reportType === ENERGY_PERFORMANCE_REPORT_TYPE
      ? await generateReport({
          reportType: ENERGY_PERFORMANCE_REPORT_TYPE,
          ...base,
          baselineId: isRecord(sourceSnapshotJson) && typeof sourceSnapshotJson.baselineId === "number" ? sourceSnapshotJson.baselineId : 0,
        }, reportGenerationRuntime(input.request))
      : input.sourceArchive.reportType === ENERGY_TARGETS_REPORT_TYPE
        ? await generateReport({
            reportType: ENERGY_TARGETS_REPORT_TYPE,
            ...base,
          }, reportGenerationRuntime(input.request))
        : await generateReport({
            reportType: ANNUAL_ENERGY_REPORT_TYPE,
            ...base,
          }, reportGenerationRuntime(input.request));

    await writeBestEffortAudit(db, {
      request: input.request,
      companyId: input.sourceArchive.companyId,
      unitId: input.sourceArchive.unitId,
      action: "report_archive.retry_started",
      entityType: "report_archive",
      entityId: generated.archiveId,
      metadata: {
        sourceArchiveId: input.sourceArchive.id,
        newArchiveId: generated.archiveId,
        reportType: input.sourceArchive.reportType,
        retryReason: input.reason,
      },
    });
    await writeBestEffortAudit(db, {
      request: input.request,
      companyId: input.sourceArchive.companyId,
      unitId: input.sourceArchive.unitId,
      action: "report_archive.retry_completed",
      entityType: "report_archive",
      entityId: generated.archiveId,
      metadata: {
        sourceArchiveId: input.sourceArchive.id,
        newArchiveId: generated.archiveId,
        reportType: input.sourceArchive.reportType,
        manifestHash: generated.manifest.manifestHash,
        trigger: "retry",
      },
    });
    return { sourceArchiveId: input.sourceArchive.id, newArchiveId: generated.archiveId, status: "completed" };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ReportScopeError(409, "Bu rapor icin aktif retry kaydi zaten var");
    }
    const latest = await latestRetryChild(input.sourceArchive.companyId, input.sourceArchive.id);
    const failureCategory = error instanceof ReportGenerationError ? error.failureCategory : reportStorageFailureCategory(error, "render_failed");
    await writeBestEffortAudit(db, {
      request: input.request,
      companyId: input.sourceArchive.companyId,
      unitId: input.sourceArchive.unitId,
      action: "report_archive.retry_failed",
      entityType: "report_archive",
      entityId: latest?.id ?? input.sourceArchive.id,
      outcome: "failure",
      metadata: {
        sourceArchiveId: input.sourceArchive.id,
        newArchiveId: latest?.id ?? null,
        reportType: input.sourceArchive.reportType,
        failureCategory,
      },
    });
    if (latest?.status === "failed") return { sourceArchiveId: input.sourceArchive.id, newArchiveId: latest.id, status: "failed" };
    throw error;
  }
}
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
    if (handleReportGenerationError(res, err)) return;
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
    if (handleReportGenerationError(res, err)) return;
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
    res.json(await buildArchiveDetailResponse(row));
  } catch (err) {
    if (handleReportGenerationError(res, err)) return;
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor detayi alinamadi" });
  }
});

// POST /api/reports/archive/:id/retry
router.post("/reports/archive/:id/retry", requireAuth, async (req, res) => {
  try {
    requireArchiveMutationRole(req);
    const archiveId = parseRequiredId(req.params.id, "id");
    const body = (req.body ?? {}) as { expectedLifecycleVersion?: unknown; reason?: unknown };
    const allowedBodyKeys = new Set(["expectedLifecycleVersion", "reason"]);
    for (const key of Object.keys(body)) {
      if (!allowedBodyKeys.has(key)) throw new ReportScopeError(400, `Gecersiz alan: ${key}`);
    }
    const expectedLifecycleVersion = parsePositiveInteger(body.expectedLifecycleVersion, "expectedLifecycleVersion");
    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 120).replace(/[^\w .:@-]/g, "_")
      : "manual_retry";
    const row = await findScopedArchiveDetail(req, archiveId);
    if (!row) {
      res.status(404).json({ error: "Rapor bulunamadi" });
      return;
    }
    if (expectedLifecycleVersion !== undefined && row.archive.lifecycleVersion !== expectedLifecycleVersion) {
      res.status(409).json({ error: "Archive lifecycle versiyonu guncel degil" });
      return;
    }
    if (!row.snapshot) {
      res.status(409).json({ error: "Bu rapor yeniden deneme icin gerekli snapshot bilgisini tasimiyor" });
      return;
    }

    let sourceArchive = row.archive;
    if (sourceArchive.status === "generating") {
      if (!isArchiveStaleGenerating(sourceArchive)) {
        res.status(409).json({ error: "Rapor uretimi henuz stale degil" });
        return;
      }
      const marked = await markStaleArchiveFailed({ request: req, archive: sourceArchive, snapshot: row.snapshot });
      if (!marked) {
        res.status(409).json({ error: "Rapor retry icin claim edilemedi" });
        return;
      }
      sourceArchive = {
        ...sourceArchive,
        status: "failed",
        failedAt: new Date(),
        failureCategory: "stale_generation",
        lifecycleVersion: sourceArchive.lifecycleVersion + 1,
      };
    }

    if (sourceArchive.status !== "failed") {
      res.status(409).json({ error: "Yalniz failed veya stale generating raporlar retry edilebilir" });
      return;
    }

    const retryInfo = await retryInfoForArchive(sourceArchive, row.snapshot);
    if (!retryInfo.canRetry) {
      res.status(409).json({ error: retryInfo.reason ?? "Bu rapor retry icin uygun degil" });
      return;
    }

    const result = await createRetryArchive({
      request: req,
      sourceArchive,
      sourceSnapshot: row.snapshot,
      reason,
    });
    res.status(201).json(result);
  } catch (err) {
    if (handleReportGenerationError(res, err)) return;
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor retry baslatilamadi" });
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
    if (handleReportGenerationError(res, err)) return;
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
    if (handleReportGenerationError(res, err)) return;
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
    if (handleReportGenerationError(res, err)) return;
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
    if (handleReportGenerationError(res, err)) return;
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
    if (handleReportGenerationError(res, err)) return;
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
    if (handleReportGenerationError(res, err)) return;
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Orphan diagnostics calistirilamadi" });
  }
});

// POST /api/reports/generate
router.post("/reports/generate", requireAuth, async (req, res) => {
  try {
    const { year, unitId: bodyUnitId } = req.body;
    const allowedBodyKeys = new Set(["year", "unitId", "companyId", "includeSwot", "includeRisks", "includeSeu", "includeRegression"]);
    for (const key of Object.keys(req.body ?? {})) {
      if (!allowedBodyKeys.has(key)) throw new ReportScopeError(400, `Ge�ersiz alan: ${key}`);
    }
    const legacyOverrides = parseAnnualEnergyLegacyOverrides(req.body as Record<string, unknown>);
    const yr = parseReportYear(year ?? new Date().getFullYear());
    const scope = await resolveReportScope(req, { ...req.body, unitId: bodyUnitId }, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const generated = await generateReport({
      reportType: ANNUAL_ENERGY_REPORT_TYPE,
      companyId: scope.companyId,
      unitId: scope.unitId,
      year: yr,
      requestedByUserId: req.user?.userId ?? null,
      requestedByName: req.user?.name ?? null,
      trigger: "initial",
      legacyOverrides,
    }, reportGenerationRuntime(req));
    if (!generated.legacyReport) throw new ReportScopeError(500, "Rapor kaydi olusturulamadi");
    res.json({
      id: generated.legacyReport.id,
      year: generated.legacyReport.year,
      status: generated.legacyReport.status,
      downloadUrl: `/api/reports/archive/${generated.archiveId}/download`,
      dataUrl: `data:text/html;base64,${generated.content.toString("base64")}`,
      archiveId: generated.archiveId,
      sizeBytes: generated.archiveResult.sizeBytes,
      checksumSha256: generated.archiveResult.checksumSha256,
      createdAt: generated.legacyReport.createdAt,
    });
  } catch (err) {
    if (handleReportGenerationError(res, err)) return;
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatas�" });
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
  try {
    const statusParam = parseTargetReportStatus(req.query.status);
    const legacyOverrides = parseEnergyTargetsLegacyOverrides({
      includeVap: req.query.includeVap,
      includeProgress: req.query.includeProgress,
    });
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    if (scope.companyId === undefined) throw new ReportScopeError(400, "companyId zorunludur");
    const yearParam = parseReportYear(req.query.year ?? new Date().getFullYear());
    const generated = await generateReport({
      reportType: ENERGY_TARGETS_REPORT_TYPE,
      companyId: scope.companyId,
      unitId: scope.unitId,
      year: yearParam,
      requestedByUserId: req.user?.userId ?? null,
      requestedByName: req.user?.name ?? null,
      trigger: "initial",
      status: statusParam,
      legacyOverrides,
    }, reportGenerationRuntime(req));
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": safeContentDisposition(generated.outputName),
      "Cache-Control": "no-store",
      "Content-Length": String(generated.content.length),
    });
    res.status(200).send(generated.content);
  } catch (err) {
    if (handleReportGenerationError(res, err)) return;
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor uretme hatasi" });
  }
});
router.get("/reports/energy-performance/pdf", requireAuth, async (req, res) => {
  try {
    const scope = await resolveReportScope(req, req.query as Record<string, unknown>, true);
    const baselineId = parseRequiredId(req.query.baselineId, "baselineId");
    const year = parseReportYear(req.query.year ?? new Date().getFullYear());
    const generated = await generateReport({
      reportType: ENERGY_PERFORMANCE_REPORT_TYPE,
      companyId: scope.companyId ?? null,
      unitId: scope.unitId,
      baselineId,
      year,
      requestedByUserId: req.user?.userId ?? null,
      requestedByName: req.user?.name ?? null,
      trigger: "initial",
    }, reportGenerationRuntime(req));
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": safeContentDisposition(generated.outputName),
      "Cache-Control": "no-store",
      "Content-Length": String(generated.content.length),
    });
    res.status(200).send(generated.content);
  } catch (err) {
    if (handleReportGenerationError(res, err)) return;
    if (handleReportScopeError(res, err)) return;
    req.log.error(err);
    res.status(500).json({ error: "Rapor uretme hatasi" });
  }
});
export default router;
