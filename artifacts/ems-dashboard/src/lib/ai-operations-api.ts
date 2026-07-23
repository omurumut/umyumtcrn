import { z } from "zod";
import { ApiError } from "@/lib/ai-api";

const rangeSchema = z.object({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  bucket: z.string(),
});

const nullableStringNumber = z.union([z.string(), z.number()]).nullable();

const summarySchema = z.object({
  range: rangeSchema,
  scope: z.object({
    role: z.string(),
    companyId: z.number().nullable(),
    isSystemWide: z.boolean(),
    canViewSystem: z.boolean(),
  }),
  global: z.object({
    enabled: z.boolean(),
    provider: z.string(),
    providerConfigured: z.boolean(),
    modelConfigured: z.boolean(),
    secretConfigured: z.boolean(),
    productionDataEnabled: z.boolean(),
    limits: z.object({
      globalMaxConcurrent: z.number().nullable(),
      globalDailyLimit: z.number().nullable(),
      circuitBreakerEnabled: z.boolean(),
    }),
  }),
  policy: z.object({
    dataPolicy: z.string(),
    retentionDays: z.number().nullable(),
    dailyAnalysisLimit: z.number().nullable(),
    monthlyAnalysisLimit: z.number().nullable(),
    maxConcurrentAnalyses: z.number(),
    fallbackEnabled: z.boolean(),
    version: z.number(),
    updatedAt: z.string().nullable(),
  }).nullable(),
  totals: z.object({
    totalRequests: z.number(),
    providerCalls: z.number(),
    completed: z.number(),
    failed: z.number(),
    cacheHit: z.number(),
    cacheMiss: z.number(),
    fallback: z.number(),
    gemini: z.number(),
    mock: z.number(),
    ruleBased: z.number(),
    activeProcessing: z.number(),
    staleProcessing: z.number(),
    cacheHitRate: z.number(),
    fallbackRate: z.number(),
    failureRate: z.number(),
    avgLatencyMs: z.number().nullable(),
    p95LatencyMs: z.number().nullable(),
    avgFindingCount: z.number().nullable(),
    lastCompletedAt: z.string().nullable(),
    lastErrorCode: z.string().nullable(),
  }),
  tokens: z.object({
    input: z.number().nullable(),
    output: z.number().nullable(),
    thinking: z.number().nullable(),
    cached: z.number().nullable(),
    total: z.number().nullable(),
  }),
  cost: z.object({
    estimatedCost: nullableStringNumber,
    currency: z.string().nullable(),
    mixedCurrency: z.boolean(),
    unknownCount: z.number(),
    pricingCatalogVersion: z.string().nullable(),
    label: z.string(),
  }),
  errors: z.array(z.object({ code: z.string(), count: z.number(), group: z.string() })),
  circuit: z.object({
    state: z.string(),
    label: z.string(),
    items: z.array(z.object({
      provider: z.string(),
      model: z.string(),
      state: z.string(),
      label: z.string(),
      failureCount: z.number(),
      lastFailureCode: z.string().nullable(),
      lastFailureAt: z.string().nullable(),
      lastSuccessAt: z.string().nullable(),
      openedAt: z.string().nullable(),
      nextProbeAt: z.string().nullable(),
      leaseActive: z.boolean(),
    })),
  }),
  retentionCleanup: z.object({
    lastRunAt: z.string().nullable(),
    summary: z.record(z.string(), z.unknown()),
  }).nullable(),
  pilotHealth: z.object({ status: z.string(), label: z.string() }),
});

const timeseriesSchema = z.object({
  range: rangeSchema,
  points: z.array(z.object({
    day: z.string(),
    total: z.number(),
    cache_hit: z.number(),
    completed: z.number(),
    failed: z.number(),
    fallback: z.number(),
    estimated_cost: nullableStringNumber,
    cost_unknown: z.number(),
  })),
});

const errorsSchema = z.object({
  range: rangeSchema,
  items: z.array(z.object({
    code: z.string(),
    group: z.string(),
    label: z.string(),
    providerStatus: z.number().nullable(),
    count: z.number(),
    latestAt: z.string().nullable(),
  })),
});

