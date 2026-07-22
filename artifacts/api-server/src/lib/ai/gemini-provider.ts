import { AiProviderError } from "./errors.js";
import type { GeminiRuntimeConfig } from "./config.js";
import { geminiAnalysisResponseSchema } from "./gemini-schema.js";
import { buildGeminiSystemInstruction, buildGeminiUserContent } from "./gemini-prompt.js";
import { GoogleGenAiClientAdapter, type GeminiClientAdapter, type GeminiClientUsageMetadata } from "./gemini-client.js";
import { classifyGeminiError, isRetryableGeminiError, retryAfterMs } from "./gemini-errors.js";
import { validateProviderAnalysis } from "./analysis-validator.js";
import type { AiProvider, AiProviderCallOptions, AiProviderRequest, AiProviderResult, AiProviderUsage } from "./provider.js";

export type Sleeper = (milliseconds: number) => Promise<void>;

const defaultSleeper: Sleeper = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class GeminiAiProvider implements AiProvider {
  readonly providerName = "gemini" as const;
  private readonly client: GeminiClientAdapter;

  constructor(
    private readonly config: GeminiRuntimeConfig,
    client?: GeminiClientAdapter,
    private readonly sleeper: Sleeper = defaultSleeper,
  ) {
    this.client = client ?? new GoogleGenAiClientAdapter(config);
  }

  getModelName() {
    if (!this.config.model) {
      throw new AiProviderError({
        code: "AI_NOT_CONFIGURED",
        status: 503,
        message: "Gemini modeli yapilandirilmamis",
      });
    }
    return this.config.model;
  }

  async generateAnalysis(request: AiProviderRequest, options: AiProviderCallOptions): Promise<AiProviderResult> {
    if (!this.config.apiKey) {
      throw new AiProviderError({
        code: "AI_NOT_CONFIGURED",
        status: 503,
        message: "Gemini API anahtari yapilandirilmamis",
      });
    }
    const model = this.getModelName();
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const abortRelay = () => controller.abort();
    options.signal?.addEventListener("abort", abortRelay, { once: true });
    try {
      const response = await this.callWithRetry(request, {
        model,
        signal: controller.signal,
        maxOutputTokens: options.maxOutputTokens ?? 4_096,
      });
      if (!response.text || response.text.trim().length === 0) {
        throw new AiProviderError({
          code: "AI_EMPTY_RESPONSE",
          status: 502,
          message: "Gemini bos yanit dondu",
        });
      }
      if (/^\s*```/.test(response.text)) {
        throw new AiProviderError({
          code: "AI_SCHEMA_INVALID",
          status: 502,
          message: "Gemini schema disi markdown yanit dondu",
        });
      }
      const parsedJson = parseJson(response.text);
      const analysis = validateProviderAnalysis(normalizeGeminiAnalysis(parsedJson, request));
      const finished = Date.now();
      return {
        analysis,
        meta: {
          provider: this.providerName,
          model,
          providerRequestId: response.responseId,
          startedAt,
          finishedAt: new Date(finished).toISOString(),
          durationMs: finished - started,
          usage: mapGeminiUsage(response.usageMetadata),
        },
      };
    } catch (error) {
      throw classifyGeminiError(error);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortRelay);
    }
  }

  private async callWithRetry(
    request: AiProviderRequest,
    options: { model: string; signal: AbortSignal; maxOutputTokens: number },
  ) {
    let lastError: unknown;
    const attempts = this.config.maxRetries + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.client.generateStructuredContent({
          model: options.model,
          systemInstruction: buildGeminiSystemInstruction(),
          contents: buildGeminiUserContent(request),
          responseJsonSchema: geminiAnalysisResponseSchema(),
          maxOutputTokens: options.maxOutputTokens,
          temperature: this.config.temperature,
          signal: options.signal,
        });
      } catch (error) {
        const classified = classifyGeminiError(error);
        lastError = classified;
        if (attempt >= this.config.maxRetries || !isRetryableGeminiError(classified)) break;
        await this.sleeper(retryAfterMs(error) ?? retryDelayMs(attempt));
      }
    }
    throw lastError;
  }
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiProviderError({
      code: "AI_SCHEMA_INVALID",
      status: 502,
      message: "Gemini JSON yaniti parse edilemedi",
    });
  }
}

function retryDelayMs(attempt: number) {
  return 250 + attempt * 250 + Math.floor(Math.random() * 50);
}

function mapGeminiUsage(usage: GeminiClientUsageMetadata | null): AiProviderUsage {
  return {
    inputTokens: tokenOrNull(usage?.promptTokenCount),
    outputTokens: tokenOrNull(usage?.candidatesTokenCount),
    thinkingTokens: tokenOrNull(usage?.thoughtsTokenCount),
    cachedTokens: tokenOrNull(usage?.cachedContentTokenCount),
    totalTokens: tokenOrNull(usage?.totalTokenCount),
  };
}

function tokenOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeGeminiAnalysis(value: unknown, request: AiProviderRequest): unknown {
  if (!isRecord(value) || !Array.isArray(value.findings)) return value;
  const equipmentIds = new Set(request.context.equipmentInventory.items.map((item) => item.id));
  const energySourceIds = new Set(
    request.context.equipmentInventory.items.flatMap((item) => item.energySources.map((source) => source.id)),
  );
  return {
    ...value,
    findings: value.findings.map((finding) => normalizeFinding(finding, request, equipmentIds, energySourceIds)),
  };
}

function normalizeFinding(
  finding: unknown,
  request: AiProviderRequest,
  equipmentIds: Set<number>,
  energySourceIds: Set<number>,
): unknown {
  if (!isRecord(finding) || !isRecord(finding.scope)) return finding;
  const rawUnitId = finding.scope.unitId;
  const normalizedUnitId = rawUnitId === undefined && request.scope.unitId === null ? null : rawUnitId;
  if (
    finding.scope.companyId !== request.scope.companyId
    || finding.scope.year !== request.scope.year
    || normalizedUnitId !== request.scope.unitId
  ) {
    throw new AiProviderError({
      code: "AI_SCHEMA_INVALID",
      status: 502,
      message: "Gemini scope disi bulgu uretti",
    });
  }
  const equipmentRefs = Array.isArray(finding.equipmentRefs) ? finding.equipmentRefs : [];
  const energySourceRefs = Array.isArray(finding.energySourceRefs) ? finding.energySourceRefs : [];
  if (!equipmentRefs.every((id) => typeof id === "number" && equipmentIds.has(id))) {
    throw new AiProviderError({
      code: "AI_SCHEMA_INVALID",
      status: 502,
      message: "Gemini bilinmeyen ekipman referansi uretti",
    });
  }
  if (!energySourceRefs.every((id) => typeof id === "number" && energySourceIds.has(id))) {
    throw new AiProviderError({
      code: "AI_SCHEMA_INVALID",
      status: 502,
      message: "Gemini bilinmeyen enerji kaynagi referansi uretti",
    });
  }
  return {
    ...finding,
    scope: {
      ...finding.scope,
      unitId: normalizedUnitId,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
