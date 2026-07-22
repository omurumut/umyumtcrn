import { AiProviderError } from "./errors.js";
import type { AiRuntimeConfig } from "./config.js";

type CircuitState = {
  state: "closed" | "open" | "half_open";
  failures: number[];
  openedAt: number | null;
  halfOpenProbe: boolean;
  lastErrorCode: string | null;
  lastSuccessAt: string | null;
};

const circuits = new Map<string, CircuitState>();

function key(provider: string, model: string) {
  return `${provider}:${model}`;
}

function stateFor(provider: string, model: string) {
  const id = key(provider, model);
  let state = circuits.get(id);
  if (!state) {
    state = { state: "closed", failures: [], openedAt: null, halfOpenProbe: false, lastErrorCode: null, lastSuccessAt: null };
    circuits.set(id, state);
  }
  return state;
}

export function beforeProviderCall(provider: string, model: string, config: AiRuntimeConfig) {
  if (!config.circuitBreakerEnabled) return { state: "disabled" as const };
  const state = stateFor(provider, model);
  const now = Date.now();
  if (state.state === "open") {
    if (state.openedAt !== null && now - state.openedAt >= config.circuitBreakerCooldownMs) {
      if (state.halfOpenProbe) throw circuitOpenError();
      state.state = "half_open";
      state.halfOpenProbe = true;
      return { state: "half_open_probe" as const };
    }
    throw circuitOpenError();
  }
  if (state.state === "half_open") {
    if (state.halfOpenProbe) throw circuitOpenError();
    state.halfOpenProbe = true;
    return { state: "half_open_probe" as const };
  }
  return { state: "closed" as const };
}

export function recordProviderSuccess(provider: string, model: string) {
  const state = stateFor(provider, model);
  state.state = "closed";
  state.failures = [];
  state.openedAt = null;
  state.halfOpenProbe = false;
  state.lastErrorCode = null;
  state.lastSuccessAt = new Date().toISOString();
}

export function recordProviderFailure(provider: string, model: string, code: string, config: AiRuntimeConfig) {
  if (!config.circuitBreakerEnabled) return { opened: false };
  const state = stateFor(provider, model);
  const now = Date.now();
  state.lastErrorCode = code;
  state.failures = state.failures.filter((time) => now - time <= config.circuitBreakerWindowMs);
  state.failures.push(now);
  if (state.state === "half_open" || state.failures.length >= config.circuitBreakerFailureThreshold) {
    state.state = "open";
    state.openedAt = now;
    state.halfOpenProbe = false;
    return { opened: true };
  }
  return { opened: false };
}

export function getCircuitDiagnostics() {
  return Array.from(circuits.entries()).map(([id, state]) => ({
    id,
    state: state.state,
    failureCount: state.failures.length,
    openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : null,
    lastErrorCode: state.lastErrorCode,
    lastSuccessAt: state.lastSuccessAt,
  }));
}

export function resetCircuitStateForTests() {
  circuits.clear();
}

function circuitOpenError() {
  return new AiProviderError({
    code: "AI_CIRCUIT_OPEN",
    status: 503,
    retryable: true,
    message: "AI provider gecici olarak kullanilamiyor",
  });
}
