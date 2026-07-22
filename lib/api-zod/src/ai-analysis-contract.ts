import { z } from "zod";

export const aiAnalysisTypeSchema = z.enum([
  "energy_performance_overview",
  "equipment_improvement_opportunities",
  "data_quality_and_monitoring",
]);

export const aiFindingTypeSchema = z.enum([
  "performance_trend",
  "equipment_opportunity",
  "data_quality_gap",
  "monitoring_gap",
  "operational_practice",
]);

export const aiPrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export const aiConfidenceSchema = z.enum(["low", "medium", "high"]);
export const aiDataSufficiencySchema = z.enum(["sufficient", "partial", "insufficient"]);
export const aiEstimatedImpactTypeSchema = z.enum([
  "verified_calculation",
  "backend_scenario",
  "qualitative_estimate",
  "not_estimated",
]);

const boundedText = (min: number, max: number) => z.string().trim().min(min).max(max);
const idRefSchema = z.number().int().positive();

export const aiEvidenceSchema = z.object({
  source: boundedText(1, 80),
  description: boundedText(1, 400),
  value: boundedText(1, 160).optional(),
});

export const aiEstimatedImpactSchema = z.object({
  type: aiEstimatedImpactTypeSchema,
  description: boundedText(1, 300),
  annualKwh: z.number().finite().nonnegative().optional(),
  annualCost: z.number().finite().nonnegative().optional(),
  percent: z.number().finite().min(0).max(100).optional(),
  calculationRef: boundedText(1, 120).optional(),
}).superRefine((impact, ctx) => {
  if (impact.type === "not_estimated" && (
    impact.annualKwh !== undefined
    || impact.annualCost !== undefined
    || impact.percent !== undefined
    || impact.calculationRef !== undefined
  )) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "not_estimated etkisi sayisal tasarruf veya hesap referansi tasiyamaz",
      path: ["type"],
    });
  }
  if (impact.type === "qualitative_estimate" && impact.calculationRef !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "qualitative_estimate dogrulanmis hesap referansi tasiyamaz",
      path: ["calculationRef"],
    });
  }
});

export const aiFindingSchema = z.object({
  id: boundedText(1, 80),
  findingType: aiFindingTypeSchema,
  title: boundedText(3, 140),
  observation: boundedText(10, 800),
  reasoning: boundedText(10, 1_200),
  evidence: z.array(aiEvidenceSchema).max(8),
  scope: z.object({
    companyId: idRefSchema,
    unitId: idRefSchema.nullable(),
    year: z.number().int().min(1900).max(3000),
  }),
  energySourceRefs: z.array(idRefSchema).max(20),
  equipmentRefs: z.array(idRefSchema).max(20),
  recommendedAction: boundedText(10, 700),
  priority: aiPrioritySchema,
  estimatedImpact: aiEstimatedImpactSchema,
  confidence: aiConfidenceSchema,
  dataSufficiency: aiDataSufficiencySchema,
  missingData: z.array(boundedText(1, 160)).max(12),
  limitations: z.array(boundedText(1, 240)).max(12),
  moduleTarget: z.enum([
    "energy_review",
    "equipment_inventory",
    "technical_profile",
    "action_plan",
    "monitoring",
  ]),
  draftActionEligibility: z.object({
    eligible: z.boolean(),
    reason: boundedText(1, 240),
  }),
});

export const aiAnalysisResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  analysisType: aiAnalysisTypeSchema,
  summary: boundedText(10, 1_000),
  dataSufficiency: aiDataSufficiencySchema,
  findings: z.array(aiFindingSchema).min(1).max(8),
  overallLimitations: z.array(boundedText(1, 280)).max(12),
  disclaimer: boundedText(20, 600),
});

export type AiAnalysisType = z.infer<typeof aiAnalysisTypeSchema>;
export type AiFinding = z.infer<typeof aiFindingSchema>;
export type AiAnalysisResult = z.infer<typeof aiAnalysisResultSchema>;
