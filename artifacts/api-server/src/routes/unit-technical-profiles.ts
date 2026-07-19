import { Router, type Request, type Response } from "express";
import ExcelJS from "exceljs";
import multer from "multer";
import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import {
  companiesTable,
  db,
  unitTechnicalProfileFieldDefinitionsTable,
  unitTechnicalProfilesTable,
  unitTechnicalProfileSnapshotsTable,
  unitsTable,
  usersTable,
} from "@workspace/db";
import {
  calculateUnitTechnicalProfileCompletion,
  createDefaultUnitTechnicalProfile,
  missingRequiredUnitTechnicalProfileCustomFieldsForPublish,
  normalizeUnitTechnicalProfileCustomFieldValue,
  UNIT_TECHNICAL_PROFILE_FIELD_LABELS,
  UNIT_TECHNICAL_PROFILE_FIELD_UNITS,
  UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS,
  UNIT_TECHNICAL_PROFILE_SECTIONS,
  UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES,
  UNIT_TECHNICAL_PROFILE_TEXT_LIMITS,
  unitTechnicalProfilePatchRequestSchema,
  unitTechnicalProfilePublishRequestSchema,
  validateUnitTechnicalProfileCustomFieldValues,
  validateUnitTechnicalProfilePublishMinimum,
  type UnitTechnicalProfileCustomFieldDefinitionDto,
  type UnitTechnicalProfileDto,
  type UnitTechnicalProfileSnapshotDetail,
  type UnitTechnicalProfileSnapshotSummary,
  type UnitTechnicalProfileValues,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";
import { changedAuditFields, writeAuditEvent, type AuditAction } from "../lib/audit.js";
import { sanitizeSpreadsheetText, sendXlsxResponse } from "../lib/xlsx-export.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

const PROFILE_FIELDS = [
  "facilityUseType",
  "mainActivity",
  "buildingCount",
  "totalEnclosedAreaM2",
  "heatedAreaM2",
  "cooledAreaM2",
  "openAreaM2",
  "personnelCount",
  "averageDailyUsers",
  "dailyOperatingHours",
  "weeklyOperatingDays",
  "annualOperatingDays",
  "shiftCount",
  "shiftType",
  "seasonalOperationStatus",
  "insulationStatus",
  "heatingSystemType",
  "coolingSystemType",
  "domesticHotWaterSystem",
  "buildingAutomationStatus",
  "compressedAirStatus",
  "steamSystemStatus",
  "generatorStatus",
  "renewableEnergyStatus",
  "mainProcessDescription",
  "energyInfrastructureDescription",
  "knownEnergyIssues",
  "technicalImprovements",
  "plannedInfrastructureChanges",
  "profileStatus",
] as const;

const STANDARD_SNAPSHOT_FIELDS = PROFILE_FIELDS.filter((field) => field !== "profileStatus");

type ProfileField = typeof PROFILE_FIELDS[number];
type TextField = keyof typeof UNIT_TECHNICAL_PROFILE_TEXT_LIMITS;
type NumericField = keyof typeof UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS;
type TechnicalField =
  | "seasonalOperationStatus"
  | "insulationStatus"
  | "buildingAutomationStatus"
  | "compressedAirStatus"
  | "steamSystemStatus"
  | "generatorStatus"
  | "renewableEnergyStatus";
type ProfilePatch = Partial<Pick<typeof unitTechnicalProfilesTable.$inferInsert, ProfileField>>;
type CustomFieldValues = Record<string, unknown>;
type DefinitionRow = typeof unitTechnicalProfileFieldDefinitionsTable.$inferSelect;
type ProfileRow = typeof unitTechnicalProfilesTable.$inferSelect;
type SnapshotRow = typeof unitTechnicalProfileSnapshotsTable.$inferSelect;

const textFields = Object.keys(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS) as TextField[];
const numericFields = Object.keys(UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS) as NumericField[];
const technicalFields: TechnicalField[] = [
  "seasonalOperationStatus",
  "insulationStatus",
  "buildingAutomationStatus",
  "compressedAirStatus",
  "steamSystemStatus",
  "generatorStatus",
  "renewableEnergyStatus",
];
const integerFields = new Set<NumericField>([
  "buildingCount",
  "personnelCount",
  "averageDailyUsers",
  "annualOperatingDays",
  "shiftCount",
]);

class UnitTechnicalProfileScopeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function canPublish(role: string) {
  return isCompanyAdmin(role) || isSuperAdmin(role);
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new UnitTechnicalProfileScopeError(400, `Gecersiz ${field}`);
}

function parseOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return parsePositiveInteger(value, field);
}

function parseIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UnitTechnicalProfileScopeError(400, `Gecersiz ${field}`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new UnitTechnicalProfileScopeError(400, `Gecersiz ${field}`);
  }
  return value;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function handleScopeError(res: Response, error: unknown) {
  if (!(error instanceof UnitTechnicalProfileScopeError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

async function resolveScope(req: Request, unitId: number) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const requestedCompanyId = parseOptionalPositiveInteger(req.query.companyId, "companyId");

  if (!isSuperAdmin(role) && requestedCompanyId !== undefined) {
    throw new UnitTechnicalProfileScopeError(400, "Firma kapsami oturumdan alinir; companyId gonderilmemelidir");
  }
  if (isSuperAdmin(role) && requestedCompanyId === undefined) {
    throw new UnitTechnicalProfileScopeError(400, "Gecerli companyId zorunludur");
  }
  if (!isCompanyAdmin(role) && !isSuperAdmin(role)) {
    if (sessionUnitId === null) throw new UnitTechnicalProfileScopeError(403, "Birim yetkisi gerekli");
    if (unitId !== sessionUnitId) throw new UnitTechnicalProfileScopeError(403, "Yetki yok");
  }

  const companyId = isSuperAdmin(role) ? requestedCompanyId! : sessionCompanyId;
  const [company] = await db.select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) throw new UnitTechnicalProfileScopeError(404, "Sirket bulunamadi");

  const [unit] = await db.select({ id: unitsTable.id, companyId: unitsTable.companyId })
    .from(unitsTable)
    .where(and(eq(unitsTable.id, unitId), eq(unitsTable.companyId, companyId)))
    .limit(1);
  if (!unit) throw new UnitTechnicalProfileScopeError(isSuperAdmin(role) ? 403 : 404, "Birim bulunamadi");

  return {
    role,
    userId: req.user!.userId,
    companyId,
    unitId,
    canEdit: true,
    canPublish: canPublish(role),
  };
}

function serializeProfile(profile: ProfileRow | null, companyId: number, unitId: number): UnitTechnicalProfileDto {
  if (!profile) return createDefaultUnitTechnicalProfile(companyId, unitId);
  return {
    id: profile.id,
    companyId: profile.companyId,
    unitId: profile.unitId,
    exists: true,
    facilityUseType: profile.facilityUseType,
    mainActivity: profile.mainActivity,
    buildingCount: profile.buildingCount,
    totalEnclosedAreaM2: profile.totalEnclosedAreaM2,
    heatedAreaM2: profile.heatedAreaM2,
    cooledAreaM2: profile.cooledAreaM2,
    openAreaM2: profile.openAreaM2,
    personnelCount: profile.personnelCount,
    averageDailyUsers: profile.averageDailyUsers,
    dailyOperatingHours: profile.dailyOperatingHours,
    weeklyOperatingDays: profile.weeklyOperatingDays,
    annualOperatingDays: profile.annualOperatingDays,
    shiftCount: profile.shiftCount,
    shiftType: profile.shiftType,
    seasonalOperationStatus: profile.seasonalOperationStatus as UnitTechnicalProfileDto["seasonalOperationStatus"],
    insulationStatus: profile.insulationStatus as UnitTechnicalProfileDto["insulationStatus"],
    heatingSystemType: profile.heatingSystemType,
    coolingSystemType: profile.coolingSystemType,
    domesticHotWaterSystem: profile.domesticHotWaterSystem,
    buildingAutomationStatus: profile.buildingAutomationStatus as UnitTechnicalProfileDto["buildingAutomationStatus"],
    compressedAirStatus: profile.compressedAirStatus as UnitTechnicalProfileDto["compressedAirStatus"],
    steamSystemStatus: profile.steamSystemStatus as UnitTechnicalProfileDto["steamSystemStatus"],
    generatorStatus: profile.generatorStatus as UnitTechnicalProfileDto["generatorStatus"],
    renewableEnergyStatus: profile.renewableEnergyStatus as UnitTechnicalProfileDto["renewableEnergyStatus"],
    mainProcessDescription: profile.mainProcessDescription,
    energyInfrastructureDescription: profile.energyInfrastructureDescription,
    knownEnergyIssues: profile.knownEnergyIssues,
    technicalImprovements: profile.technicalImprovements,
    plannedInfrastructureChanges: profile.plannedInfrastructureChanges,
    profileStatus: profile.profileStatus as UnitTechnicalProfileDto["profileStatus"],
    profileVersion: profile.profileVersion,
    createdAt: profile.createdAt.toISOString(),
    createdBy: profile.createdBy,
    updatedAt: profile.updatedAt.toISOString(),
    updatedBy: profile.updatedBy,
  };
}

function serializeDefinition(row: DefinitionRow): UnitTechnicalProfileCustomFieldDefinitionDto {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    label: row.label,
    description: row.description,
    fieldType: row.fieldType as UnitTechnicalProfileCustomFieldDefinitionDto["fieldType"],
    unitLabel: row.unitLabel,
    options: row.options ?? [],
    isRequiredForPublish: row.isRequiredForPublish,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    validationConfig: row.validationConfig ?? {},
    definitionVersion: row.definitionVersion,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

function profileCustomValues(profile: ProfileRow | null): CustomFieldValues {
  const values = profile?.customValues;
  return values && typeof values === "object" && !Array.isArray(values) ? values : {};
}

async function getDefinitionsForProfile(companyId: number, customValues: CustomFieldValues) {
  const rows = await db.select()
    .from(unitTechnicalProfileFieldDefinitionsTable)
    .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, companyId))
    .orderBy(
      asc(unitTechnicalProfileFieldDefinitionsTable.sortOrder),
      asc(unitTechnicalProfileFieldDefinitionsTable.label),
    );
  return rows
    .filter((row) => row.isActive || Object.prototype.hasOwnProperty.call(customValues, row.code))
    .map(serializeDefinition);
}

