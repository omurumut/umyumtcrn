import type { AiAnalysisResult, AiAnalysisType } from "@workspace/api-zod";
import type { AiProviderError } from "./errors.js";
import type { AiAnalysisContext, AiEvidenceRegistry } from "./context-types.js";
import type { EquipmentInventoryContext } from "../equipment-inventory-context.js";
import type { TechnicalProfileAiContext } from "../unit-technical-profile-effective.js";

export type AiProviderName = "mock" | "gemini" | "rule_based";

export type AiProviderScope = {
  companyId: number;
  unitId: number | null;
  year: number;
};

export type AiProviderRequest = {
  analysisType: AiAnalysisType;
  scope: AiProviderScope;
  context: AiAnalysisContext | {
    technicalProfile: TechnicalProfileAiContext;
    equipmentInventory: EquipmentInventoryContext;
    consumption: {
      totalKwh: number;
      recordCount: number;
    };
    seu: {
      itemCount: number;
      categories: string[];
    };
  };
  evidenceRegistry?: AiEvidenceRegistry;
  dataVersion?: string;
};

export type AiProviderCallOptions = {
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputTokens?: number;
  requestId?: string;
};

export type AiProviderUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  thinkingTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
};

export type AiProviderResult = {
  analysis: AiAnalysisResult;
  meta: {
    provider: AiProviderName;
    model: string;
    providerRequestId: string | null;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    usage: AiProviderUsage;
  };
};

export interface AiProvider {
  readonly providerName: AiProviderName;
  getModelName(): string;
  generateAnalysis(
    request: AiProviderRequest,
    options: AiProviderCallOptions,
  ): Promise<AiProviderResult>;
}

export type AiProviderFailure = AiProviderError;
