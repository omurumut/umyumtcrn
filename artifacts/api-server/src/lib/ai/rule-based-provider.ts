import type { AiAnalysisResult, AiAnalysisType } from "@workspace/api-zod";
import { createHash } from "node:crypto";
import { validateProviderAnalysis } from "./analysis-validator.js";
import type { AiAnalysisContext } from "./context-types.js";
import type { AiProvider, AiProviderCallOptions, AiProviderRequest, AiProviderResult } from "./provider.js";

const TITLES: Record<AiAnalysisType, string> = {
  energy_performance_overview: "Kural tabanli enerji performansi degerlendirmesi",
  equipment_improvement_opportunities: "Kural tabanli ekipman iyilestirme degerlendirmesi",
  data_quality_and_monitoring: "Kural tabanli veri kalitesi degerlendirmesi",
};

export class RuleBasedAiProvider implements AiProvider {
  readonly providerName = "rule_based" as const;

  getModelName() {
    return "rule-based-v1";
  }

  async generateAnalysis(request: AiProviderRequest, _options: AiProviderCallOptions): Promise<AiProviderResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const providerRequestId = `rule_${stableHash({ scope: request.scope, dataVersion: request.dataVersion, analysisType: request.analysisType }).slice(0, 16)}`;
    const result = validateProviderAnalysis(buildRuleBasedResult(request, providerRequestId), request.evidenceRegistry);
    const finished = Date.now();
    return {
      analysis: result,
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

function buildRuleBasedResult(request: AiProviderRequest, providerRequestId: string): AiAnalysisResult {
  const context = request.context as AiAnalysisContext;
  const evidence = request.evidenceRegistry?.records[0];
  const evidenceId = evidence?.evidenceId ?? "backend_context";
  const dataSufficiency = context.dataSufficiency;
  const missingData = missingDataFor(context);
  const findingType = request.analysisType === "equipment_improvement_opportunities"
    ? "equipment_opportunity"
    : request.analysisType === "data_quality_and_monitoring"
      ? "data_quality_gap"
      : "performance_trend";
  const moduleTarget = request.analysisType === "equipment_improvement_opportunities"
    ? "equipment_inventory"
    : request.analysisType === "data_quality_and_monitoring"
      ? "monitoring"
      : "energy_review";
  const limitations = [
    "Bu sonuc Gemini yaniti degil, EnYS icindeki kural tabanli fallback motoru tarafindan uretilmistir.",
    "Tahmini etki nitel bir degerlendirmedir; dogrulanmis tasarruf hesabi olarak kullanilamaz.",
  ];
  const consumptionKwh = context.consumption.totalKwh;
  const recordCount = context.consumption.recordCount;
  const activeEquipment = context.equipmentInventory.scope.activeEquipment;

  return {
    schemaVersion: "1.0",
    analysisType: request.analysisType,
    summary: `${TITLES[request.analysisType]} ${request.scope.year} donemi icin hazirlandi. Gemini servisi kullanilamadiginda sistem, mevcut dogrulanmis EnYS context ozetleriyle sinirli bir fallback sonucu uretir.`,
    dataSufficiency,
    findings: [
      {
        id: `fallback_${providerRequestId.slice(-12)}`,
        findingType,
        title: TITLES[request.analysisType],
        observation: `Kapsamda ${recordCount} tuketim kaydi, ${activeEquipment} aktif ekipman ve ${context.seu.itemCount} OEK kaydi gorunuyor.`,
        reasoning: "Kural tabanli fallback, yalniz backend tarafindan hazirlanan minimize edilmis context ozetlerini ve evidence registry kayitlarini kullanir.",
        evidence: [
          {
            source: evidenceId,
            description: evidence
              ? `${evidence.sourceModule} modulundeki ${evidence.metric} metrigi backend tarafindan scope uygulanarak hazirlandi.`
              : "Backend tarafindan scope uygulanarak hazirlanan EnYS context ozeti.",
            value: evidence?.value === null || evidence?.value === undefined
              ? `${Math.round(consumptionKwh)} kWh toplam tuketim`
              : `${String(evidence.value)}${evidence.unit ? ` ${evidence.unit}` : ""}`,
          },
        ],
        scope: request.scope,
        energySourceRefs: [],
        equipmentRefs: [],
        recommendedAction: dataSufficiency === "insufficient"
          ? "Eksik tuketim, ekipman veya izleme verilerini tamamlayip AI analizini tekrar calistirin."
          : "Bulguyu yetkili uzmanla gozden gecirip ilgili EnYS modulunde dogrulanmis hesaplarla destekleyin.",
        priority: dataSufficiency === "insufficient" ? "medium" : "high",
        estimatedImpact: {
          type: "qualitative_estimate",
          description: "Kural tabanli fallback sayisal tasarruf garantisi veya dogrulanmis hesap uretmez.",
        },
        confidence: dataSufficiency === "sufficient" ? "medium" : "low",
        dataSufficiency,
        missingData,
        limitations,
        moduleTarget,
        draftActionEligibility: {
          eligible: false,
          reason: "Fallback sonucu otomatik aksiyon taslagi olusturmaz; insan onayi ve dogrulanmis hesap gerekir.",
        },
      },
    ],
    overallLimitations: limitations,
    disclaimer: "Bu sonuc Gemini AI analizi degildir. Kural tabanli fallback karar destegi amaclidir ve resmi enerji hesabi veya tasarruf garantisi olarak kullanilamaz.",
  };
}

function missingDataFor(context: AiAnalysisContext) {
  const missing: string[] = [];
  if (context.consumption.recordCount === 0) missing.push("annual_consumption_records");
  if (context.equipmentInventory.readiness.ready === false) missing.push("equipment_meter_or_energy_source_links");
  if (context.technicalProfile.status !== "resolved") missing.push("published_unit_technical_profile");
  if (context.monitoring.weather.dataSufficiency.status === "unavailable") missing.push("weather_or_monitoring_data");
  return missing.slice(0, 12);
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
