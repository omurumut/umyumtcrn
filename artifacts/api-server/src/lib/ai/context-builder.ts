import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AiAnalysisType } from "@workspace/api-zod";
import {
  companiesTable,
  companySettingsTable,
  consumptionTable,
  db,
  energyActionPlansTable,
  energyBaselineVariablesTable,
  energyBaselinesTable,
  energyPerformanceIndicatorsTable,
  energyPerformanceResultsTable,
  energyReviewRecordsTable,
  energySourcesTable,
  energyTargetsTable,
  equipmentTable,
  metersTable,
  risksTable,
  seuAssessmentItemsTable,
  seuAssessmentsTable,
  unitsTable,
  vapProjectsTable,
  variableValuesTable,
  variablesTable,
  weatherDegreeDaysTable,
} from "@workspace/db";
import { buildEquipmentInventoryContext, type EquipmentInventoryContext } from "../equipment-inventory-context.js";
import { buildTechnicalProfileAiContext, endOfYearEffectiveDate } from "../unit-technical-profile-effective.js";
import type {
  AiActionContext,
  AiAnalysisContext,
  AiAnalysisEvidence,
  AiContextBuilder,
  AiContextBuildRequest,
  AiContextBuildResult,
  AiContextLimits,
  AiConsumptionContext,
  AiDataManifest,
  AiEvidenceRegistry,
  AiMonitoringContext,
  AiPerformanceContext,
} from "./context-types.js";
import {
  AI_CONTEXT_BUILDER_VERSION,
  AI_CONTEXT_SCHEMA_VERSION,
  AI_LIMIT_POLICY_VERSION,
  AI_REDACTION_POLICY_VERSION,
} from "./context-types.js";
import type { AiResolvedScope } from "./scope.js";
import { createEvidenceRegistry, evidenceId, increment, maxIso, round, sha256Canonical, stripSensitiveKeys, sufficiency } from "./context-utils.js";

export const DEFAULT_AI_CONTEXT_LIMITS: AiContextLimits = {
  maxBytes: 48_000,
  maxEvidence: 80,
  maxEquipment: 24,
  maxFreeTextChars: 400,
  maxMonthlyPeriods: 12,
};

type BuildPieces = {
  context: Omit<AiAnalysisContext, "dataVersion">;
  evidenceRegistry: AiEvidenceRegistry;
  dataManifest: AiDataManifest;
  warnings: string[];
};

export function createAiContextBuilder(analysisType: AiAnalysisType): AiContextBuilder {
  switch (analysisType) {
    case "energy_performance_overview":
      return new EnergyPerformanceContextBuilder();
    case "equipment_improvement_opportunities":
      return new EquipmentOpportunityContextBuilder();
    case "data_quality_and_monitoring":
      return new DataQualityContextBuilder();
  }
}

export async function buildAiAnalysisContext(scope: AiResolvedScope, request: AiContextBuildRequest): Promise<AiContextBuildResult> {
  return createAiContextBuilder(request.analysisType).build(scope, request);
}

class BaseContextBuilder implements AiContextBuilder {
  readonly analysisType: AiAnalysisType;
  constructor(analysisType: AiAnalysisType) {
    this.analysisType = analysisType;
  }

  async build(scope: AiResolvedScope, request: AiContextBuildRequest): Promise<AiContextBuildResult> {
    const pieces = await buildCommonPieces(scope, request, this.enabledSections());
    const dataVersion = sha256Canonical(pieces.dataManifest);
    let context = stripSensitiveKeys({ ...pieces.context, dataVersion });
    let byteSize = Buffer.byteLength(JSON.stringify(context), "utf8");
    const warnings = [...pieces.warnings];
    if (byteSize > DEFAULT_AI_CONTEXT_LIMITS.maxBytes) {
      warnings.push("context_byte_limit_exceeded");
      context = {
        ...context,
        equipmentInventory: {
          ...context.equipmentInventory,
          source: {
            ...context.equipmentInventory.source,
            includedCount: 0,
            truncated: true,
          },
          items: [],
          warnings: Array.from(new Set([...context.equipmentInventory.warnings, "context_byte_limit_items_removed"])),
        },
        contextTruncated: true,
        limitations: [...context.limitations, "Context byte limiti nedeniyle detay listeleri kaldirildi; ozet metrikler korundu."],
      };
      byteSize = Buffer.byteLength(JSON.stringify(context), "utf8");
    }
    return {
      context: {
        ...context,
        contextTruncated: context.contextTruncated || byteSize > DEFAULT_AI_CONTEXT_LIMITS.maxBytes,
        limitations: byteSize > DEFAULT_AI_CONTEXT_LIMITS.maxBytes
          ? [...context.limitations, "Context byte limiti asildi; provider'a gonderim oncesi daha dar ozet gerekli."]
          : context.limitations,
      },
      evidenceRegistry: pieces.evidenceRegistry,
      dataVersion,
      dataManifest: pieces.dataManifest,
      warnings,
    };
  }

  protected enabledSections(): Set<string> {
    return new Set(["technical", "equipment", "consumption", "weather", "variables", "performance", "targets", "actions", "vap", "risks", "energyReview"]);
  }
}

export class EnergyPerformanceContextBuilder extends BaseContextBuilder {
  constructor() {
    super("energy_performance_overview");
  }
  protected override enabledSections() {
    return new Set(["technical", "consumption", "weather", "variables", "performance", "targets", "actions", "energyReview"]);
  }
}

