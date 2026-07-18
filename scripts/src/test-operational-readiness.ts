import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium, type Browser } from "playwright";
import { pool } from "@workspace/db";

const REQUIRED_MIGRATIONS = 29;
const REQUIRED_TABLES = [
  "audit_events",
  "companies",
  "users",
  "report_generation_snapshots",
  "company_report_profiles",
  "company_report_type_settings",
  "company_report_section_settings",
];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function databaseHost(): string {
  const raw = process.env.DATABASE_URL;
  assert(raw, "DATABASE_URL is required.");
  try {
    return new URL(raw).hostname;
  } catch {
    throw new Error("DATABASE_URL is invalid.");
  }
}

function assertReadOnlyEnvironment(): void {
  const host = databaseHost();
  const local = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (!local && process.env.OPERATIONAL_READINESS_ALLOW_REMOTE !== "true") {
    throw new Error("Remote DB diagnostics requires OPERATIONAL_READINESS_ALLOW_REMOTE=true.");
  }
}

async function checkBrowserDeepSmoke(): Promise<void> {
  const executablePath = chromium.executablePath();
  await access(executablePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><title>Operational readiness</title><p>ISO 50001 EMS</p>");
    const output = Buffer.from(await page.pdf({ format: "A4" }));
    assert(output.length > 1_024 && output.subarray(0, 5).toString("ascii") === "%PDF-", "Browser PDF smoke failed.");
    await page.close();
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  assertReadOnlyEnvironment();
  const started = Date.now();

  await pool.query({ text: "SELECT 1", query_timeout: 2_000 } as { text: string; query_timeout: number });
  const migrations = await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations");
  const migrationCount = Number(migrations.rows[0]?.count ?? 0);
  assert(migrationCount >= REQUIRED_MIGRATIONS, "Migration level is below required report infrastructure level.");

  const tableCheck = await pool.query<{ missing: string[] }>(
    "SELECT coalesce(array_agg(name), ARRAY[]::text[]) AS missing FROM unnest($1::text[]) AS required(name) WHERE to_regclass(required.name) IS NULL",
    [REQUIRED_TABLES],
  );
  assert((tableCheck.rows[0]?.missing ?? []).length === 0, "Critical table readiness failed.");

  const snapshotSummary = await pool.query<{
    generating: string;
    stale_generating: string;
    failed_recent: string;
  }>(
    `
      SELECT
        count(*) FILTER (WHERE status = 'generating')::text AS generating,
        count(*) FILTER (WHERE status = 'generating' AND generated_at < now() - interval '30 minutes')::text AS stale_generating,
        count(*) FILTER (WHERE status = 'failed' AND coalesce(failed_at, generated_at) > now() - interval '24 hours')::text AS failed_recent
      FROM report_generation_snapshots
    `,
  );

  await pool.query("SELECT 1 FROM audit_events LIMIT 1");
  await checkBrowserDeepSmoke();

  console.log(JSON.stringify({
    status: "ready",
    migrations: migrationCount,
    criticalTables: REQUIRED_TABLES.length,
    snapshots: {
      generating: Number(snapshotSummary.rows[0]?.generating ?? 0),
      staleGenerating: Number(snapshotSummary.rows[0]?.stale_generating ?? 0),
      failedRecent: Number(snapshotSummary.rows[0]?.failed_recent ?? 0),
    },
    browserDeepSmoke: "passed",
    elapsedMs: Date.now() - started,
  }));
}

main()
  .catch((error: unknown) => {
    console.error(`[test-operational-readiness] Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });
