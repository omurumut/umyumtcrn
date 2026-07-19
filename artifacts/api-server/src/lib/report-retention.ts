import { createHash } from "node:crypto";
import { pool, type ReportArchive } from "@workspace/db";

export type ReportRetentionSettings = {
  companyId: number;
  retentionEnabled: boolean;
  completedRetentionDays: number;
  failedRetentionDays: number;
  deletedGraceDays: number;
  automaticCleanupAllowed: boolean;
  settingsVersion: number;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type RetentionArchiveStatus = "completed" | "failed" | "deleted";

export const DEFAULT_REPORT_RETENTION_SETTINGS = {
  retentionEnabled: false,
  completedRetentionDays: 3650,
  failedRetentionDays: 90,
  deletedGraceDays: 30,
  automaticCleanupAllowed: false,
  settingsVersion: 0,
} as const;

export const RETENTION_BOUNDS = {
  completedRetentionDays: { min: 365, max: 36500 },
  failedRetentionDays: { min: 30, max: 3650 },
  deletedGraceDays: { min: 7, max: 365 },
} as const;

export function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function isSaneReferenceDate(date: Date): boolean {
  const year = date.getUTCFullYear();
  return Number.isFinite(date.getTime()) && year >= 2000 && year <= 3000;
}

export function calculateRetentionExpiresAt(input: {
  status: "completed" | "failed";
  completedAt?: Date | null;
  failedAt?: Date | null;
  generatedAt: Date;
  settings: Pick<ReportRetentionSettings, "retentionEnabled" | "completedRetentionDays" | "failedRetentionDays">;
}): Date | null {
  if (!input.settings.retentionEnabled) return null;
  const reference = input.status === "completed"
    ? input.completedAt ?? input.generatedAt
    : input.failedAt ?? input.generatedAt;
  if (!isSaneReferenceDate(reference)) return null;
  const days = input.status === "completed" ? input.settings.completedRetentionDays : input.settings.failedRetentionDays;
  return addUtcDays(reference, days);
}

export function calculatePurgeEligibleAt(deletedAt: Date, deletedGraceDays: number): Date {
  return addUtcDays(deletedAt, deletedGraceDays);
}

export function normalizeDeleteReason(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const safe = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").slice(0, 160);
  return safe.length >= 3 ? safe : "manual_admin_delete";
}

export function parseRetentionInteger(value: unknown, field: keyof typeof RETENTION_BOUNDS): number | null {
  const bounds = RETENTION_BOUNDS[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < bounds.min || value > bounds.max) return null;
  return value;
}

export function redactedObjectIdentifier(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

export function companyReportPrefix(companyId: number): string {
  return `companies/${companyId}/reports/`;
}

export function archiveIdFromStorageKey(key: string, companyId: number): number | null {
  const prefix = companyReportPrefix(companyId);
  if (!key.startsWith(prefix)) return null;
  const segments = key.slice(prefix.length).split("/");
  if (segments.length < 4) return null;
  const archiveId = Number(segments[2]);
  return Number.isSafeInteger(archiveId) && archiveId > 0 ? archiveId : null;
}

export function serializeRetentionSettings(row: Record<string, unknown> | null, companyId: number): ReportRetentionSettings {
  if (!row) {
    return {
      companyId,
      ...DEFAULT_REPORT_RETENTION_SETTINGS,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    companyId: Number(row.company_id),
    retentionEnabled: row.retention_enabled === true,
    completedRetentionDays: Number(row.completed_retention_days),
    failedRetentionDays: Number(row.failed_retention_days),
    deletedGraceDays: Number(row.deleted_grace_days),
    automaticCleanupAllowed: row.automatic_cleanup_allowed === true,
    settingsVersion: Number(row.settings_version),
    createdAt: row.created_at instanceof Date ? row.created_at : null,
    updatedAt: row.updated_at instanceof Date ? row.updated_at : null,
  };
}

export async function getReportRetentionSettings(companyId: number): Promise<ReportRetentionSettings> {
  const result = await pool.query("SELECT * FROM company_report_retention_settings WHERE company_id=$1 LIMIT 1", [companyId]);
  return serializeRetentionSettings(result.rows[0] ?? null, companyId);
}

export function archiveDownloadable(status: string): boolean {
  return status === "completed";
}

export function retentionCandidateReason(archive: Pick<ReportArchive, "status" | "retentionExpiresAt" | "purgeEligibleAt">, now = new Date()): string | null {
  if (archive.status === "deleted" && archive.purgeEligibleAt && archive.purgeEligibleAt <= now) return "deleted_grace_expired";
  if ((archive.status === "completed" || archive.status === "failed") && archive.retentionExpiresAt && archive.retentionExpiresAt <= now) {
    return archive.status === "completed" ? "completed_retention_expired" : "failed_retention_expired";
  }
  return null;
}
