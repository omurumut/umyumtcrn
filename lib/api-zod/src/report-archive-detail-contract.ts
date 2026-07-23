import type { ReportDataManifestSummary } from "./report-data-manifest-contract";

export type ReportArchiveDetailStatus =
  | "generating"
  | "completed"
  | "failed"
  | "deleted"
  | "purging"
  | "purged"
  | "purge_failed";

export type ReportArchiveDetailResponse = {
  archive: {
    id: number;
    reportType: string;
    reportName: string;
    status: ReportArchiveDetailStatus;
    fileName: string;
    mimeType: string;
    sizeBytes: number | null;
    checksum: string | null;
    createdAt: string;
    completedAt: string | null;
    failedAt: string | null;
    deletedAt: string | null;
    restoredAt: string | null;
    expiresAt: string | null;
    lifecycleVersion: number;
    canDownload: boolean;
    canRestore: boolean;
  };
  scope: {
    companyId: number;
    unitId: number | null;
    periodStart: string | null;
    periodEnd: string | null;
  };
  generation: {
    generatedByUserId: number | null;
    generatedAt: string | null;
    snapshotId: number | null;
    settingsProfileVersion: number | null;
    reportTypeSettingsVersion: number | null;
  };
  document: {
    documentNumber: string | null;
    revisionNumber: string | null;
    revisionDate: string | null;
    preparedBy: string | null;
    checkedBy: string | null;
    approvedBy: string | null;
    confidentialityLevel: string | null;
    footerText: string | null;
  };
  dataScope: ReportDataManifestSummary | null;
  failure: {
    category: string | null;
    message: string | null;
    retryable: boolean;
  };
  retry: {
    canRetry: boolean;
    retryOfArchiveId: number | null;
    latestRetryArchiveId: number | null;
    latestRetryStatus: ReportArchiveDetailStatus | null;
    reason: string | null;
  };
  lifecycle: {
    isStale: boolean;
  };
};
