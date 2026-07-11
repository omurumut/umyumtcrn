import { Router } from "express";
import {
  db,
  consumptionTable,
  energyActionPlansTable,
  energyBaselineVariablesTable,
  energyBaselinesTable,
  energyPerformanceResultsTable,
  energyReviewRecordsTable,
  energyTargetProgressTable,
  energyTargetsTable,
  metersTable,
  risksTable,
  seuAssessmentItemsTable,
  seuAssessmentsTable,
  unitsTable,
  variablesTable,
  variableValuesTable,
  vapProjectsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, isNull, lte, ne, type SQL } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

type PendingWorkItemSeverity = "info" | "warning" | "critical";

interface PendingWorkItem {
  id: string;
  type: string;
  severity: PendingWorkItemSeverity;
  title: string;
  description: string;
  sourceModule: string;
  sourceRecordId: number | null;
  unitId: number | null;
  unitName: string | null;
  dueDate: string | null;
  actionUrl: string | null;
}

interface MissingConsumptionGroup {
  unitId: number | null;
  unitName: string | null;
  meterNames: string[];
}

interface AcceptedOfficialSeuItem {
  id: number;
  name: string;
  energyUseGroupId: number | null;
  meterId: number | null;
  subUnitId: number | null;
  energySourceId: number | null;
  unitId: number | null;
  unitName: string | null;
}

interface ActiveEnergyBaseline {
  id: number;
  seuAssessmentItemId: number | null;
}

interface ActiveEnergyTarget {
  id: number;
  name: string;
  targetYear: number;
  actualValue: number | null;
  status: string | null;
  unitId: number | null;
  unitName: string | null;
}

interface ScopedVapProject {
  id: number;
  actionPlanId: number;
  projectTitle: string;
  status: string;
  annualEnergySavingValue: number | null;
  annualCostSaving: number | null;
  co2ReductionTon: number | null;
  endDate: string | null;
  actionPlanDueDate: string | null;
  unitId: number | null;
  unitName: string | null;
}

interface EnergyReviewUnit {
  id: number;
  name: string;
}

interface EnergyReviewRecordSummary {
  id: number;
  unitId: number | null;
  status: string;
}

interface HighRiskWithoutActionCandidate {
  id: number;
  title: string;
  responseType: string;
  mitigationPlan: string | null;
  unitId: number | null;
  unitName: string | null;
}

interface BaselineVariableCheckCandidate {
  id: number;
  unitId: number | null;
  unitName: string | null;
  seuAssessmentItemId: number | null;
  seuName: string;
  meterId: number | null;
  energyUseGroupId: number | null;
  subUnitId: number | null;
}

interface BaselineScopeMeter {
  id: number;
  unitId: number | null;
  subUnitId: number | null;
}

interface BaselineVariableRow {
  baselineId: number;
  variableName: string;
  variableCode: string | null;
}

interface VariableDefinitionForCheck {
  id: number;
  name: string;
  scopeType: string;
}

interface VariableValueScope {
  unitId: number | null;
  subUnitId: number | null;
  meterId: number | null;
}

interface MissingVariableSummary {
  variableId: number;
  variableName: string;
  months: number[];
}

const ACTION_PLAN_COMPLETED_STATUSES = new Set(["completed", "cancelled"]);
const VAP_COMPLETED_STATUSES = new Set(["completed", "cancelled"]);
const VARIABLE_CODES_IGNORED_IN_PHASE_2F = new Set(["HDD", "CDD"]);
const MONTH_LABELS: Record<number, string> = {
  1: "Ocak",
  2: "Şubat",
  3: "Mart",
  4: "Nisan",
  5: "Mayıs",
  6: "Haziran",
  7: "Temmuz",
  8: "Ağustos",
  9: "Eylül",
  10: "Ekim",
  11: "Kasım",
  12: "Aralık",
};
const severityOrder: Record<PendingWorkItemSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function parseOptionalInt(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateOnly(value: string | null): string | null {
  if (!value) return null;
  const dateOnly = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateOnly) ? dateOnly : null;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getPreviousMonthPeriod(now = new Date()) {
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    year: previousMonth.getFullYear(),
    month: previousMonth.getMonth() + 1,
  };
}

function formatPeriod(year: number, month: number): string {
  return `${year}/${`${month}`.padStart(2, "0")}`;
}

function getMonitoringMonthLimit(year: number, now = new Date()): number {
  const currentYear = now.getFullYear();
  if (year < currentYear) return 12;
  if (year === currentYear) return now.getMonth() + 1;
  return 0;
}

function parseMonthFromPeriodStart(value: string): number | null {
  const parts = value.split("-");
  if (parts.length < 2) return null;
  const month = Number.parseInt(parts[1], 10);
  return month >= 1 && month <= 12 ? month : null;
}

function parseUserVariableId(variableCode: string | null): number | null {
  if (!variableCode?.startsWith("user-")) return null;
  const variableId = Number.parseInt(variableCode.replace("user-", ""), 10);
  return Number.isFinite(variableId) ? variableId : null;
}

function getOnlyValue(values: Array<number | null>): number | null {
  const uniqueValues = Array.from(new Set(values.filter((value): value is number => value !== null)));
  return uniqueValues.length === 1 ? uniqueValues[0] : null;
}

function buildVariableValueKey(variableId: number, month: number, scope: VariableValueScope): string {
  return [
    variableId,
    month,
    scope.unitId ?? "none",
    scope.subUnitId ?? "none",
    scope.meterId ?? "none",
  ].join(":");
}

function isIncompleteActionPlan(row: {
  status: string;
  completionDate: string | null;
  progressPercent: number;
}): boolean {
  if (ACTION_PLAN_COMPLETED_STATUSES.has(row.status)) return false;
  if (row.completionDate) return false;
  return row.progressPercent < 100;
}

