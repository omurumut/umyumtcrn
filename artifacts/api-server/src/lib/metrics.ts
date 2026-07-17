import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import { pool } from "@workspace/db";

const METRIC_PREFIX = "iso50001_";

type MetricsState = {
  registry: Registry;
  initialized: boolean;
  httpRequestsTotal: Counter<"method" | "route" | "status_class">;
  httpRequestDuration: Histogram<"method" | "route" | "status_class">;
  httpRequestsActive: Gauge;
  authEventsTotal: Counter<"event" | "reason">;
  dbEventsTotal: Counter<"event" | "outcome">;
  dbPoolGauge: Gauge<"state">;
  pdfRendersTotal: Counter<"report_type" | "outcome">;
  pdfRenderDuration: Histogram<"report_type" | "outcome">;
  pdfRenderActive: Gauge<"report_type">;
  importAttemptsTotal: Counter<"kind" | "outcome">;
  importRowsTotal: Counter<"kind" | "result">;
  mgmSyncTotal: Counter<"trigger" | "outcome">;
  auditEventsTotal: Counter<"action" | "outcome">;
  auditWriteFailuresTotal: Counter<"action">;
};

function createMetricsState(): MetricsState {
  const registry = new Registry();
  registry.setDefaultLabels({ service: "api-server" });
  collectDefaultMetrics({
    register: registry,
    prefix: METRIC_PREFIX,
    eventLoopMonitoringPrecision: 20,
  });

  const httpRequestsTotal = new Counter({
    name: `${METRIC_PREFIX}http_requests_total`,
    help: "HTTP request count by method, normalized route, and status class.",
    labelNames: ["method", "route", "status_class"],
    registers: [registry],
  });
  const httpRequestDuration = new Histogram({
    name: `${METRIC_PREFIX}http_request_duration_seconds`,
    help: "HTTP request duration by method, normalized route, and status class.",
    labelNames: ["method", "route", "status_class"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  const httpRequestsActive = new Gauge({
    name: `${METRIC_PREFIX}http_requests_active`,
    help: "Active HTTP request count.",
    registers: [registry],
  });
  const authEventsTotal = new Counter({
    name: `${METRIC_PREFIX}auth_events_total`,
    help: "Authentication event count.",
    labelNames: ["event", "reason"],
    registers: [registry],
  });
  const dbEventsTotal = new Counter({
    name: `${METRIC_PREFIX}db_events_total`,
    help: "Database and readiness event count.",
    labelNames: ["event", "outcome"],
    registers: [registry],
  });
  const dbPoolGauge = new Gauge({
    name: `${METRIC_PREFIX}db_pool_connections`,
    help: "PostgreSQL pool state.",
    labelNames: ["state"],
    registers: [registry],
    collect() {
      this.set({ state: "total" }, pool.totalCount);
      this.set({ state: "idle" }, pool.idleCount);
      this.set({ state: "waiting" }, pool.waitingCount);
    },
  });
  const pdfRendersTotal = new Counter({
    name: `${METRIC_PREFIX}pdf_renders_total`,
    help: "PDF render count.",
    labelNames: ["report_type", "outcome"],
    registers: [registry],
  });
  const pdfRenderDuration = new Histogram({
    name: `${METRIC_PREFIX}pdf_render_duration_seconds`,
    help: "PDF render duration.",
    labelNames: ["report_type", "outcome"],
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  });
  const pdfRenderActive = new Gauge({
    name: `${METRIC_PREFIX}pdf_render_active`,
    help: "Active PDF render count.",
    labelNames: ["report_type"],
    registers: [registry],
  });
  const importAttemptsTotal = new Counter({
    name: `${METRIC_PREFIX}import_attempts_total`,
    help: "Import attempt count by bounded kind and outcome.",
    labelNames: ["kind", "outcome"],
    registers: [registry],
  });
  const importRowsTotal = new Counter({
    name: `${METRIC_PREFIX}import_rows_total`,
    help: "Import row count by bounded kind and result.",
    labelNames: ["kind", "result"],
    registers: [registry],
  });
  const mgmSyncTotal = new Counter({
    name: `${METRIC_PREFIX}mgm_sync_total`,
    help: "MGM sync count by bounded trigger and outcome.",
    labelNames: ["trigger", "outcome"],
    registers: [registry],
  });
  const auditEventsTotal = new Counter({
    name: `${METRIC_PREFIX}audit_events_total`,
    help: "Audit events written by bounded action and outcome.",
    labelNames: ["action", "outcome"],
    registers: [registry],
  });
  const auditWriteFailuresTotal = new Counter({
    name: `${METRIC_PREFIX}audit_write_failures_total`,
    help: "Audit write failures by bounded action.",
    labelNames: ["action"],
    registers: [registry],
  });

  return {
    registry,
    initialized: true,
    httpRequestsTotal,
    httpRequestDuration,
    httpRequestsActive,
    authEventsTotal,
    dbEventsTotal,
    dbPoolGauge,
    pdfRendersTotal,
    pdfRenderDuration,
    pdfRenderActive,
    importAttemptsTotal,
    importRowsTotal,
    mgmSyncTotal,
    auditEventsTotal,
    auditWriteFailuresTotal,
  };
}

const globalMetrics = globalThis as typeof globalThis & { __iso50001Metrics?: MetricsState };
export const metrics = globalMetrics.__iso50001Metrics ??= createMetricsState();

export function resetMetricsForTests() {
  metrics.registry.resetMetrics();
}

function safeObserve(operation: () => void): void {
  try {
    operation();
  } catch {
    // Metrics are best-effort and must never fail business requests.
  }
}

export function statusClass(statusCode: number): "2xx" | "3xx" | "4xx" | "5xx" | "unknown" {
  if (statusCode >= 200 && statusCode < 300) return "2xx";
  if (statusCode >= 300 && statusCode < 400) return "3xx";
  if (statusCode >= 400 && statusCode < 500) return "4xx";
  if (statusCode >= 500 && statusCode < 600) return "5xx";
  return "unknown";
}

export function observeHttpRequest(labels: { method: string; route: string; statusCode: number; durationSeconds: number }) {
  const status_class = statusClass(labels.statusCode);
  safeObserve(() => {
    metrics.httpRequestsTotal.inc({ method: labels.method, route: labels.route, status_class });
    metrics.httpRequestDuration.observe({ method: labels.method, route: labels.route, status_class }, labels.durationSeconds);
  });
}

export function incActiveHttpRequest() {
  safeObserve(() => metrics.httpRequestsActive.inc());
}

export function decActiveHttpRequest() {
  safeObserve(() => metrics.httpRequestsActive.dec());
}

export function observeAuthEvent(event: string, reason = "none") {
  safeObserve(() => metrics.authEventsTotal.inc({ event, reason }));
}

export function observeDbEvent(event: string, outcome: "success" | "failure") {
  safeObserve(() => metrics.dbEventsTotal.inc({ event, outcome }));
}

export function observePdfRender(reportType: string, outcome: "success" | "failure", durationSeconds: number) {
  safeObserve(() => {
    metrics.pdfRendersTotal.inc({ report_type: reportType, outcome });
    metrics.pdfRenderDuration.observe({ report_type: reportType, outcome }, durationSeconds);
  });
}

export function incActivePdfRender(reportType: string) {
  safeObserve(() => metrics.pdfRenderActive.inc({ report_type: reportType }));
}

export function decActivePdfRender(reportType: string) {
  safeObserve(() => metrics.pdfRenderActive.dec({ report_type: reportType }));
}

export function observeImport(kind: string, outcome: "success" | "partial" | "failure", rows: { total: number; inserted?: number; updated?: number; failed?: number }) {
  safeObserve(() => {
    metrics.importAttemptsTotal.inc({ kind, outcome });
    metrics.importRowsTotal.inc({ kind, result: "total" }, rows.total);
    if (rows.inserted) metrics.importRowsTotal.inc({ kind, result: "inserted" }, rows.inserted);
    if (rows.updated) metrics.importRowsTotal.inc({ kind, result: "updated" }, rows.updated);
    if (rows.failed) metrics.importRowsTotal.inc({ kind, result: "failed" }, rows.failed);
  });
}

export function observeMgmSync(trigger: "manual" | "bootstrap" | "scheduler", outcome: "success" | "partial" | "failure") {
  safeObserve(() => metrics.mgmSyncTotal.inc({ trigger, outcome }));
}

export function observeAuditWritten(action: string, outcome: string) {
  safeObserve(() => metrics.auditEventsTotal.inc({ action, outcome }));
}

export function observeAuditFailure(action: string) {
  safeObserve(() => metrics.auditWriteFailuresTotal.inc({ action }));
}
