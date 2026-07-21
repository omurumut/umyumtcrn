import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  db,
  energySourcesTable,
  energyUseGroupsTable,
  equipmentEnergySourceLinksTable,
  equipmentFieldDefinitionsTable,
  equipmentMeterLinksTable,
  equipmentTable,
  metersTable,
  subUnitsTable,
  unitsTable,
} from "@workspace/db";

type EquipmentRow = typeof equipmentTable.$inferSelect;
type FieldDefinitionRow = typeof equipmentFieldDefinitionsTable.$inferSelect;
type MeterLinkRow = typeof equipmentMeterLinksTable.$inferSelect;
type SourceLinkRow = typeof equipmentEnergySourceLinksTable.$inferSelect;

export type EquipmentInventoryReadinessStatus = "ready" | "partial" | "insufficient" | "not_applicable";

export type EquipmentInventoryReadiness = {
  status: EquipmentInventoryReadinessStatus;
  ready: boolean;
  activeEquipment: number;
  coverage: {
    withAnyMeter: number;
    withAnyEnergySource: number;
    withTechnicalCapacity: number;
    criticalOrEnergyIntensive: number;
  };
  warnings: string[];
  note: string;
};

export type EquipmentInventoryContext = {
  source: {
    contextType: "equipment_inventory";
    companyId: number;
    unitId: number | null;
    effectiveDate: string;
    generatedAt: string;
    sourcePolicy: "current_inventory";
    aggregateSourceCount: number;
    itemLimit: number;
    totalCount: number;
    includedCount: number;
    truncated: boolean;
    selectionPolicy: "critical_energy_intensive_power_updated_code";
    lastEquipmentUpdatedAt: string | null;
  };
  scope: {
    totalEquipment: number;
    activeEquipment: number;
    archivedEquipment: number;
    criticalEquipment: number;
    energyIntensiveEquipment: number;
  };
  coverage: {
    withPrimaryMeter: number;
    withAnyMeter: number;
    withPrimaryEnergySource: number;
    withAnyEnergySource: number;
    withEnergyUseGroup: number;
    withRatedPower: number;
    withLifecycleData: number;
    withCustomValues: number;
  };
  aggregates: {
    installedPowerKw: number | null;
    ratedPowerKw: number | null;
    categoryCounts: Record<string, number>;
    statusCounts: Record<string, number>;
    measurementMethodCounts: Record<string, number>;
    confidenceCounts: Record<string, number>;
  };
  readiness: EquipmentInventoryReadiness;
  warnings: string[];
  items: Array<{
    id: number;
    equipmentCode: string;
    name: string;
    unitId: number;
    unitName: string | null;
    subUnitName: string | null;
    category: string;
    subType: string | null;
    status: string;
    location: string | null;
    building: string | null;
    process: string | null;
    energyUseGroupName: string | null;
    installedPowerKw: number | null;
    ratedPower: { value: number; unit: string | null } | null;
    measurementMethod: string;
    measurementConfidence: string;
    isCritical: boolean;
    isEnergyIntensive: boolean;
    plannedReplacementYear: number | null;
    savingPotential: string | null;
    meters: Array<{ id: number; name: string | null; isPrimary: boolean; relationRole: string; sharePercent: number | null }>;
    energySources: Array<{ id: number; name: string | null; isPrimary: boolean; relationRole: string; sharePercent: number | null }>;
    customFacts: Array<{ code: string; label: string; fieldType: string; displayValue: string; unitLabel: string | null }>;
    updatedAt: string | null;
  }>;
};

const ACTIVE_STATUSES = new Set(["active", "standby", "maintenance", "faulty", "out_of_service"]);
const ALLOWED_CUSTOM_FIELD_TYPES = new Set(["integer", "decimal", "unit_number", "boolean", "single_select", "multi_select", "date", "short_text"]);

function dateOnlyNow() {
  return new Date().toISOString().slice(0, 10);
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function round(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const m = 10 ** digits;
  return Math.round(value * m) / m;
}

function increment(map: Record<string, number>, key: string | null | undefined) {
  const normalized = normalizeText(key ?? "unknown", 80) ?? "unknown";
  map[normalized] = (map[normalized] ?? 0) + 1;
}

function hasLifecycleData(row: EquipmentRow) {
  return row.purchaseDate !== null
    || row.commissioningDate !== null
    || row.manufactureYear !== null
    || row.expectedLifeYears !== null
    || row.plannedReplacementYear !== null;
}

function ratedPowerKw(row: EquipmentRow) {
  if (row.ratedPowerValue === null || row.ratedPowerValue === undefined) return null;
  const unit = (row.ratedPowerUnit ?? "").toLowerCase();
  if (unit === "kw" || unit.includes("kilowatt")) return Number(row.ratedPowerValue);
  if (unit === "w" || unit === "watt") return Number(row.ratedPowerValue) / 1000;
  return null;
}

function displayCustomValue(value: unknown, fieldType: string, unitLabel: string | null) {
  if (value === null || value === undefined) return null;
  if (fieldType === "boolean") return value ? "Evet" : "Hayir";
  if (fieldType === "unit_number" && typeof value === "object" && value && "value" in value) {
    const rawValue = (value as { value?: unknown }).value;
    const rawUnit = (value as { unit?: unknown }).unit;
    if (typeof rawValue === "number") return `${round(rawValue, 2)} ${typeof rawUnit === "string" ? rawUnit : unitLabel ?? ""}`.trim();
  }
  if (typeof value === "number") return `${round(value, 2)}${unitLabel ? ` ${unitLabel}` : ""}`;
  if (Array.isArray(value)) return normalizeText(value.map((item) => String(item)).join(", "), 160);
  return normalizeText(String(value), fieldType === "short_text" ? 120 : 160);
}

function customFacts(row: EquipmentRow, definitions: FieldDefinitionRow[]) {
  const values = row.customValues ?? {};
  return definitions
    .filter((definition) => definition.isActive && ALLOWED_CUSTOM_FIELD_TYPES.has(definition.fieldType))
    .map((definition) => {
      const displayValue = displayCustomValue(values[definition.code], definition.fieldType, definition.unitLabel);
      if (!displayValue) return null;
      return {
        code: definition.code,
        label: normalizeText(definition.label, 100) ?? definition.code,
        fieldType: definition.fieldType,
        displayValue,
        unitLabel: definition.unitLabel,
      };
    })
    .filter((fact): fact is NonNullable<typeof fact> => fact !== null)
    .slice(0, 12);
}

function hasAllowedCustomValue(row: EquipmentRow, definitions: FieldDefinitionRow[]) {
  return customFacts(row, definitions).length > 0;
}

function buildReadiness(activeRows: EquipmentRow[], coverage: EquipmentInventoryContext["coverage"], warnings: string[]): EquipmentInventoryReadiness {
  const activeEquipment = activeRows.length;
  const technicalCapacity = coverage.withRatedPower;
  const criticalOrEnergyIntensive = activeRows.filter((row) => row.isCritical || row.isEnergyIntensive).length;
  let status: EquipmentInventoryReadinessStatus = "not_applicable";
  if (activeEquipment > 0) {
    const hasCoreLinks = coverage.withAnyMeter > 0 && coverage.withAnyEnergySource > 0;
    const hasContext = criticalOrEnergyIntensive > 0 || technicalCapacity > 0;
    status = hasCoreLinks && hasContext
      ? "ready"
      : (coverage.withAnyMeter > 0 || coverage.withAnyEnergySource > 0 || technicalCapacity > 0 || criticalOrEnergyIntensive > 0)
        ? "partial"
        : "insufficient";
  }
  return {
    status,
    ready: status === "ready",
    activeEquipment,
    coverage: {
      withAnyMeter: coverage.withAnyMeter,
      withAnyEnergySource: coverage.withAnyEnergySource,
      withTechnicalCapacity: technicalCapacity,
      criticalOrEnergyIntensive,
    },
    warnings,
    note: status === "ready"
      ? "Ekipman envanteri karar destek baglamina hazir; dis AI servisine gonderilmedi."
      : status === "not_applicable"
        ? "Kapsamda aktif ekipman yok; dis AI servisine gonderilmedi."
        : "Ekipman envanteri baglami kismen hazir; eksik iliski ve teknik alanlar tamamlanmali.",
  };
}

function emptyContext(companyId: number, unitId: number | null, effectiveDate: string, itemLimit: number, warning: string): EquipmentInventoryContext {
  const warnings = [warning, "current_inventory_not_historical"];
  const coverage = {
    withPrimaryMeter: 0,
    withAnyMeter: 0,
    withPrimaryEnergySource: 0,
    withAnyEnergySource: 0,
    withEnergyUseGroup: 0,
    withRatedPower: 0,
    withLifecycleData: 0,
    withCustomValues: 0,
  };
  return {
    source: {
      contextType: "equipment_inventory",
      companyId,
      unitId,
      effectiveDate,
      generatedAt: new Date().toISOString(),
      sourcePolicy: "current_inventory",
      aggregateSourceCount: 0,
      itemLimit,
      totalCount: 0,
      includedCount: 0,
      truncated: false,
      selectionPolicy: "critical_energy_intensive_power_updated_code",
      lastEquipmentUpdatedAt: null,
    },
    scope: {
      totalEquipment: 0,
      activeEquipment: 0,
      archivedEquipment: 0,
      criticalEquipment: 0,
      energyIntensiveEquipment: 0,
    },
    coverage,
    aggregates: {
      installedPowerKw: null,
      ratedPowerKw: null,
      categoryCounts: {},
      statusCounts: {},
      measurementMethodCounts: {},
      confidenceCounts: {},
    },
    readiness: buildReadiness([], coverage, warnings),
    warnings,
    items: [],
  };
}

export async function buildEquipmentInventoryContext({
  companyId,
  unitId = null,
  effectiveDate = dateOnlyNow(),
  includeArchived = false,
  itemLimit = 50,
  includeItems = true,
}: {
  companyId: number;
  unitId?: number | null;
  effectiveDate?: string;
  includeArchived?: boolean;
  itemLimit?: number;
  includeItems?: boolean;
}): Promise<EquipmentInventoryContext> {
  const limit = Math.max(0, Math.min(100, itemLimit));
  const conditions = [eq(equipmentTable.companyId, companyId)];
  if (unitId !== null) conditions.push(eq(equipmentTable.unitId, unitId));

  const rows = await db.select().from(equipmentTable)
    .where(and(...conditions))
    .orderBy(desc(equipmentTable.updatedAt), desc(equipmentTable.id));

  if (rows.length === 0) {
    return emptyContext(companyId, unitId, effectiveDate, limit, "no_equipment");
  }

  const activeRows = rows.filter((row) => ACTIVE_STATUSES.has(row.status) && row.archivedAt === null);
  const aggregateRows = includeArchived ? rows : activeRows;
  const aggregateIds = aggregateRows.map((row) => row.id);
  const allUnitIds = Array.from(new Set(rows.map((row) => row.unitId)));
  const allSubUnitIds = Array.from(new Set(rows.map((row) => row.subUnitId).filter((id): id is number => id !== null)));
  const allEugIds = Array.from(new Set(rows.map((row) => row.energyUseGroupId).filter((id): id is number => id !== null)));

  const [meterLinks, sourceLinks, definitions, units, subUnits, energyUseGroups] = await Promise.all([
    aggregateIds.length > 0 ? db.select().from(equipmentMeterLinksTable).where(and(eq(equipmentMeterLinksTable.companyId, companyId), inArray(equipmentMeterLinksTable.equipmentId, aggregateIds))) : Promise.resolve([] as MeterLinkRow[]),
    aggregateIds.length > 0 ? db.select().from(equipmentEnergySourceLinksTable).where(and(eq(equipmentEnergySourceLinksTable.companyId, companyId), inArray(equipmentEnergySourceLinksTable.equipmentId, aggregateIds))) : Promise.resolve([] as SourceLinkRow[]),
    db.select().from(equipmentFieldDefinitionsTable).where(and(eq(equipmentFieldDefinitionsTable.companyId, companyId), eq(equipmentFieldDefinitionsTable.isActive, true))),
    allUnitIds.length > 0 ? db.select({ id: unitsTable.id, name: unitsTable.name }).from(unitsTable).where(inArray(unitsTable.id, allUnitIds)) : Promise.resolve([]),
    allSubUnitIds.length > 0 ? db.select({ id: subUnitsTable.id, name: subUnitsTable.name }).from(subUnitsTable).where(inArray(subUnitsTable.id, allSubUnitIds)) : Promise.resolve([]),
    allEugIds.length > 0 ? db.select({ id: energyUseGroupsTable.id, name: energyUseGroupsTable.name }).from(energyUseGroupsTable).where(inArray(energyUseGroupsTable.id, allEugIds)) : Promise.resolve([]),
  ]);

  const meterIds = Array.from(new Set(meterLinks.map((link) => link.meterId)));
  const sourceIds = Array.from(new Set(sourceLinks.map((link) => link.energySourceId)));
  const [meters, energySources] = await Promise.all([
    meterIds.length > 0 ? db.select({ id: metersTable.id, name: metersTable.name }).from(metersTable).where(and(eq(metersTable.companyId, companyId), inArray(metersTable.id, meterIds))) : Promise.resolve([]),
    sourceIds.length > 0 ? db.select({ id: energySourcesTable.id, name: energySourcesTable.name }).from(energySourcesTable).where(and(eq(energySourcesTable.companyId, companyId), inArray(energySourcesTable.id, sourceIds))) : Promise.resolve([]),
  ]);

  const unitNames = new Map(units.map((row) => [row.id, row.name]));
  const subUnitNames = new Map(subUnits.map((row) => [row.id, row.name]));
  const eugNames = new Map(energyUseGroups.map((row) => [row.id, row.name]));
  const meterNames = new Map(meters.map((row) => [row.id, row.name]));
  const sourceNames = new Map(energySources.map((row) => [row.id, row.name]));
  const linksByEquipment = new Map<number, MeterLinkRow[]>();
  for (const link of meterLinks) linksByEquipment.set(link.equipmentId, [...(linksByEquipment.get(link.equipmentId) ?? []), link]);
  const sourcesByEquipment = new Map<number, SourceLinkRow[]>();
  for (const link of sourceLinks) sourcesByEquipment.set(link.equipmentId, [...(sourcesByEquipment.get(link.equipmentId) ?? []), link]);

  const coverage = {
    withPrimaryMeter: 0,
    withAnyMeter: 0,
    withPrimaryEnergySource: 0,
    withAnyEnergySource: 0,
    withEnergyUseGroup: 0,
    withRatedPower: 0,
    withLifecycleData: 0,
    withCustomValues: 0,
  };
  const categoryCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const measurementMethodCounts: Record<string, number> = {};
  const confidenceCounts: Record<string, number> = {};
  let installedPowerTotal = 0;
  let installedPowerCount = 0;
  let ratedPowerTotal = 0;
  let ratedPowerCount = 0;

  for (const row of activeRows) {
    const rowMeterLinks = linksByEquipment.get(row.id) ?? [];
    const rowSourceLinks = sourcesByEquipment.get(row.id) ?? [];
    if (rowMeterLinks.some((link) => link.isPrimary)) coverage.withPrimaryMeter++;
    if (rowMeterLinks.length > 0) coverage.withAnyMeter++;
    if (rowSourceLinks.some((link) => link.isPrimary)) coverage.withPrimaryEnergySource++;
    if (rowSourceLinks.length > 0) coverage.withAnyEnergySource++;
    if (row.energyUseGroupId !== null) coverage.withEnergyUseGroup++;
    if (ratedPowerKw(row) !== null || row.installedPowerKw !== null) coverage.withRatedPower++;
    if (hasLifecycleData(row)) coverage.withLifecycleData++;
    if (hasAllowedCustomValue(row, definitions)) coverage.withCustomValues++;
    if (row.installedPowerKw !== null && Number.isFinite(row.installedPowerKw)) {
      installedPowerTotal += Number(row.installedPowerKw);
      installedPowerCount++;
    }
    const ratedKw = ratedPowerKw(row);
    if (ratedKw !== null) {
      ratedPowerTotal += ratedKw;
      ratedPowerCount++;
    }
    increment(categoryCounts, row.category);
    increment(statusCounts, row.status);
    increment(measurementMethodCounts, row.measurementMethod);
    increment(confidenceCounts, row.measurementConfidence);
  }

  const warnings = ["current_inventory_not_historical"];
  if (activeRows.length === 0) warnings.push("no_equipment");
  if (activeRows.length > 0 && coverage.withPrimaryMeter === 0) warnings.push("no_primary_meter");
  if (activeRows.length > 0 && coverage.withAnyEnergySource === 0) warnings.push("no_energy_source");
  if (activeRows.some((row) => row.measurementConfidence === "low" || row.measurementConfidence === "unknown")) warnings.push("low_measurement_confidence");
  if (activeRows.some((row) => (row.isCritical || row.isEnergyIntensive) && (linksByEquipment.get(row.id) ?? []).length === 0)) warnings.push("unmeasured_critical_equipment");
  if (activeRows.length > 0 && coverage.withRatedPower === 0) warnings.push("missing_rated_power");
  if (activeRows.length > 0 && coverage.withLifecycleData === 0) warnings.push("missing_lifecycle_data");
  const effectiveYear = Number(effectiveDate.slice(0, 4));
  if (activeRows.some((row) => row.plannedReplacementYear !== null && row.plannedReplacementYear <= effectiveYear)) warnings.push("planned_replacement_due");
  if (!includeArchived && rows.some((row) => row.status === "archived" || row.archivedAt !== null)) warnings.push("archived_equipment_excluded");

  const selectedRows = includeItems
    ? [...activeRows]
      .sort((a, b) => {
        const critical = Number(b.isCritical) - Number(a.isCritical);
        if (critical !== 0) return critical;
        const intensive = Number(b.isEnergyIntensive) - Number(a.isEnergyIntensive);
        if (intensive !== 0) return intensive;
        const power = (b.installedPowerKw ?? -1) - (a.installedPowerKw ?? -1);
        if (power !== 0) return power;
        const date = (new Date(toIso(b.updatedAt) ?? 0).getTime()) - (new Date(toIso(a.updatedAt) ?? 0).getTime());
        if (date !== 0) return date;
        return a.equipmentCode.localeCompare(b.equipmentCode);
      })
      .slice(0, limit)
    : [];
  const truncated = includeItems && activeRows.length > selectedRows.length;
  if (truncated) warnings.push("context_truncated");

  const readiness = buildReadiness(activeRows, coverage, warnings);
  const lastUpdated = rows
    .map((row) => toIso(row.updatedAt))
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;

  return {
    source: {
      contextType: "equipment_inventory",
      companyId,
      unitId,
      effectiveDate,
      generatedAt: new Date().toISOString(),
      sourcePolicy: "current_inventory",
      aggregateSourceCount: activeRows.length,
      itemLimit: limit,
      totalCount: activeRows.length,
      includedCount: selectedRows.length,
      truncated,
      selectionPolicy: "critical_energy_intensive_power_updated_code",
      lastEquipmentUpdatedAt: lastUpdated,
    },
    scope: {
      totalEquipment: rows.length,
      activeEquipment: activeRows.length,
      archivedEquipment: rows.length - activeRows.length,
      criticalEquipment: activeRows.filter((row) => row.isCritical).length,
      energyIntensiveEquipment: activeRows.filter((row) => row.isEnergyIntensive).length,
    },
    coverage,
    aggregates: {
      installedPowerKw: installedPowerCount > 0 ? round(installedPowerTotal, 2) : null,
      ratedPowerKw: ratedPowerCount > 0 ? round(ratedPowerTotal, 2) : null,
      categoryCounts,
      statusCounts,
      measurementMethodCounts,
      confidenceCounts,
    },
    readiness,
    warnings,
    items: selectedRows.map((row) => {
      const rowMeterLinks = linksByEquipment.get(row.id) ?? [];
      const rowSourceLinks = sourcesByEquipment.get(row.id) ?? [];
      const ratedKw = ratedPowerKw(row);
      return {
        id: row.id,
        equipmentCode: row.equipmentCode,
        name: normalizeText(row.name, 160) ?? row.equipmentCode,
        unitId: row.unitId,
        unitName: unitNames.get(row.unitId) ?? null,
        subUnitName: row.subUnitId !== null ? subUnitNames.get(row.subUnitId) ?? null : null,
        category: row.category,
        subType: normalizeText(row.subType, 80),
        status: row.status,
        location: normalizeText(row.locationText, 120),
        building: normalizeText(row.buildingText, 120),
        process: normalizeText(row.processText, 120),
        energyUseGroupName: row.energyUseGroupId !== null ? eugNames.get(row.energyUseGroupId) ?? null : null,
        installedPowerKw: round(row.installedPowerKw, 2),
        ratedPower: row.ratedPowerValue !== null ? { value: round(ratedKw ?? row.ratedPowerValue, 2) ?? row.ratedPowerValue, unit: ratedKw !== null ? "kW" : row.ratedPowerUnit } : null,
        measurementMethod: row.measurementMethod,
        measurementConfidence: row.measurementConfidence,
        isCritical: row.isCritical,
        isEnergyIntensive: row.isEnergyIntensive,
        plannedReplacementYear: row.plannedReplacementYear,
        savingPotential: normalizeText(row.savingPotential, 180),
        meters: rowMeterLinks.map((link) => ({ id: link.meterId, name: meterNames.get(link.meterId) ?? null, isPrimary: link.isPrimary, relationRole: link.relationRole, sharePercent: round(link.sharePercent, 2) })),
        energySources: rowSourceLinks.map((link) => ({ id: link.energySourceId, name: sourceNames.get(link.energySourceId) ?? null, isPrimary: link.isPrimary, relationRole: link.relationRole, sharePercent: round(link.sharePercent, 2) })),
        customFacts: customFacts(row, definitions),
        updatedAt: toIso(row.updatedAt),
      };
    }),
  };
}

export function toEquipmentDashboardContext(context: EquipmentInventoryContext) {
  return {
    mode: context.source.unitId === null ? "company" : "unit",
    source: context.source,
    scope: context.scope,
    coverage: context.coverage,
    aggregates: context.aggregates,
    readiness: context.readiness,
    warnings: context.warnings,
    highlights: context.items.slice(0, 6),
  };
}

export function toEquipmentEnergyReviewContext(context: EquipmentInventoryContext) {
  return {
    source: context.source,
    scope: context.scope,
    coverage: context.coverage,
    aggregates: context.aggregates,
    readiness: context.readiness,
    warnings: context.warnings,
    keyEquipment: context.items.slice(0, 8),
  };
}

export function toEquipmentAiReadiness(context: EquipmentInventoryContext): EquipmentInventoryReadiness & {
  source: EquipmentInventoryContext["source"];
} {
  const stableGeneratedAt = `${context.source.effectiveDate}T00:00:00.000Z`;
  return {
    ...context.readiness,
    source: {
      ...context.source,
      generatedAt: stableGeneratedAt,
      includedCount: 0,
      truncated: false,
    },
  };
}

export function toEquipmentReportSnapshot(context: EquipmentInventoryContext) {
  return {
    source: context.source,
    scope: context.scope,
    coverage: context.coverage,
    aggregates: context.aggregates,
    readiness: context.readiness,
    warnings: context.warnings,
    keyEquipment: context.items.slice(0, 10).map((item) => ({
      equipmentCode: item.equipmentCode,
      name: item.name,
      category: item.category,
      unitName: item.unitName,
      isCritical: item.isCritical,
      isEnergyIntensive: item.isEnergyIntensive,
      installedPowerKw: item.installedPowerKw,
      meterCount: item.meters.length,
      energySourceCount: item.energySources.length,
      measurementConfidence: item.measurementConfidence,
    })),
  };
}
