import type { AiAnalysisType } from "@workspace/api-zod";

type JsonSchema = {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null" | Array<"string" | "number" | "integer" | "boolean" | "null">;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  additionalProperties?: boolean;
};

const text = (enumValues?: string[]): JsonSchema => enumValues ? { type: "string", enum: enumValues } : { type: "string" };
const number = (): JsonSchema => ({ type: "number" });
const integer = (): JsonSchema => ({ type: "integer" });
const boolean = (): JsonSchema => ({ type: "boolean" });
const array = (items: JsonSchema): JsonSchema => ({ type: "array", items });

function object(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

export function geminiAnalysisResponseSchema(): JsonSchema {
  const scope = object({
    companyId: integer(),
    unitId: integer(),
    year: integer(),
  }, ["companyId", "year"]);

  const estimatedImpact = object({
    type: text(["backend_scenario", "qualitative_estimate", "not_estimated"]),
    description: text(),
    annualKwh: number(),
    annualCost: number(),
    percent: number(),
    calculationRef: text(),
  }, ["type", "description"]);

  const finding = object({
    id: text(),
    findingType: text(["performance_trend", "equipment_opportunity", "data_quality_gap", "monitoring_gap", "operational_practice"]),
    title: text(),
    observation: text(),
    reasoning: text(),
    evidence: array(object({
      source: text(),
      description: text(),
      value: text(),
    }, ["source", "description"])),
    scope,
    energySourceRefs: array(integer()),
    equipmentRefs: array(integer()),
    recommendedAction: text(),
    priority: text(["low", "medium", "high", "critical"]),
    estimatedImpact,
    confidence: text(["low", "medium", "high"]),
    dataSufficiency: text(["sufficient", "partial", "insufficient"]),
    missingData: array(text()),
    limitations: array(text()),
    moduleTarget: text(["energy_review", "equipment_inventory", "technical_profile", "action_plan", "monitoring"]),
    draftActionEligibility: object({
      eligible: boolean(),
      reason: text(),
    }, ["eligible", "reason"]),
  }, [
    "id",
    "findingType",
    "title",
    "observation",
    "reasoning",
    "evidence",
    "scope",
    "energySourceRefs",
    "equipmentRefs",
    "recommendedAction",
    "priority",
    "estimatedImpact",
    "confidence",
    "dataSufficiency",
    "missingData",
    "limitations",
    "moduleTarget",
    "draftActionEligibility",
  ]);

  return object({
    schemaVersion: text(["1.0"]),
    analysisType: text(["energy_performance_overview", "equipment_improvement_opportunities", "data_quality_and_monitoring"]),
    summary: text(),
    dataSufficiency: text(["sufficient", "partial", "insufficient"]),
    findings: array(finding),
    overallLimitations: array(text()),
    disclaimer: text(),
  }, ["schemaVersion", "analysisType", "summary", "dataSufficiency", "findings", "overallLimitations", "disclaimer"]);
}

export function geminiMinimalSmokeResponseSchema(): JsonSchema {
  return object({
    ok: boolean(),
    summary: text(),
  }, ["ok", "summary"]);
}

export function analysisTypeInstruction(analysisType: AiAnalysisType) {
  switch (analysisType) {
    case "energy_performance_overview":
      return "Enerji performansina iliskin veri destekli genel bulgulari uret.";
    case "equipment_improvement_opportunities":
      return "Ekipman envanteri ve iliskilerinden iyilestirme firsatlarini uret.";
    case "data_quality_and_monitoring":
      return "Veri kalitesi, izleme ve eksik veri bulgularini uret.";
  }
}