function buildWhere(conditions: SQL[]) {
  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

function getSeuDecisionKey(item: AcceptedOfficialSeuItem): string {
  const unitKey = item.unitId ?? "none";
  if (item.energyUseGroupId !== null) return `${unitKey}:energy-use-group:${item.energyUseGroupId}`;
  if (item.meterId !== null) return `${unitKey}:meter:${item.meterId}`;
  if (item.subUnitId !== null) return `${unitKey}:sub-unit:${item.subUnitId}`;
  if (item.energySourceId !== null) return `${unitKey}:energy-source:${item.energySourceId}`;
  return `${unitKey}:name:${item.name.trim().toLocaleLowerCase("tr")}`;
}

async function getAcceptedOfficialSeuItems(
  companyId: number,
  unitId: number | undefined,
  year: number,
): Promise<AcceptedOfficialSeuItem[]> {
  const conditions: SQL[] = [
    eq(seuAssessmentsTable.companyId, companyId),
    lte(seuAssessmentsTable.year, year),
    eq(seuAssessmentsTable.recordType, "unit_official"),
    eq(seuAssessmentItemsTable.userDecision, "accepted_as_seu"),
  ];

  if (unitId !== undefined) {
    conditions.push(eq(seuAssessmentsTable.unitId, unitId));
  }

  const rows = await db
    .select({
      id: seuAssessmentItemsTable.id,
      name: seuAssessmentItemsTable.name,
      energyUseGroupId: seuAssessmentItemsTable.energyUseGroupId,
      meterId: seuAssessmentItemsTable.meterId,
      subUnitId: seuAssessmentItemsTable.subUnitId,
      energySourceId: seuAssessmentItemsTable.energySourceId,
      unitId: seuAssessmentsTable.unitId,
      unitName: unitsTable.name,
    })
    .from(seuAssessmentItemsTable)
    .innerJoin(seuAssessmentsTable, eq(seuAssessmentItemsTable.assessmentId, seuAssessmentsTable.id))
    .leftJoin(unitsTable, eq(seuAssessmentsTable.unitId, unitsTable.id))
    .where(buildWhere(conditions))
    .orderBy(
      desc(seuAssessmentsTable.year),
      desc(seuAssessmentsTable.updatedAt),
      desc(seuAssessmentsTable.createdAt),
      desc(seuAssessmentItemsTable.updatedAt),
      desc(seuAssessmentItemsTable.id),
    );

  const latestByDecisionKey = new Map<string, AcceptedOfficialSeuItem>();
  for (const row of rows) {
    const key = getSeuDecisionKey(row);
    if (!latestByDecisionKey.has(key)) {
      latestByDecisionKey.set(key, row);
    }
  }

  return Array.from(latestByDecisionKey.values());
}

async function getActiveBaselineBySeuItem(
  companyId: number,
  seuItemIds: number[],
): Promise<Map<number, ActiveEnergyBaseline>> {
  const baselineBySeuItem = new Map<number, ActiveEnergyBaseline>();
  if (seuItemIds.length === 0) return baselineBySeuItem;

  const baselines = await db
    .select({
      id: energyBaselinesTable.id,
      seuAssessmentItemId: energyBaselinesTable.seuAssessmentItemId,
    })
    .from(energyBaselinesTable)
    .where(and(
      eq(energyBaselinesTable.companyId, companyId),
      inArray(energyBaselinesTable.seuAssessmentItemId, seuItemIds),
      eq(energyBaselinesTable.status, "active"),
      eq(energyBaselinesTable.isValid, true),
    ));

  for (const baseline of baselines) {
    if (baseline.seuAssessmentItemId === null) continue;
    const existing = baselineBySeuItem.get(baseline.seuAssessmentItemId);
    if (!existing || baseline.id > existing.id) {
      baselineBySeuItem.set(baseline.seuAssessmentItemId, baseline);
    }
  }

  return baselineBySeuItem;
}

async function getMonitoredSeuItemIds(
  companyId: number,
  baselineIds: number[],
  year: number,
): Promise<Set<number>> {
  const monitoredSeuItemIds = new Set<number>();
  if (baselineIds.length === 0) return monitoredSeuItemIds;

  const results = await db
    .select({
      seuAssessmentItemId: energyPerformanceResultsTable.seuAssessmentItemId,
    })
    .from(energyPerformanceResultsTable)
    .where(and(
      eq(energyPerformanceResultsTable.companyId, companyId),
      inArray(energyPerformanceResultsTable.baselineId, baselineIds),
      eq(energyPerformanceResultsTable.year, year),
    ));

  for (const result of results) {
    if (result.seuAssessmentItemId !== null) {
      monitoredSeuItemIds.add(result.seuAssessmentItemId);
    }
  }

  return monitoredSeuItemIds;
}

async function appendSeuEnergyPerformanceWorkItems(
  items: PendingWorkItem[],
  companyId: number,
  unitId: number | undefined,
  year: number,
) {
  const seuItems = await getAcceptedOfficialSeuItems(companyId, unitId, year);
  if (seuItems.length === 0) return;

  const seuItemIds = seuItems.map((item) => item.id);
  const baselineBySeuItem = await getActiveBaselineBySeuItem(companyId, seuItemIds);
  const baselineIds = Array.from(baselineBySeuItem.values()).map((baseline) => baseline.id);
  const monitoredSeuItemIds = await getMonitoredSeuItemIds(companyId, baselineIds, year);

  for (const seuItem of seuItems) {
    const baseline = baselineBySeuItem.get(seuItem.id);
    const unitLabel = seuItem.unitName ?? "Şirket geneli";

    if (!baseline) {
      items.push({
        id: `seu-missing-energy-baseline-${year}-${seuItem.id}`,
        type: "seu_missing_energy_baseline",
        severity: "critical",
        title: `ÖEK için aktif EnRÇ modeli yok: ${seuItem.name}`,
        description: `${unitLabel} biriminde kabul edilmiş ÖEK için aktif/geçerli EnRÇ modeli bulunmuyor.`,
        sourceModule: "EnRÇ / EnPG İzleme",
        sourceRecordId: seuItem.id,
        unitId: seuItem.unitId,
        unitName: seuItem.unitName,
        dueDate: null,
        actionUrl: `/performans-gostergeleri?seuItemId=${seuItem.id}&tab=baselines`,
      });
      continue;
    }

    if (!monitoredSeuItemIds.has(seuItem.id)) {
      items.push({
        id: `seu-missing-monitoring-result-${year}-${seuItem.id}-${baseline.id}`,
        type: "seu_missing_monitoring_result",
        severity: "warning",
        title: `${year} yılı için EnPG izleme sonucu yok: ${seuItem.name}`,
        description: `Aktif EnRÇ modeli var ancak ${year} yılına ait izleme sonucu hesaplanmamış.`,
        sourceModule: "EnRÇ / EnPG İzleme",
        sourceRecordId: baseline.id,
        unitId: seuItem.unitId,
        unitName: seuItem.unitName,
        dueDate: null,
        actionUrl: `/performans-gostergeleri?seuItemId=${seuItem.id}&baselineId=${baseline.id}&year=${year}&tab=monitoring`,
      });
    }
  }
}

async function getActiveBaselinesForVariableCheck(
  companyId: number,
  unitId: number | undefined,
): Promise<BaselineVariableCheckCandidate[]> {
  const conditions: SQL[] = [
    eq(energyBaselinesTable.companyId, companyId),
    eq(energyBaselinesTable.status, "active"),
    eq(energyBaselinesTable.isValid, true),
  ];

  if (unitId !== undefined) {
    conditions.push(eq(energyBaselinesTable.unitId, unitId));
  }

  return db
    .select({
      id: energyBaselinesTable.id,
      unitId: energyBaselinesTable.unitId,
      unitName: unitsTable.name,
      seuAssessmentItemId: energyBaselinesTable.seuAssessmentItemId,
      seuName: seuAssessmentItemsTable.name,
      meterId: seuAssessmentItemsTable.meterId,
      energyUseGroupId: seuAssessmentItemsTable.energyUseGroupId,
      subUnitId: seuAssessmentItemsTable.subUnitId,
    })
    .from(energyBaselinesTable)
    .innerJoin(seuAssessmentItemsTable, eq(energyBaselinesTable.seuAssessmentItemId, seuAssessmentItemsTable.id))
    .leftJoin(unitsTable, eq(energyBaselinesTable.unitId, unitsTable.id))
    .where(buildWhere(conditions));
}

async function getMetersForBaselineVariableCheck(
  companyId: number,
  baseline: BaselineVariableCheckCandidate,
): Promise<BaselineScopeMeter[]> {
  const conditions: SQL[] = [eq(metersTable.companyId, companyId)];

  if (baseline.meterId !== null) {
    conditions.push(eq(metersTable.id, baseline.meterId));
  } else if (baseline.energyUseGroupId !== null) {
    conditions.push(eq(metersTable.energyUseGroupId, baseline.energyUseGroupId));
    if (baseline.unitId !== null) conditions.push(eq(metersTable.unitId, baseline.unitId));
  } else if (baseline.subUnitId !== null) {
    conditions.push(eq(metersTable.subUnitId, baseline.subUnitId));
  } else if (baseline.unitId !== null) {
    conditions.push(eq(metersTable.unitId, baseline.unitId));
  } else {
    return [];
  }

  return db
    .select({
      id: metersTable.id,
      unitId: metersTable.unitId,
      subUnitId: metersTable.subUnitId,
    })
    .from(metersTable)
    .where(buildWhere(conditions));
}

async function getConsumptionMonthsForMeters(
  companyId: number,
  meterIds: number[],
  year: number,
  monthLimit: number,
): Promise<Set<number>> {
  const months = new Set<number>();
  if (meterIds.length === 0 || monthLimit === 0) return months;

  const consumptionRows = await db
    .select({ month: consumptionTable.month })
    .from(consumptionTable)
    .where(and(
      eq(consumptionTable.companyId, companyId),
      eq(consumptionTable.year, year),
      inArray(consumptionTable.meterId, meterIds),
      lte(consumptionTable.month, monthLimit),
    ));

  for (const row of consumptionRows) {
    months.add(row.month);
  }

  return months;
}

function resolveVariableValueScopes(
  variable: VariableDefinitionForCheck,
  baseline: BaselineVariableCheckCandidate,
  meters: BaselineScopeMeter[],
): VariableValueScope[] {
  if (variable.scopeType === "company") {
    return [{ unitId: null, subUnitId: null, meterId: null }];
  }

  if (variable.scopeType === "unit") {
    return baseline.unitId === null ? [] : [{ unitId: baseline.unitId, subUnitId: null, meterId: null }];
  }

  if (variable.scopeType === "sub_unit") {
    const subUnitId = baseline.subUnitId ?? getOnlyValue(meters.map((meter) => meter.subUnitId));
    const unitId = baseline.unitId ?? getOnlyValue(meters.map((meter) => meter.unitId));
    if (unitId === null || subUnitId === null) return [];
    return [{ unitId, subUnitId, meterId: null }];
  }

  if (variable.scopeType === "meter") {
    const meter = baseline.meterId !== null
      ? meters.find((candidate) => candidate.id === baseline.meterId)
      : meters.length === 1
        ? meters[0]
        : undefined;
    if (!meter || meter.unitId === null || meter.subUnitId === null) return [];
    return [{ unitId: meter.unitId, subUnitId: meter.subUnitId, meterId: meter.id }];
  }

  return [];
}

function formatMissingVariableDescription(missingSummaries: MissingVariableSummary[]): string {
  const sortedSummaries = missingSummaries
    .map((summary) => ({
      ...summary,
      months: [...summary.months].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.variableName.localeCompare(b.variableName, "tr"));

  const visibleSummaries = sortedSummaries.slice(0, 4);
  const hiddenMissingCount = sortedSummaries
    .slice(4)
    .reduce((total, summary) => total + summary.months.length, 0);

  const fragments = visibleSummaries.map((summary) => {
    const visibleMonths = summary.months.slice(0, 4).map((month) => MONTH_LABELS[month] ?? String(month));
    const hiddenMonths = summary.months.length - visibleMonths.length;
    const monthLabel = hiddenMonths > 0
      ? `${visibleMonths.join(", ")} ve ${hiddenMonths} ay daha`
      : visibleMonths.join(", ");
    return `${summary.variableName} (${monthLabel})`;
  });

  if (hiddenMissingCount > 0) {
    fragments.push(`ve ${hiddenMissingCount} eksik değer daha`);
  }

  return fragments.join("; ");
}

async function appendMissingBaselineVariableValueWorkItems(
  items: PendingWorkItem[],
  companyId: number,
  unitId: number | undefined,
  selectedYear: number,
  today: Date,
) {
  const monthLimit = getMonitoringMonthLimit(selectedYear, today);
  if (monthLimit === 0) return;

  const baselines = await getActiveBaselinesForVariableCheck(companyId, unitId);
  if (baselines.length === 0) return;

  const baselineIds = baselines.map((baseline) => baseline.id);
  const baselineVariables = await db
    .select({
      baselineId: energyBaselineVariablesTable.baselineId,
      variableName: energyBaselineVariablesTable.variableName,
      variableCode: energyBaselineVariablesTable.variableCode,
    })
    .from(energyBaselineVariablesTable)
    .where(inArray(energyBaselineVariablesTable.baselineId, baselineIds));

  const variableIds = new Set<number>();
  const variableRowsByBaseline = new Map<number, BaselineVariableRow[]>();

  for (const variableRow of baselineVariables) {
    const variableCode = variableRow.variableCode ?? variableRow.variableName;
    if (VARIABLE_CODES_IGNORED_IN_PHASE_2F.has(variableCode)) continue;

    const variableId = parseUserVariableId(variableCode);
    if (variableId === null) continue;

    const rows = variableRowsByBaseline.get(variableRow.baselineId) ?? [];
    rows.push(variableRow);
    variableRowsByBaseline.set(variableRow.baselineId, rows);
    variableIds.add(variableId);
  }

  if (variableIds.size === 0) return;

  const variables = await db
    .select({
      id: variablesTable.id,
      name: variablesTable.name,
      scopeType: variablesTable.scopeType,
    })
    .from(variablesTable)
    .where(and(
      eq(variablesTable.companyId, companyId),
      eq(variablesTable.isActive, true),
      inArray(variablesTable.id, Array.from(variableIds)),
    ));

  const variableById = new Map<number, VariableDefinitionForCheck>(
    variables.map((variable) => [variable.id, variable]),
  );
  if (variableById.size === 0) return;

  const variableValues = await db
    .select({
      variableId: variableValuesTable.variableId,
      unitId: variableValuesTable.unitId,
      subUnitId: variableValuesTable.subUnitId,
      meterId: variableValuesTable.meterId,
      periodStart: variableValuesTable.periodStart,
      value: variableValuesTable.value,
    })
    .from(variableValuesTable)
    .where(and(
      eq(variableValuesTable.companyId, companyId),
      eq(variableValuesTable.periodType, "monthly"),
      inArray(variableValuesTable.variableId, Array.from(variableById.keys())),
      gte(variableValuesTable.periodStart, `${selectedYear}-01`),
      lte(variableValuesTable.periodStart, `${selectedYear}-12-31`),
    ));

  const existingValueKeys = new Set<string>();
  for (const variableValue of variableValues) {
    if (variableValue.value === null || variableValue.value === undefined) continue;
    const month = parseMonthFromPeriodStart(variableValue.periodStart);
    if (month === null || month > monthLimit) continue;

    existingValueKeys.add(buildVariableValueKey(variableValue.variableId, month, {
      unitId: variableValue.unitId,
      subUnitId: variableValue.subUnitId,
      meterId: variableValue.meterId,
    }));
  }

  for (const baseline of baselines) {
    const variableRows = variableRowsByBaseline.get(baseline.id) ?? [];
    if (variableRows.length === 0) continue;

    const meters = await getMetersForBaselineVariableCheck(companyId, baseline);
    const meterIds = meters.map((meter) => meter.id);
    const consumptionMonths = await getConsumptionMonthsForMeters(companyId, meterIds, selectedYear, monthLimit);
    if (consumptionMonths.size === 0) continue;

    const missingByVariable = new Map<number, MissingVariableSummary>();

    for (const variableRow of variableRows) {
      const variableId = parseUserVariableId(variableRow.variableCode ?? variableRow.variableName);
      if (variableId === null) continue;

      const variable = variableById.get(variableId);
      if (!variable) continue;

      const scopes = resolveVariableValueScopes(variable, baseline, meters);
      if (scopes.length === 0) continue;

      for (const month of consumptionMonths) {
        const hasValue = scopes.every((scope) => existingValueKeys.has(buildVariableValueKey(variableId, month, scope)));
        if (hasValue) continue;

        const summary = missingByVariable.get(variableId) ?? {
          variableId,
          variableName: variable.name,
          months: [],
        };
        summary.months.push(month);
        missingByVariable.set(variableId, summary);
      }
    }

    const missingSummaries = Array.from(missingByVariable.values());
    if (missingSummaries.length === 0) continue;

    const firstMissingVariableId = missingSummaries[0].variableId;
    const params = new URLSearchParams({
      tab: "values",
      year: String(selectedYear),
      variableId: String(firstMissingVariableId),
    });
    if (baseline.unitId !== null) {
      params.set("unitId", String(baseline.unitId));
    }

    const unitLabel = baseline.unitName ?? "Şirket geneli";
    items.push({
      id: `energy_baseline_missing_variable_values:${baseline.id}:${selectedYear}`,
      type: "energy_baseline_missing_variable_values",
      severity: "warning",
      title: `${selectedYear} yılı EnPG değişken verisi eksik: ${baseline.seuName}`,
      description: `${unitLabel} birimindeki aktif EnRÇ modeli için eksik değişken değerleri: ${formatMissingVariableDescription(missingSummaries)}.`,
      sourceModule: "EnRÇ / EnPG İzleme",
      sourceRecordId: baseline.id,
      unitId: baseline.unitId,
      unitName: baseline.unitName,
      dueDate: null,
      actionUrl: `/degiskenler?${params.toString()}`,
    });
  }
}

async function getScopedEnergyTargets(
  companyId: number,
  unitId: number | undefined,
): Promise<ActiveEnergyTarget[]> {
  const conditions: SQL[] = [
    eq(energyTargetsTable.companyId, companyId),
  ];

  if (unitId !== undefined) {
    conditions.push(eq(energyTargetsTable.unitId, unitId));
  }

  return db
    .select({
      id: energyTargetsTable.id,
      name: energyTargetsTable.name,
      targetYear: energyTargetsTable.targetYear,
      actualValue: energyTargetsTable.actualValue,
      status: energyTargetsTable.status,
      unitId: energyTargetsTable.unitId,
      unitName: unitsTable.name,
    })
    .from(energyTargetsTable)
    .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
    .where(buildWhere(conditions));
}

async function getTargetIdsWithActionPlans(
  companyId: number,
  targetIds: number[],
): Promise<Set<number>> {
  const targetIdsWithActionPlans = new Set<number>();
  if (targetIds.length === 0) return targetIdsWithActionPlans;

  const actionPlans = await db
    .select({
      targetId: energyActionPlansTable.targetId,
    })
    .from(energyActionPlansTable)
    .where(and(
      eq(energyActionPlansTable.companyId, companyId),
      inArray(energyActionPlansTable.targetId, targetIds),
    ));

  for (const actionPlan of actionPlans) {
    targetIdsWithActionPlans.add(actionPlan.targetId);
  }

  return targetIdsWithActionPlans;
}

async function getProgressYearsByTarget(
  companyId: number,
  targetIds: number[],
): Promise<Map<number, Set<number>>> {
  const progressYearsByTarget = new Map<number, Set<number>>();
  if (targetIds.length === 0) return progressYearsByTarget;

  const progressRows = await db
    .select({
      targetId: energyTargetProgressTable.targetId,
      periodYear: energyTargetProgressTable.periodYear,
    })
    .from(energyTargetProgressTable)
    .where(and(
      eq(energyTargetProgressTable.companyId, companyId),
      inArray(energyTargetProgressTable.targetId, targetIds),
    ));

  for (const progressRow of progressRows) {
    const years = progressYearsByTarget.get(progressRow.targetId) ?? new Set<number>();
    years.add(progressRow.periodYear);
    progressYearsByTarget.set(progressRow.targetId, years);
  }

  return progressYearsByTarget;
}

async function appendEnergyTargetWorkItems(
  items: PendingWorkItem[],
  companyId: number,
  unitId: number | undefined,
  selectedYear: number,
) {
  const targets = await getScopedEnergyTargets(companyId, unitId);
  if (targets.length === 0) return;

  const targetIds = targets.map((target) => target.id);
  const targetIdsWithActionPlans = await getTargetIdsWithActionPlans(companyId, targetIds);
  const progressYearsByTarget = await getProgressYearsByTarget(companyId, targetIds);

  for (const target of targets) {
    const unitLabel = target.unitName ?? "Şirket geneli";
    const isDraftOrCancelled = target.status === "draft" || target.status === "cancelled";

    if (target.status === "active" && !targetIdsWithActionPlans.has(target.id)) {
      items.push({
        id: `energy-target-missing-action-plan-${target.id}`,
        type: "energy_target_missing_action_plan",
        severity: "warning",
        title: `Enerji hedefi için aksiyon planı yok: ${target.name}`,
        description: `${unitLabel} birimindeki aktif enerji hedefi için tanımlı aksiyon planı bulunmuyor.`,
        sourceModule: "Enerji Hedefleri",
        sourceRecordId: target.id,
        unitId: target.unitId,
        unitName: target.unitName,
        dueDate: null,
        actionUrl: `/hedefler?targetId=${target.id}&tab=actions`,
      });
    }

    const hasTargetYearProgress = progressYearsByTarget.get(target.id)?.has(target.targetYear) ?? false;
    if (!isDraftOrCancelled && target.targetYear < selectedYear && target.actualValue === null && !hasTargetYearProgress) {
      items.push({
        id: `energy-target-missing-result-evaluation-${target.targetYear}-${target.id}`,
        type: "energy_target_missing_result_evaluation",
        severity: "warning",
        title: `${target.targetYear} yılı hedef sonucu değerlendirilmemiş: ${target.name}`,
        description: "Hedef dönemi tamamlanmış ancak gerçekleşme/değerlendirme kaydı bulunmuyor.",
        sourceModule: "Enerji Hedefleri",
        sourceRecordId: target.id,
        unitId: target.unitId,
        unitName: target.unitName,
        dueDate: null,
        actionUrl: `/hedefler?targetId=${target.id}&tab=progress&year=${target.targetYear}`,
      });
    }
  }
}

async function getScopedVapProjects(
  companyId: number,
  unitId: number | undefined,
): Promise<ScopedVapProject[]> {
  const conditions: SQL[] = [
    eq(vapProjectsTable.companyId, companyId),
    eq(energyActionPlansTable.isVap, true),
  ];

  if (unitId !== undefined) {
    conditions.push(eq(energyTargetsTable.unitId, unitId));
  }

  return db
    .select({
      id: vapProjectsTable.id,
      actionPlanId: vapProjectsTable.actionPlanId,
      projectTitle: vapProjectsTable.projectTitle,
      status: vapProjectsTable.status,
      annualEnergySavingValue: vapProjectsTable.annualEnergySavingValue,
      annualCostSaving: vapProjectsTable.annualCostSaving,
      co2ReductionTon: vapProjectsTable.co2ReductionTon,
      endDate: vapProjectsTable.endDate,
      actionPlanDueDate: energyActionPlansTable.dueDate,
      unitId: energyTargetsTable.unitId,
      unitName: unitsTable.name,
    })
    .from(vapProjectsTable)
    .innerJoin(energyActionPlansTable, eq(vapProjectsTable.actionPlanId, energyActionPlansTable.id))
    .innerJoin(energyTargetsTable, eq(energyActionPlansTable.targetId, energyTargetsTable.id))
    .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
    .where(buildWhere(conditions));
}

async function appendVapProjectWorkItems(
  items: PendingWorkItem[],
  companyId: number,
  unitId: number | undefined,
  todayDateOnly: string,
) {
  const vapProjects = await getScopedVapProjects(companyId, unitId);
  if (vapProjects.length === 0) return;

  for (const project of vapProjects) {
    const unitLabel = project.unitName ?? "Şirket geneli";
    const actionUrl = `/vap-projeler?vapProjectId=${project.id}&actionPlanId=${project.actionPlanId}`;
    const dueDate = normalizeDateOnly(project.endDate) ?? normalizeDateOnly(project.actionPlanDueDate);

    if (!VAP_COMPLETED_STATUSES.has(project.status) && dueDate !== null && dueDate < todayDateOnly) {
      items.push({
        id: `vap-project-overdue-${project.id}`,
        type: "vap_project_overdue",
        severity: "critical",
        title: `VAP projesinin termin tarihi geçti: ${project.projectTitle}`,
        description: `${unitLabel} birimindeki VAP projesinin termin tarihi geçmiş ancak proje tamamlanmamış.`,
        sourceModule: "Verimlilik Artırıcı Projeler",
        sourceRecordId: project.id,
        unitId: project.unitId,
        unitName: project.unitName,
        dueDate,
        actionUrl,
      });
    }

    const hasSavingsInfo =
      project.annualEnergySavingValue !== null ||
      project.annualCostSaving !== null ||
      project.co2ReductionTon !== null;

    if (project.status === "completed" && !hasSavingsInfo) {
      items.push({
        id: `vap-project-missing-savings-result-${project.id}`,
        type: "vap_project_missing_savings_result",
        severity: "warning",
        title: `Tamamlanan VAP için tasarruf bilgisi eksik: ${project.projectTitle}`,
        description: "VAP projesi tamamlanmış görünüyor ancak enerji, maliyet veya emisyon tasarrufu bilgisi girilmemiş.",
        sourceModule: "Verimlilik Artırıcı Projeler",
        sourceRecordId: project.id,
        unitId: project.unitId,
        unitName: project.unitName,
        dueDate: null,
        actionUrl,
      });
    }
  }
}

async function getHighRiskWithoutActionCandidates(
  companyId: number,
  unitId: number | undefined,
): Promise<HighRiskWithoutActionCandidate[]> {
  const conditions: SQL[] = [
    eq(risksTable.companyId, companyId),
    eq(risksTable.type, "risk"),
    ne(risksTable.status, "kapali"),
    gte(risksTable.score, 15),
  ];

  if (unitId !== undefined) {
    conditions.push(eq(risksTable.unitId, unitId));
  }

  return db
    .select({
      id: risksTable.id,
      title: risksTable.title,
      responseType: risksTable.responseType,
      mitigationPlan: risksTable.mitigationPlan,
      unitId: risksTable.unitId,
      unitName: unitsTable.name,
    })
    .from(risksTable)
    .leftJoin(unitsTable, eq(risksTable.unitId, unitsTable.id))
    .where(buildWhere(conditions));
}

async function appendHighRiskWorkItems(
  items: PendingWorkItem[],
  companyId: number,
  unitId: number | undefined,
) {
  const risks = await getHighRiskWithoutActionCandidates(companyId, unitId);
  if (risks.length === 0) return;

  for (const risk of risks) {
    const hasActionPlan = risk.responseType === "aksiyon" && !!risk.mitigationPlan?.trim();
    if (hasActionPlan) continue;

    const params = new URLSearchParams({
      riskId: String(risk.id),
      type: "risk",
    });
    if (risk.unitId !== null) {
      params.set("unitId", String(risk.unitId));
    }

    const unitLabel = risk.unitName ?? "Şirket geneli";
    items.push({
      id: `high-risk-missing-action-${risk.id}`,
      type: "high_risk_missing_action",
      severity: "critical",
      title: `Yüksek risk için aksiyon planı yok: ${risk.title}`,
      description: `${unitLabel} birimindeki yüksek seviyeli risk için aksiyon kararı veya eylem planı tanımlanmamış.`,
      sourceModule: "Risk & Fırsat",
      sourceRecordId: risk.id,
      unitId: risk.unitId,
      unitName: risk.unitName,
      dueDate: null,
      actionUrl: `/riskler?${params.toString()}`,
    });
  }
}

async function getEnergyReviewUnits(
  companyId: number,
  unitId: number | undefined,
): Promise<EnergyReviewUnit[]> {
  const conditions: SQL[] = [
    eq(unitsTable.companyId, companyId),
    eq(unitsTable.active, true),
  ];

  if (unitId !== undefined) {
    conditions.push(eq(unitsTable.id, unitId));
  }

  return db
    .select({
      id: unitsTable.id,
      name: unitsTable.name,
    })
    .from(unitsTable)
    .where(buildWhere(conditions));
}

async function getEnergyReviewRecordsByUnit(
  companyId: number,
  unitIds: number[],
  year: number,
): Promise<Map<number, EnergyReviewRecordSummary[]>> {
  const recordsByUnit = new Map<number, EnergyReviewRecordSummary[]>();
  if (unitIds.length === 0) return recordsByUnit;

  const records = await db
    .select({
      id: energyReviewRecordsTable.id,
      unitId: energyReviewRecordsTable.unitId,
      status: energyReviewRecordsTable.status,
    })
    .from(energyReviewRecordsTable)
    .where(and(
      eq(energyReviewRecordsTable.companyId, companyId),
      eq(energyReviewRecordsTable.reviewYear, year),
      eq(energyReviewRecordsTable.scopeType, "unit"),
      isNull(energyReviewRecordsTable.deletedAt),
      inArray(energyReviewRecordsTable.unitId, unitIds),
      inArray(energyReviewRecordsTable.status, ["draft", "completed"]),
    ))
    .orderBy(desc(energyReviewRecordsTable.updatedAt), desc(energyReviewRecordsTable.id));

  for (const record of records) {
    if (record.unitId === null) continue;

    const unitRecords = recordsByUnit.get(record.unitId) ?? [];
    unitRecords.push(record);
    recordsByUnit.set(record.unitId, unitRecords);
  }

  return recordsByUnit;
}

async function appendEnergyReviewRecordWorkItems(
  items: PendingWorkItem[],
  companyId: number,
  unitId: number | undefined,
  selectedYear: number,
) {
  const units = await getEnergyReviewUnits(companyId, unitId);
  if (units.length === 0) return;

  const unitIds = units.map((unit) => unit.id);
  const recordsByUnit = await getEnergyReviewRecordsByUnit(companyId, unitIds, selectedYear);

  for (const unit of units) {
    const records = recordsByUnit.get(unit.id) ?? [];
    const hasCompletedRecord = records.some((record) => record.status === "completed");
    if (hasCompletedRecord) continue;

    const draftRecord = records.find((record) => record.status === "draft");
    const params = new URLSearchParams({
      tab: "records",
      year: String(selectedYear),
      unitId: String(unit.id),
    });

    if (draftRecord) {
      params.set("reviewRecordId", String(draftRecord.id));
      items.push({
        id: `energy-review-record-draft-${selectedYear}-${unit.id}-${draftRecord.id}`,
        type: "energy_review_record_draft",
        severity: "warning",
        title: `${selectedYear} yılı enerji gözden geçirme kaydı taslak durumda: ${unit.name}`,
        description: `${unit.name} birimi için ${selectedYear} yılı enerji gözden geçirme kaydı tamamlanmamış.`,
        sourceModule: "Enerji Gözden Geçirme",
        sourceRecordId: draftRecord.id,
        unitId: unit.id,
        unitName: unit.name,
        dueDate: null,
        actionUrl: `/enerji-gozden-gecirme?${params.toString()}`,
      });
      continue;
    }

    items.push({
      id: `energy-review-record-missing-${selectedYear}-${unit.id}`,
      type: "energy_review_record_missing",
      severity: "warning",
      title: `${selectedYear} yılı enerji gözden geçirme kaydı yok: ${unit.name}`,
      description: `${unit.name} birimi için ${selectedYear} yılına ait enerji gözden geçirme kaydı oluşturulmamış.`,
      sourceModule: "Enerji Gözden Geçirme",
      sourceRecordId: null,
      unitId: unit.id,
      unitName: unit.name,
      dueDate: null,
      actionUrl: `/enerji-gozden-gecirme?${params.toString()}`,
    });
  }
}

// GET /api/pending-work-items
router.get("/pending-work-items", requireAuth, async (req, res) => {
  try {
    const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
    const isAdmin = role === "admin" || role === "kontrol_admin" || role === "superadmin";

    if (!isAdmin && sessionUnitId === null) {
      res.json([]);
      return;
    }

    const requestedUnitId = parseOptionalInt(req.query.unitId);
    const effectiveUnitId = isAdmin ? requestedUnitId : sessionUnitId ?? undefined;

    const today = new Date();
    const selectedYear = parseOptionalInt(req.query.year) ?? today.getFullYear();
    const todayDateOnly = toDateOnlyString(today);
    const soonLimitDateOnly = toDateOnlyString(addDays(today, 7));
    const items: PendingWorkItem[] = [];

    const actionConditions: SQL[] = [eq(energyActionPlansTable.companyId, sessionCompanyId)];
    if (effectiveUnitId !== undefined) {
      actionConditions.push(eq(energyTargetsTable.unitId, effectiveUnitId));
    }

    const actionPlans = await db
      .select({
        id: energyActionPlansTable.id,
        targetId: energyActionPlansTable.targetId,
        title: energyActionPlansTable.title,
        status: energyActionPlansTable.status,
        completionDate: energyActionPlansTable.completionDate,
        progressPercent: energyActionPlansTable.progressPercent,
        dueDate: energyActionPlansTable.dueDate,
        targetName: energyTargetsTable.name,
        unitId: energyTargetsTable.unitId,
        unitName: unitsTable.name,
      })
      .from(energyActionPlansTable)
      .innerJoin(energyTargetsTable, eq(energyActionPlansTable.targetId, energyTargetsTable.id))
      .leftJoin(unitsTable, eq(energyTargetsTable.unitId, unitsTable.id))
      .where(buildWhere(actionConditions));

    for (const plan of actionPlans) {
      if (!isIncompleteActionPlan(plan)) continue;

      const dueDate = normalizeDateOnly(plan.dueDate);
      if (!dueDate) continue;

      if (dueDate < todayDateOnly) {
        items.push({
          id: `energy-action-plan-overdue-${plan.id}`,
          type: "energy_action_plan_overdue",
          severity: "critical",
          title: `Geciken aksiyon planı: ${plan.title}`,
          description: `${plan.targetName ?? "Enerji hedefi"} kapsamındaki aksiyon planının termin tarihi geçti.`,
          sourceModule: "Enerji Aksiyon Planları",
          sourceRecordId: plan.id,
          unitId: plan.unitId,
          unitName: plan.unitName,
          dueDate,
          actionUrl: `/hedefler?targetId=${plan.targetId}&actionPlanId=${plan.id}`,
        });
      } else if (dueDate <= soonLimitDateOnly) {
        items.push({
          id: `energy-action-plan-due-soon-${plan.id}`,
          type: "energy_action_plan_due_soon",
          severity: "warning",
          title: `Yaklaşan aksiyon planı termin tarihi: ${plan.title}`,
          description: `${plan.targetName ?? "Enerji hedefi"} kapsamındaki aksiyon planının termin tarihi 7 gün içinde.`,
          sourceModule: "Enerji Aksiyon Planları",
          sourceRecordId: plan.id,
          unitId: plan.unitId,
          unitName: plan.unitName,
          dueDate,
          actionUrl: `/hedefler?targetId=${plan.targetId}&actionPlanId=${plan.id}`,
        });
      }
    }

    const previousPeriod = getPreviousMonthPeriod(today);
    const meterConditions: SQL[] = [eq(metersTable.companyId, sessionCompanyId)];
    if (effectiveUnitId !== undefined) {
      meterConditions.push(eq(metersTable.unitId, effectiveUnitId));
    }

    const meters = await db
      .select({
        id: metersTable.id,
        name: metersTable.name,
        unitId: metersTable.unitId,
        unitName: unitsTable.name,
      })
      .from(metersTable)
      .leftJoin(unitsTable, eq(metersTable.unitId, unitsTable.id))
      .where(buildWhere(meterConditions));

    const consumptionRecords = await db
      .select({ meterId: consumptionTable.meterId })
      .from(consumptionTable)
      .where(and(
        eq(consumptionTable.companyId, sessionCompanyId),
        eq(consumptionTable.year, previousPeriod.year),
        eq(consumptionTable.month, previousPeriod.month),
      ));
    const metersWithConsumption = new Set(consumptionRecords.map((record) => record.meterId));
    const periodLabel = formatPeriod(previousPeriod.year, previousPeriod.month);

    const missingConsumptionGroups = new Map<string, MissingConsumptionGroup>();

    for (const meter of meters) {
      if (metersWithConsumption.has(meter.id)) continue;

      const groupKey = `${previousPeriod.year}-${previousPeriod.month}-${meter.unitId ?? "none"}`;
      const group = missingConsumptionGroups.get(groupKey) ?? {
        unitId: meter.unitId,
        unitName: meter.unitName,
        meterNames: [],
      };
      group.meterNames.push(meter.name);
      missingConsumptionGroups.set(groupKey, group);
    }

    for (const [groupKey, group] of missingConsumptionGroups) {
      const params = new URLSearchParams({
        year: String(previousPeriod.year),
        month: String(previousPeriod.month),
      });
      if (group.unitId !== null) {
        params.set("unitId", String(group.unitId));
      }

      const meterCount = group.meterNames.length;
      const sortedMeterNames = [...group.meterNames].sort((a, b) => a.localeCompare(b, "tr"));

      items.push({
        id: `missing-consumption-${groupKey}`,
        type: "missing_consumption_previous_month",
        severity: "warning",
        title: `${periodLabel} döneminde ${meterCount} sayaç için tüketim verisi eksik`,
        description: `Eksik sayaçlar: ${sortedMeterNames.join(", ")}.`,
        sourceModule: "Tüketim Verileri",
        sourceRecordId: null,
        unitId: group.unitId,
        unitName: group.unitName,
        dueDate: null,
        actionUrl: `/tuketim?${params.toString()}`,
      });
    }

    await appendSeuEnergyPerformanceWorkItems(items, sessionCompanyId, effectiveUnitId, selectedYear);
    await appendMissingBaselineVariableValueWorkItems(items, sessionCompanyId, effectiveUnitId, selectedYear, today);
    await appendEnergyTargetWorkItems(items, sessionCompanyId, effectiveUnitId, selectedYear);
    await appendVapProjectWorkItems(items, sessionCompanyId, effectiveUnitId, todayDateOnly);
    await appendEnergyReviewRecordWorkItems(items, sessionCompanyId, effectiveUnitId, selectedYear);
    await appendHighRiskWorkItems(items, sessionCompanyId, effectiveUnitId);

    items.sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate && !b.dueDate) return -1;
      if (!a.dueDate && b.dueDate) return 1;
      return a.title.localeCompare(b.title, "tr");
    });

    res.json(items);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

export default router;
