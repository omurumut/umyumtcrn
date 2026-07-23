import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { aiAnalysisResultSchema, type AiAnalysisResult, type AiAnalysisType } from "@workspace/api-zod";
import {
  aiAnalysesTable,
  aiAnalysisAttemptsTable,
  companyAiSettingsTable,
  db,
  unitsTable,
} from "@workspace/db";
import type { SessionUser } from "../../middlewares/auth.js";
import { writeBestEffortAudit } from "../audit.js";
import { readAiRuntimeConfig, type AiRuntimeConfig } from "./config.js";
import { buildAiAnalysisContext } from "./context-builder.js";
import {
  AI_CONTEXT_BUILDER_VERSION,
  AI_LIMIT_POLICY_VERSION,
  AI_REDACTION_POLICY_VERSION,
} from "./context-types.js";
import { GEMINI_PROMPT_POLICY_VERSION } from "./gemini-prompt.js";
import { validateProviderAnalysis } from "./analysis-validator.js";
import { AiProviderError, providerErrorResponse } from "./errors.js";
import { createAiProvider } from "./registry.js";
import { RuleBasedAiProvider } from "./rule-based-provider.js";
import { shouldTripCircuit, shouldUseFallback } from "./fallback-policy.js";
import { beforeProviderCall, recordProviderFailure, recordProviderSuccess } from "./circuit-breaker.js";
import { estimateModelUsageCost } from "./model-pricing.js";
import type { AiProviderRequest, AiProviderResult, AiProviderUsage } from "./provider.js";
import type { AiResolvedScope } from "./scope.js";
import { canonicalJson, sha256Canonical } from "./context-utils.js";

export const AI_OUTPUT_SCHEMA_VERSION = "ai-analysis-output-v1";
export const AI_CACHE_MANIFEST_VERSION = "ai-cache-manifest-v1";

export type CompanyAiDataPolicy = "disabled" | "synthetic_only" | "production_allowed";

export type CompanyAiPolicy = {
  dataPolicy: CompanyAiDataPolicy;
  retentionDays: number | null;
  dailyAnalysisLimit: number | null;
  monthlyAnalysisLimit: number | null;
  maxConcurrentAnalyses: number;
  fallbackEnabled: boolean;
  version: number;
  updatedAt: string | null;
};

export type AiAnalysisResponseDto = {
  analysis: {
    id: number;
    status: string;
    analysisType: AiAnalysisType;
    periodStart: string;
    periodEnd: string;
    result: AiAnalysisResult;
  };
  meta: {
    provider: string;
    model: string;
    cacheHit: boolean;
    sourceAnalysisId: number | null;
    fallbackUsed: boolean;
    dataVersion: string;
    dataSufficiency: string;
    contextTruncated: boolean;
    usage: AiProviderUsage & {
      estimatedCost: number | null;
      currency: string | null;
    };
    createdAt: string;
    completedAt: string | null;
  };
};

type RunInput = {
  scope: AiResolvedScope;
  analysisType: AiAnalysisType;
  user: SessionUser;
  timeoutMs?: number;
  maxOutputTokens?: number;
  requestId?: string;
  signal?: AbortSignal;
};

type AttemptMetadata = {
  dataPolicy: CompanyAiDataPolicy;
  productionDataEnabled: boolean;
  contextSchemaVersion: string;
  redactionPolicyVersion: string;
  contextTruncated: boolean;
  dataSufficiency: string;
  syntheticContext: boolean;
  providerDataClassification: string;
};

