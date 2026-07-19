import { createHash } from "node:crypto";
import type { Request } from "express";
import { auditEventsTable } from "@workspace/db";
import { observeAuditFailure, observeAuditWritten } from "./metrics.js";
import { resolveClientIp, UNKNOWN_CLIENT_IP } from "./client-ip.js";
import { resolveTrustProxyConfig } from "./proxy-config.js";

type DbLike = {
  insert: (table: typeof auditEventsTable) => {
    values: (value: typeof auditEventsTable.$inferInsert) => {
      returning: <T extends Record<string, unknown>>(fields: T) => Promise<T[]>;
    };
  };
};

export const AUDIT_ACTIONS = [
  "auth.login.success",
  "auth.login.failure",
  "auth.login.rate_limited",
  "auth.logout",
  "security.access.denied",
  "user.create",
  "user.update",
  "user.delete",
  "consumption.create",
  "consumption.update",
  "consumption.delete",
  "consumption.import",
  "seu.assessment.create",
  "seu.assessment.update",
  "seu.assessment.delete",
  "seu.assessment.accept",
  "target.create",
  "target.update",
  "target.delete",
  "action.create",
  "action.update",
  "action.delete",
  "target.progress.update",
  "vap.create",
  "vap.update",
  "vap.delete",
  "seed.execute",
  "seed.reset",
  "mgm.sync",
  "mgm.import",
  "superadmin.bootstrap",
  "company_profile.updated",
  "company_settings.created",
  "company_settings.updated",
  "company_logo.uploaded",
  "company_logo.replaced",
  "company_logo.deleted",
  "company_brand_settings.created",
  "company_brand_settings.updated",
  "company_report_profile.created",
  "company_report_profile.updated",
  "company_report_type_settings.created",
  "company_report_type_settings.updated",
  "energy_targets_report.generation_started",
  "energy_targets_report.generation_completed",
  "energy_targets_report.generation_failed",
  "energy_performance_report.generation_started",
  "energy_performance_report.generation_completed",
  "energy_performance_report.generation_failed",
  "annual_energy_performance_report.generation_started",
  "annual_energy_performance_report.generation_completed",
  "annual_energy_performance_report.generation_failed",
  "report_archive.record_created",
  "report_archive.completed",
  "report_archive.failed",
  "report_archive.downloaded",
  "report_archive.soft_deleted",
  "report_archive.restored",
  "report_archive.purge_started",
  "report_archive.purged",
  "report_archive.purge_failed",
  "report_retention_settings.created",
  "report_retention_settings.updated",
  "report_archive.missing_diagnostics_run",
  "report_archive.orphan_diagnostics_run",
  "report_archive.cleanup_dry_run",
  "report_archive.cleanup_executed",
  "unit_technical_profile.created",
  "unit_technical_profile.updated",
  "unit_technical_profile.published",
] as const;

export const AUDIT_OUTCOMES = ["success", "failure", "denied", "partial"] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];
export type AuditOutcome = typeof AUDIT_OUTCOMES[number];

export const AUDIT_ACTION_SET = new Set<string>(AUDIT_ACTIONS);
export const AUDIT_OUTCOME_SET = new Set<string>(AUDIT_OUTCOMES);

type AuditJson = null | boolean | number | string | AuditJson[] | { [key: string]: AuditJson };

export interface AuditEventInput {
  request?: Request;
  requestId?: string;
  actorUserId?: number | null;
  actorRole?: string | null;
  companyId?: number | null;
  unitId?: number | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | number | null;
  outcome?: AuditOutcome;
  changes?: unknown;
  metadata?: unknown;
}

const SECRET_KEY_PATTERN = /(password|hash|token|authorization|cookie|secret|api[_-]?key|database[_-]?url|connection|string|raw|file|stack|sql)/i;
const MAX_DEPTH = 4;
const MAX_KEYS = 30;
const MAX_ARRAY = 20;
const MAX_STRING = 256;
const MAX_JSON_BYTES = 12 * 1024;

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashAuditValue(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return null;
  return stableHash(value.trim().toLowerCase());
}

function boundedJson(value: unknown, depth = 0): AuditJson {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map(item => boundedJson(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, AuditJson> = {};
    for (const [key, raw] of Object.entries(value).slice(0, MAX_KEYS)) {
      output[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : boundedJson(raw, depth + 1);
    }
    return output;
  }
  return null;
}

export function sanitizeAuditJson(value: unknown): AuditJson {
  let sanitized = boundedJson(value);
  let serialized = JSON.stringify(sanitized);
  if (serialized.length > MAX_JSON_BYTES) {
    sanitized = { truncated: true, bytes: serialized.length };
    serialized = JSON.stringify(sanitized);
  }
  return JSON.parse(serialized) as AuditJson;
}

export function changedAuditFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: string[]) {
  const changes: Record<string, { before: AuditJson; after: AuditJson }> = {};
  for (const field of fields) {
    if (before[field] !== after[field]) {
      changes[field] = { before: sanitizeAuditJson(before[field]), after: sanitizeAuditJson(after[field]) };
    }
  }
  return changes;
}

function actorFromRequest(req?: Request) {
  const user = req?.user;
  const clientIp = req ? resolveClientIp(req) : UNKNOWN_CLIENT_IP;
  return {
    requestId: req?.id === undefined ? "system" : String(req.id),
    actorUserId: user?.userId ?? null,
    actorRole: user?.role ?? null,
    companyId: user?.companyId ?? null,
    unitId: user?.unitId ?? null,
    metadata: {
      ipHash: clientIp === UNKNOWN_CLIENT_IP ? null : stableHash(clientIp),
      proxyMode: resolveTrustProxyConfig().mode,
      userAgentHash: typeof req?.headers["user-agent"] === "string" ? stableHash(req.headers["user-agent"]) : null,
    },
  };
}

export async function writeAuditEvent(db: DbLike, input: AuditEventInput) {
  if (!AUDIT_ACTION_SET.has(input.action)) {
    observeAuditFailure("invalid");
    throw new Error("Invalid audit action");
  }
  const outcome = input.outcome ?? "success";
  if (!AUDIT_OUTCOME_SET.has(outcome)) {
    observeAuditFailure(input.action);
    throw new Error("Invalid audit outcome");
  }
  if (!/^[a-z][a-z0-9._-]{0,63}$/.test(input.entityType)) {
    observeAuditFailure(input.action);
    throw new Error("Invalid audit entity type");
  }

  const actor = actorFromRequest(input.request);
  const metadata = sanitizeAuditJson({ ...actor.metadata, ...((input.metadata ?? {}) as object) });

  try {
    const [event] = await db.insert(auditEventsTable).values({
      requestId: input.requestId ?? actor.requestId,
      actorUserId: input.actorUserId ?? actor.actorUserId,
      actorRole: input.actorRole ?? actor.actorRole,
      companyId: input.companyId ?? actor.companyId,
      unitId: input.unitId ?? actor.unitId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId === undefined || input.entityId === null ? null : String(input.entityId),
      outcome,
      changes: sanitizeAuditJson(input.changes ?? null),
      metadata,
    }).returning({ id: auditEventsTable.id });
    observeAuditWritten(input.action, outcome);
    return event.id;
  } catch (error) {
    observeAuditFailure(input.action);
    throw error;
  }
}

export async function writeBestEffortAudit(db: DbLike, input: AuditEventInput) {
  try {
    return await writeAuditEvent(db, input);
  } catch {
    return null;
  }
}
