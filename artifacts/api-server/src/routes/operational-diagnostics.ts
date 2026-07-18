import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router: IRouter = Router();

const REPORT_TYPES = new Set([
  "annual_energy_performance",
  "energy_targets_management",
  "energy_performance_monitoring",
]);
const SNAPSHOT_STATUSES = new Set(["generating", "completed", "failed"]);
const DEFAULT_STALE_MINUTES = 30;
const MIN_STALE_MINUTES = 5;
const MAX_STALE_MINUTES = 24 * 60;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseBoundedInteger(value: unknown, fallback: number, min: number, max: number, field: string): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`invalid_${field}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`invalid_${field}`);
  }
  return parsed;
}

function safeFailureCategory(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (/^[a-z][a-z0-9_-]{0,63}$/.test(value)) return value;
  return "redacted";
}

router.get("/admin/report-snapshots/diagnostics", requireAuth, async (req, res) => {
  if (!req.user || !["admin", "kontrol_admin", "superadmin"].includes(req.user.role)) {
    res.status(req.user ? 403 : 401).json({ error: "Bu islem icin yetkiniz yok" });
    return;
  }

  try {
    const staleMinutes = parseBoundedInteger(req.query.staleMinutes, DEFAULT_STALE_MINUTES, MIN_STALE_MINUTES, MAX_STALE_MINUTES, "stale_minutes");
    const limit = parseBoundedInteger(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, "limit");
    const reportType = req.query.reportType;
    if (reportType !== undefined && (typeof reportType !== "string" || !REPORT_TYPES.has(reportType))) {
      res.status(400).json({ error: "Gecersiz reportType" });
      return;
    }

    const user = req.user;
    const requestedCompanyId = parseBoundedInteger(req.query.companyId, user.companyId ?? 0, 1, 2_147_483_647, "company_id");
    const companyId = user.role === "superadmin" ? requestedCompanyId : user.companyId;
    if (!companyId) {
      res.status(400).json({ error: "companyId zorunlu" });
      return;
    }
    if (user.role !== "superadmin" && requestedCompanyId !== user.companyId) {
      res.status(403).json({ error: "Bu sirket icin yetkiniz yok" });
      return;
    }

    const params: unknown[] = [companyId, staleMinutes];
    const reportTypeClause = reportType ? "AND report_type = $3" : "";
    if (reportType) params.push(reportType);

    const summary = await pool.query<{
      status: string;
      report_type: string;
      count: string;
      stale_count: string;
      oldest_generating_at: Date | null;
    }>(
      `
        SELECT
          status,
          report_type,
          count(*)::text AS count,
          count(*) FILTER (
            WHERE status = 'generating'
              AND generated_at < now() - ($2::int * interval '1 minute')
          )::text AS stale_count,
          min(generated_at) FILTER (WHERE status = 'generating') AS oldest_generating_at
        FROM report_generation_snapshots
        WHERE company_id = $1 ${reportTypeClause}
        GROUP BY status, report_type
        ORDER BY report_type, status
      `,
      params,
    );

    const failedParams: unknown[] = [companyId];
    const failedReportTypeClause = reportType ? "AND report_type = $2" : "";
    if (reportType) failedParams.push(reportType);
    failedParams.push(limit);
    const failedLimitParam = failedParams.length;
    const failed = await pool.query<{
      id: number;
      report_type: string;
      filename: string | null;
      generated_by: number | null;
      generated_at: Date;
      failed_at: Date | null;
      failure_reason: string | null;
    }>(
      `
        SELECT id, report_type, filename, generated_by, generated_at, failed_at, failure_reason
        FROM report_generation_snapshots
        WHERE company_id = $1 AND status = 'failed' ${failedReportTypeClause}
        ORDER BY coalesce(failed_at, generated_at) DESC
        LIMIT $${failedLimitParam}
      `,
      failedParams,
    );

    const staleParams = [...params, limit];
    const staleLimitParam = staleParams.length;
    const stale = await pool.query<{
      id: number;
      report_type: string;
      filename: string | null;
      generated_by: number | null;
      generated_at: Date;
    }>(
      `
        SELECT id, report_type, filename, generated_by, generated_at
        FROM report_generation_snapshots
        WHERE company_id = $1
          AND status = 'generating'
          AND generated_at < now() - ($2::int * interval '1 minute')
          ${reportTypeClause}
        ORDER BY generated_at ASC
        LIMIT $${staleLimitParam}
      `,
      staleParams,
    );

    res.json({
      status: "ok",
      staleMinutes,
      companyId,
      filters: { reportType: reportType ?? null, limit },
      counts: summary.rows.map(row => ({
        status: SNAPSHOT_STATUSES.has(row.status) ? row.status : "unknown",
        reportType: REPORT_TYPES.has(row.report_type) ? row.report_type : "unknown",
        count: Number(row.count),
        staleGeneratingCount: Number(row.stale_count),
        oldestGeneratingAt: row.oldest_generating_at?.toISOString() ?? null,
      })),
      staleGenerating: stale.rows.map(row => ({
        snapshotId: row.id,
        reportType: row.report_type,
        outputName: row.filename,
        generatedBy: row.generated_by,
        generatedAt: row.generated_at.toISOString(),
      })),
      failed: failed.rows.map(row => ({
        snapshotId: row.id,
        reportType: row.report_type,
        outputName: row.filename,
        generatedBy: row.generated_by,
        generatedAt: row.generated_at.toISOString(),
        failedAt: row.failed_at?.toISOString() ?? null,
        failureCategory: safeFailureCategory(row.failure_reason),
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid_")) {
      res.status(400).json({ error: "Gecersiz diagnostics parametresi" });
      return;
    }
    req.log.error(error);
    res.status(500).json({ error: "Diagnostics sorgusu calistirilamadi" });
  }
});

export default router;