export class EquipmentOpportunityContextBuilder extends BaseContextBuilder {
  constructor() {
    super("equipment_improvement_opportunities");
  }
  protected override enabledSections() {
    return new Set(["technical", "equipment", "consumption", "performance", "targets", "actions", "vap", "risks"]);
  }
}

export class DataQualityContextBuilder extends BaseContextBuilder {
  constructor() {
    super("data_quality_and_monitoring");
  }
  protected override enabledSections() {
    return new Set(["technical", "equipment", "consumption", "weather", "variables", "performance", "targets", "risks", "energyReview"]);
  }
}

async function buildCommonPieces(scope: AiResolvedScope, request: AiContextBuildRequest, sections: Set<string>): Promise<BuildPieces> {
  const effectiveDate = request.effectiveDate || endOfYearEffectiveDate(scope.year);
  const periodStart = `${scope.year}-01-01`;
  const periodEnd = `${scope.year}-12-31`;
  const evidence: AiAnalysisEvidence[] = [];
  const opaqueRefMap: AiEvidenceRegistry["opaqueRefMap"] = {};

  const [company, settings, unit] = await Promise.all([
    db.select({ id: companiesTable.id, industry: companiesTable.industry, updatedAt: companiesTable.updatedAt, profileVersion: companiesTable.profileVersion })
      .from(companiesTable)
      .where(eq(companiesTable.id, scope.companyId))
      .limit(1),
    db.select({ defaultLocale: companySettingsTable.defaultLocale, settingsVersion: companySettingsTable.settingsVersion, updatedAt: companySettingsTable.updatedAt })
      .from(companySettingsTable)
      .where(eq(companySettingsTable.companyId, scope.companyId))
      .limit(1),
    scope.unitId === null
      ? Promise.resolve([])
      : db.select({ id: unitsTable.id, type: unitsTable.type, city: unitsTable.city, isDemo: unitsTable.isDemo })
        .from(unitsTable)
        .where(and(eq(unitsTable.companyId, scope.companyId), eq(unitsTable.id, scope.unitId)))
        .limit(1),
  ]);
  if (!company[0]) throw new Error("ai_context_company_not_found");
  if (scope.unitId !== null && !unit[0]) throw new Error("ai_context_unit_scope_mismatch");

  const [technicalProfile, rawEquipment, consumption, monitoring, performance, actions] = await Promise.all([
    sections.has("technical")
      ? buildTechnicalProfileAiContext({ companyId: scope.companyId, unitId: scope.unitId, effectiveDate })
      : buildTechnicalProfileAiContext({ companyId: scope.companyId, unitId: null, effectiveDate }),
    sections.has("equipment")
      ? buildEquipmentInventoryContext({ companyId: scope.companyId, unitId: scope.unitId, effectiveDate, includeItems: true, itemLimit: DEFAULT_AI_CONTEXT_LIMITS.maxEquipment })
      : buildEquipmentInventoryContext({ companyId: scope.companyId, unitId: scope.unitId, effectiveDate, includeItems: false, itemLimit: 0 }),
    sections.has("consumption") ? collectConsumption(scope, evidence, opaqueRefMap) : emptyConsumption(),
    collectMonitoring(scope, sections, evidence, opaqueRefMap),
    collectPerformance(scope, sections, evidence, opaqueRefMap),
    collectActions(scope, sections, evidence, opaqueRefMap),
  ]);

  const equipmentInventory = minimizeEquipment(rawEquipment, opaqueRefMap, evidence);
  const registry = createEvidenceRegistry(evidence.slice(0, DEFAULT_AI_CONTEXT_LIMITS.maxEvidence), opaqueRefMap);
  const contextTruncated = rawEquipment.source.truncated || evidence.length > registry.records.length;
  const warnings = [
    ...technicalProfile.warnings,
    ...equipmentInventory.warnings,
    ...(contextTruncated ? ["context_truncated"] : []),
  ];
  const limitations = [
    "AI yalniz backend tarafindan hazirlanan ozetleri yorumlar; TEP, CO2, regresyon veya hedef sapmasi hesaplamaz.",
    ...warnings,
  ];
  const topSufficiency = overallSufficiency([
    consumption.dataSufficiency.status,
    equipmentInventory.readiness.ready ? "complete" : equipmentInventory.scope.activeEquipment > 0 ? "partial" : "unavailable",
    technicalProfile.status === "resolved" ? "complete" : "partial",
  ]);
  const meterRefs = consumption.byEnergySource.map((row) => row.sourceRef).sort();
  const energySourceRefs = consumption.byEnergySource.map((row) => row.sourceRef).sort();
  const equipmentRefs = equipmentInventory.items.map((item) => `equipment:eq-${String(item.id).padStart(3, "0")}`).sort();
  const dataManifest: AiDataManifest = {
    contextSchemaVersion: AI_CONTEXT_SCHEMA_VERSION,
    analysisType: request.analysisType,
    companyScope: scope.companyId,
    unitScope: scope.unitId,
    periodStart,
    periodEnd,
    effectiveDate,
    technicalProfile: {
      snapshotId: technicalProfile.source.snapshotId,
      snapshotNumber: technicalProfile.source.snapshotNumber,
      profileVersion: technicalProfile.source.profileVersion,
      publishedAt: technicalProfile.source.publishedAt,
    },
    equipment: {
      recordCount: equipmentInventory.source.totalCount,
      maxUpdatedAt: equipmentInventory.source.lastEquipmentUpdatedAt,
      includedCount: equipmentInventory.source.includedCount,
      truncated: equipmentInventory.source.truncated,
    },
    consumption: {
      recordCount: consumption.recordCount,
      maxCreatedAt: consumption.dataSufficiency.lastUpdatedAt,
      totalKwh: consumption.totalKwh,
      totalTep: consumption.totalTep,
      totalCo2: consumption.totalCo2,
    },
    refs: { meters: meterRefs, energySources: energySourceRefs, equipment: equipmentRefs },
    performance: {
      seuAssessmentCount: performance.seu.itemCount,
      baselineCount: performance.enpi.baselineCount,
      resultCount: performance.enpi.resultCount,
      maxUpdatedAt: performance.enpi.dataSufficiency.lastUpdatedAt,
    },
    lifecycle: {
      targetMaxUpdatedAt: actions.targets.dataSufficiency.lastUpdatedAt,
      actionMaxUpdatedAt: actions.actions.dataSufficiency.lastUpdatedAt,
      vapMaxUpdatedAt: actions.vap.dataSufficiency.lastUpdatedAt,
      riskMaxCreatedAt: actions.risks.dataSufficiency.lastUpdatedAt,
    },
    weather: {
      recordCount: monitoring.weather.recordCount,
      sourceVersion: monitoring.weather.dataSufficiency.sourceVersion,
    },
    builderVersion: AI_CONTEXT_BUILDER_VERSION,
    redactionPolicyVersion: AI_REDACTION_POLICY_VERSION,
    limitPolicyVersion: AI_LIMIT_POLICY_VERSION,
  };
  return {
    context: {
      contextSchemaVersion: AI_CONTEXT_SCHEMA_VERSION,
      analysisType: request.analysisType,
      scopeType: scope.unitId === null ? "company" : "unit",
      companyRef: "company:scope",
      unitRef: scope.unitId === null ? null : "unit:primary",
      subUnitRefs: [],
      periodStart,
      periodEnd,
      effectiveDate,
      locale: request.locale ?? settings[0]?.defaultLocale ?? "tr-TR",
      generatedAt: `${effectiveDate}T00:00:00.000Z`,
      dataSufficiency: topSufficiency,
      limitations,
      sourceSummary: {
        company: { ref: "company:scope", industry: company[0].industry ?? null, profileVersion: company[0].profileVersion },
        unit: scope.unitId === null ? null : { ref: "unit:primary", type: unit[0]?.type ?? null, city: unit[0]?.city ?? null },
        sections: Array.from(sections).sort(),
      },
      contextTruncated,
      technicalProfile: {
        ...technicalProfile,
        unit: { id: scope.unitId, name: scope.unitId === null ? null : "unit:primary" },
      },
      equipmentInventory,
      consumption,
      monitoring,
      performance,
      actions,
      seu: {
        itemCount: performance.seu.itemCount,
        categories: performance.seu.acceptedItems.map((item) => item.name).slice(0, 12),
      },
      evidenceIds: registry.records.map((record) => record.evidenceId),
    },
    evidenceRegistry: registry,
    dataManifest,
    warnings,
  };
}