const analysesSchema = z.object({
  range: rangeSchema,
  items: z.array(z.object({
    id: z.number(),
    companyId: z.number(),
    companyName: z.string().nullable(),
    unitId: z.number().nullable(),
    unitName: z.string().nullable(),
    analysisType: z.string(),
    status: z.string(),
    provider: z.string(),
    model: z.string(),
    cacheHit: z.boolean(),
    fallbackUsed: z.boolean(),
    errorCode: z.string().nullable(),
    latencyMs: z.number().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    createdAt: z.string().nullable(),
  })),
  pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
});

const analysisDetailSchema = z.object({
  analysis: z.record(z.string(), z.unknown()),
  attempts: z.array(z.record(z.string(), z.unknown())),
});

const companyUsageSchema = z.object({
  range: rangeSchema,
  items: z.array(z.object({
    companyId: z.number(),
    companyName: z.string(),
    policy: z.string(),
    dailyAnalysisLimit: z.number().nullable(),
    monthlyAnalysisLimit: z.number().nullable(),
    maxConcurrentAnalyses: z.number().nullable(),
    fallbackEnabled: z.boolean().nullable(),
    totalRequests: z.number(),
    providerCalls: z.number(),
    cacheHit: z.number(),
    fallback: z.number(),
    failed: z.number(),
    totalTokens: z.number().nullable(),
    estimatedCost: nullableStringNumber,
    currency: z.string().nullable(),
    mixedCurrency: z.boolean(),
    costUnknownCount: z.number(),
    activeProcessing: z.number(),
    lastAnalysisAt: z.string().nullable(),
  })),
});

export type AiOperationsSummary = z.infer<typeof summarySchema>;
export type AiOperationsTimeseries = z.infer<typeof timeseriesSchema>;
export type AiOperationsErrors = z.infer<typeof errorsSchema>;
export type AiOperationsAnalyses = z.infer<typeof analysesSchema>;
export type AiOperationsAnalysisDetail = z.infer<typeof analysisDetailSchema>;
export type AiOperationsCompanyUsage = z.infer<typeof companyUsageSchema>;

type Query = Record<string, string | number | null | undefined>;

function buildQuery(query: Query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}

async function apiFetch<T>(token: string | null, url: string, schema: z.ZodType<T>): Promise<T> {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { headers });
  const body = await readJson(response);
  if (!response.ok) {
    const parsed = z.object({ error: z.string().optional() }).safeParse(body);
    throw new ApiError(parsed.data?.error ?? "AI operasyon verisi okunamadi.", response.status, null);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError("AI operasyon yaniti beklenen sozlesmeyle eslesmedi.", response.status, "CLIENT_SCHEMA_INVALID");
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

export function getAiOperationsSummary(token: string | null, query: Query) {
  return apiFetch(token, `/api/admin/ai/operations/summary?${buildQuery(query)}`, summarySchema);
}

export function getAiOperationsTimeseries(token: string | null, query: Query) {
  return apiFetch(token, `/api/admin/ai/operations/timeseries?${buildQuery(query)}`, timeseriesSchema);
}

export function getAiOperationsErrors(token: string | null, query: Query) {
  return apiFetch(token, `/api/admin/ai/operations/errors?${buildQuery(query)}`, errorsSchema);
}

export function listAiOperationsAnalyses(token: string | null, query: Query) {
  return apiFetch(token, `/api/admin/ai/operations/analyses?${buildQuery(query)}`, analysesSchema);
}

export function getAiOperationsAnalysisDetail(token: string | null, id: number, query: Query) {
  return apiFetch(token, `/api/admin/ai/operations/analyses/${id}?${buildQuery(query)}`, analysisDetailSchema);
}

export function getAiOperationsCompanyUsage(token: string | null, query: Query) {
  return apiFetch(token, `/api/admin/ai/operations/companies?${buildQuery(query)}`, companyUsageSchema);
}
