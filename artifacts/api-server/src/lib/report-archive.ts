import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { and, eq } from "drizzle-orm";
import { db, reportArchivesTable, reportGenerationSnapshotsTable } from "@workspace/db";
import { writeBestEffortAudit } from "./audit.js";
import { calculateSha256, reportStorage } from "./report-storage.js";
import { calculateRetentionExpiresAt, getReportRetentionSettings } from "./report-retention.js";

export type ArchiveReportType = "annual_energy_performance" | "energy_targets_management" | "energy_performance_monitoring";
export type ArchiveContentType = "text/html; charset=utf-8" | "application/pdf";

type CreateArchiveInput = {
  request: Request;
  companyId: number;
  unitId: number | null;
  reportType: ArchiveReportType;
  reportYear: number | null;
  periodLabel?: string | null;
  title: string;
  outputName: string;
  contentType: ArchiveContentType;
  snapshotId: number;
  legacyReportId?: number | null;
};

type CompleteArchiveInput = {
  request: Request;
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

type FailArchiveInput = {
  request: Request;
  archiveId: number | null;
  companyId: number | null;
  unitId: number | null;
  reportType: ArchiveReportType;
  snapshotId: number | null;
  failureCategory: string;
  outputName?: string | null;
  storageKey?: string | null;
};

export function sanitizeArchiveFilename(value: string): string {
  const trimmed = value.trim().replace(/[/\\\r\n"]/g, "-");
  const normalized = trimmed.replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ@._ +()-]/g, "-").replace(/\s+/g, " ");
  return normalized.slice(0, 160) || `report-${randomUUID()}`;
}

function safeKeySegment(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "all" : String(value);
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "all";
}

function validateContent(content: Buffer, contentType: ArchiveContentType): void {
  if (content.length === 0) throw new Error("empty_output");
  if (contentType === "application/pdf" && content.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("invalid_pdf_output");
  }
  if (contentType === "text/html; charset=utf-8") {
    const prefix = content.subarray(0, Math.min(content.length, 256)).toString("utf8").toLowerCase();
    if (!prefix.includes("<!doctype html") && !prefix.includes("<html")) throw new Error("invalid_html_output");
  }
}

export function buildArchiveStorageKey(input: {
  companyId: number;
  reportType: ArchiveReportType;
  year: number | null;
  archiveId: number;
  outputName: string;
}): string {
  return [
    "companies",
    safeKeySegment(input.companyId),
    "reports",
    safeKeySegment(input.reportType),
    safeKeySegment(input.year),
    safeKeySegment(input.archiveId),
    sanitizeArchiveFilename(input.outputName).replace(/\s+/g, "-"),
  ].join("/");
}

function archiveAuditMetadata(input: {
  archiveId: number | null;
  reportType: ArchiveReportType;
  snapshotId: number | null;
  outputName?: string | null;
  sizeBytes?: number | null;
  checksumSha256?: string | null;
  failureCategory?: string | null;
}) {
  return {
    archiveId: input.archiveId,
    reportType: input.reportType,
    snapshotId: input.snapshotId,
    outputName: input.outputName ?? null,
    sizeBytes: input.sizeBytes ?? null,
    checksumSha256: input.checksumSha256 ? input.checksumSha256.slice(0, 16) : null,
    failureCategory: input.failureCategory ?? null,
  };
}

export async function createReportArchiveRecord(input: CreateArchiveInput): Promise<number> {
  const [archive] = await db.insert(reportArchivesTable).values({
    companyId: input.companyId,
    unitId: input.unitId,
    reportType: input.reportType,
    reportYear: input.reportYear,
    periodLabel: input.periodLabel ?? null,
    title: input.title,
    outputName: sanitizeArchiveFilename(input.outputName),
    contentType: input.contentType,
    status: "generating",
    generatedBy: input.request.user?.userId ?? null,
    generatedAt: new Date(),
    snapshotId: input.snapshotId,
    legacyReportId: input.legacyReportId ?? null,
  }).returning({ id: reportArchivesTable.id });
  await writeBestEffortAudit(db, {
    request: input.request,
    companyId: input.companyId,
    unitId: input.unitId,
    action: "report_archive.record_created",
    entityType: "report_archive",
    entityId: archive.id,
    metadata: archiveAuditMetadata({
      archiveId: archive.id,
      reportType: input.reportType,
      snapshotId: input.snapshotId,
      outputName: input.outputName,
    }),
  });
  return archive.id;
}

export async function completeReportArchive(input: CompleteArchiveInput): Promise<{ storageKey: string; checksumSha256: string; sizeBytes: number }> {
  validateContent(input.content, input.contentType);
  const checksumSha256 = calculateSha256(input.content);
  const storageKey = buildArchiveStorageKey({
    companyId: input.companyId,
    reportType: input.reportType,
    year: input.reportYear,
    archiveId: input.archiveId,
    outputName: input.outputName,
  });
  let putCompleted = false;
  try {
    const metadata = await reportStorage.put({ key: storageKey, content: input.content, contentType: input.contentType });
    putCompleted = true;
    if (metadata.contentLength !== input.content.length || metadata.checksumSha256 !== checksumSha256) {
      throw new Error("storage_integrity_mismatch");
    }
    const completedAt = new Date();
    await db.update(reportArchivesTable)
      .set({
        status: "completed",
        storageProvider: reportStorage.provider,
        storageKey,
        sizeBytes: metadata.contentLength,
        checksumSha256,
        completedAt,
        retentionExpiresAt: calculateRetentionExpiresAt({
          status: "completed",
          completedAt,
          generatedAt: completedAt,
          settings: await getReportRetentionSettings(input.companyId),
        }),
        updatedAt: completedAt,
      })
      .where(and(eq(reportArchivesTable.id, input.archiveId), eq(reportArchivesTable.companyId, input.companyId)));
    await db.update(reportGenerationSnapshotsTable)
      .set({ status: "completed", storageStatus: "stored", completedAt: new Date(), filename: input.outputName })
      .where(eq(reportGenerationSnapshotsTable.id, input.snapshotId));
    await writeBestEffortAudit(db, {
      request: input.request,
      companyId: input.companyId,
      unitId: input.unitId,
      action: "report_archive.completed",
      entityType: "report_archive",
      entityId: input.archiveId,
      metadata: archiveAuditMetadata({
        archiveId: input.archiveId,
        reportType: input.reportType,
        snapshotId: input.snapshotId,
        outputName: input.outputName,
        sizeBytes: metadata.contentLength,
        checksumSha256,
      }),
    });
    return { storageKey, checksumSha256, sizeBytes: metadata.contentLength };
  } catch (error) {
    if (putCompleted) {
      await reportStorage.delete(storageKey).catch(() => undefined);
    }
    throw error;
  }
}

export async function failReportArchive(input: FailArchiveInput): Promise<void> {
  if (input.storageKey) await reportStorage.delete(input.storageKey).catch(() => undefined);
  if (input.archiveId !== null) {
    const now = new Date();
    const settings = input.companyId ? await getReportRetentionSettings(input.companyId) : null;
    await db.update(reportArchivesTable)
      .set({
        status: "failed",
        failedAt: now,
        failureCategory: input.failureCategory.slice(0, 80),
        retentionExpiresAt: settings && input.companyId
          ? calculateRetentionExpiresAt({ status: "failed", failedAt: now, generatedAt: now, settings })
          : null,
        updatedAt: now,
      })
      .where(eq(reportArchivesTable.id, input.archiveId));
  }
  await writeBestEffortAudit(db, {
    request: input.request,
    companyId: input.companyId,
    unitId: input.unitId,
    action: "report_archive.failed",
    entityType: "report_archive",
    entityId: input.archiveId,
    outcome: "failure",
    metadata: archiveAuditMetadata({
      archiveId: input.archiveId,
      reportType: input.reportType,
      snapshotId: input.snapshotId,
      outputName: input.outputName,
      failureCategory: input.failureCategory,
    }),
  });
}