function minimizeEquipment(context: EquipmentInventoryContext, opaqueRefMap: AiEvidenceRegistry["opaqueRefMap"], evidence: AiAnalysisEvidence[]): EquipmentInventoryContext {
  const items = context.items.map((item, index) => {
    const refNo = index + 1;
    const opaqueRef = `equipment:eq-${String(refNo).padStart(3, "0")}`;
    opaqueRefMap[opaqueRef] = { entityType: "equipment", id: item.id };
    evidence.push({
      evidenceId: evidenceId("equipment", [item.id, item.updatedAt]),
      sourceModule: "equipment_inventory",
      sourceEntityType: "equipment",
      opaqueSourceRef: opaqueRef,
      metric: "equipment_readiness",
      value: item.isCritical || item.isEnergyIntensive ? "priority_equipment" : "active_equipment",
      unit: null,
      period: null,
      calculationAuthority: "backend_verified",
      dataQuality: item.measurementConfidence === "high" ? "complete" : "partial",
      sourceVersion: item.updatedAt,
    });
    return {
      ...item,
      id: refNo,
      equipmentCode: opaqueRef,
      name: opaqueRef,
      unitId: item.unitId,
      unitName: item.unitName ? "unit:primary" : null,
      subUnitName: item.subUnitName ? `sub-unit:${String(refNo).padStart(3, "0")}` : null,
      location: null,
      building: null,
      process: null,
      savingPotential: null,
      meters: item.meters.map((meter, meterIndex) => {
        const meterRef = `meter:meter-${String(meterIndex + 1).padStart(3, "0")}`;
        opaqueRefMap[meterRef] = { entityType: "meter", id: meter.id };
        return { ...meter, id: meterIndex + 1, name: meterRef };
      }),
      energySources: item.energySources.map((source, sourceIndex) => {
        const sourceRef = `energy-source:es-${String(sourceIndex + 1).padStart(3, "0")}`;
        opaqueRefMap[sourceRef] = { entityType: "energy_source", id: source.id };
        return { ...source, id: sourceIndex + 1, name: sourceRef };
      }),
      customFacts: item.customFacts.filter((fact) => fact.fieldType !== "short_text").slice(0, 8),
    };
  });
  return { ...context, items };
}

