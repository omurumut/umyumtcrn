export type AiRuntimeConfig = {
  enabled: boolean;
  provider: "mock" | "gemini";
  providerConfigured: string;
  allowMockProvider: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  developmentDataPolicy: "demo_only" | "summary_only" | "full_context";
  mockMode: "success" | "timeout" | "rate_limited" | "invalid_schema" | "empty_response" | "provider_unavailable";
  gemini: GeminiRuntimeConfig;
};

export type GeminiRuntimeConfig = {
  apiKey: string | null;
  model: string | null;
  maxRetries: number;
  temperature: number;
  apiVersion: string | null;
};

function readBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

function readPositiveInteger(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readNumber(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function readDevelopmentDataPolicy(value: string | undefined): AiRuntimeConfig["developmentDataPolicy"] {
  if (value === "full_context" || value === "summary_only" || value === "demo_only") return value;
  return "demo_only";
}

function readProvider(value: string | undefined): AiRuntimeConfig["provider"] | "unknown" {
  const provider = value?.trim().toLowerCase() || "mock";
  if (provider === "mock" || provider === "gemini") return provider;
  return "unknown";
}

export function readAiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AiRuntimeConfig {
  const isProduction = env.NODE_ENV === "production";
  const mockMode = env.AI_MOCK_MODE?.trim().toLowerCase() || "success";
  const provider = readProvider(env.AI_PROVIDER);
  return {
    enabled: readBoolean(env.AI_ENABLED, true),
    provider: provider === "unknown" ? "mock" : provider,
    providerConfigured: env.AI_PROVIDER?.trim().toLowerCase() || "mock",
    allowMockProvider: readBoolean(env.AI_ALLOW_MOCK_PROVIDER, !isProduction),
    timeoutMs: readPositiveInteger(env.AI_TIMEOUT_MS, 30_000, 100, 120_000),
    maxOutputTokens: readPositiveInteger(env.AI_MAX_OUTPUT_TOKENS, 4_096, 100, 20_000),
    developmentDataPolicy: readDevelopmentDataPolicy(env.AI_DEVELOPMENT_DATA_POLICY),
    mockMode: ["timeout", "rate_limited", "invalid_schema", "empty_response", "provider_unavailable"].includes(mockMode)
      ? mockMode as AiRuntimeConfig["mockMode"]
      : "success",
    gemini: {
      apiKey: env.GEMINI_API_KEY?.trim() || null,
      model: env.GEMINI_MODEL?.trim() || null,
      maxRetries: readPositiveInteger(env.GEMINI_MAX_RETRIES, 1, 0, 1),
      temperature: readNumber(env.GEMINI_TEMPERATURE, 0.2, 0, 1),
      apiVersion: env.GEMINI_API_VERSION?.trim() || null,
    },
  };
}
