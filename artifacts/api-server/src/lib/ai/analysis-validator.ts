import { aiAnalysisResultSchema, type AiAnalysisResult } from "@workspace/api-zod";
import { AiProviderError } from "./errors.js";
import type { AiEvidenceRegistry } from "./context-types.js";
import { validateFindingEvidenceRefs } from "./context-utils.js";

export function validateProviderAnalysis(value: unknown, evidenceRegistry?: AiEvidenceRegistry): AiAnalysisResult {
  const parsed = aiAnalysisResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new AiProviderError({
      code: "AI_SCHEMA_INVALID",
      status: 502,
      message: "AI analiz semasi dogrulanamadi",
    });
  }
  if (parsed.data.findings.some((finding) => finding.estimatedImpact.type === "verified_calculation")) {
    throw new AiProviderError({
      code: "AI_SCHEMA_INVALID",
      status: 502,
      message: "Provider dogrulanmis hesap sonucu uretemez",
    });
  }
  validateFindingEvidenceRefs(parsed.data, evidenceRegistry);
  return parsed.data;
}