async function collectConsumption(scope: AiResolvedScope, evidence: AiAnalysisEvidence[], opaqueRefMap: AiEvidenceRegistry["opaqueRefMap"]): Promise<AiConsumptionContext> {
  const conditions = [
    eq(consumptionTable.companyId, scope.companyId),
    eq(consumptionTable.year, scope.year),
    eq(metersTable.companyId, scope.companyId),
  ];
  if (scope.unitId !== null) conditions.push(eq(metersTable.unitId, scope.unitId));
  const rows = await db.select({
    id: consumptionTable.id,
    meterId: metersTable.id,
    energySourceId: energySourcesTable.id,
    sourceType: energySourcesTable.type,
    sourceUnit: energySourcesTable.unit,
    month: consumptionTable.month,
    rawConsumption: consumptionTable.kwh,
    tep: consumptionTable.tep,
    co2: consumptionTable.co2,
    createdAt: consumptionTable.createdAt,
  })
    .from(consumptionTable)
    .innerJoin(metersTable, eq(consumptionTable.meterId, metersTable.id))
    .leftJoin(energySourcesTable, and(eq(metersTable.energySourceId, energySourcesTable.id), eq(energySourcesTable.companyId, scope.companyId)))
    .where(and(...conditions))
    .orderBy(asc(consumptionTable.month), asc(metersTable.id));
  const byMonth = new Map<number, { rawConsumption: number; tep: number; co2: number }>();
  const bySource = new Map<number, { type: string; unit: string; raw: number; kwh: number; tep: number; co2: number }>();
  for (const row of rows) {
    const current = byMonth.get(row.month) ?? { rawConsumption: 0, tep: 0, co2: 0 };
    current.rawConsumption += row.rawConsumption;
    current.tep += row.tep;
    current.co2 += row.co2;
    byMonth.set(row.month, current);
    const sourceId = row.energySourceId ?? 0;
    const source = bySource.get(sourceId) ?? { type: row.sourceType ?? "unknown", unit: row.sourceUnit ?? "kWh", raw: 0, kwh: 0, tep: 0, co2: 0 };
    source.raw += row.rawConsumption;
    source.kwh += row.rawConsumption;
    source.tep += row.tep;
    source.co2 += row.co2;
    bySource.set(sourceId, source);
  }
  const monthly = Array.from(byMonth.entries()).sort(([a], [b]) => a - b).slice(0, DEFAULT_AI_CONTEXT_LIMITS.maxMonthlyPeriods).map(([month, value]) => ({
    period: `${scope.year}-${String(month).padStart(2, "0")}`,
    rawConsumption: round(value.rawConsumption) ?? 0,
    kwh: round(value.rawConsumption) ?? 0,
    tep: round(value.tep) ?? 0,
    co2: round(value.co2) ?? 0,
  }));
  const byEnergySource = Array.from(bySource.entries()).sort(([a], [b]) => a - b).map(([sourceId, value], index) => {
    const ref = `energy-source:es-${String(index + 1).padStart(3, "0")}`;
    if (sourceId > 0) opaqueRefMap[ref] = { entityType: "energy_source", id: sourceId };
    return {
      sourceRef: ref,
      type: value.type,
      unit: value.unit,
      totalRawConsumption: round(value.raw) ?? 0,
      totalKwh: round(value.kwh) ?? 0,
      totalTep: round(value.tep) ?? 0,
      totalCo2: round(value.co2) ?? 0,
    };
  });
  const totalKwh = rows.reduce((sum, row) => sum + row.rawConsumption, 0);
  const totalTep = rows.reduce((sum, row) => sum + row.tep, 0);
  const totalCo2 = rows.reduce((sum, row) => sum + row.co2, 0);
  const missingPeriods = Array.from({ length: 12 }, (_, idx) => idx + 1)
    .filter((month) => !byMonth.has(month))
    .map((month) => `${scope.year}-${String(month).padStart(2, "0")}`);
  const dataSufficiency = sufficiency({ recordCount: rows.length, expectedCount: 12, missingPeriods, lastUpdatedAt: maxIso(rows.map((row) => row.createdAt)), sourceVersion: maxIso(rows.map((row) => row.createdAt)) });
  evidence.push({
    evidenceId: evidenceId("consumption-total", [scope.companyId, scope.unitId, scope.year, rows.length, totalKwh]),
    sourceModule: "consumption",
    sourceEntityType: "annual_consumption_summary",
    opaqueSourceRef: "consumption:annual",
    metric: "annual_total_kwh",
    value: round(totalKwh) ?? 0,
    unit: "kWh",
    period: String(scope.year),
    calculationAuthority: "backend_verified",
    dataQuality: dataSufficiency.status,
    sourceVersion: dataSufficiency.sourceVersion,
  });
  return { totalKwh: round(totalKwh) ?? 0, totalTep: round(totalTep), totalCo2: round(totalCo2), recordCount: rows.length, monthly, byEnergySource, dataSufficiency };
}