async function responseFor(profile: ProfileRow | null, scope: Awaited<ReturnType<typeof resolveScope>>) {
  const customFieldValues = profileCustomValues(profile);
  return {
    profile: serializeProfile(profile, scope.companyId, scope.unitId),
    customFieldDefinitions: await getDefinitionsForProfile(scope.companyId, customFieldValues),
    customFieldValues,
    permissions: {
      canEdit: scope.canEdit,
      canPublish: scope.canPublish,
    },
  };
}

function standardSnapshotValues(profile: ProfileRow) {
  const values: Record<string, unknown> = {};
  for (const field of STANDARD_SNAPSHOT_FIELDS) values[field] = profile[field];
  values.profileStatus = "published";
  return values;
}

function definitionSnapshot(definitions: DefinitionRow[]) {
  return definitions.map((definition) => ({
    id: definition.id,
    code: definition.code,
    label: definition.label,
    description: definition.description,
    fieldType: definition.fieldType,
    unitLabel: definition.unitLabel,
    options: definition.options ?? [],
    isActive: definition.isActive,
    isRequiredForPublish: definition.isRequiredForPublish,
    sortOrder: definition.sortOrder,
    definitionVersion: definition.definitionVersion,
  }));
}

function snapshotToSummary(
  snapshot: SnapshotRow,
  publishedByName?: string | null,
): UnitTechnicalProfileSnapshotSummary {
  const today = todayIsoDate();
  return {
    id: snapshot.id,
    companyId: snapshot.companyId,
    unitId: snapshot.unitId,
    sourceProfileId: snapshot.sourceProfileId,
    snapshotNumber: snapshot.snapshotNumber,
    profileVersion: snapshot.profileVersion,
    profileStatus: "published",
    validFrom: snapshot.validFrom,
    validTo: snapshot.validTo,
    publishedAt: snapshot.publishedAt.toISOString(),
    publishedBy: snapshot.publishedBy,
    publishedByName: publishedByName ?? null,
    completionPercentage: snapshot.completionPercentage,
    changeSummary: snapshot.changeSummary,
    isCurrent: snapshot.validTo === null,
    isEffectiveToday: snapshot.validFrom <= today && (snapshot.validTo === null || snapshot.validTo > today),
  };
}

function snapshotToDetail(snapshot: SnapshotRow, publishedByName?: string | null): UnitTechnicalProfileSnapshotDetail {
  return {
    ...snapshotToSummary(snapshot, publishedByName),
    standardValues: snapshot.standardValues,
    customFieldValues: snapshot.customValues,
    customFieldDefinitions: (snapshot.customDefinitionSnapshot ?? []) as UnitTechnicalProfileCustomFieldDefinitionDto[],
  };
}

function missingPublishDetails(profile: UnitTechnicalProfileValues, definitions: DefinitionRow[], customValues: CustomFieldValues) {
  const missingFields = validateUnitTechnicalProfilePublishMinimum(profile);
  const missingCustomFields = missingRequiredUnitTechnicalProfileCustomFieldsForPublish(
    definitions.map(serializeDefinition),
    customValues,
  );
  return { missingFields, missingCustomFields };
}

async function createPublishSnapshot(
  tx: typeof db,
  req: Request,
  scope: Awaited<ReturnType<typeof resolveScope>>,
  profile: ProfileRow,
  definitions: DefinitionRow[],
  validFrom: string,
  changeSummary: string | null,
) {
  const [latestSnapshot] = await tx.select()
    .from(unitTechnicalProfileSnapshotsTable)
    .where(and(
      eq(unitTechnicalProfileSnapshotsTable.companyId, scope.companyId),
      eq(unitTechnicalProfileSnapshotsTable.unitId, scope.unitId),
    ))
    .orderBy(desc(unitTechnicalProfileSnapshotsTable.snapshotNumber))
    .limit(1)
    .for("update");

  if (latestSnapshot && validFrom <= latestSnapshot.validFrom) {
    return { status: "date-conflict" as const, latestSnapshot };
  }

  if (latestSnapshot && latestSnapshot.validTo === null) {
    await tx.update(unitTechnicalProfileSnapshotsTable)
      .set({ validTo: validFrom })
      .where(eq(unitTechnicalProfileSnapshotsTable.id, latestSnapshot.id));
  }

  const completion = calculateUnitTechnicalProfileCompletion(serializeProfile(profile, scope.companyId, scope.unitId));
  const [snapshot] = await tx.insert(unitTechnicalProfileSnapshotsTable)
    .values({
      companyId: scope.companyId,
      unitId: scope.unitId,
      sourceProfileId: profile.id,
      snapshotNumber: (latestSnapshot?.snapshotNumber ?? 0) + 1,
      profileVersion: profile.profileVersion,
      profileStatus: "published",
      validFrom,
      validTo: null,
      publishedAt: new Date(),
      publishedBy: scope.userId,
      standardValues: standardSnapshotValues(profile),
      customValues: profileCustomValues(profile),
      customDefinitionSnapshot: definitionSnapshot(definitions),
      completionPercentage: completion.ratio,
      changeSummary,
    })
    .returning();

  await writeAuditEvent(tx, {
    request: req,
    companyId: scope.companyId,
    unitId: scope.unitId,
    action: "unit_technical_profile.snapshot_created",
    entityType: "unit_technical_profile_snapshot",
    entityId: snapshot.id,
    changes: {
      previousSnapshotNumber: latestSnapshot?.snapshotNumber ?? null,
      snapshotNumber: snapshot.snapshotNumber,
      profileVersion: profile.profileVersion,
    },
    metadata: { validFrom, changeSummary, snapshotNumber: snapshot.snapshotNumber },
  });
  return { status: "ok" as const, snapshot };
}

function changedCustomValueCodes(before: CustomFieldValues, after: CustomFieldValues) {
  const codes = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...codes].filter((code) => JSON.stringify(before[code] ?? null) !== JSON.stringify(after[code] ?? null));
}

function patchValues(parsedBody: Record<string, unknown>): ProfilePatch {
  const patch: ProfilePatch = {};
  for (const field of PROFILE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(parsedBody, field)) {
      (patch as Record<string, unknown>)[field] = parsedBody[field];
    }
  }
  return patch;
}

function mergedProfileValues(
  current: UnitTechnicalProfileDto,
  updates: ProfilePatch,
): UnitTechnicalProfileValues {
  const valueFor = <Field extends keyof UnitTechnicalProfileValues>(field: Field): UnitTechnicalProfileValues[Field] =>
    Object.prototype.hasOwnProperty.call(updates, field)
      ? (updates as Partial<UnitTechnicalProfileValues>)[field] as UnitTechnicalProfileValues[Field]
      : current[field];

  return {
    facilityUseType: valueFor("facilityUseType"),
    mainActivity: valueFor("mainActivity"),
    buildingCount: valueFor("buildingCount"),
    totalEnclosedAreaM2: valueFor("totalEnclosedAreaM2"),
    heatedAreaM2: valueFor("heatedAreaM2"),
    cooledAreaM2: valueFor("cooledAreaM2"),
    openAreaM2: valueFor("openAreaM2"),
    personnelCount: valueFor("personnelCount"),
    averageDailyUsers: valueFor("averageDailyUsers"),
    dailyOperatingHours: valueFor("dailyOperatingHours"),
    weeklyOperatingDays: valueFor("weeklyOperatingDays"),
    annualOperatingDays: valueFor("annualOperatingDays"),
    shiftCount: valueFor("shiftCount"),
    shiftType: valueFor("shiftType"),
    seasonalOperationStatus: valueFor("seasonalOperationStatus"),
    insulationStatus: valueFor("insulationStatus"),
    heatingSystemType: valueFor("heatingSystemType"),
    coolingSystemType: valueFor("coolingSystemType"),
    domesticHotWaterSystem: valueFor("domesticHotWaterSystem"),
    buildingAutomationStatus: valueFor("buildingAutomationStatus"),
    compressedAirStatus: valueFor("compressedAirStatus"),
    steamSystemStatus: valueFor("steamSystemStatus"),
    generatorStatus: valueFor("generatorStatus"),
    renewableEnergyStatus: valueFor("renewableEnergyStatus"),
    mainProcessDescription: valueFor("mainProcessDescription"),
    energyInfrastructureDescription: valueFor("energyInfrastructureDescription"),
    knownEnergyIssues: valueFor("knownEnergyIssues"),
    technicalImprovements: valueFor("technicalImprovements"),
    plannedInfrastructureChanges: valueFor("plannedInfrastructureChanges"),
    profileStatus: valueFor("profileStatus"),
  };
}

type ImportMode = "update_non_empty";
type ImportIssueLevel = "error" | "warning";
type ImportIssue = {
  row: number;
  column?: string;
  fieldCode?: string;
  code: string;
  message: string;
  unitKey?: string;
  level: ImportIssueLevel;
};
type ImportRowPlan = {
  row: number;
  unitId: number;
  unitName: string;
  expectedProfileVersion: number | null;
  action: "create" | "update" | "no_change";
  standardValues: ProfilePatch;
  customFieldValues: CustomFieldValues;
  changedStandardFields: string[];
  changedCustomFieldCodes: string[];
  previousVersion: number;
  newVersion: number;
};
type ImportPreview = {
  mode: ImportMode;
  totalRows: number;
  validRows: number;
  errorRows: number;
  createCount: number;
  updateCount: number;
  noChangeCount: number;
  warningCount: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  rows: ImportRowPlan[];
  message: string;
};

const IMPORT_MODE: ImportMode = "update_non_empty";
const IMPORT_CLEAR_TOKEN = "__CLEAR__";
const MAX_IMPORT_ROWS = 500;
const MAX_IMPORT_COLUMNS = 80;
const MAX_IMPORT_SHEETS = 3;
const MAX_CUSTOM_IMPORT_FIELDS = 50;
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TECHNICAL_PROFILE_SHEET = "Teknik Profil";
const HELP_SHEET = "Aciklamalar";
const OPTIONS_SHEET = "Secenekler";
const TECHNICAL_STATUS_LABELS: Record<string, string> = {
  yes: "Var",
  no: "Yok",
  unknown: "Bilinmiyor",
  not_applicable: "Uygulanamaz",
};

function technicalProfileFieldOrder() {
  return UNIT_TECHNICAL_PROFILE_SECTIONS.flatMap((section) => [...section.fields]) as Array<Exclude<ProfileField, "profileStatus">>;
}

function columnLabel(code: string, label: string) {
  return `${label} [${code}]`;
}

function extractColumnCode(value: unknown) {
  const label = value === null || value === undefined ? "" : String(value).trim();
  const match = label.match(/\[([^\]]+)\]\s*$/);
  return match ? match[1].trim() : label;
}

function safeXlsxValue(value: unknown) {
  if (typeof value === "string") return sanitizeSpreadsheetText(value);
  return value;
}

function sanitizeFilenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "firma";
}

function todayForFilename() {
  return new Date().toISOString().slice(0, 10);
}

function cellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if ("formula" in value) return { formula: true };
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return value.result;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return value;
}

function isFormulaLike(value: unknown) {
  if (value && typeof value === "object" && "formula" in value) return true;
  return typeof value === "string" && /^[=+\-@\t\r]/.test(value.trim());
}

function asTrimmedString(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

function parseImportInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const raw = asTrimmedString(value);
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return Number.NaN;
}

function parseImportNumber(value: unknown) {
  if (typeof value === "number") return value;
  const raw = asTrimmedString(value).replace(",", ".");
  if (raw === "") return Number.NaN;
  return Number(raw);
}

function parseExpectedVersion(value: unknown) {
  const raw = asTrimmedString(value);
  if (raw === "") return null;
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function parseStandardImportValue(field: Exclude<ProfileField, "profileStatus">, rawValue: unknown) {
  if (rawValue === null || rawValue === undefined || asTrimmedString(rawValue) === "") return { present: false as const };
  if (asTrimmedString(rawValue) === IMPORT_CLEAR_TOKEN) return { present: true as const, value: null };
  if (technicalFields.includes(field as TechnicalField)) {
    const value = asTrimmedString(rawValue);
    if (!(UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES as readonly string[]).includes(value)) {
      return { present: true as const, error: "invalid_enum" as const, message: `${field} icin yes/no/unknown/not_applicable kullanin` };
    }
    return { present: true as const, value };
  }
  if (integerFields.has(field as NumericField)) {
    const value = parseImportInteger(rawValue);
    const limits = UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS[field as NumericField];
    if (!Number.isFinite(value)) return { present: true as const, error: "invalid_number" as const, message: `${field} tam sayi olmalidir` };
    if (value < limits.min || value > limits.max) return { present: true as const, error: "out_of_range" as const, message: `${field} ${limits.min}-${limits.max} araliginda olmalidir` };
    return { present: true as const, value };
  }
  if (numericFields.includes(field as NumericField)) {
    const value = parseImportNumber(rawValue);
    const limits = UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS[field as NumericField];
    if (!Number.isFinite(value)) return { present: true as const, error: "invalid_number" as const, message: `${field} sayi olmalidir` };
    if (value < limits.min || value > limits.max) return { present: true as const, error: "out_of_range" as const, message: `${field} ${limits.min}-${limits.max} araliginda olmalidir` };
    return { present: true as const, value };
  }
  const value = asTrimmedString(rawValue);
  const max = UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field as TextField];
  if (value.length > max) return { present: true as const, error: "text_too_long" as const, message: `${field} en fazla ${max} karakter olabilir` };
  return { present: true as const, value };
}

function normalizeCustomImportRaw(definition: UnitTechnicalProfileCustomFieldDefinitionDto, rawValue: unknown) {
  if (rawValue === null || rawValue === undefined || asTrimmedString(rawValue) === "") return { present: false as const };
  if (asTrimmedString(rawValue) === IMPORT_CLEAR_TOKEN) return { present: true as const, value: null };
  let normalizedRaw: unknown = rawValue;
  if (definition.fieldType === "multi_select") {
    const parts = asTrimmedString(rawValue).split("|").map((part) => part.trim()).filter(Boolean);
    normalizedRaw = parts;
  } else if (definition.fieldType === "date" && rawValue instanceof Date) {
    normalizedRaw = rawValue.toISOString().slice(0, 10);
  } else if (definition.fieldType !== "integer" && definition.fieldType !== "decimal" && definition.fieldType !== "unit_number") {
    normalizedRaw = asTrimmedString(rawValue);
  }
  const parsed = normalizeUnitTechnicalProfileCustomFieldValue(definition, normalizedRaw);
  if (!parsed.ok) return { present: true as const, error: "invalid_custom_value" as const, message: parsed.error };
  return { present: true as const, value: parsed.value };
}

async function resolveProfileCompanyScope(req: Request) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const requestedCompanyId = parseOptionalPositiveInteger(req.query.companyId, "companyId");
  if (!isSuperAdmin(role) && requestedCompanyId !== undefined) {
    throw new UnitTechnicalProfileScopeError(400, "Firma kapsami oturumdan alinir; companyId gonderilmemelidir");
  }
  if (isSuperAdmin(role) && requestedCompanyId === undefined) {
    throw new UnitTechnicalProfileScopeError(400, "Gecerli companyId zorunludur");
  }
  if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
    throw new UnitTechnicalProfileScopeError(403, "Birim yetkisi gerekli");
  }
  const companyId = isSuperAdmin(role) ? requestedCompanyId! : sessionCompanyId;
  const [company] = await db.select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) throw new UnitTechnicalProfileScopeError(404, "Sirket bulunamadi");
  const scopedUnitId = !isCompanyAdmin(role) && !isSuperAdmin(role) ? sessionUnitId! : undefined;
  return {
    role,
    userId: req.user!.userId,
    companyId,
    companyName: company.name,
    unitId: scopedUnitId,
    canImport: true,
    canExport: true,
  };
}

