import { constants, type Dirent } from "node:fs";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { applicationLifecycleState } from "../lib/lifecycle-state.js";
import { logger } from "../lib/logger.js";
import { observeDbEvent } from "../lib/metrics.js";
import { reportStorageReadinessStatus } from "../lib/report-storage.js";

const router: IRouter = Router();
const READINESS_TIMEOUT_MS = 2_000;
const REQUIRED_MIGRATIONS = 30;
const REQUIRED_TABLES = [
  "companies",
  "users",
  "company_report_profiles",
  "company_report_type_settings",
  "company_report_section_settings",
  "report_generation_snapshots",
  "report_archives",
] as const;

type CheckStatus = "ok" | "fail" | "skip";
type SafeCheck = {
  status: CheckStatus;
  category?: string;
  elapsedMs?: number;
};

type ReadinessBody = {
  status: "ready" | "not_ready";
  service: "iso50001-api";
  timestamp: string;
  checks: {
    lifecycle: SafeCheck;
    database: SafeCheck;
    schema: SafeCheck;
    browser: SafeCheck;
    frontend: SafeCheck;
    reportStorage: SafeCheck;
  };
  elapsedMs: number;
};

function elapsedSince(started: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - started) / 1_000_000);
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDatabaseReadiness(): Promise<void> {
  const query = {
    text: "SELECT 1",
    // Supported by pg at runtime; the current @types/pg QueryConfig omits it.
    query_timeout: READINESS_TIMEOUT_MS,
  };
  await pool.query(query);
}

async function checkSchemaReadiness(): Promise<void> {
  const migrationResult = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations",
  );
  const migrationCount = Number(migrationResult.rows[0]?.count ?? 0);
  if (!Number.isSafeInteger(migrationCount) || migrationCount < REQUIRED_MIGRATIONS) {
    throw new Error("migration_level");
  }

  const tableResult = await pool.query<{ missing: string[] }>(
    "SELECT coalesce(array_agg(name), ARRAY[]::text[]) AS missing FROM unnest($1::text[]) AS required(name) WHERE to_regclass(required.name) IS NULL",
    [REQUIRED_TABLES],
  );
  if ((tableResult.rows[0]?.missing ?? []).length > 0) {
    throw new Error("critical_table");
  }
}

async function checkBrowserReadiness(): Promise<void> {
  const explicitPath = process.env.PDF_CHROMIUM_EXECUTABLE_PATH?.trim();
  try {
    const executablePath = explicitPath && explicitPath.length > 0 ? explicitPath : chromium.executablePath();
    await access(executablePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return;
  } catch (error) {
    const cacheRoot = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
    if (!cacheRoot) {
      logger.warn({ explicitConfigured: Boolean(explicitPath), cacheConfigured: false, errorType: error instanceof Error ? error.name : typeof error }, "Browser readiness check failed");
      throw new Error("browser");
    }
    const discovered = await findChromiumExecutable(cacheRoot, 4);
    if (!discovered) {
      logger.warn({ explicitConfigured: Boolean(explicitPath), cacheConfigured: true, discovered: false, errorType: error instanceof Error ? error.name : typeof error }, "Browser readiness check failed");
      throw new Error("browser");
    }
    try {
      await access(discovered, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    } catch (discoveredError) {
      logger.warn({ explicitConfigured: Boolean(explicitPath), cacheConfigured: true, discovered: true, errorType: discoveredError instanceof Error ? discoveredError.name : typeof discoveredError }, "Browser readiness check failed");
      throw new Error("browser");
    }
  }
}

async function findChromiumExecutable(root: string, maxDepth: number): Promise<string | null> {
  if (maxDepth < 0) return null;
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const executableName = process.platform === "win32" ? "chrome.exe" : "chrome";
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === executableName) return fullPath;
    if (entry.isDirectory()) {
      const found = await findChromiumExecutable(fullPath, maxDepth - 1);
      if (found) return found;
    }
  }
  return null;
}

async function checkFrontendReadiness(): Promise<CheckStatus> {
  if (process.env.NODE_ENV !== "production") return "skip";
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDirectory, "../../ems-dashboard/dist/public/index.html"),
    path.resolve(currentDirectory, "../../../ems-dashboard/dist/public/index.html"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK);
      return "ok";
    } catch {
      // Try the next build layout without exposing local paths.
    }
  }
  throw new Error("frontend_artifact");
}

async function checkReportStorageReadiness(): Promise<CheckStatus> {
  const status = await reportStorageReadinessStatus();
  if (status === "pass") return "ok";
  if (status === "disabled") return "skip";
  throw new Error("report_storage");
}

async function safeCheck(name: string, operation: () => Promise<void | CheckStatus>): Promise<SafeCheck> {
  const started = process.hrtime.bigint();
  try {
    const result = await withTimeout(operation(), READINESS_TIMEOUT_MS);
    return { status: result === "skip" ? "skip" : "ok", elapsedMs: elapsedSince(started) };
  } catch (error) {
    const category = error instanceof Error && error.message === "timeout" ? "timeout" : name;
    return { status: "fail", category, elapsedMs: elapsedSince(started) };
  }
}

router.get("/healthz", (_req, res) => {
  if (applicationLifecycleState().isShuttingDown) {
    res.status(503).json({ status: "draining" });
    return;
  }
  observeDbEvent("health_check", "success");
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  const started = process.hrtime.bigint();
  const lifecycle = applicationLifecycleState();
  const body: ReadinessBody = {
    status: "not_ready",
    service: "iso50001-api",
    timestamp: new Date().toISOString(),
    checks: {
      lifecycle: { status: lifecycle.isReady && !lifecycle.isShuttingDown ? "ok" : "fail", category: "lifecycle" },
      database: { status: "fail", category: "not_checked" },
      schema: { status: "fail", category: "not_checked" },
      browser: { status: "fail", category: "not_checked" },
      frontend: { status: "fail", category: "not_checked" },
      reportStorage: { status: "fail", category: "not_checked" },
    },
    elapsedMs: 0,
  };

  if (!lifecycle.isReady || lifecycle.isShuttingDown) {
    body.elapsedMs = elapsedSince(started);
    res.status(503).json(body);
    return;
  }

  body.checks.database = await safeCheck("database", checkDatabaseReadiness);
  body.checks.schema = body.checks.database.status === "ok"
    ? await safeCheck("schema", checkSchemaReadiness)
    : { status: "fail", category: "database_unavailable" };
  body.checks.browser = await safeCheck("browser", checkBrowserReadiness);
  body.checks.frontend = await safeCheck("frontend", checkFrontendReadiness);
  body.checks.reportStorage = await safeCheck("reportStorage", checkReportStorageReadiness);
  body.elapsedMs = elapsedSince(started);

  const ready = Object.values(body.checks).every(check => check.status === "ok" || check.status === "skip");
  if (ready) {
    body.status = "ready";
    observeDbEvent("readiness_check", "success");
    res.json(body);
    return;
  }

  observeDbEvent("readiness_check", "failure");
  logger.warn({
    database: body.checks.database.status,
    schema: body.checks.schema.status,
    browser: body.checks.browser.status,
    frontend: body.checks.frontend.status,
    reportStorage: body.checks.reportStorage.status,
  }, "Readiness check failed");
  res.status(503).json(body);
});

export default router;
