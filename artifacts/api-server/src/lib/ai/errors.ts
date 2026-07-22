export const AI_PROVIDER_ERROR_CODES = [
  "AI_NOT_CONFIGURED",
  "AI_DISABLED",
  "AI_TIMEOUT",
  "AI_RATE_LIMITED",
  "AI_QUOTA_EXHAUSTED",
  "AI_AUTHENTICATION_FAILED",
  "AI_INVALID_REQUEST",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_SAFETY_BLOCKED",
  "AI_SCHEMA_INVALID",
  "AI_EMPTY_RESPONSE",
  "AI_UNKNOWN_PROVIDER_ERROR",
] as const;

export type AiProviderErrorCode = typeof AI_PROVIDER_ERROR_CODES[number];

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly providerRequestId?: string;
  readonly providerStatus?: number;
  readonly providerErrorCode?: string;
  readonly sanitizedMessage?: string;
  readonly fieldPath?: string;

  constructor({
    code,
    message,
    status = 500,
    retryable = false,
    providerRequestId,
    providerStatus,
    providerErrorCode,
    sanitizedMessage,
    fieldPath,
  }: {
    code: AiProviderErrorCode;
    message: string;
    status?: number;
    retryable?: boolean;
    providerRequestId?: string;
    providerStatus?: number;
    providerErrorCode?: string;
    sanitizedMessage?: string;
    fieldPath?: string;
  }) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.providerRequestId = providerRequestId;
    this.providerStatus = providerStatus;
    this.providerErrorCode = providerErrorCode;
    this.sanitizedMessage = sanitizedMessage;
    this.fieldPath = fieldPath;
  }
}

export function providerErrorResponse(error: AiProviderError) {
  return {
    error: error.message,
    code: error.code,
    retryable: error.retryable,
  };
}