async function listScopedUnits(scope: Awaited<ReturnType<typeof resolveProfileCompanyScope>>, requestedUnitId?: number) {
  if (scope.unitId !== undefined && requestedUnitId !== undefined && scope.unitId !== requestedUnitId) {
    throw new UnitTechnicalProfileScopeError(403, "Yetki yok");
  }
  const conditions = [eq(unitsTable.companyId, scope.companyId)];
  if (requestedUnitId !== undefined) conditions.push(eq(unitsTable.id, requestedUnitId));
  if (scope.unitId !== undefined) conditions.push(eq(unitsTable.id, scope.unitId));
  const rows = await db.select({ id: unitsTable.id, name: unitsTable.name })
    .from(unitsTable)
    .where(and(...conditions))
    .orderBy(asc(unitsTable.name));
  if (requestedUnitId !== undefined && rows.length === 0) throw new UnitTechnicalProfileScopeError(404, "Birim bulunamadi");
  return rows;
}

async function activeDefinitions(companyId: number) {
  const definitions = await db.select()
    .from(unitTechnicalProfileFieldDefinitionsTable)
    .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, companyId))
    .orderBy(asc(unitTechnicalProfileFieldDefinitionsTable.sortOrder), asc(unitTechnicalProfileFieldDefinitionsTable.label));
  return definitions.filter((definition) => definition.isActive).map(serializeDefinition);
}

function buildImportColumns(definitions: UnitTechnicalProfileCustomFieldDefinitionDto[]) {
  const columns = [
    { code: "unitId", label: "Birim ID", type: "number" as const, width: 12 },
    { code: "unitName", label: "Birim Adi", type: "text" as const, width: 28 },
    { code: "expectedProfileVersion", label: "Beklenen Profil Versiyonu", type: "number" as const, width: 18 },
    ...technicalProfileFieldOrder().map((field) => ({
      code: field,
      label: UNIT_TECHNICAL_PROFILE_FIELD_LABELS[field],
      type: numericFields.includes(field as NumericField) || integerFields.has(field as NumericField) ? "number" as const : "text" as const,
      width: textFields.includes(field as TextField) ? 32 : 18,
    })),
    ...definitions.slice(0, MAX_CUSTOM_IMPORT_FIELDS).map((definition) => ({
      code: `custom:${definition.code}`,
      label: definition.label,
      type: definition.fieldType === "integer" || definition.fieldType === "decimal" || definition.fieldType === "unit_number" ? "number" as const : "text" as const,
      width: definition.fieldType === "long_text" ? 36 : 22,
    })),
  ];
  return columns;
}

