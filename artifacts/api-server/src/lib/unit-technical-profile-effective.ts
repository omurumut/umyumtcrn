import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import {
  db,
  unitsTable,
  unitTechnicalProfilesTable,
  unitTechnicalProfileSnapshotsTable,
} from "@workspace/db";

export type TechnicalProfileReportContextStatus =
  | "resolved"
  | "no_published_snapshot"
  | "no_snapshot_for_date"
  | "not_applicable";

export type TechnicalProfileReportField = {
  code: string;
  label: string;
  value: unknown;
  displayValue: string;
  unitLabel: string | null;
};

export type TechnicalProfileReportContext = {
  status: TechnicalProfileReportContextStatus;
  effectiveDate: string;
  unitId: number | null;
  unitName: string | null;
  snapshotId: number | null;
  snapshotNumber: number | null;
  profileVersion: number | null;
  validFrom: string | null;
  validTo: string | null;
  publishedAt: string | null;
  completionPercentage: number | null;
  warning: string | null;
  standardSummary: TechnicalProfileReportField[];
  customSummary: TechnicalProfileReportField[];
  sourceMetadata: {
    sourceType: "unit_technical_profile_snapshot" | null;
    snapshotId: number | null;
    snapshotNumber: number | null;
    effectiveDate: string;
    resolverStatus: TechnicalProfileReportContextStatus;
    validFrom: string | null;
    validTo: string | null;
  };
};

const STANDARD_REPORT_FIELDS: Array<{ code: string; label: string; unitLabel?: string }> = [
  { code: "facilityUseType", label: "Tesis kullanim tipi" },
  { code: "mainActivity", label: "Ana faaliyet" },
  { code: "mainProcessDescription", label: "Ana proses aciklamasi" },
  { code: "buildingCount", label: "Bina sayisi" },
  { code: "totalEnclosedAreaM2", label: "Toplam kapali alan", unitLabel: "m2" },
  { code: "heatedAreaM2", label: "Isitilan alan", unitLabel: "m2" },
  { code: "cooledAreaM2", label: "Sogutulan alan", unitLabel: "m2" },
  { code: "personnelCount", label: "Personel sayisi", unitLabel: "kisi" },
  { code: "averageDailyUsers", label: "Ortalama gunluk kullanici", unitLabel: "kisi" },
  { code: "dailyOperatingHours", label: "Gunluk calisma suresi", unitLabel: "saat/gun" },
  { code: "weeklyOperatingDays", label: "Haftalik calisma gunu", unitLabel: "gun/hafta" },
  { code: "annualOperatingDays", label: "Yillik calisma gunu", unitLabel: "gun/yil" },
  { code: "shiftCount", label: "Vardiya sayisi" },
  { code: "shiftType", label: "Vardiya tipi" },
  { code: "heatingSystemType", label: "Isitma sistemi" },
  { code: "coolingSystemType", label: "Sogutma sistemi" },
  { code: "domesticHotWaterSystem", label: "Kullanim sicak su sistemi" },
  { code: "buildingAutomationStatus", label: "Bina otomasyonu" },
  { code: "compressedAirStatus", label: "Basincili hava sistemi" },
  { code: "steamSystemStatus", label: "Buhar sistemi" },
  { code: "generatorStatus", label: "Jenerator" },
  { code: "renewableEnergyStatus", label: "Yenilenebilir enerji" },
  { code: "knownEnergyIssues", label: "Bilinen enerji sorunlari" },
  { code: "technicalImprovements", label: "Teknik iyilestirmeler" },
  { code: "plannedInfrastructureChanges", label: "Planlanan altyapi degisiklikleri" },
];

const CUSTOM_REPORT_FIELD_TYPES = new Set([
  "short_text",
  "integer",
  "decimal",
  "boolean",
  "single_select",
  "multi_select",
  "date",
  "unit_number",
]);

const CUSTOM_AI_FIELD_TYPES = new Set([
  "short_text",
  "integer",
  "decimal",
  "boolean",
  "single_select",
  "multi_select",
  "date",
  "unit_number",
]);

