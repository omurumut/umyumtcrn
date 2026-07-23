import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { AiProviderError } from "./errors.js";
import type { AiRuntimeConfig } from "./config.js";

type CircuitRow = {
  provider: string;
  model: string;
  state: "closed" | "open" | "half_open";
  failure_count: number;
  window_started_at: Date | null;
  opened_at: Date | null;
  next_probe_at: Date | null;
  probe_lease_owner: string | null;
  probe_lease_expires_at: Date | null;
  last_failure_code: string | null;
  last_failure_at: Date | null;
  last_success_at: Date | null;
  version: number;
};

const PROBE_LEASE_MS = 30_000;

export async function beforeProviderCall(provider: string, model: string, config: AiRuntimeConfig, leaseOwner: string = randomUUID()) {
  if (!config.circuitBreakerEnabled) return { state: "disabled" as const };
  await ensureCircuitRow(provider, model);
  const row = await getCircuitRow(provider, model);
  if (!row) return { state: "closed" as const };
  const now = Date.now();
  const leaseExpiresAt = new Date(now + PROBE_LEASE_MS);

  if (row.state === "closed") return { state: "closed" as const };
  if (row.state === "open") {
    if (!row.next_probe_at || row.next_probe_at.getTime() > now) throw circuitOpenError();
    const probe = await claimHalfOpenProbe(provider, model, leaseOwner, leaseExpiresAt, "open");
    if (probe) return { state: "half_open_probe" as const };
    throw circuitOpenError();
  }
  if (!row.probe_lease_expires_at || row.probe_lease_expires_at.getTime() <= now) {
    const probe = await claimHalfOpenProbe(provider, model, leaseOwner, leaseExpiresAt, "half_open");
    if (probe) return { state: "half_open_probe" as const };
  }
  throw circuitOpenError();
}

export async function recordProviderSuccess(provider: string, model: string) {
  await ensureCircuitRow(provider, model);
  await pool.query(
    `
      UPDATE ai_provider_circuit_state
      SET state='closed',
          failure_count=0,
          window_started_at=NULL,
          opened_at=NULL,
          next_probe_at=NULL,
          probe_lease_owner=NULL,
          probe_lease_expires_at=NULL,
          last_failure_code=NULL,
          last_success_at=now(),
          updated_at=now(),
          version=version+1
      WHERE provider=$1 AND model=$2
    `,
    [provider, model],
  );
}

export async function recordProviderFailure(provider: string, model: string, code: string, config: AiRuntimeConfig) {
  if (!config.circuitBreakerEnabled) return { opened: false };
  await ensureCircuitRow(provider, model);
  const row = await getCircuitRow(provider, model);
  const now = Date.now();
  const windowStart = row?.window_started_at?.getTime() ?? 0;
  const inWindow = windowStart > 0 && now - windowStart <= config.circuitBreakerWindowMs;
  const failureCount = inWindow ? (row?.failure_count ?? 0) + 1 : 1;
  const opens = row?.state === "half_open" || failureCount >= config.circuitBreakerFailureThreshold;
  const nextProbeAt = new Date(now + config.circuitBreakerCooldownMs);
  await pool.query(
    `
      UPDATE ai_provider_circuit_state
      SET state=$3,
          failure_count=$4,
          window_started_at=$5,
          opened_at=CASE WHEN $6 THEN now() ELSE opened_at END,
          next_probe_at=CASE WHEN $6 THEN $7 ELSE next_probe_at END,
          probe_lease_owner=CASE WHEN $6 THEN NULL ELSE probe_lease_owner END,
          probe_lease_expires_at=CASE WHEN $6 THEN NULL ELSE probe_lease_expires_at END,
          last_failure_code=$8,
          last_failure_at=now(),
          updated_at=now(),
          version=version+1
      WHERE provider=$1 AND model=$2
    `,
    [
      provider,
      model,
      opens ? "open" : "closed",
      failureCount,
      inWindow ? row?.window_started_at ?? new Date(now) : new Date(now),
      opens,
      nextProbeAt,
      code,
    ],
  );
  return { opened: opens };
}

export async function getCircuitDiagnostics() {
  const result = await pool.query<CircuitRow>(
    `
      SELECT provider, model, state, failure_count, window_started_at, opened_at, next_probe_at,
             probe_lease_owner, probe_lease_expires_at, last_failure_code, last_failure_at,
             last_success_at, version
      FROM ai_provider_circuit_state
      ORDER BY provider, model
    `,
  );
  return result.rows.map((row) => ({
    id: `${row.provider}:${row.model}`,
    provider: row.provider,
    model: row.model,
    state: row.state,
    failureCount: row.failure_count,
    openedAt: row.opened_at?.toISOString() ?? null,
    nextProbeAt: row.next_probe_at?.toISOString() ?? null,
    probeLeaseActive: Boolean(row.probe_lease_expires_at && row.probe_lease_expires_at.getTime() > Date.now()),
    lastFailureCode: row.last_failure_code,
    lastFailureAt: row.last_failure_at?.toISOString() ?? null,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    version: row.version,
  }));
}

export async function resetCircuitStateForTests() {
  await pool.query("DELETE FROM ai_provider_circuit_state");
}

async function ensureCircuitRow(provider: string, model: string) {
  await pool.query(
    `
      INSERT INTO ai_provider_circuit_state (provider, model)
      VALUES ($1, $2)
      ON CONFLICT (provider, model) DO NOTHING
    `,
    [provider, model],
  );
}

async function getCircuitRow(provider: string, model: string) {
  const result = await pool.query<CircuitRow>(
    "SELECT * FROM ai_provider_circuit_state WHERE provider=$1 AND model=$2",
    [provider, model],
  );
  return result.rows[0] ?? null;
}

async function claimHalfOpenProbe(
  provider: string,
  model: string,
  leaseOwner: string,
  leaseExpiresAt: Date,
  currentState: "open" | "half_open",
) {
  const result = await pool.query<{ id: number }>(
    `
      UPDATE ai_provider_circuit_state
      SET state='half_open',
          probe_lease_owner=$3,
          probe_lease_expires_at=$4,
          updated_at=now(),
          version=version+1
      WHERE provider=$1
        AND model=$2
        AND state=$5
        AND (
          $5='open'
          OR probe_lease_expires_at IS NULL
          OR probe_lease_expires_at <= now()
        )
      RETURNING id
    `,
    [provider, model, leaseOwner, leaseExpiresAt, currentState],
  );
  return result.rowCount === 1;
}

function circuitOpenError() {
  return new AiProviderError({
    code: "AI_CIRCUIT_OPEN",
    status: 503,
    retryable: true,
    message: "AI provider gecici olarak kullanilamiyor",
  });
}