async function buildProfileWorkbook(
  scope: Awaited<ReturnType<typeof resolveProfileCompanyScope>>,
  rows: Array<Record<string, unknown>>,
  definitions: UnitTechnicalProfileCustomFieldDefinitionDto[],
) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EMS";
  workbook.created = new Date();
  const columns = buildImportColumns(definitions);
  const profileSheet = workbook.addWorksheet(TECHNICAL_PROFILE_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  profileSheet.columns = columns.map((column) => ({
    key: column.code,
    header: columnLabel(column.code, column.label),
    width: column.width,
  }));
  profileSheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    profileSheet.addRow(columns.map((column) => safeXlsxValue(row[column.code])));
  }
  profileSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const help = workbook.addWorksheet(HELP_SHEET);
  help.columns = [
    { header: "Kolon kodu", key: "code", width: 28 },
    { header: "Etiket", key: "label", width: 34 },
    { header: "Aciklama", key: "description", width: 46 },
    { header: "Veri turu", key: "type", width: 18 },
    { header: "Birim", key: "unit", width: 14 },
    { header: "Zorunlu mu?", key: "required", width: 14 },
    { header: "Publish icin zorunlu mu?", key: "publishRequired", width: 22 },
    { header: "Izin verilen degerler", key: "allowed", width: 38 },
    { header: "Ornek", key: "example", width: 20 },
    { header: "Limit", key: "limit", width: 22 },
  ];
  help.getRow(1).font = { bold: true };
  help.addRow({ code: "unitId", label: "Birim ID", description: "Session/company kapsami icinde cozulur. Company ID kabul edilmez.", type: "integer", required: "Evet", example: rows[0]?.unitId ?? 1 });
  help.addRow({ code: "unitName", label: "Birim Adi", description: "Salt referans. Uyusmazsa uyari uretilir; eslestirme unitId ile yapilir.", type: "text", required: "Hayir" });
  help.addRow({ code: "expectedProfileVersion", label: "Beklenen Profil Versiyonu", description: "Mevcut profil icin zorunlu. Yeni profil icin bos veya 0.", type: "integer", required: "Mevcut profil icin evet" });
  for (const field of technicalProfileFieldOrder()) {
    const limits = UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS[field as NumericField];
    help.addRow({
      code: field,
      label: UNIT_TECHNICAL_PROFILE_FIELD_LABELS[field],
      description: `Bos hucre mevcut degeri degistirmez; temizlemek icin ${IMPORT_CLEAR_TOKEN}.`,
      type: technicalFields.includes(field as TechnicalField) ? "enum" : numericFields.includes(field as NumericField) ? "number" : "text",
      unit: UNIT_TECHNICAL_PROFILE_FIELD_UNITS[field] ?? "",
      required: "Hayir",
      publishRequired: validateUnitTechnicalProfilePublishMinimum({ [field]: "x" } as Partial<UnitTechnicalProfileValues>).includes(field) ? "Evet" : "Hayir",
      allowed: technicalFields.includes(field as TechnicalField) ? UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES.join("|") : "",
      example: technicalFields.includes(field as TechnicalField) ? "yes" : "",
      limit: limits ? `${limits.min}-${limits.max}` : UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field as TextField] ? `max ${UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field as TextField]}` : "",
    });
  }
  for (const definition of definitions) {
    help.addRow({
      code: `custom:${definition.code}`,
      label: definition.label,
      description: definition.description ?? `Firma ozel alan. Bos hucre degistirmez; temizlemek icin ${IMPORT_CLEAR_TOKEN}.`,
      type: definition.fieldType,
      unit: definition.unitLabel ?? "",
      required: "Hayir",
      publishRequired: definition.isRequiredForPublish ? "Evet" : "Hayir",
      allowed: definition.options.filter((option) => option.isActive).map((option) => option.code).join("|"),
      example: definition.fieldType === "multi_select" ? "option_a|option_b" : "",
      limit: JSON.stringify(definition.validationConfig ?? {}),
    });
  }

  const options = workbook.addWorksheet(OPTIONS_SHEET);
  options.columns = [
    { header: "Alan kodu", key: "fieldCode", width: 28 },
    { header: "Option code", key: "code", width: 22 },
    { header: "Option label", key: "label", width: 34 },
    { header: "Aktif mi?", key: "isActive", width: 12 },
  ];
  options.getRow(1).font = { bold: true };
  for (const status of UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES) {
    options.addRow({ fieldCode: "technical_status", code: status, label: TECHNICAL_STATUS_LABELS[status], isActive: "Evet" });
  }
  for (const definition of definitions) {
    for (const option of definition.options) {
      options.addRow({ fieldCode: `custom:${definition.code}`, code: option.code, label: safeXlsxValue(option.label), isActive: option.isActive ? "Evet" : "Hayir" });
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function rowIsEmpty(row: ExcelJS.Row, columnCount: number) {
  for (let index = 1; index <= columnCount; index += 1) {
    if (asTrimmedString(cellValue(row.getCell(index))) !== "") return false;
  }
  return true;
}

async function parseProfileImportWorkbook(
  req: Request,
  file: Express.Multer.File,
  mode: ImportMode,
): Promise<ImportPreview> {
  const scope = await resolveProfileCompanyScope(req);
  if (!file.originalname.toLowerCase().endsWith(".xlsx") || file.originalname.toLowerCase().endsWith(".xlsm")) {
    throw new UnitTechnicalProfileScopeError(400, "Yalniz .xlsx dosyasi kabul edilir");
  }
  if (file.mimetype && file.mimetype !== XLSX_MIME_TYPE && file.mimetype !== "application/octet-stream") {
    throw new UnitTechnicalProfileScopeError(400, "Gecersiz XLSX MIME tipi");
  }
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = file.buffer.buffer.slice(
    file.buffer.byteOffset,
    file.buffer.byteOffset + file.buffer.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  if (workbook.worksheets.length > MAX_IMPORT_SHEETS) {
    throw new UnitTechnicalProfileScopeError(400, `En fazla ${MAX_IMPORT_SHEETS} sheet kabul edilir`);
  }
  const sheet = workbook.getWorksheet(TECHNICAL_PROFILE_SHEET) ?? workbook.worksheets[0];
  if (!sheet) throw new UnitTechnicalProfileScopeError(400, "Teknik Profil sheet'i bulunamadi");
  if (sheet.columnCount > MAX_IMPORT_COLUMNS) {
    throw new UnitTechnicalProfileScopeError(400, `En fazla ${MAX_IMPORT_COLUMNS} kolon kabul edilir`);
  }
  const headers = Array.from({ length: sheet.columnCount }, (_, idx) => extractColumnCode(cellValue(sheet.getRow(1).getCell(idx + 1))));
  const issues: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const standardCodes = new Set<string>(technicalProfileFieldOrder());
  const definitions = await activeDefinitions(scope.companyId);
  const definitionsByCode = new Map(definitions.map((definition) => [definition.code, definition]));
  const units = await listScopedUnits(scope);
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const profiles = await db.select()
    .from(unitTechnicalProfilesTable)
    .where(eq(unitTechnicalProfilesTable.companyId, scope.companyId));
  const profileByUnitId = new Map(profiles.map((profile) => [profile.unitId, profile]));
  const seenUnits = new Set<number>();
  const plans: ImportRowPlan[] = [];
  let totalRows = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (rowIsEmpty(row, headers.length)) continue;
    totalRows += 1;
    if (totalRows > MAX_IMPORT_ROWS) {
      issues.push({ row: rowNumber, code: "row_limit_exceeded", message: `En fazla ${MAX_IMPORT_ROWS} satir import edilebilir`, level: "error" });
      break;
    }
    const rowIssues: ImportIssue[] = [];
    const rowWarnings: ImportIssue[] = [];
    const rawByCode = new Map<string, unknown>();
    headers.forEach((code, index) => {
      const raw = cellValue(row.getCell(index + 1));
      if (isFormulaLike(raw)) {
        rowIssues.push({ row: rowNumber, column: code, fieldCode: code, code: "formula_not_allowed", message: "Formul veya formul gibi baslayan hucre kabul edilmez", level: "error" });
      }
      if (code) rawByCode.set(code, raw);
    });
    for (const code of headers) {
      if (!code || code === "unitId" || code === "unitName" || code === "expectedProfileVersion" || standardCodes.has(code) || code.startsWith("custom:")) continue;
      rowIssues.push({ row: rowNumber, column: code, fieldCode: code, code: "unknown_column", message: `Bilinmeyen kolon: ${code}`, level: "error" });
    }
    const unitKey = asTrimmedString(rawByCode.get("unitId"));
    const unitId = parseImportInteger(rawByCode.get("unitId"));
    if (!unitKey || !Number.isSafeInteger(unitId) || unitId <= 0) {
      rowIssues.push({ row: rowNumber, column: "unitId", fieldCode: "unitId", code: "unit_not_found", message: "Gecerli Birim ID zorunludur", unitKey, level: "error" });
    }
    const unit = Number.isSafeInteger(unitId) ? unitsById.get(unitId) : undefined;
    if (Number.isSafeInteger(unitId) && !unit) {
      rowIssues.push({ row: rowNumber, column: "unitId", fieldCode: "unitId", code: scope.unitId !== undefined ? "unit_forbidden" : "unit_not_found", message: "Birim bulunamadi veya yetki disinda", unitKey, level: "error" });
    }
    if (unit && seenUnits.has(unit.id)) {
      rowIssues.push({ row: rowNumber, column: "unitId", fieldCode: "unitId", code: "duplicate_unit", message: "Ayni dosyada birim tekrarlanamaz", unitKey, level: "error" });
    }
    if (unit) seenUnits.add(unit.id);
    const unitName = asTrimmedString(rawByCode.get("unitName"));
    if (unit && unitName && unitName !== unit.name) {
      rowWarnings.push({ row: rowNumber, column: "unitName", fieldCode: "unitName", code: "unit_name_mismatch", message: `Birim adi referansi farkli; sistemdeki ad: ${unit.name}`, unitKey, level: "warning" });
    }
    const existing = unit ? profileByUnitId.get(unit.id) ?? null : null;
    const expectedProfileVersion = parseExpectedVersion(rawByCode.get("expectedProfileVersion"));
    if (existing && expectedProfileVersion !== existing.profileVersion) {
      rowIssues.push({ row: rowNumber, column: "expectedProfileVersion", fieldCode: "expectedProfileVersion", code: "version_conflict", message: `Guncel profil versiyonu ${existing.profileVersion}; dosyadaki beklenen versiyon ${expectedProfileVersion ?? "bos"}`, unitKey, level: "error" });
    }
    if (!existing && expectedProfileVersion !== null && expectedProfileVersion !== 0) {
      rowIssues.push({ row: rowNumber, column: "expectedProfileVersion", fieldCode: "expectedProfileVersion", code: "version_conflict", message: "Yeni profil icin beklenen versiyon bos veya 0 olmalidir", unitKey, level: "error" });
    }

    const standardValues: ProfilePatch = {};
    for (const field of technicalProfileFieldOrder()) {
      const parsed = parseStandardImportValue(field, rawByCode.get(field));
      if (!parsed.present) continue;
      if ("error" in parsed && parsed.error !== undefined) {
        rowIssues.push({ row: rowNumber, column: field, fieldCode: field, code: parsed.error, message: parsed.message ?? "Gecersiz deger", unitKey, level: "error" });
      } else {
        (standardValues as Record<string, unknown>)[field] = parsed.value;
      }
    }
    const customValues: CustomFieldValues = {};
    for (const [code, raw] of rawByCode.entries()) {
      if (!code.startsWith("custom:")) continue;
      const fieldCode = code.slice("custom:".length);
      const definition = definitionsByCode.get(fieldCode);
      if (!definition) {
        rowIssues.push({ row: rowNumber, column: code, fieldCode: code, code: "unknown_custom_field", message: `Aktif firma ozel alan bulunamadi: ${fieldCode}`, unitKey, level: "error" });
        continue;
      }
      const parsed = normalizeCustomImportRaw(definition, raw);
      if (!parsed.present) continue;
      if ("error" in parsed && parsed.error !== undefined) {
        rowIssues.push({ row: rowNumber, column: code, fieldCode: code, code: parsed.error, message: parsed.message ?? "Gecersiz ozel alan degeri", unitKey, level: "error" });
      } else {
        customValues[fieldCode] = parsed.value;
      }
    }
    issues.push(...rowIssues);
    warnings.push(...rowWarnings);
    if (rowIssues.length > 0 || !unit) continue;

    const base = serializeProfile(existing, scope.companyId, unit.id);
    const merged = mergedProfileValues(base, standardValues);
    const currentCustom = profileCustomValues(existing);
    const mergedCustom = { ...currentCustom, ...customValues };
    const changedStandardFields = Object.keys(changedAuditFields(base, merged, technicalProfileFieldOrder()));
    const changedCustomFieldCodes = changedCustomValueCodes(currentCustom, mergedCustom);
    const hasChanges = changedStandardFields.length > 0 || changedCustomFieldCodes.length > 0;
    plans.push({
      row: rowNumber,
      unitId: unit.id,
      unitName: unit.name,
      expectedProfileVersion,
      action: existing ? hasChanges ? "update" : "no_change" : "create",
      standardValues,
      customFieldValues: customValues,
      changedStandardFields,
      changedCustomFieldCodes,
      previousVersion: existing?.profileVersion ?? 0,
      newVersion: existing ? existing.profileVersion + (hasChanges ? 1 : 0) : 1,
    });
  }

  const errorRows = new Set(issues.map((issue) => issue.row)).size;
  return {
    mode,
    totalRows,
    validRows: plans.length,
    errorRows,
    createCount: plans.filter((plan) => plan.action === "create").length,
    updateCount: plans.filter((plan) => plan.action === "update").length,
    noChangeCount: plans.filter((plan) => plan.action === "no_change").length,
    warningCount: warnings.length,
    errors: issues,
    warnings,
    rows: plans,
    message: issues.length > 0 ? "Hatalar duzeltilmeden import uygulanamaz" : "Preview basarili; degisiklikler henuz yayimlanmadi",
  };
}

router.get("/unit-technical-profiles/import/template", requireAuth, async (req, res) => {
  try {
    const scope = await resolveProfileCompanyScope(req);
    const requestedUnitId = parseOptionalPositiveInteger(req.query.unitId, "unitId");
    const units = await listScopedUnits(scope, requestedUnitId);
    const definitions = req.query.includeCustomFields === "false" ? [] : await activeDefinitions(scope.companyId);
    const rows = units.map((unit) => ({
      unitId: unit.id,
      unitName: unit.name,
      expectedProfileVersion: "",
    }));
    const buffer = await buildProfileWorkbook(scope, rows, definitions);
    const filename = requestedUnitId !== undefined
      ? `teknik-profil-template-unit-${requestedUnitId}-${todayForFilename()}.xlsx`
      : `teknik-profiller-template-${sanitizeFilenamePart(scope.companyName)}-${todayForFilename()}.xlsx`;
    sendXlsxResponse(res, filename, buffer);
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Teknik profil sablonu olusturulamadi" });
  }
});

router.get("/unit-technical-profiles/export", requireAuth, async (req, res) => {
  try {
    const scope = await resolveProfileCompanyScope(req);
    const requestedUnitId = parseOptionalPositiveInteger(req.query.unitId, "unitId");
    const units = await listScopedUnits(scope, requestedUnitId);
    const definitions = await activeDefinitions(scope.companyId);
    const profiles = await db.select()
      .from(unitTechnicalProfilesTable)
      .where(eq(unitTechnicalProfilesTable.companyId, scope.companyId));
    const profileByUnitId = new Map(profiles.map((profile) => [profile.unitId, profile]));
    const rows = units.map((unit) => {
      const profile = profileByUnitId.get(unit.id) ?? null;
      const serialized = serializeProfile(profile, scope.companyId, unit.id);
      const customValues = profileCustomValues(profile);
      const row: Record<string, unknown> = {
        unitId: unit.id,
        unitName: unit.name,
        expectedProfileVersion: serialized.profileVersion,
      };
      for (const field of technicalProfileFieldOrder()) row[field] = serialized[field] ?? "";
      for (const definition of definitions) {
        const value = customValues[definition.code];
        row[`custom:${definition.code}`] = Array.isArray(value) ? value.join("|") : value ?? "";
      }
      return row;
    });
    const buffer = await buildProfileWorkbook(scope, rows, definitions);
    const filename = requestedUnitId !== undefined
      ? `teknik-profil-unit-${requestedUnitId}-${todayForFilename()}.xlsx`
      : `teknik-profiller-${sanitizeFilenamePart(scope.companyName)}-${todayForFilename()}.xlsx`;
    await writeAuditEvent(db, {
      request: req,
      companyId: scope.companyId,
      unitId: requestedUnitId ?? null,
      action: "unit_technical_profile.exported",
      entityType: "unit_technical_profile",
      entityId: requestedUnitId ?? null,
      metadata: { format: "xlsx", unitCount: units.length, includeCustomFields: true },
    });
    sendXlsxResponse(res, filename, buffer);
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Teknik profil export alinamadi" });
  }
});

router.post("/unit-technical-profiles/import/preview", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "XLSX dosyasi zorunludur" });
      return;
    }
    const mode = req.body?.mode === undefined || req.body.mode === IMPORT_MODE ? IMPORT_MODE : null;
    if (mode === null) {
      res.status(400).json({ error: "V1 yalniz update_non_empty import modunu destekler" });
      return;
    }
    const preview = await parseProfileImportWorkbook(req, req.file, mode);
    res.json(preview);
  } catch (error) {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Dosya boyutu 2 MB limitini asamaz" : "Dosya yukleme hatasi" });
      return;
    }
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Teknik profil import preview alinamadi" });
  }
});