const TECHNICAL_STATUS_LABELS: Record<string, string> = {
  yes: "Var",
  no: "Yok",
  unknown: "Bilinmiyor",
  not_applicable: "Uygulanamaz",
};

const AI_OBSERVATION_FIELDS = [
  "mainProcessDescription",
  "energyInfrastructureDescription",
  "knownEnergyIssues",
  "technicalImprovements",
  "plannedInfrastructureChanges",
] as const;

const COMPLETENESS_GROUPS: Record<string, string[]> = {
  facility: ["facilityUseType", "mainActivity", "totalEnclosedAreaM2"],
  operation: ["dailyOperatingHours", "weeklyOperatingDays", "annualOperatingDays", "shiftCount"],
  systems: ["heatingSystemType", "coolingSystemType", "buildingAutomationStatus", "compressedAirStatus", "steamSystemStatus", "generatorStatus", "renewableEnergyStatus"],
  observations: ["mainProcessDescription", "energyInfrastructureDescription", "knownEnergyIssues", "technicalImprovements", "plannedInfrastructureChanges"],
};

export type TechnicalProfileAiCustomFact = {
  code: string;
  label: string;
  fieldType: string;
  value: unknown;
  displayValue: string;
  unitLabel: string | null;
  source: "snapshot_custom_definition";
  truncated: boolean;
};

export type TechnicalProfileAiTextObservation = {
  code: string;
  label: string;
  text: string;
  contentKind: "user_supplied_profile_text";
  truncated: boolean;
};

export type TechnicalProfileAiContext = {
  status: TechnicalProfileReportContextStatus;
  effectiveDate: string;
  source: {
    type: "unit_technical_profile_snapshot" | null;
    snapshotId: number | null;
    snapshotNumber: number | null;
    profileVersion: number | null;
    validFrom: string | null;
    validTo: string | null;
    publishedAt: string | null;
    daysSincePublished: number | null;
  };
  unit: { id: number | null; name: string | null };
  facility: Record<string, unknown>;
  operation: Record<string, unknown>;
  systems: Record<string, unknown>;
  observations: TechnicalProfileAiTextObservation[];
  customFacts: TechnicalProfileAiCustomFact[];
  completeness: { percentage: number | null; missingGroups: string[] };
  warnings: string[];
};

export type TechnicalProfileDashboardContext =
  | {
      mode: "unit";
      status: TechnicalProfileReportContextStatus;
      effectiveDate: string;
      unitId: number | null;
      unitName: string | null;
      snapshotNumber: number | null;
      validFrom: string | null;
      validTo: string | null;
      publishedAt: string | null;
      completionPercentage: number | null;
      facilityUseType: string | null;
      mainActivity: string | null;
      totalEnclosedAreaM2: number | null;
      heatingSystemType: string | null;
      coolingSystemType: string | null;
      warning: string | null;
    }
  | {
      mode: "company";
      status: "aggregate";
      effectiveDate: string;
      totalUnits: number;
      unitsWithResolvedProfile: number;
      unitsWithoutPublishedProfile: number;
      unitsWithoutProfileForDate: number;
      averageCompletionPercentage: number | null;
      warning: string | null;
    };

export function endOfYearEffectiveDate(year: number) {
  return `${year}-12-31`;
}

function isEmptyValue(value: unknown) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function displayValue(value: unknown, unitLabel?: string | null): string {
  if (typeof value === "boolean") return value ? "Evet" : "Hayir";
  if (typeof value === "number") return `${value.toLocaleString("tr-TR")}${unitLabel ? ` ${unitLabel}` : ""}`;
  if (typeof value === "string") return truncateText(value, 220);
  if (Array.isArray(value)) return truncateText(value.map((item) => String(item)).join(", "), 220);
  if (value && typeof value === "object" && "value" in value) {
    const rawValue = (value as { value?: unknown }).value;
    const rawUnit = (value as { unit?: unknown }).unit;
    return displayValue(rawValue, typeof rawUnit === "string" ? rawUnit : unitLabel);
  }
  return truncateText(String(value), 220);
}

function normalizeFreeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return {
    text: truncateText(normalized, maxLength),
    truncated: normalized.length > maxLength,
  };
}

function dateDiffDays(from: Date, to: Date) {
  const ms = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
    - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function dateOnlyNow() {
  return new Date().toISOString().slice(0, 10);
}

function definedEntries(values: Record<string, unknown>, fields: string[]) {
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field];
    if (isEmptyValue(value)) continue;
    output[field] = typeof value === "string" && TECHNICAL_STATUS_LABELS[value] ? { code: value, label: TECHNICAL_STATUS_LABELS[value] } : value;
  }
  return output;
}

function missingGroups(values: Record<string, unknown>) {
  return Object.entries(COMPLETENESS_GROUPS)
    .filter(([, fields]) => fields.every((field) => isEmptyValue(values[field])))
    .map(([group]) => group);
}

function emptyContext(
  status: TechnicalProfileReportContextStatus,
  effectiveDate: string,
  unitId: number | null,
  unitName: string | null,
  warning: string | null,
): TechnicalProfileReportContext {
  return {
    status,
    effectiveDate,
    unitId,
    unitName,
    snapshotId: null,
    snapshotNumber: null,
    profileVersion: null,
    validFrom: null,
    validTo: null,
    publishedAt: null,
    completionPercentage: null,
    warning,
    standardSummary: [],
    customSummary: [],
    sourceMetadata: {
      sourceType: null,
      snapshotId: null,
      snapshotNumber: null,
      effectiveDate,
      resolverStatus: status,
      validFrom: null,
      validTo: null,
    },
  };
}

export async function resolvePublishedUnitTechnicalProfileSnapshotForDate({
  companyId,
  unitId,
  effectiveDate,
}: {
  companyId: number;
  unitId: number;
  effectiveDate: string;
}) {
  const [snapshot] = await db.select()
    .from(unitTechnicalProfileSnapshotsTable)
    .where(and(
      eq(unitTechnicalProfileSnapshotsTable.companyId, companyId),
      eq(unitTechnicalProfileSnapshotsTable.unitId, unitId),
      lte(unitTechnicalProfileSnapshotsTable.validFrom, effectiveDate),
      or(isNull(unitTechnicalProfileSnapshotsTable.validTo), gt(unitTechnicalProfileSnapshotsTable.validTo, effectiveDate)),
    ))
    .orderBy(desc(unitTechnicalProfileSnapshotsTable.validFrom))
    .limit(1);
  return snapshot ?? null;
}

