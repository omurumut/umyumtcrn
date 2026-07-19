import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function main(): Promise<void> {
  if (
    process.env.REPORT_STORAGE_PROVIDER?.trim().toLowerCase() !== "s3"
    || process.env.REPORT_STORAGE_S3_SMOKE_ENABLE !== "true"
    || process.env.REPORT_STORAGE_S3_SMOKE_ACK !== "test-bucket"
  ) {
    console.log(JSON.stringify({ skipped: "not_configured", network: "not_used" }));
    return;
  }
  const storageModule = await import(pathToFileURL(resolve(import.meta.dirname, "../../artifacts/api-server/src/lib/report-storage.ts")).href) as {
    reportStorage: unknown;
    runReportStorageWriteSmoke(storage: unknown, acknowledged: boolean): Promise<"passed" | "skipped" | "failed">;
  };
  const result = await storageModule.runReportStorageWriteSmoke(storageModule.reportStorage, true);
  if (result !== "passed") throw new Error("S3 smoke failed.");
  console.log(JSON.stringify({
    status: "passed",
    checksumAlgorithm: createHash("sha256").update("report storage diagnostics smoke").digest("hex").length === 64 ? "sha256" : "unknown",
  }));
}

main().catch((error: unknown) => {
  console.error(`[test-report-storage-s3-smoke] Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