router.post("/unit-technical-profiles/import", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "XLSX dosyasi zorunludur" });
      return;
    }
    if (req.body?.confirm !== "true") {
      res.status(400).json({ error: "Import uygulamak icin confirm=true zorunludur" });
      return;
    }
    const mode = req.body?.mode === undefined || req.body.mode === IMPORT_MODE ? IMPORT_MODE : null;
    if (mode === null) {
      res.status(400).json({ error: "V1 yalniz update_non_empty import modunu destekler" });
      return;
    }
    const preview = await parseProfileImportWorkbook(req, req.file, mode);
    if (preview.errors.length > 0) {
      res.status(422).json(preview);
      return;
    }
    const scope = await resolveProfileCompanyScope(req);
    const result = await db.transaction(async (tx) => {
      const applied: ImportRowPlan[] = [];
      for (const plan of preview.rows) {
        if (plan.action === "no_change") {
          applied.push(plan);
          continue;
        }
        const [existing] = await tx.select()
          .from(unitTechnicalProfilesTable)
          .where(and(
            eq(unitTechnicalProfilesTable.companyId, scope.companyId),
            eq(unitTechnicalProfilesTable.unitId, plan.unitId),
          ))
          .limit(1)
          .for("update");
        if (existing && existing.profileVersion !== plan.expectedProfileVersion) {
          throw new UnitTechnicalProfileScopeError(409, `Birim ${plan.unitId} profil versiyonu degisti`);
        }
        const now = new Date();
        if (!existing) {
          const [created] = await tx.insert(unitTechnicalProfilesTable)
            .values({
              companyId: scope.companyId,
              unitId: plan.unitId,
              ...plan.standardValues,
              customValues: plan.customFieldValues,
              profileStatus: "draft",
              profileVersion: 1,
              createdBy: scope.userId,
              updatedAt: now,
              updatedBy: scope.userId,
            })
            .returning();
          applied.push({ ...plan, newVersion: created.profileVersion });
          continue;
        }
        const nextCustomValues = { ...profileCustomValues(existing), ...plan.customFieldValues };
        const [updated] = await tx.update(unitTechnicalProfilesTable)
          .set({
            ...plan.standardValues,
            customValues: nextCustomValues,
            profileStatus: "draft",
            profileVersion: existing.profileVersion + 1,
            updatedAt: now,
            updatedBy: scope.userId,
          })
          .where(and(
            eq(unitTechnicalProfilesTable.id, existing.id),
            eq(unitTechnicalProfilesTable.profileVersion, existing.profileVersion),
          ))
          .returning();
        if (!updated) throw new UnitTechnicalProfileScopeError(409, `Birim ${plan.unitId} profil versiyonu degisti`);
        applied.push({ ...plan, previousVersion: existing.profileVersion, newVersion: updated.profileVersion });
      }
      const changedStandardFields = [...new Set(applied.flatMap((plan) => plan.changedStandardFields))];
      const changedCustomFieldCodes = [...new Set(applied.flatMap((plan) => plan.changedCustomFieldCodes))];
      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        unitId: preview.rows.length === 1 ? preview.rows[0].unitId : null,
        action: "unit_technical_profile.import_applied",
        entityType: "unit_technical_profile_import",
        entityId: null,
        changes: {
          createCount: preview.createCount,
          updateCount: preview.updateCount,
          noChangeCount: preview.noChangeCount,
          changedStandardFields,
          changedCustomFieldCodes,
        },
        metadata: {
          mode,
          totalRows: preview.totalRows,
          validRows: preview.validRows,
          affectedUnitIds: applied.filter((plan) => plan.action !== "no_change").map((plan) => plan.unitId).slice(0, 20),
          affectedUnitCount: applied.filter((plan) => plan.action !== "no_change").length,
          originalName: req.file?.originalname,
        },
      });
      return { ...preview, rows: applied, message: "Import current taslak profile uygulandi; snapshot gecmisi degismedi ve publish otomatik yapilmadi." };
    });
    res.json(result);
  } catch (error) {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Dosya boyutu 2 MB limitini asamaz" : "Dosya yukleme hatasi" });
      return;
    }
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Teknik profil import uygulanamadi" });
  }
});