export async function buildTechnicalProfileReportContext({
  companyId,
  unitId,
  effectiveDate,
}: {
  companyId: number;
  unitId: number | null;
  effectiveDate: string;
}): Promise<TechnicalProfileReportContext> {
  if (unitId === null) {
    return emptyContext(
      "not_applicable",
      effectiveDate,
      null,
      null,
      "Teknik profil V1 kapsaminda birim bazli kullanilir; kurulus geneli kapsam icin profil eklenmedi.",
    );
  }

  const [unit] = await db.select({ id: unitsTable.id, name: unitsTable.name, companyId: unitsTable.companyId })
    .from(unitsTable)
    .where(eq(unitsTable.id, unitId))
    .limit(1);

  if (!unit || unit.companyId !== companyId) {
    throw new Error("unit_technical_profile_context_unit_scope_mismatch");
  }

  const snapshot = await resolvePublishedUnitTechnicalProfileSnapshotForDate({ companyId, unitId, effectiveDate });
  if (!snapshot) {
    const [anySnapshot] = await db.select({ id: unitTechnicalProfileSnapshotsTable.id })
      .from(unitTechnicalProfileSnapshotsTable)
      .where(and(
        eq(unitTechnicalProfileSnapshotsTable.companyId, companyId),
        eq(unitTechnicalProfileSnapshotsTable.unitId, unitId),
      ))
      .limit(1);
    const [profile] = await db.select({ id: unitTechnicalProfilesTable.id })
      .from(unitTechnicalProfilesTable)
      .where(and(
        eq(unitTechnicalProfilesTable.companyId, companyId),
        eq(unitTechnicalProfilesTable.unitId, unitId),
      ))
      .limit(1);
    const status: TechnicalProfileReportContextStatus = anySnapshot ? "no_snapshot_for_date" : "no_published_snapshot";
    const warning = anySnapshot
      ? "Secilen etki tarihi icin yayimlanmis teknik profil snapshot'i bulunamadi."
      : profile
        ? "Birim teknik profili var ancak henuz yayimlanmis snapshot bulunmuyor."
        : "Birim teknik profili henuz olusturulmamis.";
    return emptyContext(status, effectiveDate, unitId, unit.name, warning);
  }

  const standardValues = snapshot.standardValues ?? {};
  const customValues = snapshot.customValues ?? {};
  const standardSummary = STANDARD_REPORT_FIELDS
    .map((field) => {
      const value = standardValues[field.code];
      if (isEmptyValue(value)) return null;
      return {
        code: field.code,
        label: field.label,
        value,
        displayValue: displayValue(value, field.unitLabel),
        unitLabel: field.unitLabel ?? null,
      };
    })
    .filter((field): field is TechnicalProfileReportField => field !== null);

  const customSummary = (snapshot.customDefinitionSnapshot ?? [])
    .filter((definition) => definition && typeof definition === "object")
    .map((definition) => definition as Record<string, unknown>)
    .filter((definition) => typeof definition.code === "string" && CUSTOM_REPORT_FIELD_TYPES.has(String(definition.fieldType)))
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
    .map((definition) => {
      const code = String(definition.code);
      const value = customValues[code];
      if (isEmptyValue(value)) return null;
      const unitLabel = typeof definition.unitLabel === "string" ? definition.unitLabel : null;
      return {
        code,
        label: typeof definition.label === "string" ? definition.label : code,
        value,
        displayValue: displayValue(value, unitLabel),
        unitLabel,
      };
    })
    .filter((field): field is TechnicalProfileReportField => field !== null)
    .slice(0, 8);

  return {
    status: "resolved",
    effectiveDate,
    unitId,
    unitName: unit.name,
    snapshotId: snapshot.id,
    snapshotNumber: snapshot.snapshotNumber,
    profileVersion: snapshot.profileVersion,
    validFrom: snapshot.validFrom,
    validTo: snapshot.validTo,
    publishedAt: snapshot.publishedAt.toISOString(),
    completionPercentage: snapshot.completionPercentage,
    warning: null,
    standardSummary,
    customSummary,
    sourceMetadata: {
      sourceType: "unit_technical_profile_snapshot",
      snapshotId: snapshot.id,
      snapshotNumber: snapshot.snapshotNumber,
      effectiveDate,
      resolverStatus: "resolved",
      validFrom: snapshot.validFrom,
      validTo: snapshot.validTo,
    },
  };
}

