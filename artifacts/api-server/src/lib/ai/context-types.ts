import type { AiAnalysisType } from "@workspace/api-zod";
import type { AiResolvedScope } from "./scope.js";
import type { EquipmentInventoryContext } from "../equipment-inventory-context.js";
import type { TechnicalProfileAiContext } from "../unit-technical-profile-effective.js";

export const AI_CONTEXT_SCHEMA_VERSION = "1";
export const AI_CONTEXT_BUILDER_VERSION = "3f.3.0";
export const AI_REDACTION_POLICY_VERSION = "allowlist-redaction-v1";
export const AI_LIMIT_POLICY_VERSION = "context-limits-v1";

export type AiDataSufficiencyStatus = "complete" | "partial" | "insufficient" | "unavailable";
export type AiCalculationAuthority = "backend_verified" | "user_entered" | "imported_official" | "rule_based_estimate";

export type AiDataSufficiency = {
  status: AiDataSufficiencyStatus;
  recordCount: number;
  expectedCount: number | null;
  coveragePercent: number | null;
  missingPeriods: string[];
  missingFields: string[];
  warnings: string[];
  lastUpdatedAt: string | null;
  sourceVersion: string | null;
};

export type AiAnalysisEvidence = {
  evidenceId: string;
  sourceModule: string;
  sourceEntityType: string;
  opaqueSourceRef: string;
  metric: string;
  value: string | number | boolean | null;
  unit: string | null;
  period: string | null;
  calculationAuthority: AiCalculationAuthority;
  dataQuality: AiDataSufficiencyStatus;
  sourceVersion: string | null;
};

export type AiEvidenceRegistry = {
  records: AiAnalysisEvidence[];
  opaqueRefMap: Record<string, { entityType: string; id: number }>;
};

export type AiContextLimits = {
  maxBytes: number;
  maxEvidence: number;
  maxEquipment: number;
  maxFreeTextChars: number;
  maxMonthlyPeriods: number;
};

export type AiConsumptionContext = {
  totalKwh: number;
  totalTep: number | null;
  totalCo2: number | null;
  recordCount: number;
  monthly: Array<{ period: string; rawConsumption: number; kwh: number; tep: number; co2: number }>;
  byEnergySource: Array<{ sourceRef: string; type: string; unit: string; totalRawConsumption: number; totalKwh: number; totalTep: number; totalCo2: number }>;
  dataSufficiency: AiDataSufficiency;
};

export type AiMonitoringContext = {
  weather: {
    recordCount: number;
    officialRecordCount: number;
    annualHdd: number | null;
    annualCdd: number | null;
    monthly: Array<{ period: string; hdd: number; cdd: number; source: string; isOfficial: boolean }>;
    dataSufficiency: AiDataSufficiency;
  };
  variables: {
    recordCount: number;
    variables: Array<{ variableRef: string; name: string; category: string; unitLabel: string | null; monthlyCount: number; coveragePercent: number | null; dataQuality: string | null }>;
    dataSufficiency: AiDataSufficiency;
  };
};

export type AiPerformanceContext = {
  seu: {
    itemCount: number;
    categories: string[];
    acceptedItems: Array<{ seuRef: string; name: string; energyTep: number; sharePercent: number; priorityResult: number | null; energySourceRef: string | null }>;
    dataSufficiency: AiDataSufficiency;
  };
  enpi: {
    indicatorCount: number;
    baselineCount: number;
    resultCount: number;
    baselines: Array<{ baselineRef: string; baselineYear: number; status: string; isValid: boolean; rSquared: number | null; adjustedRSquared: number | null; sampleSize: number | null }>;
    results: Array<{ resultRef: string; period: string; actualConsumption: number | null; expectedConsumption: number | null; difference: number | null; eei: number | null; status: string | null }>;
    dataSufficiency: AiDataSufficiency;
  };
};

export type AiActionContext = {
  targets: {
    count: number;
    items: Array<{ targetRef: string; targetYear: number; targetReductionPercent: number; baselineValue: number | null; targetValue: number | null; actualValue: number | null; unitLabel: string | null; status: string | null }>;
    dataSufficiency: AiDataSufficiency;
  };
  actions: {
    count: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    overdueCount: number;
    dataSufficiency: AiDataSufficiency;
  };
  vap: {
    count: number;
    byStatus: Record<string, number>;
    verifiedSavings: Array<{ vapRef: string; projectType: string | null; status: string; annualEnergySavingValue: number | null; annualEnergySavingUnit: string | null; co2ReductionTon: number | null; feasibilityStatus: string | null }>;
    dataSufficiency: AiDataSufficiency;
  };
  risks: {
    count: number;
    openHighPriorityCount: number;
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
    dataSufficiency: AiDataSufficiency;
  };
  energyReview: {
    completedCount: number;
    latestRevision: number | null;
    latestCompletedAt: string | null;
    dataSufficiency: AiDataSufficiency;
  };
};

export type AiDataManifest = {
  contextSchemaVersion: string;
  analysisType: AiAnalysisType;
  companyScope: number;
  unitScope: number | null;
  periodStart: string;
  periodEnd: string;
  effectiveDate: string;
  technicalProfile: { snapshotId: number | null; snapshotNumber: number | null; profileVersion: number | null; publishedAt: string | null };
  equipment: { recordCount: number; maxUpdatedAt: string | null; includedCount: number; truncated: boolean };
  consumption: { recordCount: number; maxCreatedAt: string | null; totalKwh: number; totalTep: number | null; totalCo2: number | null };
  refs: { meters: string[]; energySources: string[]; equipment: string[] };
  performance: { seuAssessmentCount: number; baselineCount: number; resultCount: number; maxUpdatedAt: string | null };
  lifecycle: { targetMaxUpdatedAt: string | null; actionMaxUpdatedAt: string | null; vapMaxUpdatedAt: string | null; riskMaxCreatedAt: string | null };
  weather: { recordCount: number; sourceVersion: string | null };
  builderVersion: string;
  redactionPolicyVersion: string;
  limitPolicyVersion: string;
};

export type AiAnalysisContext = {
  contextSchemaVersion: string;
  analysisType: AiAnalysisType;
  scopeType: "company" | "unit";
  companyRef: "company:scope";
  unitRef: "unit:primary" | null;
  subUnitRefs: string[];
  periodStart: string;
  periodEnd: string;
  effectiveDate: string;
  locale: string;
  generatedAt: string;
  dataVersion: string;
  dataSufficiency: "sufficient" | "partial" | "insufficient";
  limitations: string[];
  sourceSummary: Record<string, unknown>;
  contextTruncated: boolean;
  technicalProfile: TechnicalProfileAiContext;
  equipmentInventory: EquipmentInventoryContext;
  consumption: AiConsumptionContext;
  monitoring: AiMonitoringContext;
  performance: AiPerformanceContext;
  actions: AiActionContext;
  seu: { itemCount: number; categories: string[] };
  evidenceIds: string[];
};

export type AiContextBuildRequest = {
  analysisType: AiAnalysisType;
  effectiveDate: string;
  locale?: string;
};

export type AiContextBuildResult = {
  context: AiAnalysisContext;
  evidenceRegistry: AiEvidenceRegistry;
  dataVersion: string;
  dataManifest: AiDataManifest;
  warnings: string[];
};

export interface AiContextBuilder {
  readonly analysisType: AiAnalysisType;
  build(scope: AiResolvedScope, request: AiContextBuildRequest): Promise<AiContextBuildResult>;
}