router.get("/unit-technical-profiles/:unitId", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const scope = await resolveScope(req, unitId);
    const [profile] = await db.select()
      .from(unitTechnicalProfilesTable)
      .where(and(
        eq(unitTechnicalProfilesTable.companyId, scope.companyId),
        eq(unitTechnicalProfilesTable.unitId, scope.unitId),
      ))
      .limit(1);
    res.json(await responseFor(profile ?? null, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

router.get("/unit-technical-profiles/:unitId/history", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const scope = await resolveScope(req, unitId);
    const limit = Math.min(parseOptionalPositiveInteger(req.query.limit, "limit") ?? 20, 100);
    const offset = parseOptionalPositiveInteger(req.query.offset, "offset") ?? 0;
    const rows = await db.select({
      snapshot: unitTechnicalProfileSnapshotsTable,
      publishedByName: usersTable.name,
    })
      .from(unitTechnicalProfileSnapshotsTable)
      .leftJoin(usersTable, eq(usersTable.id, unitTechnicalProfileSnapshotsTable.publishedBy))
      .where(and(
        eq(unitTechnicalProfileSnapshotsTable.companyId, scope.companyId),
        eq(unitTechnicalProfileSnapshotsTable.unitId, scope.unitId),
      ))
      .orderBy(desc(unitTechnicalProfileSnapshotsTable.snapshotNumber))
      .limit(limit + 1)
      .offset(offset);
    const items = rows.slice(0, limit).map((row) => snapshotToSummary(row.snapshot, row.publishedByName));
    res.json({
      items,
      total: offset + items.length + (rows.length > limit ? 1 : 0),
      limit,
      offset,
      hasNext: rows.length > limit,
      permissions: { canEdit: scope.canEdit, canPublish: scope.canPublish },
    });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Teknik profil tarihcesi alinamadi" });
  }
});

router.get("/unit-technical-profiles/:unitId/effective", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const scope = await resolveScope(req, unitId);
    const date = parseIsoDate(req.query.date, "date");
    const [row] = await db.select({
      snapshot: unitTechnicalProfileSnapshotsTable,
      publishedByName: usersTable.name,
    })
      .from(unitTechnicalProfileSnapshotsTable)
      .leftJoin(usersTable, eq(usersTable.id, unitTechnicalProfileSnapshotsTable.publishedBy))
      .where(and(
        eq(unitTechnicalProfileSnapshotsTable.companyId, scope.companyId),
        eq(unitTechnicalProfileSnapshotsTable.unitId, scope.unitId),
        lte(unitTechnicalProfileSnapshotsTable.validFrom, date),
        or(isNull(unitTechnicalProfileSnapshotsTable.validTo), gt(unitTechnicalProfileSnapshotsTable.validTo, date)),
      ))
      .orderBy(desc(unitTechnicalProfileSnapshotsTable.validFrom))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Bu tarih icin yayimlanmis teknik profil snapshot'i yok", code: "not_found" });
      return;
    }
    res.json({ date, snapshot: snapshotToDetail(row.snapshot, row.publishedByName) });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Gecerli teknik profil alinamadi" });
  }
});

router.get("/unit-technical-profiles/:unitId/history/:snapshotId", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const snapshotId = parsePositiveInteger(req.params.snapshotId, "snapshotId");
    const scope = await resolveScope(req, unitId);
    const [row] = await db.select({
      snapshot: unitTechnicalProfileSnapshotsTable,
      publishedByName: usersTable.name,
    })
      .from(unitTechnicalProfileSnapshotsTable)
      .leftJoin(usersTable, eq(usersTable.id, unitTechnicalProfileSnapshotsTable.publishedBy))
      .where(and(
        eq(unitTechnicalProfileSnapshotsTable.id, snapshotId),
        eq(unitTechnicalProfileSnapshotsTable.companyId, scope.companyId),
        eq(unitTechnicalProfileSnapshotsTable.unitId, scope.unitId),
      ))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Snapshot bulunamadi" });
      return;
    }
    res.json({
      snapshot: snapshotToDetail(row.snapshot, row.publishedByName),
      permissions: { canEdit: scope.canEdit, canPublish: scope.canPublish },
    });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Snapshot detayi alinamadi" });
  }
});

router.post("/unit-technical-profiles/:unitId/publish", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const scope = await resolveScope(req, unitId);
    if (!scope.canPublish) {
      res.status(403).json({ error: "Teknik profili yayimlama yetkiniz yok" });
      return;
    }
    const parsed = unitTechnicalProfilePublishRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz yayinlama verisi" });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [profile] = await tx.select()
        .from(unitTechnicalProfilesTable)
        .where(and(
          eq(unitTechnicalProfilesTable.companyId, scope.companyId),
          eq(unitTechnicalProfilesTable.unitId, scope.unitId),
        ))
        .limit(1)
        .for("update");
      if (!profile) return { status: "not-found" as const };
      if (profile.profileVersion !== parsed.data.expectedProfileVersion) {
        return { status: "conflict" as const, profile };
      }

      const definitions = await tx.select()
        .from(unitTechnicalProfileFieldDefinitionsTable)
        .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId))
        .orderBy(
          asc(unitTechnicalProfileFieldDefinitionsTable.sortOrder),
          asc(unitTechnicalProfileFieldDefinitionsTable.label),
        );
      const merged = mergedProfileValues(serializeProfile(profile, scope.companyId, scope.unitId), { profileStatus: "published" });
      const missing = missingPublishDetails(merged, definitions, profileCustomValues(profile));
      if (missing.missingFields.length > 0 || missing.missingCustomFields.length > 0) {
        return { status: "publish-validation" as const, ...missing };
      }

      const now = new Date();
      const [updated] = await tx.update(unitTechnicalProfilesTable)
        .set({
          profileStatus: "published",
          profileVersion: profile.profileVersion + 1,
          updatedAt: now,
          updatedBy: scope.userId,
        })
        .where(and(
          eq(unitTechnicalProfilesTable.id, profile.id),
          eq(unitTechnicalProfilesTable.profileVersion, parsed.data.expectedProfileVersion),
        ))
        .returning();
      if (!updated) return { status: "conflict" as const, profile };

      const snapshotResult = await createPublishSnapshot(
        tx as unknown as typeof db,
        req,
        scope,
        updated,
        definitions,
        parsed.data.validFrom,
        parsed.data.changeSummary ?? null,
      );
      if (snapshotResult.status !== "ok") return snapshotResult;

      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        unitId: scope.unitId,
        action: "unit_technical_profile.published",
        entityType: "unit_technical_profile",
        entityId: updated.id,
        changes: {
          changedFields: profile.profileStatus === "published" ? [] : ["profileStatus"],
          previousVersion: profile.profileVersion,
          newVersion: updated.profileVersion,
        },
        metadata: {
          validFrom: parsed.data.validFrom,
          changeSummary: parsed.data.changeSummary ?? null,
          snapshotNumber: snapshotResult.snapshot.snapshotNumber,
          snapshotId: snapshotResult.snapshot.id,
        },
      });

      return { status: "ok" as const, profile: updated, snapshot: snapshotResult.snapshot };
    });

    if (result.status === "not-found") {
      res.status(404).json({ error: "Yayimlanacak teknik profil bulunamadi" });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({
        error: "Birim teknik profili baska bir oturum tarafindan guncellendi. Guncel bilgileri yeniden yukleyin.",
        profile: serializeProfile(result.profile, scope.companyId, scope.unitId),
        customFieldDefinitions: await getDefinitionsForProfile(scope.companyId, profileCustomValues(result.profile)),
        customFieldValues: profileCustomValues(result.profile),
      });
      return;
    }
    if (result.status === "date-conflict") {
      res.status(409).json({
        error: `validFrom son yayim tarihinden buyuk olmalidir (${result.latestSnapshot.validFrom}).`,
        code: "valid_from_conflict",
        latestSnapshot: snapshotToSummary(result.latestSnapshot),
      });
      return;
    }
    if (result.status === "publish-validation") {
      const missingCustomFields = result.missingCustomFields ?? [];
      res.status(422).json({
        error: "Teknik profil yayinlamak icin minimum alanlar tamamlanmalidir.",
        missingFields: [
          ...result.missingFields,
          ...missingCustomFields.map((field) => field.code),
        ],
        missingFieldDetails: [
          ...result.missingFields.map((code) => ({ kind: "standard" as const, code })),
          ...missingCustomFields,
        ],
      });
      return;
    }

    res.json({
      ...(await responseFor(result.profile, scope)),
      snapshot: snapshotToSummary(result.snapshot, req.user?.name ?? null),
    });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Teknik profil yayimlanamadi" });
  }
});