export async function loadCompanyAiPolicy(companyId: number): Promise<CompanyAiPolicy> {
  const [settings] = await db.select({
    dataPolicy: companyAiSettingsTable.dataPolicy,
    retentionDays: companyAiSettingsTable.retentionDays,
    dailyAnalysisLimit: companyAiSettingsTable.dailyAnalysisLimit,
    monthlyAnalysisLimit: companyAiSettingsTable.monthlyAnalysisLimit,
    maxConcurrentAnalyses: companyAiSettingsTable.maxConcurrentAnalyses,
    fallbackEnabled: companyAiSettingsTable.fallbackEnabled,
    version: companyAiSettingsTable.settingsVersion,
    updatedAt: companyAiSettingsTable.updatedAt,
  }).from(companyAiSettingsTable)
    .where(eq(companyAiSettingsTable.companyId, companyId))
    .limit(1);
  if (!settings) return defaultCompanyAiPolicy();
  return {
    dataPolicy: normalizePolicy(settings.dataPolicy),
    retentionDays: settings.retentionDays,
    dailyAnalysisLimit: settings.dailyAnalysisLimit,
    monthlyAnalysisLimit: settings.monthlyAnalysisLimit,
    maxConcurrentAnalyses: normalizeConcurrent(settings.maxConcurrentAnalyses),
    fallbackEnabled: settings.fallbackEnabled,
    version: settings.version,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

export async function upsertCompanyAiPolicy({
  companyId,
  dataPolicy,
  retentionDays,
  dailyAnalysisLimit,
  monthlyAnalysisLimit,
  maxConcurrentAnalyses,
  fallbackEnabled,
  expectedSettingsVersion,
  userId,
}: {
  companyId: number;
  dataPolicy: CompanyAiDataPolicy;
  retentionDays: number | null;
  dailyAnalysisLimit?: number | null;
  monthlyAnalysisLimit?: number | null;
  maxConcurrentAnalyses?: number;
  fallbackEnabled?: boolean;
  expectedSettingsVersion?: number;
  userId: number | null;
}) {
  return await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(companyAiSettingsTable)
      .where(eq(companyAiSettingsTable.companyId, companyId))
      .limit(1);
    if (existing && expectedSettingsVersion !== undefined && existing.settingsVersion !== expectedSettingsVersion) {
      return { status: "conflict" as const, settings: existing };
    }
    if (!existing) {
      const [created] = await tx.insert(companyAiSettingsTable).values({
        companyId,
        dataPolicy,
        retentionDays,
        dailyAnalysisLimit: dailyAnalysisLimit ?? null,
        monthlyAnalysisLimit: monthlyAnalysisLimit ?? null,
        maxConcurrentAnalyses: maxConcurrentAnalyses ?? defaultCompanyAiPolicy().maxConcurrentAnalyses,
        fallbackEnabled: fallbackEnabled ?? true,
        settingsVersion: 1,
        updatedBy: userId,
      }).returning();
      return { status: "created" as const, settings: created };
    }
    const [updated] = await tx.update(companyAiSettingsTable)
      .set({
        dataPolicy,
        retentionDays,
        dailyAnalysisLimit: dailyAnalysisLimit ?? null,
        monthlyAnalysisLimit: monthlyAnalysisLimit ?? null,
        maxConcurrentAnalyses: maxConcurrentAnalyses ?? existing.maxConcurrentAnalyses,
        fallbackEnabled: fallbackEnabled ?? existing.fallbackEnabled,
        settingsVersion: existing.settingsVersion + 1,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(companyAiSettingsTable.id, existing.id))
      .returning();
    return { status: "updated" as const, settings: updated };
  });
}

export async function runPersistedAiAnalysis(input: RunInput): Promise<AiAnalysisResponseDto> {
  const config = readAiRuntimeConfig();
  const policy = await loadCompanyAiPolicy(input.scope.companyId);
  ensureProviderAllowed(config, policy);

  const built = await buildAiAnalysisContext(input.scope, {
    analysisType: input.analysisType,
    effectiveDate: `${input.scope.year}-12-31`,
  });
  const provider = createAiProvider(config);
  const model = provider.getModelName();
  const cacheManifest = buildCacheManifest({
    scope: input.scope,
    analysisType: input.analysisType,
    provider: provider.providerName,
    model,
    dataVersion: built.dataVersion,
    periodStart: built.context.periodStart,
    periodEnd: built.context.periodEnd,
    contextSchemaVersion: built.context.contextSchemaVersion,
  });
  const cacheKey = sha256Canonical(cacheManifest);
  const fallbackProvider = new RuleBasedAiProvider();
  const fallbackCacheKey = sha256Canonical(buildCacheManifest({
    scope: input.scope,
    analysisType: input.analysisType,
    provider: fallbackProvider.providerName,
    model: fallbackProvider.getModelName(),
    dataVersion: built.dataVersion,
    periodStart: built.context.periodStart,
    periodEnd: built.context.periodEnd,
    contextSchemaVersion: built.context.contextSchemaVersion,
  }));
  await resetStaleProcessing(readStaleMinutes());
  const cached = await findCompletedCache(input.scope, cacheKey);
  if (cached) {
    const hit = await createCacheHitAnalysis({
      source: cached,
      input,
      built,
      provider: provider.providerName,
      model,
      cacheKey,
    });
    await auditAnalysis(input, "ai.analysis.cache_hit", hit.id, { cacheHit: true, sourceAnalysisId: cached.id, dataVersion: built.dataVersion, provider: provider.providerName, model });
    return toResponse(hit, parseStoredResult(cached.resultJson), null);
  }

  await enforceOperationalLimits(input, config, policy, provider.providerName);

  const analysis = await createProcessingAnalysis({
    input,
    built,
    provider: provider.providerName,
    model,
    cacheKey,
  }).catch((error) => {
    if (isUniqueViolation(error)) {
      throw new AiProviderError({
        code: "AI_RATE_LIMITED",
        status: 409,
        retryable: true,
        message: "Ayni veri surumu icin AI analizi halen isleniyor",
      });
    }
    throw error;
  });
  await auditAnalysis(input, "ai.analysis.requested", analysis.id, { cacheHit: false, dataVersion: built.dataVersion, provider: provider.providerName, model });

  const primaryAttemptMetadata = buildAttemptMetadata(config, policy, built, provider.providerName);
  const attempt = await createAttempt(analysis.id, provider.providerName, model, 1, primaryAttemptMetadata);
  const started = Date.now();
  const providerRequest: AiProviderRequest = {
    analysisType: input.analysisType,
    scope: input.scope,
    context: built.context,
    evidenceRegistry: built.evidenceRegistry,
    dataVersion: built.dataVersion,
  };
  try {
    await beforeProviderCall(provider.providerName, model, config, input.requestId);
    const result = await provider.generateAnalysis(providerRequest, {
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? config.timeoutMs,
      maxOutputTokens: input.maxOutputTokens ?? config.maxOutputTokens,
      requestId: input.requestId,
    });
    await recordProviderSuccess(provider.providerName, model);
    const safeResult = validateProviderAnalysis(result.analysis, built.evidenceRegistry);
    const cost = estimateUsageCost(result.meta.provider, result.meta.model, result.meta.usage);
    await completeAttempt(attempt.id, result, started, cost);
    const completed = await completeAnalysis(analysis.id, safeResult, result);
    await auditAnalysis(input, "ai.analysis.completed", analysis.id, { cacheHit: false, dataVersion: built.dataVersion, provider: provider.providerName, model, totalTokens: result.meta.usage.totalTokens });
    return toResponse(completed, safeResult, { ...result.meta.usage, estimatedCost: costToNumber(cost.estimatedCost), currency: cost.currency });
  } catch (error) {
    const classified = error instanceof AiProviderError ? error : new AiProviderError({
      code: "AI_UNKNOWN_PROVIDER_ERROR",
      status: 502,
      message: "AI analiz hatasi",
    });
    if (shouldTripCircuit(classified)) {
      const circuit = await recordProviderFailure(provider.providerName, model, classified.code, config);
      if (circuit.opened) await auditAnalysis(input, "ai.circuit.opened", analysis.id, { provider: provider.providerName, model, errorCode: classified.code });
    }
    await failAttempt(attempt.id, classified, started);
    if (shouldUseFallback(classified, { policy, primaryProvider: provider.providerName })) {
      const fallbackResponse = await tryFallback({
        input,
        analysis,
        built,
        providerRequest,
        fallbackProvider,
        fallbackCacheKey,
        failedError: classified,
      });
      if (fallbackResponse) return fallbackResponse;
    }
    const failed = await failAnalysis(analysis.id, classified);
    await auditAnalysis(input, "ai.analysis.failed", analysis.id, { dataVersion: built.dataVersion, provider: provider.providerName, model, errorCode: classified.code });
    throw Object.assign(classified, { analysisId: failed.id });
  }
}

export async function listAiAnalyses(scope: AiResolvedScope, input: { limit: number; offset: number; analysisType?: AiAnalysisType; status?: string }) {
  const conditions = [eq(aiAnalysesTable.companyId, scope.companyId)];
  if (scope.unitId !== null) conditions.push(eq(aiAnalysesTable.unitId, scope.unitId));
  if (input.analysisType) conditions.push(eq(aiAnalysesTable.analysisType, input.analysisType));
  if (input.status) conditions.push(eq(aiAnalysesTable.status, input.status));
  return await db.select({
    id: aiAnalysesTable.id,
    analysisType: aiAnalysesTable.analysisType,
    status: aiAnalysesTable.status,
    unitId: aiAnalysesTable.unitId,
    periodStart: aiAnalysesTable.periodStart,
    periodEnd: aiAnalysesTable.periodEnd,
    provider: aiAnalysesTable.provider,
    model: aiAnalysesTable.model,
    cacheHit: aiAnalysesTable.cacheHit,
    sourceAnalysisId: aiAnalysesTable.sourceAnalysisId,
    dataVersion: aiAnalysesTable.dataVersion,
    dataSufficiency: aiAnalysesTable.dataSufficiency,
    contextTruncated: aiAnalysesTable.contextTruncated,
    createdAt: aiAnalysesTable.createdAt,
    completedAt: aiAnalysesTable.completedAt,
  }).from(aiAnalysesTable)
    .where(and(...conditions))
    .orderBy(desc(aiAnalysesTable.createdAt), desc(aiAnalysesTable.id))
    .limit(input.limit)
    .offset(input.offset);
}

export async function getAiAnalysisDetail(scope: AiResolvedScope, id: number) {
  const conditions = [eq(aiAnalysesTable.id, id), eq(aiAnalysesTable.companyId, scope.companyId)];
  if (scope.unitId !== null) conditions.push(eq(aiAnalysesTable.unitId, scope.unitId));
  const [analysis] = await db.select().from(aiAnalysesTable).where(and(...conditions)).limit(1);
  if (!analysis) return null;
  let result = analysis.resultJson ? parseStoredResult(analysis.resultJson) : null;
  if (!result && analysis.sourceAnalysisId !== null) {
    const [source] = await db.select({ resultJson: aiAnalysesTable.resultJson })
      .from(aiAnalysesTable)
      .where(and(
        eq(aiAnalysesTable.id, analysis.sourceAnalysisId),
        eq(aiAnalysesTable.companyId, scope.companyId),
      ))
      .limit(1);
    result = source?.resultJson ? parseStoredResult(source.resultJson) : null;
  }
  const attempts = await db.select({
    id: aiAnalysisAttemptsTable.id,
    attemptNumber: aiAnalysisAttemptsTable.attemptNumber,
    provider: aiAnalysisAttemptsTable.provider,
    model: aiAnalysisAttemptsTable.model,
    success: aiAnalysisAttemptsTable.success,
    retryable: aiAnalysisAttemptsTable.retryable,
    errorCode: aiAnalysisAttemptsTable.errorCode,
    providerHttpStatus: aiAnalysisAttemptsTable.providerHttpStatus,
    providerErrorCode: aiAnalysisAttemptsTable.providerErrorCode,
    providerRequestId: aiAnalysisAttemptsTable.providerRequestId,
    inputTokens: aiAnalysisAttemptsTable.inputTokens,
    outputTokens: aiAnalysisAttemptsTable.outputTokens,
    thinkingTokens: aiAnalysisAttemptsTable.thinkingTokens,
    cachedTokens: aiAnalysisAttemptsTable.cachedTokens,
    totalTokens: aiAnalysisAttemptsTable.totalTokens,
    estimatedCost: aiAnalysisAttemptsTable.estimatedCost,
    currency: aiAnalysisAttemptsTable.currency,
    latencyMs: aiAnalysisAttemptsTable.latencyMs,
    startedAt: aiAnalysisAttemptsTable.startedAt,
    completedAt: aiAnalysisAttemptsTable.completedAt,
  }).from(aiAnalysisAttemptsTable)
    .where(eq(aiAnalysisAttemptsTable.analysisId, analysis.id))
    .orderBy(aiAnalysisAttemptsTable.attemptNumber);
  return { analysis, result, attempts };
}

function buildCacheManifest(input: {
  scope: AiResolvedScope;
  analysisType: AiAnalysisType;
  provider: string;
  model: string;
  dataVersion: string;
  periodStart: string;
  periodEnd: string;
  contextSchemaVersion: string;
}) {
  return {
    cacheManifestVersion: AI_CACHE_MANIFEST_VERSION,
    companyScope: input.scope.companyId,
    unitScope: input.scope.unitId,
    analysisType: input.analysisType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dataVersion: input.dataVersion,
    provider: input.provider,
    model: input.model,
    contextSchemaVersion: input.contextSchemaVersion,
    outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
    promptPolicyVersion: GEMINI_PROMPT_POLICY_VERSION,
    builderVersion: AI_CONTEXT_BUILDER_VERSION,
    redactionPolicyVersion: AI_REDACTION_POLICY_VERSION,
    limitPolicyVersion: AI_LIMIT_POLICY_VERSION,
  };
}

async function findCompletedCache(scope: AiResolvedScope, cacheKey: string) {
  const [cached] = await db.select().from(aiAnalysesTable)
    .where(and(
      eq(aiAnalysesTable.companyId, scope.companyId),
      scope.unitId === null ? isNull(aiAnalysesTable.unitId) : eq(aiAnalysesTable.unitId, scope.unitId),
      eq(aiAnalysesTable.cacheKey, cacheKey),
      eq(aiAnalysesTable.status, "completed"),
      eq(aiAnalysesTable.cacheHit, false),
      sql`${aiAnalysesTable.resultJson} IS NOT NULL`,
    ))
    .orderBy(desc(aiAnalysesTable.completedAt), desc(aiAnalysesTable.id))
    .limit(1);
  if (!cached?.resultJson) return null;
  parseStoredResult(cached.resultJson);
  return cached;
}

async function createProcessingAnalysis(input: {
  input: RunInput;
  built: Awaited<ReturnType<typeof buildAiAnalysisContext>>;
  provider: string;
  model: string;
  cacheKey: string;
}) {
  const now = new Date();
  const [row] = await db.insert(aiAnalysesTable).values({
    companyId: input.input.scope.companyId,
    unitId: input.input.scope.unitId,
    requestedByUserId: input.input.user.userId ?? null,
    analysisType: input.input.analysisType,
    periodStart: input.built.context.periodStart,
    periodEnd: input.built.context.periodEnd,
    status: "processing",
    provider: input.provider,
    model: input.model,
    contextSchemaVersion: input.built.context.contextSchemaVersion,
    outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
    promptPolicyVersion: GEMINI_PROMPT_POLICY_VERSION,
    builderVersion: AI_CONTEXT_BUILDER_VERSION,
    redactionPolicyVersion: AI_REDACTION_POLICY_VERSION,
    limitPolicyVersion: AI_LIMIT_POLICY_VERSION,
    dataVersion: input.built.dataVersion,
    cacheKey: input.cacheKey,
    cacheHit: false,
    fallbackUsed: false,
    dataSufficiency: input.built.context.dataSufficiency,
    contextTruncated: input.built.context.contextTruncated,
    contextWarnings: input.built.warnings,
    startedAt: now,
  }).returning();
  return row;
}

async function createCacheHitAnalysis(input: {
  source: typeof aiAnalysesTable.$inferSelect;
  input: RunInput;
  built: Awaited<ReturnType<typeof buildAiAnalysisContext>>;
  provider: string;
  model: string;
  cacheKey: string;
  fallbackUsed?: boolean;
}) {
  const now = new Date();
  const [row] = await db.insert(aiAnalysesTable).values({
    companyId: input.input.scope.companyId,
    unitId: input.input.scope.unitId,
    requestedByUserId: input.input.user.userId ?? null,
    analysisType: input.input.analysisType,
    periodStart: input.built.context.periodStart,
    periodEnd: input.built.context.periodEnd,
    status: "completed",
    provider: input.provider,
    model: input.model,
    contextSchemaVersion: input.built.context.contextSchemaVersion,
    outputSchemaVersion: AI_OUTPUT_SCHEMA_VERSION,
    promptPolicyVersion: GEMINI_PROMPT_POLICY_VERSION,
    builderVersion: AI_CONTEXT_BUILDER_VERSION,
    redactionPolicyVersion: AI_REDACTION_POLICY_VERSION,
    limitPolicyVersion: AI_LIMIT_POLICY_VERSION,
    dataVersion: input.built.dataVersion,
    cacheKey: `${input.cacheKey}:hit:${now.getTime()}:${input.input.user.userId ?? "system"}`,
    cacheHit: true,
    sourceAnalysisId: input.source.id,
    fallbackUsed: input.fallbackUsed ?? false,
    dataSufficiency: input.built.context.dataSufficiency,
    contextTruncated: input.built.context.contextTruncated,
    contextWarnings: input.built.warnings,
    startedAt: now,
    completedAt: now,
  }).returning();
  return row;
}

async function createAttempt(analysisId: number, provider: string, model: string, attemptNumber: number, metadata: AttemptMetadata) {
  const [attempt] = await db.insert(aiAnalysisAttemptsTable).values({
    analysisId,
    attemptNumber,
    provider,
    model,
    startedAt: new Date(),
    dataPolicy: metadata.dataPolicy,
    productionDataEnabled: metadata.productionDataEnabled,
    contextSchemaVersion: metadata.contextSchemaVersion,
    redactionPolicyVersion: metadata.redactionPolicyVersion,
    contextTruncated: metadata.contextTruncated,
    dataSufficiency: metadata.dataSufficiency,
    syntheticContext: metadata.syntheticContext,
    providerDataClassification: metadata.providerDataClassification,
  }).returning();
  return attempt;
}

async function completeAttempt(attemptId: number, result: AiProviderResult, startedMs: number, cost: { estimatedCost: string | null; currency: string | null; costCalculationVersion: string | null; pricingCatalogVersion: string | null }) {
  const usage = result.meta.usage;
  await db.update(aiAnalysisAttemptsTable).set({
    completedAt: new Date(),
    success: true,
    retryable: false,
    providerRequestId: result.meta.providerRequestId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    thinkingTokens: usage.thinkingTokens,
    cachedTokens: usage.cachedTokens,
    totalTokens: usage.totalTokens,
    estimatedCost: cost.estimatedCost,
    currency: cost.currency,
    costCalculationVersion: cost.costCalculationVersion,
    pricingCatalogVersion: cost.pricingCatalogVersion,
    latencyMs: Math.max(0, Date.now() - startedMs),
  }).where(eq(aiAnalysisAttemptsTable.id, attemptId));
}

function estimateUsageCost(provider: string, model: string, usage: AiProviderUsage) {
  return estimateModelUsageCost(provider, model, usage);
}

async function failAttempt(attemptId: number, error: AiProviderError, startedMs: number) {
  await db.update(aiAnalysisAttemptsTable).set({
    completedAt: new Date(),
    success: false,
    retryable: error.retryable,
    errorCode: error.code,
    providerHttpStatus: error.providerStatus ?? null,
    providerErrorCode: error.providerErrorCode ?? null,
    providerRequestId: error.providerRequestId ?? null,
    estimatedCost: null,
    currency: null,
    costCalculationVersion: null,
    pricingCatalogVersion: null,
    latencyMs: Math.max(0, Date.now() - startedMs),
  }).where(eq(aiAnalysisAttemptsTable.id, attemptId));
}

async function completeAnalysis(id: number, result: AiAnalysisResult, providerResult: AiProviderResult, overrides?: { cacheKey?: string; fallbackUsed?: boolean }) {
  const [row] = await db.update(aiAnalysesTable).set({
    status: "completed",
    provider: providerResult.meta.provider,
    model: providerResult.meta.model,
    cacheKey: overrides?.cacheKey,
    fallbackUsed: overrides?.fallbackUsed ?? false,
    resultJson: result as unknown as Record<string, unknown>,
    errorCode: null,
    errorMessageSafe: null,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(aiAnalysesTable.id, id)).returning();
  return row;
}

async function failAnalysis(id: number, error: AiProviderError) {
  const [row] = await db.update(aiAnalysesTable).set({
    status: "failed",
    errorCode: error.code,
    errorMessageSafe: providerErrorResponse(error).error,
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(aiAnalysesTable.id, id)).returning();
  return row;
}

function toResponse(row: typeof aiAnalysesTable.$inferSelect, result: AiAnalysisResult, usage: (AiProviderUsage & { estimatedCost: number | null; currency: string | null }) | null): AiAnalysisResponseDto {
  return {
    analysis: {
      id: row.id,
      status: row.status,
      analysisType: row.analysisType as AiAnalysisType,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      result,
    },
    meta: {
      provider: row.provider,
      model: row.model,
      cacheHit: row.cacheHit,
      sourceAnalysisId: row.sourceAnalysisId,
      fallbackUsed: row.fallbackUsed,
      dataVersion: row.dataVersion,
      dataSufficiency: row.dataSufficiency,
      contextTruncated: row.contextTruncated,
      usage: usage ?? {
        inputTokens: null,
        outputTokens: null,
        thinkingTokens: null,
        cachedTokens: null,
        totalTokens: null,
        estimatedCost: null,
        currency: null,
      },
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    },
  };
}

function parseStoredResult(value: unknown): AiAnalysisResult {
  return validateProviderAnalysis(aiAnalysisResultSchema.parse(value));
}

function ensureProviderAllowed(config: AiRuntimeConfig, policy: CompanyAiPolicy) {
  if (!config.enabled) {
    throw new AiProviderError({ code: "AI_DISABLED", status: 403, message: "AI global olarak kapali" });
  }
  if (policy.dataPolicy === "disabled") {
    throw new AiProviderError({ code: "AI_DISABLED", status: 403, message: "Firma AI politikasi kapali" });
  }
  if (config.provider === "gemini" && policy.dataPolicy !== "production_allowed") {
    throw new AiProviderError({
      code: "AI_DISABLED",
      status: 403,
      message: "Firma AI veri politikasi gercek provider icin uygun degil",
    });
  }
  if (config.provider === "gemini" && !config.productionDataEnabled) {
    throw new AiProviderError({
      code: "AI_DISABLED",
      status: 403,
      message: "Gercek musteri verisi icin AI production data bayragi kapali",
    });
  }
}

function buildAttemptMetadata(
  config: AiRuntimeConfig,
  policy: CompanyAiPolicy,
  built: Awaited<ReturnType<typeof buildAiAnalysisContext>>,
  provider: string,
): AttemptMetadata {
  const productionCustomerContext = provider === "gemini" && policy.dataPolicy === "production_allowed" && config.productionDataEnabled;
  return {
    dataPolicy: policy.dataPolicy,
    productionDataEnabled: config.productionDataEnabled,
    contextSchemaVersion: built.context.contextSchemaVersion,
    redactionPolicyVersion: AI_REDACTION_POLICY_VERSION,
    contextTruncated: built.context.contextTruncated,
    dataSufficiency: built.context.dataSufficiency,
    syntheticContext: !productionCustomerContext,
    providerDataClassification: productionCustomerContext
      ? "customer_production"
      : provider === "rule_based"
        ? "local_rule_based"
        : "mock_or_synthetic",
  };
}

function costToNumber(value: string | null) {
  return value === null ? null : Number(value);
}

function normalizePolicy(value: string): CompanyAiDataPolicy {
  return value === "synthetic_only" || value === "production_allowed" ? value : "disabled";
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505");
}

function readStaleMinutes() {
  const raw = process.env.AI_PROCESSING_STALE_MINUTES;
  if (!raw) return 30;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 24 * 60 ? parsed : 30;
}

async function auditAnalysis(input: RunInput, action: "ai.analysis.requested" | "ai.analysis.completed" | "ai.analysis.failed" | "ai.analysis.cache_hit" | "ai.analysis.fallback_used" | "ai.quota.blocked" | "ai.concurrency.blocked" | "ai.circuit.opened" | "ai.circuit.probe" | "ai.circuit.closed" | "ai.processing.stale_recovered", analysisId: number | null, metadata: Record<string, unknown>) {
  await writeBestEffortAudit(db, {
    requestId: input.requestId,
    actorUserId: input.user.userId ?? null,
    actorRole: input.user.role,
    companyId: input.scope.companyId,
    unitId: input.scope.unitId,
    action,
    entityType: "ai_analysis",
    entityId: analysisId,
    metadata: {
      analysisType: input.analysisType,
      ...metadata,
    },
  });
}

export async function resetStaleProcessing(minutes = 30) {
  const cutoff = new Date(Date.now() - minutes * 60_000);
  const stale = await db.update(aiAnalysesTable).set({
    status: "failed",
    errorCode: "AI_PROCESSING_STALE",
    errorMessageSafe: "AI analysis processing kaydi zaman asimina ugradi",
    completedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(aiAnalysesTable.status, "processing"),
    sql`${aiAnalysesTable.startedAt} < ${cutoff}`,
  )).returning({ id: aiAnalysesTable.id });
  if (stale.length > 0) {
    await db.update(aiAnalysisAttemptsTable).set({
      completedAt: new Date(),
      success: false,
      retryable: true,
      errorCode: "AI_PROCESSING_STALE",
    }).where(and(
      sql`${aiAnalysisAttemptsTable.analysisId} IN (${sql.join(stale.map((row) => sql`${row.id}`), sql`,`)})`,
      isNull(aiAnalysisAttemptsTable.completedAt),
    ));
  }
  return stale;
}

async function tryFallback(input: {
  input: RunInput;
  analysis: typeof aiAnalysesTable.$inferSelect;
  built: Awaited<ReturnType<typeof buildAiAnalysisContext>>;
  providerRequest: AiProviderRequest;
  fallbackProvider: RuleBasedAiProvider;
  fallbackCacheKey: string;
  failedError: AiProviderError;
}) {
  const cachedFallback = await findCompletedCache(input.input.scope, input.fallbackCacheKey);
  if (cachedFallback?.resultJson) {
    await failAnalysis(input.analysis.id, input.failedError);
    const hit = await createCacheHitAnalysis({
      source: cachedFallback,
      input: input.input,
      built: input.built,
      provider: input.fallbackProvider.providerName,
      model: input.fallbackProvider.getModelName(),
      cacheKey: input.fallbackCacheKey,
      fallbackUsed: true,
    });
    await auditAnalysis(input.input, "ai.analysis.cache_hit", hit.id, { cacheHit: true, fallbackUsed: true, sourceAnalysisId: cachedFallback.id, provider: input.fallbackProvider.providerName, model: input.fallbackProvider.getModelName() });
    return toResponse(hit, parseStoredResult(cachedFallback.resultJson), null);
  }

  const fallbackAttempt = await createAttempt(
    input.analysis.id,
    input.fallbackProvider.providerName,
    input.fallbackProvider.getModelName(),
    2,
    buildAttemptMetadata(readAiRuntimeConfig(), await loadCompanyAiPolicy(input.input.scope.companyId), input.built, input.fallbackProvider.providerName),
  );
  const started = Date.now();
  try {
    const result = await input.fallbackProvider.generateAnalysis(input.providerRequest, {
      timeoutMs: input.input.timeoutMs ?? 1_000,
      maxOutputTokens: input.input.maxOutputTokens,
      requestId: input.input.requestId,
    });
    const cost = estimateUsageCost(result.meta.provider, result.meta.model, result.meta.usage);
    await completeAttempt(fallbackAttempt.id, result, started, cost);
    const completed = await completeAnalysis(input.analysis.id, result.analysis, result, { cacheKey: input.fallbackCacheKey, fallbackUsed: true });
    await auditAnalysis(input.input, "ai.analysis.fallback_used", input.analysis.id, { primaryErrorCode: input.failedError.code, fallbackProvider: result.meta.provider, fallbackModel: result.meta.model, dataVersion: input.providerRequest.dataVersion });
    return toResponse(completed, result.analysis, { ...result.meta.usage, estimatedCost: costToNumber(cost.estimatedCost), currency: cost.currency });
  } catch (fallbackError) {
    const classified = fallbackError instanceof AiProviderError ? fallbackError : new AiProviderError({
      code: "AI_UNKNOWN_PROVIDER_ERROR",
      status: 502,
      message: "Fallback analiz hatasi",
    });
    await failAttempt(fallbackAttempt.id, classified, started);
    return null;
  }
}

async function enforceOperationalLimits(input: RunInput, config: AiRuntimeConfig, policy: CompanyAiPolicy, providerName: string) {
  const userActive = await countActiveAnalyses({ requestedByUserId: input.user.userId ?? null });
  if (userActive >= 1) {
    await auditAnalysis(input, "ai.concurrency.blocked", null, { limit: 1, current: userActive, scope: "user" });
    throw new AiProviderError({ code: "AI_USER_CONCURRENCY_LIMIT", status: 429, retryable: true, message: "Bu kullanici icin baska bir AI analizi halen devam ediyor" });
  }
  const companyActive = await countActiveAnalyses({ companyId: input.scope.companyId });
  const companyLimit = policy.maxConcurrentAnalyses;
  if (companyActive >= companyLimit) {
    await auditAnalysis(input, "ai.concurrency.blocked", null, { limit: companyLimit, current: companyActive, scope: "company" });
    throw new AiProviderError({ code: "AI_COMPANY_CONCURRENCY_LIMIT", status: 429, retryable: true, message: "Bu firma icin AI analiz eszamanli istek limiti dolu" });
  }
  if (config.globalMaxConcurrent !== null) {
    const globalActive = await countActiveAnalyses({});
    if (globalActive >= config.globalMaxConcurrent) {
      await auditAnalysis(input, "ai.concurrency.blocked", null, { limit: config.globalMaxConcurrent, current: globalActive, scope: "global" });
      throw new AiProviderError({ code: "AI_COMPANY_CONCURRENCY_LIMIT", status: 429, retryable: true, message: "Sistem genelinde AI analiz eszamanli istek limiti dolu" });
    }
  }
  if (providerName !== "gemini") return;
  const dailyLimit = policy.dailyAnalysisLimit ?? config.globalDailyLimit;
  if (dailyLimit !== null) {
    const count = await countSuccessfulProviderAnalyses(input.scope.companyId, "day");
    if (count >= dailyLimit) {
      await auditAnalysis(input, "ai.quota.blocked", null, { window: "day", limit: dailyLimit, current: count });
      throw new AiProviderError({ code: "AI_DAILY_LIMIT_REACHED", status: 429, message: "Firma gunluk AI analiz limiti doldu" });
    }
  }
  if (policy.monthlyAnalysisLimit !== null) {
    const count = await countSuccessfulProviderAnalyses(input.scope.companyId, "month");
    if (count >= policy.monthlyAnalysisLimit) {
      await auditAnalysis(input, "ai.quota.blocked", null, { window: "month", limit: policy.monthlyAnalysisLimit, current: count });
      throw new AiProviderError({ code: "AI_MONTHLY_LIMIT_REACHED", status: 429, message: "Firma aylik AI analiz limiti doldu" });
    }
  }
}

async function countActiveAnalyses(input: { companyId?: number; requestedByUserId?: number | null }) {
  if (input.requestedByUserId !== undefined) {
    if (input.requestedByUserId === null) return 0;
    const [row] = await db.select({ count: sql<number>`count(*) FILTER (WHERE ${aiAnalysesTable.status} = 'processing' AND ${aiAnalysesTable.requestedByUserId} = ${input.requestedByUserId})::int` })
      .from(aiAnalysesTable);
    return Number(row?.count ?? 0);
  }
  if (input.companyId !== undefined) {
    const [row] = await db.select({ count: sql<number>`count(*) FILTER (WHERE ${aiAnalysesTable.status} = 'processing' AND ${aiAnalysesTable.companyId} = ${input.companyId})::int` })
      .from(aiAnalysesTable);
    return Number(row?.count ?? 0);
  }
  const [row] = await db.select({ count: sql<number>`count(*) FILTER (WHERE ${aiAnalysesTable.status} = 'processing')::int` })
    .from(aiAnalysesTable);
  return Number(row?.count ?? 0);
}

async function countSuccessfulProviderAnalyses(companyId: number, window: "day" | "month") {
  const since = new Date();
  if (window === "day") since.setUTCHours(0, 0, 0, 0);
  else {
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
  }
  const [row] = await db.select({ count: sql<number>`count(*)::int` })
    .from(aiAnalysesTable)
    .where(and(
      eq(aiAnalysesTable.companyId, companyId),
      eq(aiAnalysesTable.provider, "gemini"),
      eq(aiAnalysesTable.status, "completed"),
      eq(aiAnalysesTable.cacheHit, false),
      eq(aiAnalysesTable.fallbackUsed, false),
      gte(aiAnalysesTable.completedAt, since),
    ));
  return Number(row?.count ?? 0);
}

function defaultCompanyAiPolicy(): CompanyAiPolicy {
  return {
    dataPolicy: "disabled",
    retentionDays: null,
    dailyAnalysisLimit: null,
    monthlyAnalysisLimit: null,
    maxConcurrentAnalyses: 2,
    fallbackEnabled: true,
    version: 0,
    updatedAt: null,
  };
}

function normalizeConcurrent(value: number) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 20 ? value : 2;
}
