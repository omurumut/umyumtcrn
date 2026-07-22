import { AiProviderError, type AiProviderErrorCode } from "./errors.js";

type ErrorLike = {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
  cause?: unknown;
  response?: {
    status?: unknown;
    headers?: unknown;
  };
  error?: {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
};

export function classifyGeminiError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const details = extractGeminiErrorDetails(error);
  if (isAbortError(error)) {
    return new AiProviderError({ code: "AI_TIMEOUT", status: 504, retryable: true, message: "Gemini provider zaman asimina ugradi", ...details });
  }
  const status = details.httpStatus ?? numericStatus(error);
  if (status === 401 || status === 403) {
    return new AiProviderError({ code: "AI_AUTHENTICATION_FAILED", status: 503, message: "Gemini kimlik dogrulamasi basarisiz", ...details });
  }
  if (status === 400) {
    return new AiProviderError({ code: "AI_INVALID_REQUEST", status: 502, message: "Gemini istegi gecersiz", ...details });
  }
  if (status === 429) {
    const quota = reliableQuotaSignal(error) || /quota|resource_exhausted/i.test(details.providerErrorCode ?? "");
    return new AiProviderError({
      code: quota ? "AI_QUOTA_EXHAUSTED" : "AI_RATE_LIMITED",
      status: 429,
      retryable: !quota,
      message: quota ? "Gemini kotasi tukenmis gorunuyor" : "Gemini rate limit uyguladi",
      ...details,
    });
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return new AiProviderError({ code: "AI_PROVIDER_UNAVAILABLE", status: 503, retryable: true, message: "Gemini provider gecici olarak kullanilamiyor", ...details });
  }
  if (typeof status === "number") {
    return new AiProviderError({ code: "AI_UNKNOWN_PROVIDER_ERROR", status: 502, message: "Gemini provider hatasi siniflandirilamadi", ...details });
  }
  return new AiProviderError({ code: "AI_PROVIDER_UNAVAILABLE", status: 503, retryable: true, message: "Gemini provider ag hatasi", ...details });
}

export function isRetryableGeminiError(error: AiProviderError) {
  return error.code === "AI_RATE_LIMITED" || error.code === "AI_PROVIDER_UNAVAILABLE" || error.code === "AI_TIMEOUT";
}

export function retryAfterMs(error: unknown): number | null {
  const headers = (error as ErrorLike | null)?.response?.headers;
  const value = headerValue(headers, "retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 30) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.min(30_000, date - Date.now()));
  return null;
}

function numericStatus(error: unknown): number | null {
  const err = error as ErrorLike | null;
  const candidates = [err?.status, err?.code, err?.response?.status, err?.error?.code, err?.error?.status];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isSafeInteger(candidate)) return candidate;
    if (typeof candidate === "string" && /^\d+$/.test(candidate)) return Number(candidate);
  }
  return null;
}

function isAbortError(error: unknown) {
  const err = error as ErrorLike | null;
  return err?.name === "AbortError" || err?.name === "TimeoutError";
}

function reliableQuotaSignal(error: unknown) {
  const err = error as ErrorLike | null;
  const text = typeof err?.error?.message === "string" ? err.error.message : typeof err?.message === "string" ? err.message : "";
  return /\bquota\b|\bresource_exhausted\b/i.test(text);
}

function headerValue(headers: unknown, name: string) {
  if (!headers) return null;
  if (typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as { get: (key: string) => unknown }).get(name);
    return typeof value === "string" ? value : null;
  }
  if (typeof headers === "object") {
    const record = headers as Record<string, unknown>;
    const value = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
    return typeof value === "string" ? value : null;
  }
  return null;
}

export function safeGeminiErrorMeta(error: AiProviderError): { code: AiProviderErrorCode; retryable: boolean } {
  return { code: error.code, retryable: error.retryable };
}

export function geminiDiagnosticSummary({
  provider,
  model,
  error,
}: {
  provider: "gemini";
  model: string | null;
  error: AiProviderError;
}) {
  return {
    provider,
    model,
    classifiedCode: error.code,
    httpStatus: error.providerStatus ?? null,
    providerErrorCode: error.providerErrorCode ?? null,
    sanitizedMessage: error.sanitizedMessage ?? null,
    fieldPath: error.fieldPath ?? null,
    providerRequestId: error.providerRequestId ?? null,
  };
}

function extractGeminiErrorDetails(error: unknown): {
  providerStatus?: number;
  providerErrorCode?: string;
  sanitizedMessage?: string;
  fieldPath?: string;
  providerRequestId?: string;
  httpStatus?: number;
} {
  const err = error as ErrorLike | null;
  const parsed = parseGeminiErrorMessage(typeof err?.message === "string" ? err.message : undefined);
  const httpStatus = numericStatus(error) ?? parsed?.error?.code;
  const fieldPath = firstFieldViolationPath(parsed);
  const providerRequestId = headerValue(err?.response?.headers, "x-request-id")
    ?? headerValue(err?.response?.headers, "x-goog-request-id")
    ?? undefined;
  return {
    ...(typeof httpStatus === "number" ? { providerStatus: httpStatus, httpStatus } : {}),
    ...(typeof parsed?.error?.status === "string" ? { providerErrorCode: parsed.error.status } : {}),
    ...(typeof parsed?.error?.message === "string" ? { sanitizedMessage: sanitizeProviderMessage(parsed.error.message) } : {}),
    ...(fieldPath ? { fieldPath } : {}),
    ...(providerRequestId ? { providerRequestId } : {}),
  };
}

function parseGeminiErrorMessage(message: string | undefined): {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: unknown[];
  };
} | null {
  if (!message) return null;
  try {
    const parsed = JSON.parse(message) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as { error?: { code?: number; status?: string; message?: string; details?: unknown[] } } : null;
  } catch {
    return null;
  }
}

function firstFieldViolationPath(parsed: { error?: { details?: unknown[] } } | null) {
  const details = parsed?.error?.details;
  if (!Array.isArray(details)) return undefined;
  for (const detail of details) {
    if (!detail || typeof detail !== "object") continue;
    const violations = (detail as { fieldViolations?: unknown }).fieldViolations;
    if (!Array.isArray(violations)) continue;
    const [first] = violations;
    if (first && typeof first === "object" && typeof (first as { field?: unknown }).field === "string") {
      return (first as { field: string }).field.slice(0, 240);
    }
  }
  return undefined;
}

function sanitizeProviderMessage(message: string) {
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