router.patch("/unit-technical-profiles/:unitId", requireAuth, async (req, res) => {
  try {
    const unitId = parsePositiveInteger(req.params.unitId, "unitId");
    const scope = await resolveScope(req, unitId);
    const parsed = unitTechnicalProfilePatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz teknik profil verisi" });
      return;
    }
    if (parsed.data.profileStatus === "published" && !scope.canPublish) {
      res.status(403).json({ error: "Teknik profili yayimlama yetkiniz yok" });
      return;
    }

    const updates = patchValues(parsed.data);
    const customFieldPatch = parsed.data.customFieldValues;
    const expectedProfileVersion = parsed.data.expectedProfileVersion;
    const result = await db.transaction(async (tx) => {
      const [unit] = await tx.select({ id: unitsTable.id })
        .from(unitsTable)
        .where(and(eq(unitsTable.id, scope.unitId), eq(unitsTable.companyId, scope.companyId)))
        .limit(1)
        .for("update");
      if (!unit) return { status: "not-found" as const };

      const [existing] = await tx.select()
        .from(unitTechnicalProfilesTable)
        .where(and(
          eq(unitTechnicalProfilesTable.companyId, scope.companyId),
          eq(unitTechnicalProfilesTable.unitId, scope.unitId),
        ))
        .limit(1)
        .for("update");

      const now = new Date();
      if (!existing) {
        if (expectedProfileVersion !== 0) return { status: "conflict" as const, profile: null };
        if (updates.profileStatus === "published") {
          const merged = mergedProfileValues(createDefaultUnitTechnicalProfile(scope.companyId, scope.unitId), updates);
          const definitions = await tx.select()
            .from(unitTechnicalProfileFieldDefinitionsTable)
            .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId));
          const customValidation = validateUnitTechnicalProfileCustomFieldValues(
            definitions.map(serializeDefinition),
            customFieldPatch ?? {},
          );
          if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
          const missingStandardFields = validateUnitTechnicalProfilePublishMinimum(merged);
          const missingCustomFields = missingRequiredUnitTechnicalProfileCustomFieldsForPublish(
            definitions.map(serializeDefinition),
            customValidation.value,
          );
          if (missingStandardFields.length > 0 || missingCustomFields.length > 0) {
            return { status: "publish-validation" as const, missingFields: missingStandardFields, missingCustomFields };
          }
        }
        const definitions = await tx.select()
          .from(unitTechnicalProfileFieldDefinitionsTable)
          .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId));
        const customValidation = customFieldPatch === undefined
          ? { ok: true as const, value: {} as CustomFieldValues }
          : validateUnitTechnicalProfileCustomFieldValues(definitions.map(serializeDefinition), customFieldPatch);
        if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
        const [created] = await tx.insert(unitTechnicalProfilesTable)
          .values({
            companyId: scope.companyId,
            unitId: scope.unitId,
            ...updates,
            customValues: customValidation.value,
            profileStatus: typeof updates.profileStatus === "string" ? updates.profileStatus : "draft",
            profileVersion: 1,
            createdAt: now,
            createdBy: scope.userId,
            updatedAt: now,
            updatedBy: scope.userId,
          })
          .onConflictDoNothing({ target: unitTechnicalProfilesTable.unitId })
          .returning();
        if (!created) return { status: "conflict" as const, profile: null };

        await writeAuditEvent(tx, {
          request: req,
          companyId: scope.companyId,
          unitId: scope.unitId,
          action: created.profileStatus === "published" ? "unit_technical_profile.published" : "unit_technical_profile.created",
          entityType: "unit_technical_profile",
          entityId: created.id,
          changes: {
            changedFields: Object.keys(updates),
            previousVersion: 0,
            newVersion: created.profileVersion,
          },
        });
        if (Object.keys(customValidation.value).length > 0) {
          await writeAuditEvent(tx, {
            request: req,
            companyId: scope.companyId,
            unitId: scope.unitId,
            action: "unit_technical_profile.custom_values_updated",
            entityType: "unit_technical_profile",
            entityId: created.id,
            changes: {
              changedCodes: Object.keys(customValidation.value),
              previousVersion: 0,
              newVersion: created.profileVersion,
            },
          });
        }
        return { status: "ok" as const, profile: created };
      }

      if (existing.profileVersion !== expectedProfileVersion) {
        return { status: "conflict" as const, profile: existing };
      }

      if (existing.profileStatus !== "published" && updates.profileStatus === "published") {
        const merged = mergedProfileValues(serializeProfile(existing, scope.companyId, scope.unitId), updates);
        const definitions = await tx.select()
          .from(unitTechnicalProfileFieldDefinitionsTable)
          .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId));
        const existingCustomValues = profileCustomValues(existing);
        const customValidation = customFieldPatch === undefined
          ? { ok: true as const, value: existingCustomValues }
          : validateUnitTechnicalProfileCustomFieldValues(definitions.map(serializeDefinition), customFieldPatch);
        if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
        const mergedCustomValues = customFieldPatch === undefined ? existingCustomValues : { ...existingCustomValues, ...customValidation.value };
        const missingStandardFields = validateUnitTechnicalProfilePublishMinimum(merged);
        const missingCustomFields = missingRequiredUnitTechnicalProfileCustomFieldsForPublish(
          definitions.map(serializeDefinition),
          mergedCustomValues,
        );
        if (missingStandardFields.length > 0 || missingCustomFields.length > 0) {
          return { status: "publish-validation" as const, missingFields: missingStandardFields, missingCustomFields };
        }
      }

      const definitions = await tx.select()
        .from(unitTechnicalProfileFieldDefinitionsTable)
        .where(eq(unitTechnicalProfileFieldDefinitionsTable.companyId, scope.companyId));
      const existingCustomValues = profileCustomValues(existing);
      const customValidation = customFieldPatch === undefined
        ? { ok: true as const, value: {} as CustomFieldValues }
        : validateUnitTechnicalProfileCustomFieldValues(definitions.map(serializeDefinition), customFieldPatch);
      if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
      const nextCustomValues = customFieldPatch === undefined
        ? existingCustomValues
        : { ...existingCustomValues, ...customValidation.value };

      const nextProfile = {
        ...existing,
        ...updates,
        customValues: nextCustomValues,
        updatedAt: now,
        updatedBy: scope.userId,
        profileVersion: existing.profileVersion + 1,
      };
      const changedFields = Object.keys(changedAuditFields(existing, nextProfile, [...PROFILE_FIELDS]));
      const changedCustomCodes = changedCustomValueCodes(existingCustomValues, nextCustomValues);
      if (changedFields.length === 0 && changedCustomCodes.length === 0) return { status: "ok" as const, profile: existing };

      const [updated] = await tx.update(unitTechnicalProfilesTable)
        .set({
          ...updates,
          customValues: nextCustomValues,
          profileVersion: existing.profileVersion + 1,
          updatedAt: now,
          updatedBy: scope.userId,
        })
        .where(and(
          eq(unitTechnicalProfilesTable.id, existing.id),
          eq(unitTechnicalProfilesTable.profileVersion, expectedProfileVersion),
        ))
        .returning();
      if (!updated) return { status: "conflict" as const, profile: existing };

      const action: AuditAction = existing.profileStatus !== "published" && updated.profileStatus === "published"
        ? "unit_technical_profile.published"
        : "unit_technical_profile.updated";
      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        unitId: scope.unitId,
        action,
        entityType: "unit_technical_profile",
        entityId: updated.id,
        changes: {
          changedFields,
          previousVersion: existing.profileVersion,
          newVersion: updated.profileVersion,
        },
      });
      if (changedCustomCodes.length > 0) {
        await writeAuditEvent(tx, {
          request: req,
          companyId: scope.companyId,
          unitId: scope.unitId,
          action: "unit_technical_profile.custom_values_updated",
          entityType: "unit_technical_profile",
          entityId: updated.id,
          changes: {
            changedCodes: changedCustomCodes,
            previousVersion: existing.profileVersion,
            newVersion: updated.profileVersion,
          },
        });
      }
      return { status: "ok" as const, profile: updated };
    });

    if (result.status === "not-found") {
      res.status(404).json({ error: "Birim bulunamadi" });
      return;
    }
    if (result.status === "conflict") {
      const [current] = result.profile ? [result.profile] : await db.select()
        .from(unitTechnicalProfilesTable)
        .where(and(
          eq(unitTechnicalProfilesTable.companyId, scope.companyId),
          eq(unitTechnicalProfilesTable.unitId, scope.unitId),
        ))
        .limit(1);
      res.status(409).json({
        error: "Birim teknik profili baska bir oturum tarafindan guncellendi. Guncel bilgileri yeniden yukleyin.",
        profile: serializeProfile(current ?? null, scope.companyId, scope.unitId),
        customFieldDefinitions: await getDefinitionsForProfile(scope.companyId, profileCustomValues(current ?? null)),
        customFieldValues: profileCustomValues(current ?? null),
      });
      return;
    }
    if (result.status === "custom-validation") {
      res.status(400).json({ error: result.error });
      return;
    }
    if (result.status === "publish-validation") {
      const missingCustomFields = result.missingCustomFields ?? [];
      res.status(422).json({
        error: "Teknik profil yayinlamak icin minimum alanlar tamamlanmalidir.",
        missingFields: [
          ...result.missingFields,
          ...missingCustomFields.map((field) => field.code),
        ],
        missingFieldDetails: [
          ...result.missingFields.map((code) => ({ kind: "standard" as const, code })),
          ...missingCustomFields,
        ],
      });
      return;
    }

    res.json(await responseFor(result.profile, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Sunucu hatasi" });
  }
});

export default router;
