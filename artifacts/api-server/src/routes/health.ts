import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { applicationLifecycleState } from "../lib/lifecycle-state.js";
import { logger } from "../lib/logger.js";
import { observeDbEvent } from "../lib/metrics.js";

const router: IRouter = Router();
const READINESS_TIMEOUT_MS = 2_000;

async function checkDatabaseReadiness(): Promise<void> {
  const query = {
    text: "SELECT 1",
    // Supported by pg at runtime; the current @types/pg QueryConfig omits it.
    query_timeout: READINESS_TIMEOUT_MS,
  };
  await pool.query(query);
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
  const lifecycle = applicationLifecycleState();
  if (!lifecycle.isReady || lifecycle.isShuttingDown) {
    res.status(503).json({ status: "not_ready" });
    return;
  }

  try {
    await checkDatabaseReadiness();
    observeDbEvent("readiness_check", "success");
    res.json({ status: "ready" });
  } catch {
    observeDbEvent("readiness_check", "failure");
    logger.warn("Readiness database check failed");
    res.status(503).json({ status: "not_ready" });
  }
});

export default router;