function emptyConsumption(): AiConsumptionContext {
  return { totalKwh: 0, totalTep: null, totalCo2: null, recordCount: 0, monthly: [], byEnergySource: [], dataSufficiency: sufficiency({ recordCount: 0, expectedCount: 12 }) };
}

async function collectMonitoring(scope: AiResolvedScope, sections: Set<string>, evidence: AiAnalysisEvidence[], opaqueRefMap: AiEvidenceRegistry["opaqueRefMap"]): Promise<AiMonitoringContext> {
  const weatherRows = sections.has("weather")
    ? await db.select({
      id: weatherDegreeDaysTable.id,
      date: weatherDegreeDaysTable.date,
      hdd: weatherDegreeDaysTable.hdd,
      cdd: weatherDegreeDaysTable.cdd,
      annualHdd: weatherDegreeDaysTable.annualHdd,
      annualCdd: weatherDegreeDaysTable.annualCdd,
      source: weatherDegreeDaysTable.source,
      isOfficial: weatherDegreeDaysTable.isOfficial,
      updatedAt: weatherDegreeDaysTable.updatedAt,
    }).from(weatherDegreeDaysTable)
      .where(and(
        or(isNull(weatherDegreeDaysTable.companyId), eq(weatherDegreeDaysTable.companyId, scope.companyId)),
        eq(weatherDegreeDaysTable.year, scope.year),
      ))
      .orderBy(asc(weatherDegreeDaysTable.month), asc(weatherDegreeDaysTable.id))
      .limit(DEFAULT_AI_CONTEXT_LIMITS.maxMonthlyPeriods)
    : [];
  const variableRows = sections.has("variables")
    ? await db.select({
      variableId: variablesTable.id,
      name: variablesTable.name,
      category: variablesTable.category,
      unitLabel: variablesTable.unitLabel,
      dataQuality: variableValuesTable.dataQuality,
      periodStart: variableValuesTable.periodStart,
      updatedAt: variableValuesTable.updatedAt,
    }).from(variableValuesTable)
      .innerJoin(variablesTable, and(eq(variableValuesTable.variableId, variablesTable.id), eq(variablesTable.companyId, scope.companyId)))
      .where(and(
        eq(variableValuesTable.companyId, scope.companyId),
        sql`${variableValuesTable.periodStart} >= ${scope.year + "-01-01"}`,
        sql`${variableValuesTable.periodStart} <= ${scope.year + "-12-31"}`,
        scope.unitId === null ? undefined : or(isNull(variableValuesTable.unitId), eq(variableValuesTable.unitId, scope.unitId)),
      ))
      .orderBy(asc(variablesTable.id), asc(variableValuesTable.periodStart))
    : [];
  const variables = new Map<number, { name: string; category: string; unitLabel: string | null; periods: Set<string>; dataQuality: string | null; updatedAt: Array<Date | string | null> }>();
  for (const row of variableRows) {
    const current = variables.get(row.variableId) ?? { name: row.name, category: row.category, unitLabel: row.unitLabel, periods: new Set<string>(), dataQuality: row.dataQuality, updatedAt: [] };
    current.periods.add(row.periodStart.slice(0, 7));
    current.updatedAt.push(row.updatedAt);
    variables.set(row.variableId, current);
  }
  const variableSummary = Array.from(variables.entries()).sort(([a], [b]) => a - b).slice(0, 12).map(([id, row], index) => {
    const ref = `variable:var-${String(index + 1).padStart(3, "0")}`;
    opaqueRefMap[ref] = { entityType: "variable", id };
    return { variableRef: ref, name: row.name, category: row.category, unitLabel: row.unitLabel, monthlyCount: row.periods.size, coveragePercent: Math.round((row.periods.size / 12) * 100), dataQuality: row.dataQuality };
  });
  if (weatherRows.length > 0) {
    evidence.push({
      evidenceId: evidenceId("weather", [scope.companyId, scope.year, weatherRows.length, maxIso(weatherRows.map((row) => row.updatedAt))]),
      sourceModule: "weather",
      sourceEntityType: "degree_days_summary",
      opaqueSourceRef: "weather:degree-days",
      metric: "degree_day_coverage",
      value: weatherRows.length,
      unit: "months",
      period: String(scope.year),
      calculationAuthority: weatherRows.every((row) => row.isOfficial) ? "imported_official" : "user_entered",
      dataQuality: weatherRows.length >= 12 ? "complete" : "partial",
      sourceVersion: maxIso(weatherRows.map((row) => row.updatedAt)),
    });
  }
  return {
    weather: {
      recordCount: weatherRows.length,
      officialRecordCount: weatherRows.filter((row) => row.isOfficial).length,
      annualHdd: round(weatherRows.find((row) => row.annualHdd !== null)?.annualHdd),
      annualCdd: round(weatherRows.find((row) => row.annualCdd !== null)?.annualCdd),
      monthly: weatherRows.filter((row) => row.date.length === 7).map((row) => ({ period: row.date, hdd: round(row.hdd) ?? 0, cdd: round(row.cdd) ?? 0, source: row.source, isOfficial: row.isOfficial })),
      dataSufficiency: sufficiency({ recordCount: weatherRows.length, expectedCount: 12, lastUpdatedAt: maxIso(weatherRows.map((row) => row.updatedAt)), sourceVersion: maxIso(weatherRows.map((row) => row.updatedAt)) }),
    },
    variables: {
      recordCount: variableRows.length,
      variables: variableSummary,
      dataSufficiency: sufficiency({ recordCount: variableRows.length, expectedCount: 12, lastUpdatedAt: maxIso(variableRows.map((row) => row.updatedAt)), sourceVersion: maxIso(variableRows.map((row) => row.updatedAt)) }),
    },
  };
}