export async function buildTechnicalProfileAiContext({
  companyId,
  unitId,
  effectiveDate,
}: {
  companyId: number;
  unitId: number | null;
  effectiveDate: string;
}): Promise<TechnicalProfileAiContext> {
  const reportContext = await buildTechnicalProfileReportContext({ companyId, unitId, effectiveDate });
  const warnings = reportContext.warning ? [reportContext.warning] : [];

  if (reportContext.status !== "resolved" || unitId === null || reportContext.snapshotId === null) {
    return {
      status: reportContext.status,
      effectiveDate,
      source: {
        type: null,
        snapshotId: null,
        snapshotNumber: null,
        profileVersion: null,
        validFrom: null,
        validTo: null,
        publishedAt: null,
        daysSincePublished: null,
      },
      unit: { id: unitId, name: reportContext.unitName },
      facility: {},
      operation: {},
      systems: {},
      observations: [],
      customFacts: [],
      completeness: { percentage: null, missingGroups: [] },
      warnings,
    };
  }

  const snapshot = await resolvePublishedUnitTechnicalProfileSnapshotForDate({ companyId, unitId, effectiveDate });
  if (!snapshot) {
    throw new Error("unit_technical_profile_ai_context_snapshot_resolution_mismatch");
  }

  const standardValues = snapshot.standardValues ?? {};
  const observationLabels = new Map(STANDARD_REPORT_FIELDS.map((field) => [field.code, field.label]));
  const observations: TechnicalProfileAiTextObservation[] = [];
  for (const code of AI_OBSERVATION_FIELDS) {
      const normalized = normalizeFreeText(standardValues[code], 700);
      if (!normalized) continue;
      observations.push({
        code,
        label: observationLabels.get(code) ?? code,
        text: normalized.text,
        contentKind: "user_supplied_profile_text" as const,
        truncated: normalized.truncated,
      });
  }

  const customValues = snapshot.customValues ?? {};
  const customFacts = (snapshot.customDefinitionSnapshot ?? [])
    .filter((definition) => definition && typeof definition === "object")
    .map((definition) => definition as Record<string, unknown>)
    .filter((definition) =>
      definition.isActive !== false
      && typeof definition.code === "string"
      && CUSTOM_AI_FIELD_TYPES.has(String(definition.fieldType))
    )
    .sort((a, b) => {
      const order = Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
      if (order !== 0) return order;
      return String(a.code).localeCompare(String(b.code));
    })
    .map((definition) => {
      const code = String(definition.code);
      const fieldType = String(definition.fieldType);
      const value = customValues[code];
      if (isEmptyValue(value)) return null;
      const unitLabel = typeof definition.unitLabel === "string" ? definition.unitLabel : null;
      const maxLength = fieldType === "short_text" ? 160 : 220;
      const rawDisplay = displayValue(value, unitLabel);
      const safeDisplay = truncateText(rawDisplay.replace(/\s+/g, " ").trim(), maxLength);
      return {
        code,
        label: typeof definition.label === "string" ? definition.label : code,
        fieldType,
        value,
        displayValue: safeDisplay,
        unitLabel,
        source: "snapshot_custom_definition" as const,
        truncated: rawDisplay.length > maxLength,
      };
    })
    .filter((field): field is TechnicalProfileAiCustomFact => field !== null)
    .slice(0, 12);

  return {
    status: "resolved",
    effectiveDate,
    source: {
      type: "unit_technical_profile_snapshot",
      snapshotId: snapshot.id,
      snapshotNumber: snapshot.snapshotNumber,
      profileVersion: snapshot.profileVersion,
      validFrom: snapshot.validFrom,
      validTo: snapshot.validTo,
      publishedAt: snapshot.publishedAt.toISOString().slice(0, 10),
      daysSincePublished: dateDiffDays(snapshot.publishedAt, new Date()),
    },
    unit: { id: unitId, name: reportContext.unitName },
    facility: definedEntries(standardValues, [
      "facilityUseType",
      "mainActivity",
      "buildingCount",
      "totalEnclosedAreaM2",
      "heatedAreaM2",
      "cooledAreaM2",
      "insulationStatus",
    ]),
    operation: definedEntries(standardValues, [
      "personnelCount",
      "averageDailyUsers",
      "dailyOperatingHours",
      "weeklyOperatingDays",
      "annualOperatingDays",
      "shiftCount",
      "shiftType",
      "seasonalOperationStatus",
    ]),
    systems: definedEntries(standardValues, [
      "heatingSystemType",
      "coolingSystemType",
      "domesticHotWaterSystem",
      "buildingAutomationStatus",
      "compressedAirStatus",
      "steamSystemStatus",
      "generatorStatus",
      "renewableEnergyStatus",
    ]),
    observations,
    customFacts,
    completeness: {
      percentage: snapshot.completionPercentage,
      missingGroups: missingGroups(standardValues),
    },
    warnings,
  };
}

