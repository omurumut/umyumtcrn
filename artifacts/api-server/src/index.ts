import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { closeDatabasePool, databasePoolConfig, runMigrations } from "@workspace/db";
import { bootstrapSuperAdminIfEnabled } from "./routes/auth.js";
import {
  type MgmSchedulerHandle,
  seedStationsIfEmpty,
  seedDegreeDataIfEmpty,
  startMgmDailyScheduler,
} from "./services/mgm-sync.js";
import { bootstrapMgmReferenceData } from "./services/mgm-bootstrap.js";
import {
  applicationLifecycleState,
  beginApplicationShutdown,
  markApplicationReady,
} from "./lib/lifecycle-state.js";
import { observeDbEvent, observeMgmSync } from "./lib/metrics.js";

const SHUTDOWN_TIMEOUT_MS = 15_000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "drizzle");

let httpServer: Server | null = null;
let schedulerHandle: MgmSchedulerHandle | null = null;

function applicationPort(): number {
  const rawPort = process.env.PORT;
  if (!rawPort || !/^\d+$/.test(rawPort)) {
    throw new Error("PORT must be a positive integer.");
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("PORT must be between 1 and 65535.");
  }
  return port;
}

async function closeHttpServer(): Promise<void> {
  if (!httpServer) return;
  const server = httpServer;
  httpServer = null;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (!beginApplicationShutdown()) {
    logger.warn({ signal }, "Second shutdown signal received; forcing exit");
    process.exit(1);
  }

  logger.info({ signal }, "Graceful shutdown started");
  const timeout = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timeout.unref();

  let failed = false;
  try {
    if (schedulerHandle) {
      const handle = schedulerHandle;
      schedulerHandle = null;
      await handle.stop();
    }
    await closeHttpServer();
  } catch (error) {
    failed = true;
    logger.error({ err: error }, "HTTP or scheduler shutdown failed");
  }

  try {
    await closeDatabasePool();
    observeDbEvent("pool_close", "success");
  } catch (error) {
    failed = true;
    observeDbEvent("pool_close", "failure");
    logger.error({ err: error }, "Database pool shutdown failed");
  } finally {
    clearTimeout(timeout);
  }

  process.exitCode = failed ? 1 : 0;
  logger.info({ failed }, "Graceful shutdown complete");
}

function registerSignalHandlers(): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

async function listen(port: number): Promise<void> {
  const server = app.listen(port, "0.0.0.0");
  httpServer = server;
  await new Promise<void>((resolve, reject) => {
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
  });
}

async function startOptionalMgmServices(): Promise<void> {
  let bootstrapPromise: Promise<void> = Promise.resolve();
  if (process.env.ENABLE_MGM_BOOTSTRAP === "true") {
    bootstrapPromise = bootstrapMgmReferenceData()
      .then(() => seedStationsIfEmpty())
      .then(() => seedDegreeDataIfEmpty())
      .catch(error => logger.error({ err: error }, "MGM bootstrap failed"));
  }

  if (process.env.ENABLE_MGM_SCHEDULER !== "true") {
    logger.info("MGM scheduler disabled");
    return;
  }
  if (process.env.MGM_SCHEDULER_INSTANCE_MODE !== "single") {
    logger.warn("MGM scheduler refused: approved single-instance mode is not confirmed");
    return;
  }

  await bootstrapPromise;
  if (applicationLifecycleState().isShuttingDown) return;
  schedulerHandle = startMgmDailyScheduler();
  logger.info("MGM scheduler enabled in approved single-instance mode");
}

async function start(): Promise<void> {
  registerSignalHandlers();
  try {
    const port = applicationPort();
    logger.info({
      poolMax: databasePoolConfig.max,
      idleTimeoutMs: databasePoolConfig.idleTimeoutMillis,
      connectionTimeoutMs: databasePoolConfig.connectionTimeoutMillis,
      maxUses: databasePoolConfig.maxUses ?? null,
    }, "Database pool configured");
    logger.info("Running database migrations...");
    await runMigrations(migrationsFolder);
    observeDbEvent("migration_startup", "success");
    logger.info("Migrations complete");
    await bootstrapSuperAdminIfEnabled();
    if (applicationLifecycleState().isShuttingDown) return;
    await listen(port);
    if (applicationLifecycleState().isShuttingDown) return;
    markApplicationReady();
    logger.info({ port }, "Server listening and ready");
    void startOptionalMgmServices().catch(error => {
      observeMgmSync("bootstrap", "failure");
      logger.error({ err: error }, "MGM optional service startup failed");
    });
  } catch {
    observeDbEvent("migration_startup", "failure");
    logger.error("Application startup failed");
    if (!applicationLifecycleState().isShuttingDown) {
      beginApplicationShutdown();
      try {
        await closeHttpServer();
        await closeDatabasePool();
      } catch (error) {
        logger.error({ err: error }, "Startup cleanup failed");
      }
      process.exitCode = 1;
    }
  }
}

void start();
