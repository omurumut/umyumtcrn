import type { AiAnalysisResult, AiAnalysisType } from "@workspace/api-zod";
import { createHash } from "node:crypto";
import { AiProviderError } from "./errors.js";
import { validateProviderAnalysis } from "./analysis-validator.js";
import type { AiProvider, AiProviderCallOptions, AiProviderRequest, AiProviderResult } from "./provider.js";

export type MockAiMode = "success" | "timeout" | "rate_limited" | "invalid_schema" | "empty_response" | "provider_unavailable";

const ANALYSIS_TITLES: Record<AiAnalysisType, string> = {
  energy_performance_overview: "Enerji performansi genel gorunumu",
  equipment_improvement_opportunities: "Ekipman iyilestirme firsatlari",
  data_quality_and_monitoring: "Veri kalitesi ve izleme",
};

export class MockAiProvider implements AiProvider {
  readonly providerName = "mock" as const;

  constructor(private readonly mode: MockAiMode = "success") {}

  getModelName() {
    return "mock-v1";
  }

  async generateAnalysis(
    request: AiProviderRequest,
    options: AiProviderCallOptions,
  ): Promise<AiProviderResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const providerRequestId = `mock_${stableHash(request).slice(0, 16)}`;

    if (options.signal?.aborted || this.mode === "timeout") {
      throw new AiProviderError({
        code: "AI_TIMEOUT",
        status: 504,
        retryable: true,
        providerRequestId,
        message: "AI provider zaman asimina ugradi",
      });
    }
    if (this.mode === "rate_limited") {
      throw new AiProviderError({
        code: "AI_RATE_LIMITED",
        status: 429,
        retryable: true,
        providerRequestId,
        message: "AI provider rate limit uyguladi",
      });
    }
    if (this.mode === "provider_unavailable") {
      throw new AiProviderError({
        code: "AI_PROVIDER_UNAVAILABLE",
        status: 503,
        retryable: true,
        providerRequestId,
        message: "AI provider gecici olarak kullanilamiyor",
      });
    }
    if (this.mode === "empty_response") {
      throw new AiProviderError({
        code: "AI_EMPTY_RESPONSE",
        status: 502,
        providerRequestId,
        message: "AI provider bos yanit dondu",
      });
    }
    if (this.mode === "invalid_schema") {
      validateProviderAnalysis({ schemaVersion: "1.0", findings: [] });
    }

    const rawAnalysis = buildMockAnalysis(request, providerRequestId);
    const analysis = validateProviderAnalysis(rawAnalysis);
    const finished = Date.now();
    return {
      analysis,
      meta: {
        provider: this.providerName,
        model: this.getModelName(),
        providerRequestId,
        startedAt,
        finishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        usage: {
          inputTokens: null,
          outputTokens: null,
          thinkingTokens: null,
          cachedTokens: null,
          totalTokens: null,
        },
      },
    };
  }
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildMockAnalysis(request: AiProviderRequest, providerRequestId: string): AiAnalysisResult {
  const { analysisType, scope, context } = request;
  const technicalReady = context.technicalProfile.status === "resolved";
  const equipmentReady = context.equipmentInventory.readiness.ready;
  const dataSufficiency = technicalReady && equipmentReady && context.consumption.recordCount > 0
    ? "sufficient"
    : context.consumption.recordCount > 0 || technicalReady || equipmentReady
      ? "partial"
      : "insufficient";
  const findingType = analysisType === "equipment_improvement_opportunities"
    ? "equipment_opportunity"
    : analysisType === "data_quality_and_monitoring"
      ? "data_quality_gap"
      : "performance_trend";
  const moduleTarget = analysisType === "equipment_improvement_opportunities"
    ? "equipment_inventory"
    : analysisType === "data_quality_and_monitoring"
      ? "monitoring"
      : "energy_review";
  const limitations = [
    "Bu mock analiz dis AI servisi kullanmadan deterministik olarak uretilmistir.",
    "Sayisal tasarruflar dogrulanmis enerji hesabi degildir.",
  ];

  return {
    schemaVersion: "1.0",
    analysisType,
    summary: `${ANALYSIS_TITLES[analysisType]} icin ${scope.year} yili kapsaminda mock on analiz olusturuldu.`,
    dataSufficiency,
    findings: [
      {
        id: `finding_${providerRequestId.slice(-10)}`,
        findingType,
        title: ANALYSIS_TITLES[analysisType],
        observation: `Kapsamda ${context.consumption.recordCount} tuketim kaydi, ${context.seu.itemCount} OEK kaydi ve ${context.equipmentInventory.scope.activeEquipment} aktif ekipman gorunuyor.`,
        reasoning: "Mock provider yalniz backend tarafindan hazirlanan baglam ozetlerini kullanir; kullanici promptu veya serbest metin calistirmaz.",
        evidence: [
          {
            source: "backend_context",
            description: "Tuketim, teknik profil ve ekipman readiness ozetleri backend tarafinda scope uygulanarak hazirlandi.",
            value: `${Math.round(context.consumption.totalKwh)} kWh toplam tuketim`,
          },
        ],
        scope,
        energySourceRefs: [],
        equipmentRefs: [],
        recommendedAction: dataSufficiency === "sufficient"
          ? "Bulguyu enerji gozden gecirme ve aksiyon plani hazirligi icin insan onayina sunun."
          : "Eksik teknik profil, ekipman iliskileri veya tuketim verilerini tamamlayip analizi tekrar calistirin.",
        priority: dataSufficiency === "insufficient" ? "medium" : "high",
        estimatedImpact: {
          type: "qualitative_estimate",
          description: "Bu fazda mock provider dogrulanmis tasarruf hesabi uretmez.",
        },
        confidence: dataSufficiency === "sufficient" ? "medium" : "low",
        dataSufficiency,
        missingData: [
          ...technicalReady ? [] : ["published_unit_technical_profile"],
          ...equipmentReady ? [] : ["equipment_meter_or_energy_source_links"],
          ...context.consumption.recordCount > 0 ? [] : ["annual_consumption_records"],
        ],
        limitations,
        moduleTarget,
        draftActionEligibility: {
          eligible: dataSufficiency !== "insufficient",
          reason: dataSufficiency !== "insufficient"
            ? "Taslak aksiyon yalniz insan onayi ve backend hesaplari ile ilerletilebilir."
            : "Veri yeterliligi aksiyon taslagi icin dusuk.",
        },
      },
    ],
    overallLimitations: limitations,
    disclaimer: "Bu analiz resmi veya matematiksel enerji hesabinin kaynagi degildir; kararlar yetkili uzman ve backend dogrulanmis hesaplarla desteklenmelidir.",
  };
}
