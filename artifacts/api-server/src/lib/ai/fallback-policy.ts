import { AiProviderError } from "./errors.js";
import type { CompanyAiPolicy } from "./analysis-service.js";

const FALLBACK_CODES = new Set([
  "AI_TIMEOUT",
  "AI_RATE_LIMITED",
  "AI_QUOTA_EXHAUSTED",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_EMPTY_RESPONSE",
  "AI_SCHEMA_INVALID",
  "AI_CIRCUIT_OPEN",
]);

const NEVER_FALLBACK_CODES = new Set([
  "AI_DISABLED",
  "AI_NOT_CONFIGURED",
  "AI_AUTHENTICATION_FAILED",
  "AI_INVALID_REQUEST",
  "AI_USER_CONCURRENCY_LIMIT",
  "AI_COMPANY_CONCURRENCY_LIMIT",
  "AI_DAILY_LIMIT_REACHED",
  "AI_MONTHLY_LIMIT_REACHED",
]);

export function shouldUseFallback(error: unknown, context: { policy: CompanyAiPolicy; primaryProvider: string }) {
  if (!(error instanceof AiProviderError)) return false;
  if (!context.policy.fallbackEnabled) return false;
  if (context.primaryProvider !== "gemini" && context.primaryProvider !== "mock") return false;
  if (context.policy.dataPolicy === "disabled") return false;
  if (NEVER_FALLBACK_CODES.has(error.code)) return false;
  return FALLBACK_CODES.has(error.code);
}

export function shouldTripCircuit(error: unknown) {
  if (!(error instanceof AiProviderError)) return false;
  return error.code === "AI_TIMEOUT"
    || error.code === "AI_RATE_LIMITED"
    || error.code === "AI_PROVIDER_UNAVAILABLE"
    || error.code === "AI_QUOTA_EXHAUSTED";
}
