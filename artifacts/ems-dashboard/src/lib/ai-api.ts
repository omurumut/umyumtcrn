import { z } from "zod";
import { aiAnalysisResultSchema, aiAnalysisTypeSchema } from "@workspace/api-zod";
import type { AiAnalysisResult, AiAnalysisType } from "@workspace/api-zod";

const usageSchema = z.object({
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  thinkingTokens: z.number().nullable(),
  cachedTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  estimatedCost: z.number().nullable(),
  currency: z.string().nullable(),
});

const aiAnalysisResponseSchema = z.object({
  analysis: z.object({
    id: z.number(),
    status: z.string(),
    analysisType: aiAnalysisTypeSchema,
    periodStart: z.string(),
    periodEnd: z.string(),
    result: aiAnalysisResultSchema,
    createdAt: z.string().optional(),
    completedAt: z.string().nullable().optional(),
  }),
  meta: z.object({
    provider: z.string(),
    model: z.string(),
    cacheHit: z.boolean(),
    sourceAnalysisId: z.number().nullable(),
    fallbackUsed: z.boolean().optional(),
    dataVersion: z.string(),
    dataSufficiency: z.string(),
    contextTruncated: z.boolean(),
    usage: usageSchema.optional(),
    createdAt: z.string().optional(),
    completedAt: z.string().nullable().optional(),
    attempts: z.array(z.object({
      attemptNumber: z.number(),
      provider: z.string(),
      model: z.string(),
      success: z.boolean().nullable(),
      retryable: z.boolean().nullable(),
      errorCode: z.string().nullable(),
      latencyMs: z.number().nullable(),
      startedAt: z.string().nullable(),
      completedAt: z.string().nullable(),
      totalTokens: z.number().nullable(),
    })).optional(),
  }),
});

const aiAnalysisHistoryItemSchema = z.object({
  id: z.number(),
  analysisType: aiAnalysisTypeSchema,
  status: z.string(),
  unitId: z.number().nullable(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  cacheHit: z.boolean(),
  sourceAnalysisId: z.number().nullable(),
  dataVersion: z.string(),
  dataSufficiency: z.string(),
  contextTruncated: z.boolean(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

const aiAnalysisHistoryResponseSchema = z.object({
  items: z.array(aiAnalysisHistoryItemSchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
  }),
});

const aiPolicySchema = z.object({
  dataPolicy: z.enum(["disabled", "synthetic_only", "production_allowed"]),
  retentionDays: z.number().nullable(),
  dailyAnalysisLimit: z.number().nullable().optional(),
  monthlyAnalysisLimit: z.number().nullable().optional(),
  maxConcurrentAnalyses: z.number().optional(),
  fallbackEnabled: z.boolean().optional(),
  version: z.number(),
  updatedAt: z.string().nullable(),
});

const legacySuggestionSchema = z.object({
  title: z.string(),
  category: z.string(),
  description: z.string(),
  priority: z.string(),
  potentialSavingKwh: z.number().optional(),
  potentialSavingPercent: z.number().optional(),
  paybackMonths: z.number().optional(),
});

const legacyReadinessSchema = z.record(z.string(), z.unknown());

const legacySuggestionsResponseSchema = z.object({
  suggestions: z.array(legacySuggestionSchema),
  technicalProfileReadiness: legacyReadinessSchema.optional(),
  equipmentInventoryReadiness: legacyReadinessSchema.optional(),
});

export type AiAnalysisResponse = z.infer<typeof aiAnalysisResponseSchema>;
export type AiAnalysisHistoryItem = z.infer<typeof aiAnalysisHistoryItemSchema>;
export type AiAnalysisHistoryResponse = z.infer<typeof aiAnalysisHistoryResponseSchema>;
export type AiCompanyPolicy = z.infer<typeof aiPolicySchema>;
export type LegacySuggestion = z.infer<typeof legacySuggestionSchema>;
export type LegacySuggestionsResponse = z.infer<typeof legacySuggestionsResponseSchema>;
export type { AiAnalysisResult, AiAnalysisType };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ScopeParams = {
  token: string | null;
  companyId: number | null;
  unitId: number | null;
  year: number;
};

async function apiFetch<T>(token: string | null, url: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  const body = await readJson(response);
  if (!response.ok) {
    const parsed = z.object({ error: z.string().optional(), code: z.string().optional() }).safeParse(body);
    throw new ApiError(parsed.data?.error ?? statusMessage(response.status), response.status, parsed.data?.code ?? null);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError("Sunucu yaniti beklenen sozlesmeyle eslesmedi.", response.status, "CLIENT_SCHEMA_INVALID");
  }
  return parsed.data;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function scopeQuery(scope: Omit<ScopeParams, "token">, extra?: Record<string, string>) {
  const params = new URLSearchParams({ year: String(scope.year), ...(extra ?? {}) });
  if (scope.companyId !== null) params.set("companyId", String(scope.companyId));
  if (scope.unitId !== null) params.set("unitId", String(scope.unitId));
  return params.toString();
}

function statusMessage(status: number) {
  if (status === 404 || status === 403) return "Analiz bulunamadi veya bu kayda erisim yetkiniz yok.";
  if (status === 429) return "AI servisi su anda yogun. Lutfen daha sonra tekrar deneyin.";
  if (status >= 500) return "Sunucu islemi guvenli bicimde tamamlayamadi.";
  return "Istek tamamlanamadi.";
}

export function getAiPolicy(scope: ScopeParams) {
  return apiFetch(scope.token, `/api/company-settings/ai?${scopeQuery(scope)}`, aiPolicySchema);
}

export function listAiAnalyses(scope: ScopeParams, input: { limit: number; offset: number; analysisType?: AiAnalysisType | "all"; status?: string | "all" }) {
  const extra: Record<string, string> = {
    limit: String(input.limit),
    offset: String(input.offset),
  };
  if (input.analysisType && input.analysisType !== "all") extra.analysisType = input.analysisType;
  if (input.status && input.status !== "all") extra.status = input.status;
  return apiFetch(scope.token, `/api/ai/analyses?${scopeQuery(scope, extra)}`, aiAnalysisHistoryResponseSchema);
}

export function createAiAnalysis(scope: ScopeParams, analysisType: AiAnalysisType) {
  return apiFetch(scope.token, `/api/ai/analyses?${scopeQuery(scope)}`, aiAnalysisResponseSchema, {
    method: "POST",
    body: JSON.stringify({ analysisType, year: scope.year, ...(scope.unitId !== null ? { unitId: scope.unitId } : {}) }),
  });
}

export function getAiAnalysisDetail(scope: ScopeParams, id: number) {
  return apiFetch(scope.token, `/api/ai/analyses/${id}?${scopeQuery(scope)}`, aiAnalysisResponseSchema);
}

export function getLegacySuggestions(scope: ScopeParams, focus: string) {
  return apiFetch(scope.token, "/api/ai/suggestions", legacySuggestionsResponseSchema, {
    method: "POST",
    body: JSON.stringify({
      focus,
      year: scope.year,
      ...(scope.companyId !== null ? { companyId: scope.companyId } : {}),
      ...(scope.unitId !== null ? { unitId: scope.unitId } : {}),
    }),
  });
}
