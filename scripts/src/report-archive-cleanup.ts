import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { pool } from "@workspace/db";

type Args = {
  companyId: number | null;
  execute: boolean;
  ack: string | null;
  maxCount: number;
  maxBytes: number;
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const parsed: Args = { companyId: null, execute: false, ack: null, maxCount: 25, maxBytes: 50 * 1024 * 1024 };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const next = args[i + 1];
    if (arg === "--execute") parsed.execute = true;
    else if (arg === "--company-id" && next) { parsed.companyId = Number(next); i += 1; }
    else if (arg === "--ack" && next) { parsed.ack = next; i += 1; }
    else if (arg === "--max-count" && next) { parsed.maxCount = Number(next); i += 1; }
    else if (arg === "--max-bytes" && next) { parsed.maxBytes = Number(next); i += 1; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(parsed.companyId) || parsed.companyId === null || parsed.companyId <= 0) throw new Error("--company-id is required.");
  if (!Number.isSafeInteger(parsed.maxCount) || parsed.maxCount < 1 || parsed.maxCount > 500) throw new Error("--max-count must be 1-500.");
  if (!Number.isSafeInteger(parsed.maxBytes) || parsed.maxBytes < 1 || parsed.maxBytes > 1024 * 1024 * 1024) throw new Error("--max-bytes must be bounded.");
  return parsed;
}

function assertWriteEnvironment(args: Args): void {
  if (!args.execute) return;
  const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  const local = databaseUrl && ["localhost", "127.0.0.1", "::1"].includes(databaseUrl.hostname);
  const expectedAck = `EXECUTE_REPORT_ARCHIVE_CLEANUP_${args.companyId}`;
  if (args.ack !== expectedAck) throw new Error(`Execute requires --ack ${expectedAck}.`);
  if (!local && process.env.REPORT_ARCHIVE_CLEANUP_REMOTE_ACK !== expectedAck) {
    throw new Error("Remote cleanup execution requires REPORT_ARCHIVE_CLEANUP_REMOTE_ACK.");
  }
}

async function loadStorage() {
  const moduleUrl = pathToFileURL(resolve(import.meta.dirname, "../../artifacts/api-server/src/lib/report-storage.ts")).href;
  return import(moduleUrl) as Promise<{
    reportStorage: { delete(key: string): Promise<void>; provider: string };
    ReportStorageError: new(category: string) => Error;
  }>;
}

async function main(): Promise<void> {
  const args = parseArgs();
  assertWriteEnvironment(args);
  const candidates = await pool.query<{
    id: number;
    status: string;
    report_type: string;
    size_bytes: number | null;
    storage_key: string | null;
  }>(
    `
      SELECT id, status, report_type, size_bytes, storage_key
      FROM report_archives
      WHERE company_id=$1
        AND deletion_locked=false
        AND (
          (status='deleted' AND purge_eligible_at IS NOT NULL AND purge_eligible_at <= now())
          OR (status IN ('completed','failed') AND retention_expires_at IS NOT NULL AND retention_expires_at <= now())
          OR status='purge_failed'
        )
      ORDER BY coalesce(purge_eligible_at, retention_expires_at, updated_at) ASC, id ASC
      LIMIT $2
    `,
    [args.companyId, args.maxCount],
  );
  const totalBytes = candidates.rows.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0);
  const plan = {
    mode: args.execute ? "execute" : "dry-run",
    companyId: args.companyId,
    candidateCount: candidates.rows.length,
    totalBytes,
    maxCount: args.maxCount,
    maxBytes: args.maxBytes,
    candidates: candidates.rows.map((row) => ({ id: row.id, status: row.status, reportType: row.report_type, hasStorageObject: row.storage_key !== null })),
  };
  if (!args.execute) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (totalBytes > args.maxBytes) throw new Error("Candidate bytes exceed --max-bytes.");
  const { reportStorage } = await loadStorage();
  let purged = 0;
  let failed = 0;
  for (const row of candidates.rows) {
    const claimed = await pool.query<{ id: number; storage_key: string | null }>(
      "UPDATE report_archives SET status='purging', updated_at=now(), lifecycle_version=lifecycle_version+1 WHERE id=$1 AND company_id=$2 AND status=$3 RETURNING id, storage_key",
      [row.id, args.companyId, row.status],
    );
    const current = claimed.rows[0];
    if (!current) continue;
    try {
      if (current.storage_key) await reportStorage.delete(current.storage_key);
      await pool.query("UPDATE report_archives SET status='purged', purged_at=now(), storage_key=NULL, storage_provider=NULL, purge_failure_category=NULL, updated_at=now(), lifecycle_version=lifecycle_version+1 WHERE id=$1", [row.id]);
      purged += 1;
    } catch {
      await pool.query("UPDATE report_archives SET status='purge_failed', purge_failure_category='storage_delete_failed', updated_at=now(), lifecycle_version=lifecycle_version+1 WHERE id=$1", [row.id]);
      failed += 1;
    }
  }
  console.log(JSON.stringify({ ...plan, storageProvider: reportStorage.provider, purged, failed }, null, 2));
}

main()
  .catch((error) => {
    console.error(`[report-archive-cleanup] Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