export async function buildTechnicalProfileDashboardContext({
  companyId,
  unitId,
  effectiveDate,
}: {
  companyId: number;
  unitId: number | null;
  effectiveDate: string;
}): Promise<TechnicalProfileDashboardContext> {
  if (unitId !== null) {
    const context = await buildTechnicalProfileAiContext({ companyId, unitId, effectiveDate });
    return {
      mode: "unit",
      status: context.status,
      effectiveDate,
      unitId: context.unit.id,
      unitName: context.unit.name,
      snapshotNumber: context.source.snapshotNumber,
      validFrom: context.source.validFrom,
      validTo: context.source.validTo,
      publishedAt: context.source.publishedAt,
      completionPercentage: context.completeness.percentage,
      facilityUseType: typeof context.facility.facilityUseType === "string" ? context.facility.facilityUseType : null,
      mainActivity: typeof context.facility.mainActivity === "string" ? context.facility.mainActivity : null,
      totalEnclosedAreaM2: typeof context.facility.totalEnclosedAreaM2 === "number" ? context.facility.totalEnclosedAreaM2 : null,
      heatingSystemType: typeof context.systems.heatingSystemType === "string" ? context.systems.heatingSystemType : null,
      coolingSystemType: typeof context.systems.coolingSystemType === "string" ? context.systems.coolingSystemType : null,
      warning: context.warnings[0] ?? null,
    };
  }

  const units = await db.select({ id: unitsTable.id })
    .from(unitsTable)
    .where(and(eq(unitsTable.companyId, companyId), eq(unitsTable.active, true)))
    .orderBy(asc(unitsTable.id));
  if (units.length === 0) {
    return {
      mode: "company",
      status: "aggregate",
      effectiveDate,
      totalUnits: 0,
      unitsWithResolvedProfile: 0,
      unitsWithoutPublishedProfile: 0,
      unitsWithoutProfileForDate: 0,
      averageCompletionPercentage: null,
      warning: "Aktif birim bulunamadi.",
    };
  }

  const unitIds = units.map((unit) => unit.id);
  const snapshots = await db.select()
    .from(unitTechnicalProfileSnapshotsTable)
    .where(and(
      eq(unitTechnicalProfileSnapshotsTable.companyId, companyId),
      inArray(unitTechnicalProfileSnapshotsTable.unitId, unitIds),
    ))
    .orderBy(asc(unitTechnicalProfileSnapshotsTable.unitId), desc(unitTechnicalProfileSnapshotsTable.validFrom));

  const hasSnapshot = new Set<number>();
  const effectiveByUnit = new Map<number, typeof unitTechnicalProfileSnapshotsTable.$inferSelect>();
  for (const snapshot of snapshots) {
    hasSnapshot.add(snapshot.unitId);
    if (
      snapshot.validFrom <= effectiveDate
      && (snapshot.validTo === null || snapshot.validTo > effectiveDate)
      && !effectiveByUnit.has(snapshot.unitId)
    ) {
      effectiveByUnit.set(snapshot.unitId, snapshot);
    }
  }

  const resolved = [...effectiveByUnit.values()];
  const averageCompletionPercentage = resolved.length > 0
    ? Math.round(resolved.reduce((sum, snapshot) => sum + snapshot.completionPercentage, 0) / resolved.length)
    : null;
  const unitsWithoutPublishedProfile = units.filter((unit) => !hasSnapshot.has(unit.id)).length;
  const unitsWithoutProfileForDate = units.filter((unit) => hasSnapshot.has(unit.id) && !effectiveByUnit.has(unit.id)).length;

  return {
    mode: "company",
    status: "aggregate",
    effectiveDate,
    totalUnits: units.length,
    unitsWithResolvedProfile: resolved.length,
    unitsWithoutPublishedProfile,
    unitsWithoutProfileForDate,
    averageCompletionPercentage,
    warning: resolved.length === units.length ? null : "Bazi birimler icin yayimlanmis veya gecerlilik tarihine uygun teknik profil yok.",
  };
}

export function defaultTechnicalProfileContextDate(year?: number) {
  return year ? endOfYearEffectiveDate(year) : dateOnlyNow();
}