async function collectPerformance(scope: AiResolvedScope, sections: Set<string>, evidence: AiAnalysisEvidence[], opaqueRefMap: AiEvidenceRegistry["opaqueRefMap"]): Promise<AiPerformanceContext> {
  const assessmentRows = sections.has("performance")
    ? await db.select({
      assessmentId: seuAssessmentsTable.id,
      itemId: seuAssessmentItemsTable.id,
      name: seuAssessmentItemsTable.name,
      energyTep: seuAssessmentItemsTable.energyTep,
      share: seuAssessmentItemsTable.consumptionSharePercent,
      priority: seuAssessmentItemsTable.priorityResult,
      energySourceId: seuAssessmentItemsTable.energySourceId,
      updatedAt: seuAssessmentItemsTable.updatedAt,
    }).from(seuAssessmentItemsTable)
      .innerJoin(seuAssessmentsTable, and(eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id), eq(seuAssessmentsTable.companyId, scope.companyId)))
      .where(and(
        eq(seuAssessmentsTable.companyId, scope.companyId),
        eq(seuAssessmentsTable.year, scope.year),
        eq(seuAssessmentsTable.isOfficial, true),
        eq(seuAssessmentItemsTable.userDecision, "accepted_as_seu"),
        scope.unitId === null ? undefined : eq(seuAssessmentsTable.unitId, scope.unitId),
      ))
      .orderBy(desc(seuAssessmentItemsTable.energyTep), asc(seuAssessmentItemsTable.id))
      .limit(12)
    : [];
  const baselineRows = sections.has("performance")
    ? await db.select({
      id: energyBaselinesTable.id,
      baselineYear: energyBaselinesTable.baselineYear,
      status: energyBaselinesTable.status,
      isValid: energyBaselinesTable.isValid,
      rSquared: energyBaselinesTable.rSquared,
      adjustedRSquared: energyBaselinesTable.adjustedRSquared,
      sampleSize: energyBaselinesTable.sampleSize,
      updatedAt: energyBaselinesTable.updatedAt,
    }).from(energyBaselinesTable)
      .where(and(
        eq(energyBaselinesTable.companyId, scope.companyId),
        eq(energyBaselinesTable.isValid, true),
        scope.unitId === null ? undefined : eq(energyBaselinesTable.unitId, scope.unitId),
      ))
      .orderBy(desc(energyBaselinesTable.updatedAt), asc(energyBaselinesTable.id))
      .limit(8)
    : [];
  const resultRows = sections.has("performance")
    ? await db.select({
      id: energyPerformanceResultsTable.id,
      month: energyPerformanceResultsTable.month,
      actualConsumption: energyPerformanceResultsTable.actualConsumption,
      expectedConsumption: energyPerformanceResultsTable.expectedConsumption,
      difference: energyPerformanceResultsTable.difference,
      eei: energyPerformanceResultsTable.eei,
      status: energyPerformanceResultsTable.status,
      updatedAt: energyPerformanceResultsTable.updatedAt,
    }).from(energyPerformanceResultsTable)
      .where(and(
        eq(energyPerformanceResultsTable.companyId, scope.companyId),
        eq(energyPerformanceResultsTable.year, scope.year),
        scope.unitId === null ? undefined : eq(energyPerformanceResultsTable.unitId, scope.unitId),
      ))
      .orderBy(asc(energyPerformanceResultsTable.month), asc(energyPerformanceResultsTable.id))
      .limit(12)
    : [];
  const acceptedItems = assessmentRows.map((row, index) => {
    const ref = `seu:seu-${String(index + 1).padStart(3, "0")}`;
    opaqueRefMap[ref] = { entityType: "seu_assessment_item", id: row.itemId };
    const sourceRef = row.energySourceId ? `energy-source:es-${String(index + 1).padStart(3, "0")}` : null;
    if (row.energySourceId && sourceRef) opaqueRefMap[sourceRef] = { entityType: "energy_source", id: row.energySourceId };
    return { seuRef: ref, name: row.name, energyTep: round(row.energyTep) ?? 0, sharePercent: round(row.share) ?? 0, priorityResult: row.priority, energySourceRef: sourceRef };
  });
  if (assessmentRows.length > 0) {
    evidence.push({
      evidenceId: evidenceId("seu", [scope.companyId, scope.unitId, scope.year, assessmentRows.length, maxIso(assessmentRows.map((row) => row.updatedAt))]),
      sourceModule: "seu",
      sourceEntityType: "seu_assessment_items",
      opaqueSourceRef: "seu:accepted-summary",
      metric: "accepted_seu_count",
      value: assessmentRows.length,
      unit: "items",
      period: String(scope.year),
      calculationAuthority: "backend_verified",
      dataQuality: "complete",
      sourceVersion: maxIso(assessmentRows.map((row) => row.updatedAt)),
    });
  }
  return {
    seu: {
      itemCount: assessmentRows.length,
      categories: Array.from(new Set(assessmentRows.map((row) => row.name))).sort(),
      acceptedItems,
      dataSufficiency: sufficiency({ recordCount: assessmentRows.length, expectedCount: null, lastUpdatedAt: maxIso(assessmentRows.map((row) => row.updatedAt)) }),
    },
    enpi: {
      indicatorCount: sections.has("performance") ? await countIndicators(scope) : 0,
      baselineCount: baselineRows.length,
      resultCount: resultRows.length,
      baselines: baselineRows.map((row, index) => {
        const ref = `baseline:base-${String(index + 1).padStart(3, "0")}`;
        opaqueRefMap[ref] = { entityType: "energy_baseline", id: row.id };
        return { baselineRef: ref, baselineYear: row.baselineYear, status: row.status, isValid: row.isValid, rSquared: round(row.rSquared), adjustedRSquared: round(row.adjustedRSquared), sampleSize: row.sampleSize };
      }),
      results: resultRows.map((row, index) => {
        const ref = `enpi-result:res-${String(index + 1).padStart(3, "0")}`;
        opaqueRefMap[ref] = { entityType: "energy_performance_result", id: row.id };
        return { resultRef: ref, period: `${scope.year}-${String(row.month).padStart(2, "0")}`, actualConsumption: round(row.actualConsumption), expectedConsumption: round(row.expectedConsumption), difference: round(row.difference), eei: round(row.eei), status: row.status };
      }),
      dataSufficiency: sufficiency({ recordCount: baselineRows.length + resultRows.length, expectedCount: null, lastUpdatedAt: maxIso([...baselineRows.map((row) => row.updatedAt), ...resultRows.map((row) => row.updatedAt)]) }),
    },
  };
}

