import { createHash } from "node:crypto";
import { AiProviderError } from "./errors.js";
import type { AiAnalysisEvidence, AiDataSufficiency, AiDataSufficiencyStatus, AiEvidenceRegistry } from "./context-types.js";

const SENSITIVE_KEY_PATTERN = /(password|passwordhash|token|session|authorization|apikey|api_key|secret|email|phone|contactname|taxnumber|identitynumber|address|invoice|filepath|storagekey|downloadurl)/i;

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(6));
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      output[key] = canonicalize(item);
    }
    return output;
  }
  return String(value);
}

export function stripSensitiveKeys<T>(value: T): T {
  return stripSensitive(value) as T;
}

function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key.replace(/[-_\s]/g, ""))) continue;
    output[key] = stripSensitive(item);
  }
  return output;
}

export function sanitizeFreeText(value: unknown, maxChars: number): { content: string; truncated: boolean } | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return {
    content: normalized.slice(0, maxChars),
    truncated: normalized.length > maxChars,
  };
}

export function sufficiency(input: {
  recordCount: number;
  expectedCount?: number | null;
  missingPeriods?: string[];
  missingFields?: string[];
  warnings?: string[];
  lastUpdatedAt?: string | null;
  sourceVersion?: string | null;
}): AiDataSufficiency {
  const expectedCount = input.expectedCount ?? null;
  const coveragePercent = expectedCount && expectedCount > 0
    ? Math.round(Math.min(100, (input.recordCount / expectedCount) * 100))
    : null;
  const missingPeriods = input.missingPeriods ?? [];
  const missingFields = input.missingFields ?? [];
  const warnings = input.warnings ?? [];
  let status: AiDataSufficiencyStatus = "unavailable";
  if (input.recordCount > 0) {
    status = missingPeriods.length === 0 && missingFields.length === 0 && (coveragePercent === null || coveragePercent >= 95)
      ? "complete"
      : "partial";
  }
  if (expectedCount !== null && input.recordCount === 0 && expectedCount > 0) status = "insufficient";
  return {
    status,
    recordCount: input.recordCount,
    expectedCount,
    coveragePercent,
    missingPeriods,
    missingFields,
    warnings,
    lastUpdatedAt: input.lastUpdatedAt ?? null,
    sourceVersion: input.sourceVersion ?? null,
  };
}

export function evidenceId(prefix: string, parts: Array<string | number | null>) {
  const stable = parts.map((part) => part === null ? "none" : String(part)).join(":");
  return `ev:${prefix}:${createHash("sha256").update(stable).digest("hex").slice(0, 12)}`;
}

export function createEvidenceRegistry(records: AiAnalysisEvidence[], opaqueRefMap: AiEvidenceRegistry["opaqueRefMap"]): AiEvidenceRegistry {
  const sorted = [...records].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  return { records: sorted, opaqueRefMap };
}

export function validateFindingEvidenceRefs(analysis: { findings: Array<{ evidence: Array<{ source: string }> }> }, registry: AiEvidenceRegistry | undefined) {
  if (!registry) return;
  const allowed = new Set(registry.records.map((record) => record.evidenceId));
  for (const finding of analysis.findings) {
    for (const evidence of finding.evidence) {
      if (!allowed.has(evidence.source)) {
        throw new AiProviderError({
          code: "AI_SCHEMA_INVALID",
          status: 502,
          message: "Provider kayitli olmayan evidence referansi uretti",
        });
      }
    }
  }
}

export function maxIso(values: Array<Date | string | null | undefined>) {
  return values
    .map((value) => value instanceof Date ? value.toISOString() : value ?? null)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

export function increment(map: Record<string, number>, key: string | null | undefined) {
  const normalized = key?.trim() || "unknown";
  map[normalized] = (map[normalized] ?? 0) + 1;
}

export function round(value: number | null | undefined, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}