async function countIndicators(scope: AiResolvedScope) {
  const [row] = await db.select({ value: sql<number>`count(*)::int` })
    .from(energyPerformanceIndicatorsTable)
    .where(and(eq(energyPerformanceIndicatorsTable.companyId, scope.companyId), scope.unitId === null ? undefined : eq(energyPerformanceIndicatorsTable.unitId, scope.unitId)));
  return Number(row?.value ?? 0);
}

async function collectActions(scope: AiResolvedScope, sections: Set<string>, evidence: AiAnalysisEvidence[], opaqueRefMap: AiEvidenceRegistry["opaqueRefMap"]): Promise<AiActionContext> {
  const targetRows = sections.has("targets")
    ? await db.select({
      id: energyTargetsTable.id,
      targetYear: energyTargetsTable.targetYear,
      targetReductionPercent: energyTargetsTable.targetReductionPercent,
      baselineValue: energyTargetsTable.baselineValue,
      targetValue: energyTargetsTable.targetValue,
      actualValue: energyTargetsTable.actualValue,
      unitLabel: energyTargetsTable.unitLabel,
      status: energyTargetsTable.status,
      updatedAt: energyTargetsTable.updatedAt,
    }).from(energyTargetsTable)
      .where(and(eq(energyTargetsTable.companyId, scope.companyId), scope.unitId === null ? undefined : eq(energyTargetsTable.unitId, scope.unitId)))
      .orderBy(desc(energyTargetsTable.targetYear), asc(energyTargetsTable.id))
      .limit(12)
    : [];
  const actionRows = sections.has("actions")
    ? await db.select({
      id: energyActionPlansTable.id,
      priority: energyActionPlansTable.priority,
      status: energyActionPlansTable.status,
      dueDate: energyActionPlansTable.dueDate,
      updatedAt: energyActionPlansTable.updatedAt,
    }).from(energyActionPlansTable)
      .innerJoin(energyTargetsTable, and(eq(energyActionPlansTable.targetId, energyTargetsTable.id), eq(energyTargetsTable.companyId, scope.companyId)))
      .where(and(eq(energyActionPlansTable.companyId, scope.companyId), scope.unitId === null ? undefined : eq(energyTargetsTable.unitId, scope.unitId)))
    : [];
  const vapRows = sections.has("vap")
    ? await db.select({
      id: vapProjectsTable.id,
      projectType: vapProjectsTable.projectType,
      status: vapProjectsTable.status,
      annualEnergySavingValue: vapProjectsTable.annualEnergySavingValue,
      annualEnergySavingUnit: vapProjectsTable.annualEnergySavingUnit,
      co2ReductionTon: vapProjectsTable.co2ReductionTon,
      feasibilityStatus: vapProjectsTable.feasibilityStatus,
      updatedAt: vapProjectsTable.updatedAt,
    }).from(vapProjectsTable)
      .innerJoin(energyActionPlansTable, and(eq(vapProjectsTable.actionPlanId, energyActionPlansTable.id), eq(energyActionPlansTable.companyId, scope.companyId)))
      .innerJoin(energyTargetsTable, and(eq(energyActionPlansTable.targetId, energyTargetsTable.id), eq(energyTargetsTable.companyId, scope.companyId)))
      .where(and(eq(vapProjectsTable.companyId, scope.companyId), scope.unitId === null ? undefined : eq(energyTargetsTable.unitId, scope.unitId)))
      .limit(12)
    : [];
  const riskRows = sections.has("risks")
    ? await db.select({
      id: risksTable.id,
      category: risksTable.type,
      status: risksTable.status,
      score: risksTable.score,
      createdAt: risksTable.createdAt,
    }).from(risksTable)
      .where(and(eq(risksTable.companyId, scope.companyId), scope.unitId === null ? undefined : eq(risksTable.unitId, scope.unitId)))
    : [];
  const reviewRows = sections.has("energyReview")
    ? await db.select({
      id: energyReviewRecordsTable.id,
      revisionNo: energyReviewRecordsTable.revisionNo,
      completedAt: energyReviewRecordsTable.completedAt,
      updatedAt: energyReviewRecordsTable.updatedAt,
    }).from(energyReviewRecordsTable)
      .where(and(
        eq(energyReviewRecordsTable.companyId, scope.companyId),
        eq(energyReviewRecordsTable.reviewYear, scope.year),
        eq(energyReviewRecordsTable.status, "completed"),
        isNull(energyReviewRecordsTable.deletedAt),
        scope.unitId === null ? undefined : eq(energyReviewRecordsTable.unitId, scope.unitId),
      ))
      .orderBy(desc(energyReviewRecordsTable.revisionNo))
    : [];
  const actionStatus: Record<string, number> = {};
  const actionPriority: Record<string, number> = {};
  for (const row of actionRows) {
    increment(actionStatus, row.status);
    increment(actionPriority, row.priority);
  }
  const riskStatus: Record<string, number> = {};
  const riskCategory: Record<string, number> = {};
  for (const row of riskRows) {
    increment(riskStatus, row.status);
    increment(riskCategory, row.category);
  }
  const today = `${scope.year}-12-31`;
  const overdue = actionRows.filter((row) => row.dueDate && row.dueDate < today && !["completed", "done", "closed"].includes(row.status)).length;
  if (targetRows.length > 0) {
    evidence.push({
      evidenceId: evidenceId("targets", [scope.companyId, scope.unitId, targetRows.length, maxIso(targetRows.map((row) => row.updatedAt))]),
      sourceModule: "targets",
      sourceEntityType: "energy_targets",
      opaqueSourceRef: "targets:summary",
      metric: "target_count",
      value: targetRows.length,
      unit: "items",
      period: String(scope.year),
      calculationAuthority: "backend_verified",
      dataQuality: "partial",
      sourceVersion: maxIso(targetRows.map((row) => row.updatedAt)),
    });
  }
  return {
    targets: {
      count: targetRows.length,
      items: targetRows.map((row, index) => {
        const ref = `target:target-${String(index + 1).padStart(3, "0")}`;
        opaqueRefMap[ref] = { entityType: "energy_target", id: row.id };
        return { targetRef: ref, targetYear: row.targetYear, targetReductionPercent: row.targetReductionPercent, baselineValue: round(row.baselineValue), targetValue: round(row.targetValue), actualValue: round(row.actualValue), unitLabel: row.unitLabel, status: row.status };
      }),
      dataSufficiency: sufficiency({ recordCount: targetRows.length, expectedCount: null, lastUpdatedAt: maxIso(targetRows.map((row) => row.updatedAt)) }),
    },
    actions: {
      count: actionRows.length,
      byStatus: actionStatus,
      byPriority: actionPriority,
      overdueCount: overdue,
      dataSufficiency: sufficiency({ recordCount: actionRows.length, expectedCount: null, lastUpdatedAt: maxIso(actionRows.map((row) => row.updatedAt)) }),
    },
    vap: {
      count: vapRows.length,
      byStatus: vapRows.reduce<Record<string, number>>((map, row) => { increment(map, row.status); return map; }, {}),
      verifiedSavings: vapRows.map((row, index) => {
        const ref = `vap:vap-${String(index + 1).padStart(3, "0")}`;
        opaqueRefMap[ref] = { entityType: "vap_project", id: row.id };
        return { vapRef: ref, projectType: row.projectType, status: row.status, annualEnergySavingValue: round(row.annualEnergySavingValue), annualEnergySavingUnit: row.annualEnergySavingUnit, co2ReductionTon: round(row.co2ReductionTon), feasibilityStatus: row.feasibilityStatus };
      }),
      dataSufficiency: sufficiency({ recordCount: vapRows.length, expectedCount: null, lastUpdatedAt: maxIso(vapRows.map((row) => row.updatedAt)) }),
    },
    risks: {
      count: riskRows.length,
      openHighPriorityCount: riskRows.filter((row) => row.score >= 12 && !["closed", "kapali"].includes(row.status)).length,
      byStatus: riskStatus,
      byCategory: riskCategory,
      dataSufficiency: sufficiency({ recordCount: riskRows.length, expectedCount: null, lastUpdatedAt: maxIso(riskRows.map((row) => row.createdAt)) }),
    },
    energyReview: {
      completedCount: reviewRows.length,
      latestRevision: reviewRows[0]?.revisionNo ?? null,
      latestCompletedAt: maxIso(reviewRows.map((row) => row.completedAt)),
      dataSufficiency: sufficiency({ recordCount: reviewRows.length, expectedCount: null, lastUpdatedAt: maxIso(reviewRows.map((row) => row.updatedAt)) }),
    },
  };
}

function overallSufficiency(values: string[]): "sufficient" | "partial" | "insufficient" {
  if (values.every((value) => value === "complete")) return "sufficient";
  if (values.some((value) => value === "complete" || value === "partial")) return "partial";
  return "insufficient";
}
