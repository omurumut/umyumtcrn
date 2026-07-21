import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, type SQL } from "drizzle-orm";
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
  companiesTable,
} from "@workspace/db";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CUSTOM_BOOLEAN_STATUSES,
  EQUIPMENT_ENERGY_SOURCE_RELATION_ROLES,
  EQUIPMENT_KINDS,
  EQUIPMENT_MEASUREMENT_CONFIDENCES,
  EQUIPMENT_MEASUREMENT_METHODS,
  EQUIPMENT_METER_RELATION_ROLES,
  EQUIPMENT_NUMERIC_LIMITS,
  EQUIPMENT_OPERATIONAL_STATUSES,
  EQUIPMENT_SEASONAL_OPERATION_STATUSES,
  EQUIPMENT_STATUSES,
  EQUIPMENT_TEXT_LIMITS,
  equipmentArchiveRequestSchema,
  equipmentCreateRequestSchema,
  equipmentListQuerySchema,
  equipmentPatchRequestSchema,
  equipmentReactivateRequestSchema,
  type EquipmentArchiveRequest,
  type EquipmentCreateRequest,
  type EquipmentPatchRequest,
  type EquipmentReactivateRequest,
  validateEquipmentCustomFieldValues,
  changedEquipmentCustomValueCodes,
  normalizeUnitTechnicalProfileCustomFieldValue,
  type EquipmentCustomFieldDefinitionDto,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth.js";
import { changedAuditFields, writeAuditEvent, type AuditAction } from "../lib/audit.js";
import { sanitizeSpreadsheetText, sendXlsxResponse } from "../lib/xlsx-export.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

class EquipmentScopeError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type EquipmentRow = typeof equipmentTable.$inferSelect;
type MeterLinkRow = typeof equipmentMeterLinksTable.$inferSelect;
type SourceLinkRow = typeof equipmentEnergySourceLinksTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MeterLinkDetail = MeterLinkRow & {
  meterName?: string | null;
  meterType?: string | null;
  meterUnit?: string | null;
  meterEnergySourceName?: string | null;
  unitId?: number | null;
  unitName?: string | null;
  subUnitId?: number | null;
  subUnitName?: string | null;
  isActive?: boolean;
};
type SourceLinkDetail = SourceLinkRow & {
  energySourceName?: string | null;
  energySourceType?: string | null;
  unitId?: number | null;
  unitName?: string | null;
  subUnitId?: number | null;
  subUnitName?: string | null;
  isActive?: boolean;
};
type DependencyWarning = { code: string; count?: number; ids?: number[] };

const EQUIPMENT_MUTABLE_FIELDS = [
  "subUnitId",
  "name",
  "equipmentKind",
  "category",
  "subType",
  "status",
  "assetCode",
  "manufacturer",
  "brand",
  "model",
  "serialNumber",
  "tagCode",
  "locationText",
  "buildingText",
  "processText",
  "parentEquipmentId",
  "energyUseGroupId",
  "customValues",
  "measurementMethod",
  "measurementConfidence",
  "ratedPowerValue",
  "ratedPowerUnit",
  "installedPowerKw",
  "capacityValue",
  "capacityUnit",
  "nominalEfficiencyPercent",
  "operationalStatus",
  "dailyOperatingHours",
  "annualOperatingHours",
  "averageLoadPercent",
  "seasonalOperationStatus",
  "purchaseDate",
  "commissioningDate",
  "manufactureYear",
  "expectedLifeYears",
  "plannedReplacementYear",
  "isEnergyIntensive",
  "isCritical",
  "criticalityReason",
  "savingPotential",
  "technicalNotes",
  "maintenanceNotes",
  "efficiencyOpportunities",
  "plannedImprovements",
] as const;

type ImportMode = "update_non_empty";
type ImportAction = "create" | "update" | "no_change" | "error";
type ImportIssue = {
  sheet: string;
  row?: number;
  column?: string;
  code: string;
  message: string;
  severity: "error" | "warning";
};
type EquipmentImportPlan = {
  row: number;
  equipmentCode: string;
  name?: string | null;
  action: ImportAction;
  changedFields: string[];
  customFieldCodes: string[];
  expectedEquipmentVersion?: number | null;
  currentEquipmentVersion?: number | null;
  data?: EquipmentCreateRequest | EquipmentPatchRequest;
  relationPolicy: {
    meters: "preserve" | "replace";
    energySources: "preserve" | "replace";
  };
  issues: ImportIssue[];
};
type ImportPreview = {
  previewHash: string;
  mode: ImportMode;
  fileName: string;
  fileSize: number;
  scope: { companyId: number; unitId: number | null; role: string };
  sheetSummaries: Array<{ sheet: string; rows: number }>;
  totalRows: number;
  createCount: number;
  updateCount: number;
  noChangeCount: number;
  errorCount: number;
  warningCount: number;
  canApply: boolean;
  rows: EquipmentImportPlan[];
  issues: ImportIssue[];
  relationSummary: {
    meterReplaceCount: number;
    energySourceReplaceCount: number;
  };
};

const IMPORT_MODE: ImportMode = "update_non_empty";
const IMPORT_CLEAR_TOKEN = "__CLEAR__";
const RELATION_CLEAR_TOKEN = "__CLEAR_ALL__";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EQUIPMENT_SHEET = "Ekipmanlar";
const METER_RELATION_SHEET = "Ekipman-Sayac";
const ENERGY_SOURCE_RELATION_SHEET = "Ekipman-Enerji";
const REFERENCES_SHEET = "Referanslar";
const HELP_SHEET = "Aciklamalar";
const MAX_IMPORT_ROWS = 1000;
const MAX_RELATION_IMPORT_ROWS = 5000;
const MAX_IMPORT_COLUMNS = 120;
const MAX_IMPORT_SHEETS = 5;
const MAX_CUSTOM_IMPORT_FIELDS = 80;
const MAX_CELL_TEXT_LENGTH = 2000;

const STANDARD_IMPORT_COLUMNS = [
  "equipment_code",
  "name",
  "equipment_kind",
  "category",
  "sub_type",
  "status",
  "asset_code",
  "manufacturer",
  "brand",
  "model",
  "serial_number",
  "tag_code",
  "unit_code",
  "sub_unit_code",
  "sub_unit_name",
  "location_text",
  "building_text",
  "process_text",
  "parent_equipment_code",
  "energy_use_group_code",
  "measurement_method",
  "measurement_confidence",
  "rated_power_value",
  "rated_power_unit",
  "installed_power_kw",
  "capacity_value",
  "capacity_unit",
  "nominal_efficiency_percent",
  "operational_status",
  "daily_operating_hours",
  "annual_operating_hours",
  "average_load_percent",
  "seasonal_operation_status",
  "purchase_date",
  "commissioning_date",
  "manufacture_year",
  "expected_life_years",
  "planned_replacement_year",
  "is_energy_intensive",
  "is_critical",
  "criticality_reason",
  "saving_potential",
  "technical_notes",
  "maintenance_notes",
  "efficiency_opportunities",
  "planned_improvements",
  "equipment_version",
] as const;

const COLUMN_TO_FIELD: Partial<Record<typeof STANDARD_IMPORT_COLUMNS[number], keyof EquipmentCreateRequest>> = {
  equipment_code: "equipmentCode",
  name: "name",
  equipment_kind: "equipmentKind",
  category: "category",
  sub_type: "subType",
  status: "status",
  asset_code: "assetCode",
  manufacturer: "manufacturer",
  brand: "brand",
  model: "model",
  serial_number: "serialNumber",
  tag_code: "tagCode",
  location_text: "locationText",
  building_text: "buildingText",
  process_text: "processText",
  measurement_method: "measurementMethod",
  measurement_confidence: "measurementConfidence",
  rated_power_value: "ratedPowerValue",
  rated_power_unit: "ratedPowerUnit",
  installed_power_kw: "installedPowerKw",
  capacity_value: "capacityValue",
  capacity_unit: "capacityUnit",
  nominal_efficiency_percent: "nominalEfficiencyPercent",
  operational_status: "operationalStatus",
  daily_operating_hours: "dailyOperatingHours",
  annual_operating_hours: "annualOperatingHours",
  average_load_percent: "averageLoadPercent",
  seasonal_operation_status: "seasonalOperationStatus",
  purchase_date: "purchaseDate",
  commissioning_date: "commissioningDate",
  manufacture_year: "manufactureYear",
  expected_life_years: "expectedLifeYears",
  planned_replacement_year: "plannedReplacementYear",
  is_energy_intensive: "isEnergyIntensive",
  is_critical: "isCritical",
  criticality_reason: "criticalityReason",
  saving_potential: "savingPotential",
  technical_notes: "technicalNotes",
  maintenance_notes: "maintenanceNotes",
  efficiency_opportunities: "efficiencyOpportunities",
  planned_improvements: "plannedImprovements",
};

const EQUIPMENT_REQUIRED_CREATE_COLUMNS = new Set(["equipment_code", "name", "category"]);
const EQUIPMENT_ENUMS: Partial<Record<typeof STANDARD_IMPORT_COLUMNS[number], readonly string[]>> = {
  equipment_kind: EQUIPMENT_KINDS,
  category: EQUIPMENT_CATEGORIES,
  status: EQUIPMENT_STATUSES,
  measurement_method: EQUIPMENT_MEASUREMENT_METHODS,
  measurement_confidence: EQUIPMENT_MEASUREMENT_CONFIDENCES,
  operational_status: EQUIPMENT_OPERATIONAL_STATUSES,
  seasonal_operation_status: EQUIPMENT_SEASONAL_OPERATION_STATUSES,
};
const EQUIPMENT_NUMBER_COLUMNS = new Set([
  "rated_power_value",
  "installed_power_kw",
  "capacity_value",
  "nominal_efficiency_percent",
  "daily_operating_hours",
  "annual_operating_hours",
  "average_load_percent",
]);
const EQUIPMENT_INTEGER_COLUMNS = new Set(["manufacture_year", "expected_life_years", "planned_replacement_year"]);
const EQUIPMENT_BOOLEAN_COLUMNS = new Set(["is_energy_intensive", "is_critical"]);
const EQUIPMENT_DATE_COLUMNS = new Set(["purchase_date", "commissioning_date"]);
const EQUIPMENT_TEXT_LIMIT_BY_COLUMN: Partial<Record<typeof STANDARD_IMPORT_COLUMNS[number], number>> = {
  equipment_code: EQUIPMENT_TEXT_LIMITS.equipmentCode,
  name: EQUIPMENT_TEXT_LIMITS.name,
  sub_type: EQUIPMENT_TEXT_LIMITS.subType,
  asset_code: EQUIPMENT_TEXT_LIMITS.assetCode,
  manufacturer: EQUIPMENT_TEXT_LIMITS.manufacturer,
  brand: EQUIPMENT_TEXT_LIMITS.brand,
  model: EQUIPMENT_TEXT_LIMITS.model,
  serial_number: EQUIPMENT_TEXT_LIMITS.serialNumber,
  tag_code: EQUIPMENT_TEXT_LIMITS.tagCode,
  location_text: EQUIPMENT_TEXT_LIMITS.locationText,
  building_text: EQUIPMENT_TEXT_LIMITS.buildingText,
  process_text: EQUIPMENT_TEXT_LIMITS.processText,
  rated_power_unit: EQUIPMENT_TEXT_LIMITS.ratedPowerUnit,
  capacity_unit: EQUIPMENT_TEXT_LIMITS.capacityUnit,
  criticality_reason: EQUIPMENT_TEXT_LIMITS.criticalityReason,
  saving_potential: EQUIPMENT_TEXT_LIMITS.savingPotential,
  technical_notes: EQUIPMENT_TEXT_LIMITS.technicalNotes,
  maintenance_notes: EQUIPMENT_TEXT_LIMITS.maintenanceNotes,
  efficiency_opportunities: EQUIPMENT_TEXT_LIMITS.efficiencyOpportunities,
  planned_improvements: EQUIPMENT_TEXT_LIMITS.plannedImprovements,
};

function isCompanyAdmin(role: string) {
  return role === "admin" || role === "kontrol_admin";
}

function isSuperAdmin(role: string) {
  return role === "superadmin";
}

function canArchive(role: string) {
  return isCompanyAdmin(role) || isSuperAdmin(role);
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new EquipmentScopeError(400, `Gecersiz ${field}`);
}

function stableUnitCode(id: number) {
  return `unit:${id}`;
}

function stableSubUnitCode(id: number) {
  return `subunit:${id}`;
}

function stableMeterCode(id: number) {
  return `meter:${id}`;
}

function stableSourceCode(id: number) {
  return `source:${id}`;
}

function parseStableId(value: string, prefix: string) {
  const match = new RegExp(`^${prefix}:(\\d+)$`).exec(value.trim().toLowerCase());
  return match ? Number(match[1]) : null;
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

function fileHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
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

function extractColumnCode(value: unknown) {
  const label = asTrimmedString(value);
  const match = label.match(/\[([^\]]+)\]\s*$/);
  return match ? match[1].trim() : label;
}

function columnLabel(code: string, label: string) {
  return `${label} [${code}]`;
}

function rowIsEmpty(row: ExcelJS.Row, columnCount: number) {
  for (let index = 1; index <= columnCount; index += 1) {
    if (asTrimmedString(cellValue(row.getCell(index))) !== "") return false;
  }
  return true;
}

function parseImportNumber(value: unknown) {
  if (typeof value === "number") return value;
  const raw = asTrimmedString(value).replace(",", ".");
  if (raw === "") return Number.NaN;
  return Number(raw);
}

function parseImportInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const raw = asTrimmedString(value);
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return Number.NaN;
}

function parseImportBoolean(value: unknown) {
  const raw = asTrimmedString(value).toLowerCase();
  if (["yes", "true", "1", "evet"].includes(raw)) return true;
  if (["no", "false", "0", "hayir", "hayır"].includes(raw)) return false;
  return null;
}

function dateOnlyFromCell(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = asTrimmedString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function issue(sheet: string, row: number | undefined, column: string | undefined, code: string, message: string, severity: "error" | "warning" = "error"): ImportIssue {
  return { sheet, row, column, code, message, severity };
}

function parseExpectedVersion(value: unknown) {
  const raw = asTrimmedString(value);
  if (raw === "") return null;
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function parseStandardImportValue(column: typeof STANDARD_IMPORT_COLUMNS[number], rawValue: unknown) {
  if (rawValue === null || rawValue === undefined || asTrimmedString(rawValue) === "") return { present: false as const };
  if (asTrimmedString(rawValue) === IMPORT_CLEAR_TOKEN) return { present: true as const, value: null };
  const enumValues = EQUIPMENT_ENUMS[column];
  if (enumValues) {
    const value = asTrimmedString(rawValue);
    if (!enumValues.includes(value)) return { present: true as const, error: "invalid_enum" as const, message: `${column} icin izin verilen degerlerden birini kullanin: ${enumValues.join("|")}` };
    return { present: true as const, value };
  }
  if (EQUIPMENT_BOOLEAN_COLUMNS.has(column)) {
    const value = parseImportBoolean(rawValue);
    if (value === null) return { present: true as const, error: "invalid_boolean" as const, message: `${column} icin yes/no kullanin` };
    return { present: true as const, value };
  }
  if (EQUIPMENT_INTEGER_COLUMNS.has(column)) {
    const value = parseImportInteger(rawValue);
    const field = COLUMN_TO_FIELD[column] as keyof typeof EQUIPMENT_NUMERIC_LIMITS | undefined;
    const limits = field ? EQUIPMENT_NUMERIC_LIMITS[field] : undefined;
    if (!Number.isFinite(value)) return { present: true as const, error: "invalid_number" as const, message: `${column} tam sayi olmalidir` };
    if (limits && (value < limits.min || value > limits.max)) return { present: true as const, error: "out_of_range" as const, message: `${column} ${limits.min}-${limits.max} araliginda olmalidir` };
    return { present: true as const, value };
  }
  if (EQUIPMENT_NUMBER_COLUMNS.has(column)) {
    const value = parseImportNumber(rawValue);
    const field = COLUMN_TO_FIELD[column] as keyof typeof EQUIPMENT_NUMERIC_LIMITS | undefined;
    const limits = field ? EQUIPMENT_NUMERIC_LIMITS[field] : undefined;
    if (!Number.isFinite(value)) return { present: true as const, error: "invalid_number" as const, message: `${column} sayi olmalidir` };
    if (limits && (value < limits.min || value > limits.max)) return { present: true as const, error: "out_of_range" as const, message: `${column} ${limits.min}-${limits.max} araliginda olmalidir` };
    return { present: true as const, value };
  }
  if (EQUIPMENT_DATE_COLUMNS.has(column)) {
    const value = dateOnlyFromCell(rawValue);
    if (value === null) return { present: true as const, error: "invalid_date" as const, message: `${column} YYYY-MM-DD olmalidir` };
    return { present: true as const, value };
  }
  const value = asTrimmedString(rawValue);
  const max = EQUIPMENT_TEXT_LIMIT_BY_COLUMN[column] ?? MAX_CELL_TEXT_LENGTH;
  if (value.length > max) return { present: true as const, error: "text_too_long" as const, message: `${column} en fazla ${max} karakter olabilir` };
  return { present: true as const, value };
}

function normalizeCustomImportRaw(definition: EquipmentCustomFieldDefinitionDto, rawValue: unknown) {
  if (rawValue === null || rawValue === undefined || asTrimmedString(rawValue) === "") return { present: false as const };
  if (asTrimmedString(rawValue) === IMPORT_CLEAR_TOKEN) return { present: true as const, value: null };
  let normalizedRaw: unknown = rawValue;
  if (definition.fieldType === "multi_select") {
    normalizedRaw = asTrimmedString(rawValue).split("|").map((part) => part.trim()).filter(Boolean);
  } else if (definition.fieldType === "date") {
    normalizedRaw = dateOnlyFromCell(rawValue) ?? asTrimmedString(rawValue);
  } else if (definition.fieldType !== "integer" && definition.fieldType !== "decimal" && definition.fieldType !== "unit_number") {
    normalizedRaw = asTrimmedString(rawValue);
  }
  const parsed = normalizeUnitTechnicalProfileCustomFieldValue(definition, normalizedRaw);
  if (!parsed.ok) return { present: true as const, error: "invalid_custom_value" as const, message: parsed.error };
  return { present: true as const, value: parsed.value };
}

function handleScopeError(res: Response, error: unknown) {
  if (!(error instanceof EquipmentScopeError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

async function resolveCompanyScope(req: Request) {
  const { role, companyId: sessionCompanyId, unitId: sessionUnitId } = req.user!;
  const requestedCompanyId = req.query.companyId === undefined
    ? undefined
    : parsePositiveInteger(req.query.companyId, "companyId");

  if (!isSuperAdmin(role) && requestedCompanyId !== undefined) {
    throw new EquipmentScopeError(400, "Firma kapsami oturumdan alinir; companyId gonderilmemelidir");
  }
  if (isSuperAdmin(role) && requestedCompanyId === undefined) {
    throw new EquipmentScopeError(400, "Gecerli companyId zorunludur");
  }
  if (!isCompanyAdmin(role) && !isSuperAdmin(role) && sessionUnitId === null) {
    throw new EquipmentScopeError(403, "Birim yetkisi gerekli");
  }

  const companyId = isSuperAdmin(role) ? requestedCompanyId! : sessionCompanyId;
  const [company] = await db.select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);
  if (!company) throw new EquipmentScopeError(404, "Sirket bulunamadi");

  return {
    role,
    userId: req.user!.userId,
    companyId,
    companyName: company.name,
    standardUnitId: !isCompanyAdmin(role) && !isSuperAdmin(role) ? sessionUnitId! : null,
    canEdit: true,
    canArchive: canArchive(role),
  };
}

async function resolveRecordScope(req: Request, equipmentId: number) {
  const scope = await resolveCompanyScope(req);
  const conditions = [
    eq(equipmentTable.id, equipmentId),
    eq(equipmentTable.companyId, scope.companyId),
  ];
  if (scope.standardUnitId !== null) conditions.push(eq(equipmentTable.unitId, scope.standardUnitId));
  const [equipment] = await db.select().from(equipmentTable).where(and(...conditions)).limit(1);
  if (!equipment) throw new EquipmentScopeError(404, "Ekipman bulunamadi");
  return { ...scope, equipment };
}

function permissions(scope: Awaited<ReturnType<typeof resolveCompanyScope>>, equipment?: EquipmentRow | null) {
  return {
    canEdit: scope.canEdit && equipment?.status !== "archived",
    canArchive: scope.canArchive && equipment?.status !== "archived",
    canReactivate: scope.canArchive && equipment?.status === "archived",
  };
}

function serializeEquipment(row: EquipmentRow) {
  return {
    ...row,
    customValues: equipmentCustomValues(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function equipmentCustomValues(equipment: EquipmentRow | null) {
  const values = equipment?.customValues;
  return values && typeof values === "object" && !Array.isArray(values) ? values : {};
}

function serializeDefinition(row: typeof equipmentFieldDefinitionsTable.$inferSelect): EquipmentCustomFieldDefinitionDto {
  return {
    id: row.id,
    companyId: row.companyId,
    code: row.code,
    label: row.label,
    description: row.description,
    section: row.section as EquipmentCustomFieldDefinitionDto["section"],
    fieldType: row.fieldType as EquipmentCustomFieldDefinitionDto["fieldType"],
    unitLabel: row.unitLabel,
    options: (row.options ?? []).map((option, index) => ({ ...option, displayOrder: option.displayOrder ?? index })),
    isRequired: row.isRequired,
    isActive: row.isActive,
    displayOrder: row.displayOrder,
    validationConfig: row.validationConfig ?? {},
    definitionVersion: row.definitionVersion,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    archivedBy: row.archivedBy,
  };
}

async function getDefinitionsForEquipment(companyId: number, customValues: Record<string, unknown>) {
  const rows = await db.select().from(equipmentFieldDefinitionsTable).where(eq(equipmentFieldDefinitionsTable.companyId, companyId));
  return rows
    .filter((row) => row.isActive || Object.prototype.hasOwnProperty.call(customValues, row.code))
    .sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label))
    .map(serializeDefinition);
}

async function normalizeEquipmentCustomPatch(companyId: number, existingValues: Record<string, unknown>, patch: Record<string, unknown> | undefined) {
  if (patch === undefined) return { ok: true as const, value: existingValues, changedCodes: [] as string[] };
  const definitions = await db.select().from(equipmentFieldDefinitionsTable).where(eq(equipmentFieldDefinitionsTable.companyId, companyId));
  const inactiveExistingCodes = new Set(Object.keys(existingValues));
  const validation = validateEquipmentCustomFieldValues(definitions.map(serializeDefinition), patch, {
    allowInactiveExistingCodes: inactiveExistingCodes,
    enforceRequired: true,
  });
  if (!validation.ok) return validation;
  const nextValues = { ...existingValues };
  for (const [code, value] of Object.entries(validation.value)) {
    if (value === null) delete nextValues[code];
    else nextValues[code] = value;
  }
  return { ok: true as const, value: nextValues, changedCodes: changedEquipmentCustomValueCodes(existingValues, nextValues) };
}

function serializeMeterLink(row: MeterLinkDetail) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function serializeSourceLink(row: SourceLinkDetail) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

function patchValues(data: EquipmentPatchRequest) {
  const patch: Partial<typeof equipmentTable.$inferInsert> = {};
  for (const field of EQUIPMENT_MUTABLE_FIELDS) {
    if (field in data) {
      (patch as Record<string, unknown>)[field] = (data as Record<string, unknown>)[field];
    }
  }
  return patch;
}

function createValues(data: EquipmentCreateRequest, companyId: number, unitId: number, userId: number) {
  const now = new Date();
  return {
    companyId,
    unitId,
    subUnitId: data.subUnitId ?? null,
    equipmentCode: data.equipmentCode,
    name: data.name,
    equipmentKind: data.equipmentKind,
    category: data.category,
    subType: data.subType ?? null,
    status: data.status,
    assetCode: data.assetCode ?? null,
    manufacturer: data.manufacturer ?? null,
    brand: data.brand ?? null,
    model: data.model ?? null,
    serialNumber: data.serialNumber ?? null,
    tagCode: data.tagCode ?? null,
    locationText: data.locationText ?? null,
    buildingText: data.buildingText ?? null,
    processText: data.processText ?? null,
    parentEquipmentId: data.parentEquipmentId ?? null,
    energyUseGroupId: data.energyUseGroupId ?? null,
    customValues: data.customValues ?? {},
    measurementMethod: data.measurementMethod,
    measurementConfidence: data.measurementConfidence,
    ratedPowerValue: data.ratedPowerValue ?? null,
    ratedPowerUnit: data.ratedPowerUnit ?? null,
    installedPowerKw: data.installedPowerKw ?? null,
    capacityValue: data.capacityValue ?? null,
    capacityUnit: data.capacityUnit ?? null,
    nominalEfficiencyPercent: data.nominalEfficiencyPercent ?? null,
    operationalStatus: data.operationalStatus ?? null,
    dailyOperatingHours: data.dailyOperatingHours ?? null,
    annualOperatingHours: data.annualOperatingHours ?? null,
    averageLoadPercent: data.averageLoadPercent ?? null,
    seasonalOperationStatus: data.seasonalOperationStatus ?? null,
    purchaseDate: data.purchaseDate ?? null,
    commissioningDate: data.commissioningDate ?? null,
    manufactureYear: data.manufactureYear ?? null,
    expectedLifeYears: data.expectedLifeYears ?? null,
    plannedReplacementYear: data.plannedReplacementYear ?? null,
    isEnergyIntensive: data.isEnergyIntensive,
    isCritical: data.isCritical,
    criticalityReason: data.criticalityReason ?? null,
    savingPotential: data.savingPotential ?? null,
    technicalNotes: data.technicalNotes ?? null,
    maintenanceNotes: data.maintenanceNotes ?? null,
    efficiencyOpportunities: data.efficiencyOpportunities ?? null,
    plannedImprovements: data.plannedImprovements ?? null,
    equipmentVersion: 1,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    archivedAt: data.status === "archived" ? now : null,
    archivedBy: data.status === "archived" ? userId : null,
  } satisfies typeof equipmentTable.$inferInsert;
}

function dateYear(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(value);
  return match ? Number(match[1]) : null;
}

function validateLifecycleFields(values: {
  status?: string | null;
  operationalStatus?: string | null;
  purchaseDate?: string | null;
  commissioningDate?: string | null;
  manufactureYear?: number | null;
  expectedLifeYears?: number | null;
  plannedReplacementYear?: number | null;
}) {
  const currentYear = new Date().getUTCFullYear();
  if (values.status === "archived" && values.operationalStatus === "running") {
    throw new EquipmentScopeError(400, "Arsivli ekipman running operasyon durumunda olamaz");
  }
  if (values.manufactureYear !== null && values.manufactureYear !== undefined) {
    if (values.manufactureYear < 1900 || values.manufactureYear > currentYear + 1) {
      throw new EquipmentScopeError(400, "Uretim yili makul aralikta olmalidir");
    }
  }
  const purchaseYear = dateYear(values.purchaseDate);
  const commissioningYear = dateYear(values.commissioningDate);
  if (values.manufactureYear !== null && values.manufactureYear !== undefined && purchaseYear !== null && purchaseYear < values.manufactureYear) {
    throw new EquipmentScopeError(400, "Satin alma tarihi uretim yilindan once olamaz");
  }
  if (values.plannedReplacementYear !== null && values.plannedReplacementYear !== undefined) {
    if (values.manufactureYear !== null && values.manufactureYear !== undefined && values.plannedReplacementYear < values.manufactureYear) {
      throw new EquipmentScopeError(400, "Planlanan yenileme yili uretim yilindan once olamaz");
    }
    if (commissioningYear !== null && values.plannedReplacementYear < commissioningYear) {
      throw new EquipmentScopeError(400, "Planlanan yenileme yili devreye alma yilindan once olamaz");
    }
  }
}

async function validateUnit(scope: Awaited<ReturnType<typeof resolveCompanyScope>>, unitId: number) {
  if (scope.standardUnitId !== null && unitId !== scope.standardUnitId) {
    throw new EquipmentScopeError(403, "Yetki yok");
  }
  const [unit] = await db.select({ id: unitsTable.id, active: unitsTable.active })
    .from(unitsTable)
    .where(and(eq(unitsTable.id, unitId), eq(unitsTable.companyId, scope.companyId)))
    .limit(1);
  if (!unit) throw new EquipmentScopeError(isSuperAdmin(scope.role) ? 403 : 404, "Birim bulunamadi");
  return unit;
}

async function validateRelations(params: {
  tx: Tx | typeof db;
  companyId: number;
  unitId: number;
  equipmentId?: number;
  subUnitId: number | null | undefined;
  parentEquipmentId: number | null | undefined;
  energyUseGroupId: number | null | undefined;
  meterLinks: EquipmentCreateRequest["meterLinks"] | undefined;
  energySourceLinks: EquipmentCreateRequest["energySourceLinks"] | undefined;
}) {
  const { tx, companyId, unitId, equipmentId, subUnitId, parentEquipmentId, energyUseGroupId, meterLinks, energySourceLinks } = params;
  if (subUnitId !== undefined && subUnitId !== null) {
    const [subUnit] = await tx.select({ id: subUnitsTable.id })
      .from(subUnitsTable)
      .where(and(eq(subUnitsTable.id, subUnitId), eq(subUnitsTable.companyId, companyId), eq(subUnitsTable.unitId, unitId)))
      .limit(1);
    if (!subUnit) throw new EquipmentScopeError(400, "Alt birim secilen birime ait degil");
  }

  if (energyUseGroupId !== undefined && energyUseGroupId !== null) {
    const [group] = await tx.select({
      companyId: energyUseGroupsTable.companyId,
      unitId: energyUseGroupsTable.unitId,
      subUnitId: energyUseGroupsTable.subUnitId,
      isActive: energyUseGroupsTable.isActive,
    }).from(energyUseGroupsTable).where(eq(energyUseGroupsTable.id, energyUseGroupId)).limit(1);
    if (!group || group.companyId !== companyId) throw new EquipmentScopeError(400, "Enerji kullanim grubu secilen sirkete ait degil");
    if (group.unitId !== null && group.unitId !== unitId) throw new EquipmentScopeError(400, "Enerji kullanim grubu secilen birime ait degil");
    if (subUnitId !== undefined && subUnitId !== null && group.subUnitId !== null && group.subUnitId !== subUnitId) {
      throw new EquipmentScopeError(400, "Enerji kullanim grubu secilen alt birime ait degil");
    }
  }

  if (parentEquipmentId !== undefined && parentEquipmentId !== null) {
    if (equipmentId !== undefined && parentEquipmentId === equipmentId) throw new EquipmentScopeError(400, "Ekipman kendisinin parent kaydi olamaz");
    const [parent] = await tx.select({
      id: equipmentTable.id,
      companyId: equipmentTable.companyId,
      unitId: equipmentTable.unitId,
      status: equipmentTable.status,
      parentEquipmentId: equipmentTable.parentEquipmentId,
    }).from(equipmentTable).where(eq(equipmentTable.id, parentEquipmentId)).limit(1).for("update");
    if (!parent || parent.companyId !== companyId || parent.unitId !== unitId) {
      throw new EquipmentScopeError(404, "Parent ekipman bulunamadi");
    }
    if (parent.status === "archived") throw new EquipmentScopeError(409, "Arsivli parent ekipmana baglanti kurulamaz");
    if (equipmentId !== undefined) await assertNoParentCycle(tx, equipmentId, parentEquipmentId);
  }

  if (meterLinks !== undefined) {
    const meterIds = meterLinks.map((link) => link.meterId);
    if (new Set(meterIds).size !== meterIds.length) throw new EquipmentScopeError(400, "Ayni meter birden fazla baglanamaz");
    if (meterLinks.filter((link) => link.isPrimary).length > 1) throw new EquipmentScopeError(400, "Bir ekipman icin tek primary meter olabilir");
    if (meterIds.length > 0) {
      const meters = await tx.select({ id: metersTable.id, companyId: metersTable.companyId, unitId: metersTable.unitId })
        .from(metersTable)
        .where(inArray(metersTable.id, meterIds));
      const byId = new Map(meters.map((meter) => [meter.id, meter]));
      for (const meterId of meterIds) {
        const meter = byId.get(meterId);
        if (!meter || meter.companyId !== companyId || meter.unitId !== unitId) {
          throw new EquipmentScopeError(400, "Meter secilen sirket/birim ile uyumlu degil");
        }
      }
    }
  }

  if (energySourceLinks !== undefined) {
    const sourceIds = energySourceLinks.map((link) => link.energySourceId);
    if (new Set(sourceIds).size !== sourceIds.length) throw new EquipmentScopeError(400, "Ayni enerji kaynagi birden fazla baglanamaz");
    if (energySourceLinks.filter((link) => link.isPrimary).length > 1) throw new EquipmentScopeError(400, "Bir ekipman icin tek primary enerji kaynagi olabilir");
    if (sourceIds.length > 0) {
      const sources = await tx.select({ id: energySourcesTable.id, companyId: energySourcesTable.companyId, unitId: energySourcesTable.unitId })
        .from(energySourcesTable)
        .where(inArray(energySourcesTable.id, sourceIds));
      const byId = new Map(sources.map((source) => [source.id, source]));
      for (const sourceId of sourceIds) {
        const source = byId.get(sourceId);
        if (!source || source.companyId !== companyId || source.unitId !== unitId) {
          throw new EquipmentScopeError(400, "Enerji kaynagi secilen sirket/birim ile uyumlu degil");
        }
      }
    }
  }
}

async function activeChildDependency(tx: Tx | typeof db, equipmentId: number, companyId: number) {
  const children = await tx.select({
    id: equipmentTable.id,
    equipmentCode: equipmentTable.equipmentCode,
    name: equipmentTable.name,
    status: equipmentTable.status,
  })
    .from(equipmentTable)
    .where(and(eq(equipmentTable.companyId, companyId), eq(equipmentTable.parentEquipmentId, equipmentId), ne(equipmentTable.status, "archived")))
    .orderBy(equipmentTable.id)
    .limit(6)
    .for("update");
  if (children.length === 0) return null;
  const [{ value }] = await tx.select({ value: count() }).from(equipmentTable)
    .where(and(eq(equipmentTable.companyId, companyId), eq(equipmentTable.parentEquipmentId, equipmentId), ne(equipmentTable.status, "archived")));
  return {
    status: "active-children" as const,
    activeChildCount: value,
    children: children.slice(0, 5),
  };
}

async function parentSummary(equipment: EquipmentRow) {
  if (equipment.parentEquipmentId === null) return null;
  const [parent] = await db.select({
    id: equipmentTable.id,
    equipmentCode: equipmentTable.equipmentCode,
    name: equipmentTable.name,
    status: equipmentTable.status,
  })
    .from(equipmentTable)
    .where(and(eq(equipmentTable.companyId, equipment.companyId), eq(equipmentTable.id, equipment.parentEquipmentId)))
    .limit(1);
  return parent ?? null;
}

async function childSummary(equipment: EquipmentRow) {
  const children = await db.select({
    id: equipmentTable.id,
    equipmentCode: equipmentTable.equipmentCode,
    name: equipmentTable.name,
    status: equipmentTable.status,
  })
    .from(equipmentTable)
    .where(and(eq(equipmentTable.companyId, equipment.companyId), eq(equipmentTable.parentEquipmentId, equipment.id), ne(equipmentTable.status, "archived")))
    .orderBy(equipmentTable.id)
    .limit(5);
  const [{ value }] = await db.select({ value: count() }).from(equipmentTable)
    .where(and(eq(equipmentTable.companyId, equipment.companyId), eq(equipmentTable.parentEquipmentId, equipment.id), ne(equipmentTable.status, "archived")));
  return { activeChildCount: value, children };
}

async function validateStoredLinkIntegrity(tx: Tx, equipment: EquipmentRow): Promise<DependencyWarning[]> {
  const [meterLinks, sourceLinks] = await Promise.all([
    tx.select().from(equipmentMeterLinksTable).where(eq(equipmentMeterLinksTable.equipmentId, equipment.id)),
    tx.select().from(equipmentEnergySourceLinksTable).where(eq(equipmentEnergySourceLinksTable.equipmentId, equipment.id)),
  ]);
  const warnings: DependencyWarning[] = [];
  if (meterLinks.length > 0) {
    const meters = await tx.select({ id: metersTable.id, companyId: metersTable.companyId, unitId: metersTable.unitId })
      .from(metersTable)
      .where(inArray(metersTable.id, meterLinks.map((link) => link.meterId)));
    const byId = new Map(meters.map((meter) => [meter.id, meter]));
    for (const link of meterLinks) {
      const meter = byId.get(link.meterId);
      if (!meter || meter.companyId !== equipment.companyId || meter.unitId !== equipment.unitId) {
        throw new EquipmentScopeError(409, "Ekipman sayac iliskisi sirket/birim kapsami ile uyumsuz");
      }
    }
  }
  if (sourceLinks.length > 0) {
    const sources = await tx.select({ id: energySourcesTable.id, companyId: energySourcesTable.companyId, unitId: energySourcesTable.unitId, active: energySourcesTable.active })
      .from(energySourcesTable)
      .where(inArray(energySourcesTable.id, sourceLinks.map((link) => link.energySourceId)));
    const byId = new Map(sources.map((source) => [source.id, source]));
    const inactive: number[] = [];
    for (const link of sourceLinks) {
      const source = byId.get(link.energySourceId);
      if (!source || source.companyId !== equipment.companyId || source.unitId !== equipment.unitId) {
        throw new EquipmentScopeError(409, "Ekipman enerji kaynagi iliskisi sirket/birim kapsami ile uyumsuz");
      }
      if (source.active === false) inactive.push(source.id);
    }
    if (inactive.length > 0) warnings.push({ code: "INACTIVE_ENERGY_SOURCE_LINKS", count: inactive.length, ids: inactive.slice(0, 5) });
  }
  return warnings;
}

async function assertNoParentCycle(tx: Tx | typeof db, equipmentId: number, candidateParentId: number) {
  let current: number | null = candidateParentId;
  const seen = new Set<number>();
  for (let depth = 0; current !== null && depth < 50; depth += 1) {
    if (current === equipmentId) throw new EquipmentScopeError(400, "Parent ekipman dongusu olusturulamaz");
    if (seen.has(current)) throw new EquipmentScopeError(400, "Parent ekipman dongusu olusturulamaz");
    seen.add(current);
    const [row] = await tx.select({ parentEquipmentId: equipmentTable.parentEquipmentId })
      .from(equipmentTable)
      .where(eq(equipmentTable.id, current))
      .limit(1);
    current = row?.parentEquipmentId ?? null;
  }
  if (current !== null) throw new EquipmentScopeError(400, "Parent ekipman zinciri cok derin");
}

async function replaceLinks(tx: Tx, input: {
  equipmentId: number;
  companyId: number;
  userId: number;
  meterLinks?: EquipmentCreateRequest["meterLinks"];
  energySourceLinks?: EquipmentCreateRequest["energySourceLinks"];
}) {
  if (input.meterLinks !== undefined) {
    await tx.delete(equipmentMeterLinksTable).where(eq(equipmentMeterLinksTable.equipmentId, input.equipmentId));
    if (input.meterLinks.length > 0) {
      await tx.insert(equipmentMeterLinksTable).values(input.meterLinks.map((link) => ({
        companyId: input.companyId,
        equipmentId: input.equipmentId,
        meterId: link.meterId,
        relationRole: link.relationRole,
        sharePercent: link.sharePercent ?? null,
        measurementConfidence: link.measurementConfidence,
        isPrimary: link.isPrimary,
        createdBy: input.userId,
      })));
    }
  }
  if (input.energySourceLinks !== undefined) {
    await tx.delete(equipmentEnergySourceLinksTable).where(eq(equipmentEnergySourceLinksTable.equipmentId, input.equipmentId));
    if (input.energySourceLinks.length > 0) {
      await tx.insert(equipmentEnergySourceLinksTable).values(input.energySourceLinks.map((link) => ({
        companyId: input.companyId,
        equipmentId: input.equipmentId,
        energySourceId: link.energySourceId,
        relationRole: link.relationRole,
        sharePercent: link.sharePercent ?? null,
        measurementConfidence: link.measurementConfidence,
        isPrimary: link.isPrimary,
        createdBy: input.userId,
      })));
    }
  }
}

async function loadLinks(equipmentId: number) {
  const [meterLinks, energySourceLinks] = await Promise.all([
    db.select().from(equipmentMeterLinksTable).where(eq(equipmentMeterLinksTable.equipmentId, equipmentId)),
    db.select().from(equipmentEnergySourceLinksTable).where(eq(equipmentEnergySourceLinksTable.equipmentId, equipmentId)),
  ]);
  const meterIds = meterLinks.map((link) => link.meterId);
  const sourceIds = energySourceLinks.map((link) => link.energySourceId);
  const [meters, sources] = await Promise.all([
    meterIds.length > 0
      ? db.select({
        id: metersTable.id,
        name: metersTable.name,
        type: metersTable.type,
        unit: metersTable.unit,
        unitId: metersTable.unitId,
        unitName: unitsTable.name,
        subUnitId: metersTable.subUnitId,
        subUnitName: subUnitsTable.name,
        energySourceName: energySourcesTable.name,
      })
        .from(metersTable)
        .leftJoin(unitsTable, eq(metersTable.unitId, unitsTable.id))
        .leftJoin(subUnitsTable, eq(metersTable.subUnitId, subUnitsTable.id))
        .leftJoin(energySourcesTable, eq(metersTable.energySourceId, energySourcesTable.id))
        .where(inArray(metersTable.id, meterIds))
      : [],
    sourceIds.length > 0
      ? db.select({
        id: energySourcesTable.id,
        name: energySourcesTable.name,
        type: energySourcesTable.type,
        unitId: energySourcesTable.unitId,
        unitName: unitsTable.name,
      })
        .from(energySourcesTable)
        .leftJoin(unitsTable, eq(energySourcesTable.unitId, unitsTable.id))
        .where(inArray(energySourcesTable.id, sourceIds))
      : [],
  ]);
  const meterById = new Map(meters.map((meter) => [meter.id, meter]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return {
    meterLinks: meterLinks.map((link): MeterLinkDetail => {
      const meter = meterById.get(link.meterId);
      return {
        ...link,
        meterName: meter?.name ?? null,
        meterType: meter?.type ?? null,
        meterUnit: meter?.unit ?? null,
        meterEnergySourceName: meter?.energySourceName ?? null,
        unitId: meter?.unitId ?? null,
        unitName: meter?.unitName ?? null,
        subUnitId: meter?.subUnitId ?? null,
        subUnitName: meter?.subUnitName ?? null,
        isActive: Boolean(meter),
      };
    }),
    energySourceLinks: energySourceLinks.map((link): SourceLinkDetail => {
      const source = sourceById.get(link.energySourceId);
      return {
        ...link,
        energySourceName: source?.name ?? null,
        energySourceType: source?.type ?? null,
        unitId: source?.unitId ?? null,
        unitName: source?.unitName ?? null,
        subUnitId: null,
        subUnitName: null,
        isActive: Boolean(source),
      };
    }),
  };
}

async function activeEquipmentDefinitions(companyId: number) {
  const rows = await db.select()
    .from(equipmentFieldDefinitionsTable)
    .where(eq(equipmentFieldDefinitionsTable.companyId, companyId))
    .orderBy(asc(equipmentFieldDefinitionsTable.displayOrder), asc(equipmentFieldDefinitionsTable.label));
  return rows.filter((row) => row.isActive).slice(0, MAX_CUSTOM_IMPORT_FIELDS).map(serializeDefinition);
}

function buildEquipmentImportColumns(definitions: EquipmentCustomFieldDefinitionDto[]) {
  const labels: Record<string, string> = {
    equipment_code: "Ekipman kodu",
    name: "Ekipman adi",
    equipment_kind: "Ekipman turu",
    category: "Kategori",
    sub_type: "Alt tur",
    status: "Durum",
    asset_code: "Varlik kodu",
    manufacturer: "Uretici",
    brand: "Marka",
    model: "Model",
    serial_number: "Seri no",
    tag_code: "Etiket kodu",
    unit_code: "Birim kodu",
    sub_unit_code: "Alt birim kodu",
    sub_unit_name: "Alt birim adi",
    location_text: "Lokasyon",
    building_text: "Bina",
    process_text: "Proses",
    parent_equipment_code: "Parent ekipman kodu",
    energy_use_group_code: "Enerji kullanim grubu kodu",
    measurement_method: "Olcum yontemi",
    measurement_confidence: "Olcum guveni",
    rated_power_value: "Etiket gucu",
    rated_power_unit: "Etiket gucu birimi",
    installed_power_kw: "Kurulu guc kW",
    capacity_value: "Kapasite",
    capacity_unit: "Kapasite birimi",
    nominal_efficiency_percent: "Nominal verim %",
    operational_status: "Operasyon durumu",
    daily_operating_hours: "Gunluk saat",
    annual_operating_hours: "Yillik saat",
    average_load_percent: "Ortalama yuk %",
    seasonal_operation_status: "Sezonsal operasyon",
    purchase_date: "Satin alma",
    commissioning_date: "Devreye alma",
    manufacture_year: "Uretim yili",
    expected_life_years: "Beklenen omur",
    planned_replacement_year: "Planlanan yenileme",
    is_energy_intensive: "Enerji yogun mu",
    is_critical: "Kritik mi",
    criticality_reason: "Kritiklik nedeni",
    saving_potential: "Tasarruf potansiyeli",
    technical_notes: "Teknik notlar",
    maintenance_notes: "Bakim notlari",
    efficiency_opportunities: "Verimlilik firsatlari",
    planned_improvements: "Planlanan iyilestirmeler",
    equipment_version: "Ekipman versiyonu",
  };
  return [
    ...STANDARD_IMPORT_COLUMNS.map((code) => ({
      code,
      label: labels[code] ?? code,
      width: ["technical_notes", "maintenance_notes", "efficiency_opportunities", "planned_improvements"].includes(code) ? 36 : 20,
    })),
    ...definitions.map((definition) => ({
      code: `custom.${definition.code}`,
      label: definition.label,
      width: definition.fieldType === "long_text" ? 36 : 22,
    })),
  ];
}

async function loadEquipmentReferenceData(scope: Awaited<ReturnType<typeof resolveCompanyScope>>) {
  const unitConditions = [eq(unitsTable.companyId, scope.companyId)];
  if (scope.standardUnitId !== null) unitConditions.push(eq(unitsTable.id, scope.standardUnitId));
  const equipmentConditions = [eq(equipmentTable.companyId, scope.companyId)];
  if (scope.standardUnitId !== null) equipmentConditions.push(eq(equipmentTable.unitId, scope.standardUnitId));
  const [units, subUnits, groups, meters, sources, equipments, definitions] = await Promise.all([
    db.select({ id: unitsTable.id, name: unitsTable.name, active: unitsTable.active })
      .from(unitsTable)
      .where(and(...unitConditions))
      .orderBy(asc(unitsTable.name)),
    db.select({ id: subUnitsTable.id, unitId: subUnitsTable.unitId, name: subUnitsTable.name, active: subUnitsTable.active })
      .from(subUnitsTable)
      .where(eq(subUnitsTable.companyId, scope.companyId))
      .orderBy(asc(subUnitsTable.name)),
    db.select({ id: energyUseGroupsTable.id, code: energyUseGroupsTable.code, name: energyUseGroupsTable.name, unitId: energyUseGroupsTable.unitId, subUnitId: energyUseGroupsTable.subUnitId, isActive: energyUseGroupsTable.isActive })
      .from(energyUseGroupsTable)
      .where(eq(energyUseGroupsTable.companyId, scope.companyId))
      .orderBy(asc(energyUseGroupsTable.name)),
    db.select({ id: metersTable.id, name: metersTable.name, unitId: metersTable.unitId, subUnitId: metersTable.subUnitId, type: metersTable.type, unit: metersTable.unit })
      .from(metersTable)
      .where(eq(metersTable.companyId, scope.companyId))
      .orderBy(asc(metersTable.name)),
    db.select({ id: energySourcesTable.id, name: energySourcesTable.name, unitId: energySourcesTable.unitId, type: energySourcesTable.type, unit: energySourcesTable.unit, active: energySourcesTable.active })
      .from(energySourcesTable)
      .where(eq(energySourcesTable.companyId, scope.companyId))
      .orderBy(asc(energySourcesTable.name)),
    db.select().from(equipmentTable).where(and(...equipmentConditions)),
    activeEquipmentDefinitions(scope.companyId),
  ]);
  const allowedUnitIds = new Set(units.map((unit) => unit.id));
  return {
    units,
    subUnits: subUnits.filter((row) => allowedUnitIds.has(row.unitId)),
    groups: groups.filter((row) => row.unitId === null || allowedUnitIds.has(row.unitId)),
    meters: meters.filter((row) => row.unitId !== null && allowedUnitIds.has(row.unitId)),
    sources: sources.filter((row) => allowedUnitIds.has(row.unitId)),
    equipments,
    definitions,
  };
}

async function buildEquipmentWorkbook(
  scope: Awaited<ReturnType<typeof resolveCompanyScope>>,
  rows: EquipmentRow[],
) {
  const refs = await loadEquipmentReferenceData(scope);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EMS";
  workbook.created = new Date();
  const columns = buildEquipmentImportColumns(refs.definitions);
  const sheet = workbook.addWorksheet(EQUIPMENT_SHEET, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({
    key: column.code,
    header: columnLabel(column.code, column.label),
    width: column.width,
  }));
  sheet.getRow(1).font = { bold: true };

  const equipmentIds = rows.map((row) => row.id);
  const [meterLinks, sourceLinks] = await Promise.all([
    equipmentIds.length > 0 ? db.select().from(equipmentMeterLinksTable).where(inArray(equipmentMeterLinksTable.equipmentId, equipmentIds)) : [],
    equipmentIds.length > 0 ? db.select().from(equipmentEnergySourceLinksTable).where(inArray(equipmentEnergySourceLinksTable.equipmentId, equipmentIds)) : [],
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byParentId = new Map(refs.equipments.map((row) => [row.id, row.equipmentCode]));
  const subUnitById = new Map(refs.subUnits.map((row) => [row.id, row]));
  const groupById = new Map(refs.groups.map((row) => [row.id, row]));

  for (const row of rows) {
    const values: Record<string, unknown> = {
      equipment_code: row.equipmentCode,
      name: row.name,
      equipment_kind: row.equipmentKind,
      category: row.category,
      sub_type: row.subType,
      status: row.status,
      asset_code: row.assetCode,
      manufacturer: row.manufacturer,
      brand: row.brand,
      model: row.model,
      serial_number: row.serialNumber,
      tag_code: row.tagCode,
      unit_code: stableUnitCode(row.unitId),
      sub_unit_code: row.subUnitId ? stableSubUnitCode(row.subUnitId) : null,
      sub_unit_name: row.subUnitId ? subUnitById.get(row.subUnitId)?.name ?? null : null,
      location_text: row.locationText,
      building_text: row.buildingText,
      process_text: row.processText,
      parent_equipment_code: row.parentEquipmentId ? byParentId.get(row.parentEquipmentId) ?? null : null,
      energy_use_group_code: row.energyUseGroupId ? groupById.get(row.energyUseGroupId)?.code ?? `group:${row.energyUseGroupId}` : null,
      measurement_method: row.measurementMethod,
      measurement_confidence: row.measurementConfidence,
      rated_power_value: row.ratedPowerValue,
      rated_power_unit: row.ratedPowerUnit,
      installed_power_kw: row.installedPowerKw,
      capacity_value: row.capacityValue,
      capacity_unit: row.capacityUnit,
      nominal_efficiency_percent: row.nominalEfficiencyPercent,
      operational_status: row.operationalStatus,
      daily_operating_hours: row.dailyOperatingHours,
      annual_operating_hours: row.annualOperatingHours,
      average_load_percent: row.averageLoadPercent,
      seasonal_operation_status: row.seasonalOperationStatus,
      purchase_date: row.purchaseDate,
      commissioning_date: row.commissioningDate,
      manufacture_year: row.manufactureYear,
      expected_life_years: row.expectedLifeYears,
      planned_replacement_year: row.plannedReplacementYear,
      is_energy_intensive: row.isEnergyIntensive ? "yes" : "no",
      is_critical: row.isCritical ? "yes" : "no",
      criticality_reason: row.criticalityReason,
      saving_potential: row.savingPotential,
      technical_notes: row.technicalNotes,
      maintenance_notes: row.maintenanceNotes,
      efficiency_opportunities: row.efficiencyOpportunities,
      planned_improvements: row.plannedImprovements,
      equipment_version: row.equipmentVersion,
    };
    const customValues = equipmentCustomValues(row);
    for (const definition of refs.definitions) {
      const value = customValues[definition.code];
      values[`custom.${definition.code}`] = Array.isArray(value) ? value.join("|") : value ?? null;
    }
    sheet.addRow(columns.map((column) => safeXlsxValue(values[column.code])));
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const meterSheet = workbook.addWorksheet(METER_RELATION_SHEET);
  meterSheet.columns = [
    { header: "Ekipman kodu [equipment_code]", key: "equipment_code", width: 24 },
    { header: "Sayac kodu [meter_code]", key: "meter_code", width: 18 },
    { header: "Rol [relation_role]", key: "relation_role", width: 20 },
    { header: "Primary [is_primary]", key: "is_primary", width: 12 },
    { header: "Pay [share_percent]", key: "share_percent", width: 14 },
    { header: "Guven [measurement_confidence]", key: "measurement_confidence", width: 18 },
  ];
  meterSheet.getRow(1).font = { bold: true };
  for (const link of meterLinks) {
    const row = byId.get(link.equipmentId);
    if (!row) continue;
    meterSheet.addRow({
      equipment_code: row.equipmentCode,
      meter_code: stableMeterCode(link.meterId),
      relation_role: link.relationRole,
      is_primary: link.isPrimary ? "yes" : "no",
      share_percent: link.sharePercent,
      measurement_confidence: link.measurementConfidence,
    });
  }

  const sourceSheet = workbook.addWorksheet(ENERGY_SOURCE_RELATION_SHEET);
  sourceSheet.columns = [
    { header: "Ekipman kodu [equipment_code]", key: "equipment_code", width: 24 },
    { header: "Enerji kaynagi kodu [energy_source_code]", key: "energy_source_code", width: 22 },
    { header: "Rol [relation_role]", key: "relation_role", width: 20 },
    { header: "Primary [is_primary]", key: "is_primary", width: 12 },
    { header: "Pay [share_percent]", key: "share_percent", width: 14 },
    { header: "Guven [measurement_confidence]", key: "measurement_confidence", width: 18 },
  ];
  sourceSheet.getRow(1).font = { bold: true };
  for (const link of sourceLinks) {
    const row = byId.get(link.equipmentId);
    if (!row) continue;
    sourceSheet.addRow({
      equipment_code: row.equipmentCode,
      energy_source_code: stableSourceCode(link.energySourceId),
      relation_role: link.relationRole,
      is_primary: link.isPrimary ? "yes" : "no",
      share_percent: link.sharePercent,
      measurement_confidence: link.measurementConfidence,
    });
  }

  const reference = workbook.addWorksheet(REFERENCES_SHEET);
  reference.columns = [
    { header: "Tur", key: "kind", width: 24 },
    { header: "Kod", key: "code", width: 28 },
    { header: "Etiket", key: "label", width: 36 },
    { header: "Birim", key: "unit", width: 18 },
    { header: "Aktif", key: "active", width: 10 },
    { header: "Ek bilgi", key: "metadata", width: 44 },
  ];
  reference.getRow(1).font = { bold: true };
  for (const unit of refs.units) reference.addRow({ kind: "unit", code: stableUnitCode(unit.id), label: safeXlsxValue(unit.name), active: unit.active ? "yes" : "no" });
  for (const subUnit of refs.subUnits) reference.addRow({ kind: "sub_unit", code: stableSubUnitCode(subUnit.id), label: safeXlsxValue(subUnit.name), unit: stableUnitCode(subUnit.unitId), active: subUnit.active ? "yes" : "no" });
  for (const group of refs.groups) reference.addRow({ kind: "energy_use_group", code: group.code ?? `group:${group.id}`, label: safeXlsxValue(group.name), unit: group.unitId ? stableUnitCode(group.unitId) : "", active: group.isActive ? "yes" : "no" });
  for (const meter of refs.meters) reference.addRow({ kind: "meter", code: stableMeterCode(meter.id), label: safeXlsxValue(meter.name), unit: meter.unitId ? stableUnitCode(meter.unitId) : "", active: "yes", metadata: `${meter.type}/${meter.unit}` });
  for (const source of refs.sources) reference.addRow({ kind: "energy_source", code: stableSourceCode(source.id), label: safeXlsxValue(source.name), unit: stableUnitCode(source.unitId), active: source.active ? "yes" : "no", metadata: `${source.type}/${source.unit}` });
  for (const value of EQUIPMENT_CATEGORIES) reference.addRow({ kind: "category", code: value, label: value, active: "yes" });
  for (const value of EQUIPMENT_STATUSES) reference.addRow({ kind: "status", code: value, label: value, active: value === "archived" ? "export-only" : "yes" });
  for (const value of EQUIPMENT_CUSTOM_BOOLEAN_STATUSES) reference.addRow({ kind: "boolean", code: value, label: value, active: "yes" });
  for (const definition of refs.definitions) {
    reference.addRow({ kind: "custom_field", code: `custom.${definition.code}`, label: safeXlsxValue(definition.label), unit: definition.unitLabel ?? "", active: definition.isActive ? "yes" : "no", metadata: definition.fieldType });
    for (const option of definition.options) reference.addRow({ kind: `custom_option:${definition.code}`, code: option.code, label: safeXlsxValue(option.label), active: option.isActive ? "yes" : "no" });
  }

  const help = workbook.addWorksheet(HELP_SHEET);
  help.columns = [
    { header: "Konu", key: "topic", width: 28 },
    { header: "Aciklama", key: "description", width: 96 },
  ];
  help.getRow(1).font = { bold: true };
  help.addRow({ topic: "Import modu", description: `V1 modu ${IMPORT_MODE}. Bos hucre update satirinda mevcut degeri korur; temizlemek icin ${IMPORT_CLEAR_TOKEN}.` });
  help.addRow({ topic: "Relation policy", description: `Relation sheet'te equipment_code varsa o ekipman icin relation seti replace edilir. Hepsini temizlemek icin ilgili sheet'te relation koduna ${RELATION_CLEAR_TOKEN} yazin.` });
  help.addRow({ topic: "Stable key", description: "Ekipman eslestirmesi yalniz equipment_code ile yapilir; equipment ID anahtar degildir." });
  help.addRow({ topic: "Guvenlik", description: "Formula hucreleri ve =,+,-,@ ile baslayan import metinleri reddedilir." });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function listEquipmentForQuery(scope: Awaited<ReturnType<typeof resolveCompanyScope>>, rawQuery: unknown, exportMode = false) {
  const parsed = equipmentListQuerySchema.safeParse(rawQuery);
  if (!parsed.success) throw new EquipmentScopeError(400, parsed.error.issues[0]?.message ?? "Gecersiz ekipman filtresi");
  const query = { ...parsed.data, limit: exportMode ? 5000 : parsed.data.limit, offset: exportMode ? 0 : parsed.data.offset };
  const requestedUnitId = scope.standardUnitId !== null ? scope.standardUnitId : query.unitId;
  if (scope.standardUnitId !== null && query.unitId !== undefined && query.unitId !== scope.standardUnitId) throw new EquipmentScopeError(403, "Yetki yok");
  if (requestedUnitId !== undefined) await validateUnit(scope, requestedUnitId);
  const conditions: SQL[] = [eq(equipmentTable.companyId, scope.companyId)];
  if (requestedUnitId !== undefined) conditions.push(eq(equipmentTable.unitId, requestedUnitId));
  if (query.subUnitId !== undefined) conditions.push(eq(equipmentTable.subUnitId, query.subUnitId));
  if (query.category !== undefined) conditions.push(eq(equipmentTable.category, query.category));
  if (query.status !== undefined) conditions.push(eq(equipmentTable.status, query.status));
  if (query.energyUseGroupId !== undefined) conditions.push(eq(equipmentTable.energyUseGroupId, query.energyUseGroupId));
  if (query.parentEquipmentId !== undefined) conditions.push(eq(equipmentTable.parentEquipmentId, query.parentEquipmentId));
  if (query.parentless === true) conditions.push(isNull(equipmentTable.parentEquipmentId));
  if (!query.includeArchived && query.status === undefined) conditions.push(or(eq(equipmentTable.status, "active"), eq(equipmentTable.status, "standby"), eq(equipmentTable.status, "maintenance"), eq(equipmentTable.status, "faulty"), eq(equipmentTable.status, "out_of_service"))!);
  if (query.search) {
    const pattern = `%${query.search.replace(/[%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(equipmentTable.equipmentCode, pattern), ilike(equipmentTable.name, pattern), ilike(equipmentTable.assetCode, pattern))!);
  }
  if (query.meterId !== undefined) {
    const rows = await db.select({ equipmentId: equipmentMeterLinksTable.equipmentId })
      .from(equipmentMeterLinksTable)
      .where(and(eq(equipmentMeterLinksTable.companyId, scope.companyId), eq(equipmentMeterLinksTable.meterId, query.meterId)));
    if (rows.length === 0) return { rows: [], total: 0, query };
    conditions.push(inArray(equipmentTable.id, rows.map((row) => row.equipmentId)));
  }
  if (query.energySourceId !== undefined) {
    const rows = await db.select({ equipmentId: equipmentEnergySourceLinksTable.equipmentId })
      .from(equipmentEnergySourceLinksTable)
      .where(and(eq(equipmentEnergySourceLinksTable.companyId, scope.companyId), eq(equipmentEnergySourceLinksTable.energySourceId, query.energySourceId)));
    if (rows.length === 0) return { rows: [], total: 0, query };
    conditions.push(inArray(equipmentTable.id, rows.map((row) => row.equipmentId)));
  }
  const [totalRow] = await db.select({ value: count() }).from(equipmentTable).where(and(...conditions));
  const rows = await db.select().from(equipmentTable)
    .where(and(...conditions))
    .orderBy(desc(equipmentTable.updatedAt), desc(equipmentTable.id))
    .limit(query.limit)
    .offset(query.offset);
  return { rows, total: totalRow?.value ?? 0, query };
}

function headersForSheet(sheet: ExcelJS.Worksheet) {
  const headers = Array.from({ length: sheet.columnCount }, (_, idx) => extractColumnCode(cellValue(sheet.getRow(1).getCell(idx + 1))));
  const seen = new Set<string>();
  const duplicate = headers.find((header) => {
    if (!header) return false;
    if (seen.has(header)) return true;
    seen.add(header);
    return false;
  });
  return { headers, duplicate };
}

async function parseRelationSheet(params: {
  workbook: ExcelJS.Workbook;
  sheetName: string;
  codeColumn: "meter_code" | "energy_source_code";
  allowedRoles: readonly string[];
  targetByCode: Map<string, { id: number; unitId: number | null; active?: boolean }>;
  equipmentCodesInMain: Set<string>;
  equipmentByCode: Map<string, EquipmentRow>;
  issues: ImportIssue[];
}) {
  const sheet = params.workbook.getWorksheet(params.sheetName);
  const result = new Map<string, Array<Record<string, unknown>>>();
  const clear = new Set<string>();
  let rowCount = 0;
  if (!sheet) return { result, clear, rowCount };
  if (sheet.columnCount > 12) params.issues.push(issue(params.sheetName, 1, undefined, "too_many_columns", "Relation sheet kolon sayisi cok fazla"));
  const { headers, duplicate } = headersForSheet(sheet);
  if (duplicate) params.issues.push(issue(params.sheetName, 1, duplicate, "duplicate_header", "Ayni relation kolonu birden fazla kez kullanilmis"));
  const required = new Set(["equipment_code", params.codeColumn, "relation_role", "is_primary", "share_percent", "measurement_confidence"]);
  for (const header of headers) {
    if (header && !required.has(header)) params.issues.push(issue(params.sheetName, 1, header, "unknown_column", `Bilinmeyen kolon: ${header}`));
  }
  const seenRelation = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (rowIsEmpty(row, headers.length)) continue;
    rowCount += 1;
    if (rowCount > MAX_RELATION_IMPORT_ROWS) {
      params.issues.push(issue(params.sheetName, rowNumber, undefined, "row_limit_exceeded", `En fazla ${MAX_RELATION_IMPORT_ROWS} relation satiri import edilebilir`));
      break;
    }
    const raw = new Map<string, unknown>();
    headers.forEach((header, index) => {
      const value = cellValue(row.getCell(index + 1));
      if (isFormulaLike(value)) params.issues.push(issue(params.sheetName, rowNumber, header, "formula_not_allowed", "Formul veya formul gibi baslayan hucre kabul edilmez"));
      if (typeof value === "string" && value.length > MAX_CELL_TEXT_LENGTH) params.issues.push(issue(params.sheetName, rowNumber, header, "cell_too_long", "Hucre metni cok uzun"));
      raw.set(header, value);
    });
    const equipmentCode = asTrimmedString(raw.get("equipment_code"));
    const relatedCode = asTrimmedString(raw.get(params.codeColumn));
    if (!equipmentCode) {
      params.issues.push(issue(params.sheetName, rowNumber, "equipment_code", "required", "equipment_code zorunludur"));
      continue;
    }
    if (!params.equipmentCodesInMain.has(equipmentCode)) {
      params.issues.push(issue(params.sheetName, rowNumber, "equipment_code", "missing_main_row", "Relation icin ana Ekipmanlar sheet'inde satir bulunmalidir"));
      continue;
    }
    if (relatedCode === RELATION_CLEAR_TOKEN) {
      clear.add(equipmentCode);
      result.set(equipmentCode, []);
      continue;
    }
    const target = params.targetByCode.get(relatedCode);
    if (!target) {
      params.issues.push(issue(params.sheetName, rowNumber, params.codeColumn, "unknown_reference", "Relation referans kodu bulunamadi"));
      continue;
    }
    const equipment = params.equipmentByCode.get(equipmentCode);
    if (equipment && target.unitId !== null && target.unitId !== equipment.unitId) {
      params.issues.push(issue(params.sheetName, rowNumber, params.codeColumn, "unit_mismatch", "Relation referansi ekipman birimiyle uyumlu degil"));
    }
    if (target.active === false) params.issues.push(issue(params.sheetName, rowNumber, params.codeColumn, "inactive_reference", "Pasif referansa yeni relation kurulamaz"));
    const relationRole = asTrimmedString(raw.get("relation_role")) || (params.codeColumn === "meter_code" ? "direct" : "primary");
    if (!params.allowedRoles.includes(relationRole)) params.issues.push(issue(params.sheetName, rowNumber, "relation_role", "invalid_enum", "Relation role gecersiz"));
    const isPrimary = parseImportBoolean(raw.get("is_primary")) ?? false;
    const rawShare = raw.get("share_percent");
    const sharePercent = asTrimmedString(rawShare) === "" ? null : parseImportNumber(rawShare);
    if (sharePercent !== null && (!Number.isFinite(sharePercent) || sharePercent < 0 || sharePercent > 100)) {
      params.issues.push(issue(params.sheetName, rowNumber, "share_percent", "invalid_share", "Pay 0-100 araliginda olmalidir"));
    }
    const confidence = asTrimmedString(raw.get("measurement_confidence")) || "unknown";
    if (!(EQUIPMENT_MEASUREMENT_CONFIDENCES as readonly string[]).includes(confidence)) params.issues.push(issue(params.sheetName, rowNumber, "measurement_confidence", "invalid_enum", "Measurement confidence gecersiz"));
    const key = `${equipmentCode}:${relatedCode}`;
    if (seenRelation.has(key)) params.issues.push(issue(params.sheetName, rowNumber, params.codeColumn, "duplicate_relation", "Ayni relation birden fazla yazilmis"));
    seenRelation.add(key);
    const list = result.get(equipmentCode) ?? [];
    list.push(params.codeColumn === "meter_code"
      ? { meterId: target.id, relationRole, isPrimary, sharePercent, measurementConfidence: confidence }
      : { energySourceId: target.id, relationRole, isPrimary, sharePercent, measurementConfidence: confidence });
    result.set(equipmentCode, list);
  }
  for (const [equipmentCode, list] of result) {
    if (clear.has(equipmentCode) && list.length > 0) params.issues.push(issue(params.sheetName, undefined, "equipment_code", "clear_with_rows", `${equipmentCode} icin clear marker ile relation satiri birlikte kullanilamaz`));
    if (list.filter((row) => row.isPrimary).length > 1) params.issues.push(issue(params.sheetName, undefined, "is_primary", "multiple_primary", `${equipmentCode} icin tek primary relation olabilir`));
  }
  return { result, clear, rowCount };
}

async function parseEquipmentImportWorkbook(req: Request, file: Express.Multer.File, mode: ImportMode): Promise<ImportPreview> {
  const scope = await resolveCompanyScope(req);
  if (!file.originalname.toLowerCase().endsWith(".xlsx") || file.originalname.toLowerCase().endsWith(".xlsm")) {
    throw new EquipmentScopeError(400, "Yalniz .xlsx dosyasi kabul edilir");
  }
  if (file.mimetype && file.mimetype !== XLSX_MIME_TYPE && file.mimetype !== "application/octet-stream") {
    throw new EquipmentScopeError(400, "Gecersiz XLSX MIME tipi");
  }
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = file.buffer.buffer.slice(file.buffer.byteOffset, file.buffer.byteOffset + file.buffer.byteLength) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);
  const allowedSheets = new Set([EQUIPMENT_SHEET, METER_RELATION_SHEET, ENERGY_SOURCE_RELATION_SHEET, REFERENCES_SHEET, HELP_SHEET]);
  if (workbook.worksheets.length > MAX_IMPORT_SHEETS) throw new EquipmentScopeError(400, `En fazla ${MAX_IMPORT_SHEETS} sheet kabul edilir`);
  for (const sheet of workbook.worksheets) {
    if (!allowedSheets.has(sheet.name)) throw new EquipmentScopeError(400, `Bilinmeyen worksheet: ${sheet.name}`);
  }
  const sheet = workbook.getWorksheet(EQUIPMENT_SHEET);
  if (!sheet) throw new EquipmentScopeError(400, "Ekipmanlar sheet'i bulunamadi");
  if (sheet.columnCount > MAX_IMPORT_COLUMNS) throw new EquipmentScopeError(400, `En fazla ${MAX_IMPORT_COLUMNS} kolon kabul edilir`);

  const refs = await loadEquipmentReferenceData(scope);
  const activeDefinitionsByCode = new Map(refs.definitions.map((definition) => [definition.code, definition]));
  const allDefinitionRows = await db.select().from(equipmentFieldDefinitionsTable).where(eq(equipmentFieldDefinitionsTable.companyId, scope.companyId));
  const inactiveDefinitionCodes = new Set(allDefinitionRows.filter((row) => !row.isActive).map((row) => row.code));
  const unitByCode = new Map(refs.units.map((unit) => [stableUnitCode(unit.id), unit]));
  const subUnitByCode = new Map(refs.subUnits.map((subUnit) => [stableSubUnitCode(subUnit.id), subUnit]));
  const subUnitByUnitName = new Map<string, typeof refs.subUnits[number]>();
  const duplicateSubUnitNames = new Set<string>();
  for (const subUnit of refs.subUnits) {
    const key = `${subUnit.unitId}:${subUnit.name.trim().toLowerCase()}`;
    if (subUnitByUnitName.has(key)) duplicateSubUnitNames.add(key);
    subUnitByUnitName.set(key, subUnit);
  }
  const groupByCode = new Map(refs.groups.map((group) => [group.code ?? `group:${group.id}`, group]));
  const meterByCode = new Map(refs.meters.map((meter) => [stableMeterCode(meter.id), { id: meter.id, unitId: meter.unitId, active: true }]));
  const sourceByCode = new Map(refs.sources.map((source) => [stableSourceCode(source.id), { id: source.id, unitId: source.unitId, active: source.active }]));
  const equipmentByCode = new Map(refs.equipments.map((equipment) => [equipment.equipmentCode, equipment]));
  const { headers, duplicate } = headersForSheet(sheet);
  const issues: ImportIssue[] = [];
  if (duplicate) issues.push(issue(EQUIPMENT_SHEET, 1, duplicate, "duplicate_header", "Ayni kolon birden fazla kez kullanilmis"));
  const standardCodes = new Set<string>(STANDARD_IMPORT_COLUMNS);
  for (const header of headers) {
    if (!header) continue;
    if (standardCodes.has(header)) continue;
    if (header.startsWith("custom.")) {
      const code = header.slice("custom.".length);
      if (inactiveDefinitionCodes.has(code)) issues.push(issue(EQUIPMENT_SHEET, 1, header, "inactive_custom_field", "Pasif custom field import ile yazilamaz"));
      else if (!activeDefinitionsByCode.has(code)) issues.push(issue(EQUIPMENT_SHEET, 1, header, "unknown_custom_field", "Firma ozel alan kodu bulunamadi"));
      continue;
    }
    issues.push(issue(EQUIPMENT_SHEET, 1, header, "unknown_column", `Bilinmeyen kolon: ${header}`));
  }

  const rawRows: Array<{ rowNumber: number; rawByCode: Map<string, unknown>; rowIssues: ImportIssue[] }> = [];
  const seenCodes = new Set<string>();
  let totalRows = 0;
  const mainCodes = new Set<string>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (rowIsEmpty(row, headers.length)) continue;
    totalRows += 1;
    if (totalRows > MAX_IMPORT_ROWS) {
      issues.push(issue(EQUIPMENT_SHEET, rowNumber, undefined, "row_limit_exceeded", `En fazla ${MAX_IMPORT_ROWS} ekipman satiri import edilebilir`));
      break;
    }
    const rowIssues: ImportIssue[] = [];
    const rawByCode = new Map<string, unknown>();
    headers.forEach((code, index) => {
      const raw = cellValue(row.getCell(index + 1));
      if (isFormulaLike(raw)) rowIssues.push(issue(EQUIPMENT_SHEET, rowNumber, code, "formula_not_allowed", "Formul veya formul gibi baslayan hucre kabul edilmez"));
      if (typeof raw === "string" && raw.length > MAX_CELL_TEXT_LENGTH) rowIssues.push(issue(EQUIPMENT_SHEET, rowNumber, code, "cell_too_long", "Hucre metni cok uzun"));
      rawByCode.set(code, raw);
    });
    const equipmentCode = asTrimmedString(rawByCode.get("equipment_code"));
    if (!equipmentCode) rowIssues.push(issue(EQUIPMENT_SHEET, rowNumber, "equipment_code", "required", "equipment_code zorunludur"));
    else if (seenCodes.has(equipmentCode)) rowIssues.push(issue(EQUIPMENT_SHEET, rowNumber, "equipment_code", "duplicate_equipment_code", "Ekipman kodu ayni dosyada birden fazla kez kullanilmis"));
    seenCodes.add(equipmentCode);
    if (equipmentCode) mainCodes.add(equipmentCode);
    rawRows.push({ rowNumber, rawByCode, rowIssues });
  }

  const meterRelations = await parseRelationSheet({
    workbook,
    sheetName: METER_RELATION_SHEET,
    codeColumn: "meter_code",
    allowedRoles: EQUIPMENT_METER_RELATION_ROLES,
    targetByCode: meterByCode,
    equipmentCodesInMain: mainCodes,
    equipmentByCode,
    issues,
  });
  const sourceRelations = await parseRelationSheet({
    workbook,
    sheetName: ENERGY_SOURCE_RELATION_SHEET,
    codeColumn: "energy_source_code",
    allowedRoles: EQUIPMENT_ENERGY_SOURCE_RELATION_ROLES,
    targetByCode: sourceByCode,
    equipmentCodesInMain: mainCodes,
    equipmentByCode,
    issues,
  });

  const plans: EquipmentImportPlan[] = [];
  for (const rawRow of rawRows) {
    const rowIssues = [...rawRow.rowIssues];
    const equipmentCode = asTrimmedString(rawRow.rawByCode.get("equipment_code"));
    const existing = equipmentByCode.get(equipmentCode);
    let unitId = scope.standardUnitId ?? null;
    const unitCode = asTrimmedString(rawRow.rawByCode.get("unit_code"));
    if (unitCode) {
      const unit = unitByCode.get(unitCode);
      if (!unit) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "unit_code", "unknown_unit", "Birim kodu bulunamadi"));
      else unitId = unit.id;
    }
    if (existing && unitCode && unitId !== existing.unitId) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "unit_code", "unit_change_unsupported", "Import ile ekipman birimi degistirilemez"));
    if (!existing && unitId === null) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "unit_code", "required", "Yeni ekipman icin unit_code zorunludur"));
    if (scope.standardUnitId !== null && unitId !== scope.standardUnitId) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "unit_code", "forbidden_unit", "Standard kullanici yalniz kendi birimine import yapabilir"));

    let subUnitId: number | null | undefined = undefined;
    const subUnitCode = asTrimmedString(rawRow.rawByCode.get("sub_unit_code"));
    const subUnitName = asTrimmedString(rawRow.rawByCode.get("sub_unit_name"));
    if (subUnitCode === IMPORT_CLEAR_TOKEN) subUnitId = null;
    else if (subUnitCode) {
      const subUnit = subUnitByCode.get(subUnitCode);
      if (!subUnit || (unitId !== null && subUnit.unitId !== unitId)) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "sub_unit_code", "unknown_sub_unit", "Alt birim kodu secilen birime ait degil"));
      else subUnitId = subUnit.id;
    } else if (subUnitName && unitId !== null) {
      const key = `${unitId}:${subUnitName.toLowerCase()}`;
      if (duplicateSubUnitNames.has(key)) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "sub_unit_name", "duplicate_sub_unit_name", "Alt birim adi bu birimde benzersiz degil; sub_unit_code kullanin"));
      const subUnit = subUnitByUnitName.get(key);
      if (!subUnit) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "sub_unit_name", "unknown_sub_unit", "Alt birim adi bulunamadi"));
      else subUnitId = subUnit.id;
    }

    let parentEquipmentId: number | null | undefined = undefined;
    const parentCode = asTrimmedString(rawRow.rawByCode.get("parent_equipment_code"));
    if (parentCode === IMPORT_CLEAR_TOKEN) parentEquipmentId = null;
    else if (parentCode) {
      const parent = equipmentByCode.get(parentCode);
      if (!parent) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "parent_equipment_code", "unknown_parent", "Parent equipment code bulunamadi veya V1'de ayni dosyada yeni parent desteklenmiyor"));
      else if (parent.equipmentCode === equipmentCode) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "parent_equipment_code", "self_parent", "Ekipman kendisinin parent kaydi olamaz"));
      else if (unitId !== null && parent.unitId !== unitId) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "parent_equipment_code", "parent_unit_mismatch", "Parent ekipman ayni birimde olmalidir"));
      else if (parent.status === "archived") rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "parent_equipment_code", "archived_parent", "Arsivli parent ekipmana baglanti kurulamaz"));
      else parentEquipmentId = parent.id;
    }

    let energyUseGroupId: number | null | undefined = undefined;
    const groupCode = asTrimmedString(rawRow.rawByCode.get("energy_use_group_code"));
    if (groupCode === IMPORT_CLEAR_TOKEN) energyUseGroupId = null;
    else if (groupCode) {
      const group = groupByCode.get(groupCode);
      if (!group) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "energy_use_group_code", "unknown_group", "Enerji kullanim grubu kodu bulunamadi"));
      else if (group.unitId !== null && group.unitId !== unitId) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "energy_use_group_code", "group_unit_mismatch", "Enerji kullanim grubu secilen birime ait degil"));
      else if (subUnitId !== undefined && subUnitId !== null && group.subUnitId !== null && group.subUnitId !== subUnitId) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "energy_use_group_code", "group_sub_unit_mismatch", "Enerji kullanim grubu secilen alt birime ait degil"));
      else energyUseGroupId = group.id;
    }

    const standardPatch: Record<string, unknown> = {};
    for (const column of STANDARD_IMPORT_COLUMNS) {
      if (["equipment_code", "unit_code", "sub_unit_code", "sub_unit_name", "parent_equipment_code", "energy_use_group_code", "equipment_version"].includes(column)) continue;
      const parsed = parseStandardImportValue(column, rawRow.rawByCode.get(column));
      if (!parsed.present) continue;
      if ("error" in parsed) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, column, parsed.error ?? "invalid_value", parsed.message ?? "Gecersiz deger"));
      else {
        const field = COLUMN_TO_FIELD[column];
        if (field) standardPatch[field] = parsed.value;
      }
    }
    if (subUnitId !== undefined) standardPatch.subUnitId = subUnitId;
    if (parentEquipmentId !== undefined) standardPatch.parentEquipmentId = parentEquipmentId;
    if (energyUseGroupId !== undefined) standardPatch.energyUseGroupId = energyUseGroupId;

    const customPatch: Record<string, unknown> = {};
    for (const header of headers.filter((header) => header.startsWith("custom."))) {
      const code = header.slice("custom.".length);
      const definition = activeDefinitionsByCode.get(code);
      if (!definition) continue;
      const parsed = normalizeCustomImportRaw(definition, rawRow.rawByCode.get(header));
      if (!parsed.present) continue;
      if ("error" in parsed) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, header, parsed.error ?? "invalid_custom_value", parsed.message ?? "Gecersiz custom deger"));
      else customPatch[code] = parsed.value;
    }
    const meterLinks = meterRelations.result.get(equipmentCode) as EquipmentCreateRequest["meterLinks"] | undefined;
    const energySourceLinks = sourceRelations.result.get(equipmentCode) as EquipmentCreateRequest["energySourceLinks"] | undefined;
    if (meterLinks !== undefined) standardPatch.meterLinks = meterLinks;
    if (energySourceLinks !== undefined) standardPatch.energySourceLinks = energySourceLinks;
    if (Object.keys(customPatch).length > 0) standardPatch.customValues = customPatch;

    const version = parseExpectedVersion(rawRow.rawByCode.get("equipment_version"));
    if (existing) {
      if (existing.status === "archived") rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "status", "archived_update_unsupported", "Arsivli ekipman import ile guncellenemez"));
      if (version === null) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "equipment_version", "version_required", "Mevcut ekipman update icin equipment_version zorunludur"));
      else if (version !== existing.equipmentVersion) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "equipment_version", "version_conflict", "Ekipman dosya disari aktarildiktan sonra guncellenmis"));
      const data = { expectedEquipmentVersion: version ?? 0, ...standardPatch } as EquipmentPatchRequest;
      const isRelationOnlyOrFieldUpdate = Object.keys(data).length > 1;
      if (isRelationOnlyOrFieldUpdate) {
        const parsed = equipmentPatchRequestSchema.safeParse(data);
        if (!parsed.success) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, undefined, "invalid_update", parsed.error.issues[0]?.message ?? "Gecersiz ekipman update verisi"));
      }
      if (Object.keys(data).length === 1) {
        const preserveRelations = meterLinks === undefined && energySourceLinks === undefined;
        plans.push({ row: rawRow.rowNumber, equipmentCode, name: existing.name, action: rowIssues.length ? "error" : preserveRelations ? "no_change" : "update", changedFields: [], customFieldCodes: [], expectedEquipmentVersion: version, currentEquipmentVersion: existing.equipmentVersion, data, relationPolicy: { meters: meterLinks === undefined ? "preserve" : "replace", energySources: energySourceLinks === undefined ? "preserve" : "replace" }, issues: rowIssues });
      } else {
        plans.push({ row: rawRow.rowNumber, equipmentCode, name: asTrimmedString(standardPatch.name) || existing.name, action: rowIssues.length ? "error" : "update", changedFields: Object.keys(standardPatch).filter((key) => key !== "customValues" && key !== "meterLinks" && key !== "energySourceLinks"), customFieldCodes: Object.keys(customPatch), expectedEquipmentVersion: version, currentEquipmentVersion: existing.equipmentVersion, data, relationPolicy: { meters: meterLinks === undefined ? "preserve" : "replace", energySources: energySourceLinks === undefined ? "preserve" : "replace" }, issues: rowIssues });
      }
    } else {
      for (const required of EQUIPMENT_REQUIRED_CREATE_COLUMNS) {
        if (!asTrimmedString(rawRow.rawByCode.get(required))) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, required, "required", `${required} zorunludur`));
      }
      if (version !== null) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "equipment_version", "version_for_create", "Yeni ekipman satirinda equipment_version bos olmalidir"));
      const createCandidate: Record<string, unknown> = {
        equipmentCode,
        unitId: unitId ?? undefined,
        meterLinks: meterLinks ?? [],
        energySourceLinks: energySourceLinks ?? [],
        ...standardPatch,
        customValues: customPatch,
      };
      if (createCandidate.status === "archived") rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, "status", "archive_import_unsupported", "Import ile archive/reactivate desteklenmez"));
      const parsed = equipmentCreateRequestSchema.safeParse(createCandidate);
      if (!parsed.success) rowIssues.push(issue(EQUIPMENT_SHEET, rawRow.rowNumber, undefined, "invalid_create", parsed.error.issues[0]?.message ?? "Gecersiz ekipman verisi"));
      plans.push({ row: rawRow.rowNumber, equipmentCode, name: asTrimmedString(rawRow.rawByCode.get("name")) || null, action: rowIssues.length ? "error" : "create", changedFields: Object.keys(standardPatch), customFieldCodes: Object.keys(customPatch), expectedEquipmentVersion: null, currentEquipmentVersion: null, data: parsed.success ? parsed.data : undefined, relationPolicy: { meters: meterLinks === undefined ? "preserve" : "replace", energySources: energySourceLinks === undefined ? "preserve" : "replace" }, issues: rowIssues });
    }
  }
  const allIssues = [...issues, ...plans.flatMap((plan) => plan.issues)];
  const errorCount = plans.filter((plan) => plan.action === "error").length + issues.filter((item) => item.severity === "error").length;
  return {
    previewHash: fileHash(file.buffer),
    mode,
    fileName: file.originalname,
    fileSize: file.size,
    scope: { companyId: scope.companyId, unitId: scope.standardUnitId, role: scope.role },
    sheetSummaries: [
      { sheet: EQUIPMENT_SHEET, rows: totalRows },
      { sheet: METER_RELATION_SHEET, rows: meterRelations.rowCount },
      { sheet: ENERGY_SOURCE_RELATION_SHEET, rows: sourceRelations.rowCount },
    ],
    totalRows,
    createCount: plans.filter((plan) => plan.action === "create").length,
    updateCount: plans.filter((plan) => plan.action === "update").length,
    noChangeCount: plans.filter((plan) => plan.action === "no_change").length,
    errorCount,
    warningCount: allIssues.filter((item) => item.severity === "warning").length,
    canApply: errorCount === 0 && plans.some((plan) => plan.action === "create" || plan.action === "update"),
    rows: plans.slice(0, 200),
    issues: allIssues.slice(0, 300),
    relationSummary: {
      meterReplaceCount: [...meterRelations.result.keys()].length,
      energySourceReplaceCount: [...sourceRelations.result.keys()].length,
    },
  };
}

async function detailResponse(equipment: EquipmentRow, scope: Awaited<ReturnType<typeof resolveCompanyScope>>) {
  const links = await loadLinks(equipment.id);
  const customValues = equipmentCustomValues(equipment);
  const definitions = await getDefinitionsForEquipment(scope.companyId, customValues);
  return {
    equipment: serializeEquipment(equipment),
    meterLinks: links.meterLinks.map(serializeMeterLink),
    energySourceLinks: links.energySourceLinks.map(serializeSourceLink),
    parentSummary: await parentSummary(equipment),
    childSummary: await childSummary(equipment),
    customFields: definitions.map((definition) => ({
      definitionId: definition.id,
      code: definition.code,
      label: definition.label,
      section: definition.section,
      fieldType: definition.fieldType,
      unitLabel: definition.unitLabel,
      isActive: definition.isActive,
      isRequired: definition.isRequired,
      value: customValues[definition.code] ?? null,
    })),
    permissions: permissions(scope, equipment),
  };
}

router.get("/equipment/import/template", requireAuth, async (req, res) => {
  try {
    const scope = await resolveCompanyScope(req);
    const buffer = await buildEquipmentWorkbook(scope, []);
    const filename = `ekipman-import-sablonu-${sanitizeFilenamePart(scope.companyName)}-${todayForFilename()}.xlsx`;
    sendXlsxResponse(res, filename, buffer);
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman import sablonu indirilemedi" });
  }
});

router.get("/equipment/export", requireAuth, async (req, res) => {
  try {
    const scope = await resolveCompanyScope(req);
    const { rows, total, query } = await listEquipmentForQuery(scope, req.query, true);
    const buffer = await buildEquipmentWorkbook(scope, rows);
    await writeAuditEvent(db, {
      request: req,
      companyId: scope.companyId,
      unitId: scope.standardUnitId ?? query.unitId ?? null,
      action: "equipment.exported",
      entityType: "equipment_import_export",
      entityId: `export:${Date.now()}`,
      metadata: {
        rowCount: rows.length,
        totalMatched: total,
        includeArchived: query.includeArchived,
        filters: {
          unitId: query.unitId ?? null,
          subUnitId: query.subUnitId ?? null,
          category: query.category ?? null,
          status: query.status ?? null,
          meterId: query.meterId ?? null,
          energySourceId: query.energySourceId ?? null,
          energyUseGroupId: query.energyUseGroupId ?? null,
          search: query.search ? "[present]" : null,
        },
      },
    });
    const filename = `ekipman-envanteri-${sanitizeFilenamePart(scope.companyName)}-${todayForFilename()}.xlsx`;
    sendXlsxResponse(res, filename, buffer);
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman export alinamadi" });
  }
});

router.post("/equipment/import/preview", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "XLSX dosyasi zorunludur" });
      return;
    }
    const preview = await parseEquipmentImportWorkbook(req, req.file, IMPORT_MODE);
    res.json(preview);
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman import preview olusturulamadi" });
  }
});

router.post("/equipment/import/apply", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "XLSX dosyasi zorunludur" });
      return;
    }
    const expectedHash = typeof req.body?.previewHash === "string" ? req.body.previewHash : "";
    const actualHash = fileHash(req.file.buffer);
    if (!expectedHash || expectedHash !== actualHash) {
      res.status(409).json({ error: "Dosya preview sonrasi degismis veya previewHash gecersiz" });
      return;
    }
    const scope = await resolveCompanyScope(req);
    const preview = await parseEquipmentImportWorkbook(req, req.file, IMPORT_MODE);
    if (!preview.canApply) {
      res.status(400).json(preview);
      return;
    }
    const result = await db.transaction(async (tx) => {
      const changed: Array<{ id: number; code: string; action: "created" | "updated"; unitId: number; previousVersion: number; newVersion: number }> = [];
      for (const plan of preview.rows) {
        if (plan.action === "no_change") continue;
        if (plan.action === "error" || !plan.data) throw new EquipmentScopeError(400, "Import plani hatali; preview'u yenileyin");
        if (plan.action === "create") {
          const parsed = equipmentCreateRequestSchema.safeParse(plan.data);
          if (!parsed.success) throw new EquipmentScopeError(400, parsed.error.issues[0]?.message ?? "Gecersiz ekipman create verisi");
          const data = parsed.data;
          const unitId = scope.standardUnitId ?? data.unitId;
          if (unitId === undefined) throw new EquipmentScopeError(400, "unitId zorunludur");
          await validateUnit(scope, unitId);
          validateLifecycleFields(data);
          await validateRelations({
            tx,
            companyId: scope.companyId,
            unitId,
            subUnitId: data.subUnitId,
            parentEquipmentId: data.parentEquipmentId,
            energyUseGroupId: data.energyUseGroupId,
            meterLinks: data.meterLinks,
            energySourceLinks: data.energySourceLinks,
          });
          const customValidation = await normalizeEquipmentCustomPatch(scope.companyId, {}, data.customValues ?? {});
          if (!customValidation.ok) throw new EquipmentScopeError(400, customValidation.error);
          const [created] = await tx.insert(equipmentTable)
            .values({ ...createValues(data, scope.companyId, unitId, scope.userId), customValues: customValidation.value })
            .onConflictDoNothing({ target: [equipmentTable.companyId, equipmentTable.equipmentCode] })
            .returning();
          if (!created) throw new EquipmentScopeError(409, "Bu ekipman kodu sirket icinde zaten kullaniliyor");
          await replaceLinks(tx, { equipmentId: created.id, companyId: scope.companyId, userId: scope.userId, meterLinks: data.meterLinks, energySourceLinks: data.energySourceLinks });
          await writeAuditEvent(tx, {
            request: req,
            companyId: scope.companyId,
            unitId: created.unitId,
            action: "equipment.created",
            entityType: "equipment",
            entityId: created.id,
            changes: { changedFields: ["created"], previousVersion: 0, newVersion: created.equipmentVersion },
            metadata: {
              equipmentCode: created.equipmentCode,
              imported: true,
              meterCount: data.meterLinks.length,
              energySourceCount: data.energySourceLinks.length,
              customFieldCodes: Object.keys(customValidation.value),
            },
          });
          changed.push({ id: created.id, code: created.equipmentCode, action: "created", unitId: created.unitId, previousVersion: 0, newVersion: created.equipmentVersion });
        } else if (plan.action === "update") {
          const parsed = equipmentPatchRequestSchema.safeParse(plan.data);
          if (!parsed.success) throw new EquipmentScopeError(400, parsed.error.issues[0]?.message ?? "Gecersiz ekipman update verisi");
          const data = parsed.data;
          const [existing] = await tx.select().from(equipmentTable)
            .where(and(eq(equipmentTable.companyId, scope.companyId), eq(equipmentTable.equipmentCode, plan.equipmentCode)))
            .limit(1)
            .for("update");
          if (!existing) throw new EquipmentScopeError(404, "Ekipman bulunamadi");
          if (scope.standardUnitId !== null && existing.unitId !== scope.standardUnitId) throw new EquipmentScopeError(403, "Yetki yok");
          if (existing.status === "archived") throw new EquipmentScopeError(409, "Arsivli ekipman guncellenemez");
          if (existing.equipmentVersion !== data.expectedEquipmentVersion) throw new EquipmentScopeError(409, "Ekipman baska bir oturum tarafindan guncellendi.");
          const patch = patchValues(data);
          const effectiveSubUnitId = data.subUnitId !== undefined ? data.subUnitId : existing.subUnitId;
          const effectiveParentId = data.parentEquipmentId !== undefined ? data.parentEquipmentId : existing.parentEquipmentId;
          const effectiveEnergyUseGroupId = data.energyUseGroupId !== undefined ? data.energyUseGroupId : existing.energyUseGroupId;
          validateLifecycleFields({ ...existing, ...data });
          await validateRelations({
            tx,
            companyId: scope.companyId,
            unitId: existing.unitId,
            equipmentId: existing.id,
            subUnitId: effectiveSubUnitId,
            parentEquipmentId: effectiveParentId,
            energyUseGroupId: effectiveEnergyUseGroupId,
            meterLinks: data.meterLinks,
            energySourceLinks: data.energySourceLinks,
          });
          const customValidation = await normalizeEquipmentCustomPatch(scope.companyId, equipmentCustomValues(existing), data.customValues);
          if (!customValidation.ok) throw new EquipmentScopeError(400, customValidation.error);
          if (data.customValues !== undefined) patch.customValues = customValidation.value;
          const relationChanged = data.meterLinks !== undefined || data.energySourceLinks !== undefined;
          const next = { ...existing, ...patch };
          const changedFields = Object.keys(changedAuditFields(existing, next, [...EQUIPMENT_MUTABLE_FIELDS]));
          const changedCustomCodes = customValidation.changedCodes;
          if (changedFields.length === 0 && !relationChanged && changedCustomCodes.length === 0) continue;
          const now = new Date();
          const [updated] = await tx.update(equipmentTable)
            .set({ ...patch, equipmentVersion: existing.equipmentVersion + 1, updatedAt: now, updatedBy: scope.userId })
            .where(and(eq(equipmentTable.id, existing.id), eq(equipmentTable.equipmentVersion, data.expectedEquipmentVersion)))
            .returning();
          if (!updated) throw new EquipmentScopeError(409, "Ekipman baska bir oturum tarafindan guncellendi.");
          await replaceLinks(tx, { equipmentId: updated.id, companyId: scope.companyId, userId: scope.userId, meterLinks: data.meterLinks, energySourceLinks: data.energySourceLinks });
          await writeAuditEvent(tx, {
            request: req,
            companyId: scope.companyId,
            unitId: updated.unitId,
            action: "equipment.updated",
            entityType: "equipment",
            entityId: updated.id,
            changes: { changedFields, previousVersion: existing.equipmentVersion, newVersion: updated.equipmentVersion },
            metadata: {
              equipmentCode: updated.equipmentCode,
              imported: true,
              relationPolicy: plan.relationPolicy,
              customFieldCodes: changedCustomCodes,
            },
          });
          changed.push({ id: updated.id, code: updated.equipmentCode, action: "updated", unitId: updated.unitId, previousVersion: existing.equipmentVersion, newVersion: updated.equipmentVersion });
        }
      }
      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        unitId: scope.standardUnitId,
        action: "equipment.imported",
        entityType: "equipment_import_export",
        entityId: `import:${actualHash.slice(0, 16)}`,
        metadata: {
          fileName: req.file?.originalname ?? "upload.xlsx",
          fileHash: actualHash.slice(0, 16),
          mode: IMPORT_MODE,
          createCount: changed.filter((row) => row.action === "created").length,
          updateCount: changed.filter((row) => row.action === "updated").length,
          noChangeCount: preview.noChangeCount,
          rowCount: preview.totalRows,
          relationSummary: preview.relationSummary,
        },
      });
      return changed;
    });
    res.json({
      ok: true,
      mode: IMPORT_MODE,
      appliedCount: result.length,
      createCount: result.filter((row) => row.action === "created").length,
      updateCount: result.filter((row) => row.action === "updated").length,
      noChangeCount: preview.noChangeCount,
      rows: result.slice(0, 100),
    });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman import uygulanamadi" });
  }
});

router.get("/equipment", requireAuth, async (req, res) => {
  try {
    const scope = await resolveCompanyScope(req);
    const parsed = equipmentListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz ekipman filtresi" });
      return;
    }
    const query = parsed.data;
    const requestedUnitId = scope.standardUnitId !== null ? scope.standardUnitId : query.unitId;
    if (scope.standardUnitId !== null && query.unitId !== undefined && query.unitId !== scope.standardUnitId) {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }
    if (requestedUnitId !== undefined) await validateUnit(scope, requestedUnitId);

    const conditions: SQL[] = [eq(equipmentTable.companyId, scope.companyId)];
    if (requestedUnitId !== undefined) conditions.push(eq(equipmentTable.unitId, requestedUnitId));
    if (query.subUnitId !== undefined) conditions.push(eq(equipmentTable.subUnitId, query.subUnitId));
    if (query.category !== undefined) conditions.push(eq(equipmentTable.category, query.category));
    if (query.status !== undefined) conditions.push(eq(equipmentTable.status, query.status));
    if (query.energyUseGroupId !== undefined) conditions.push(eq(equipmentTable.energyUseGroupId, query.energyUseGroupId));
    if (query.parentEquipmentId !== undefined) conditions.push(eq(equipmentTable.parentEquipmentId, query.parentEquipmentId));
    if (query.parentless === true) conditions.push(isNull(equipmentTable.parentEquipmentId));
    if (!query.includeArchived && query.status === undefined) conditions.push(or(eq(equipmentTable.status, "active"), eq(equipmentTable.status, "standby"), eq(equipmentTable.status, "maintenance"), eq(equipmentTable.status, "faulty"), eq(equipmentTable.status, "out_of_service"))!);
    if (query.search) {
      const pattern = `%${query.search.replace(/[%_]/g, "\\$&")}%`;
      conditions.push(or(
        ilike(equipmentTable.equipmentCode, pattern),
        ilike(equipmentTable.name, pattern),
        ilike(equipmentTable.assetCode, pattern),
      )!);
    }
    if (query.meterId !== undefined) {
      const rows = await db.select({ equipmentId: equipmentMeterLinksTable.equipmentId })
        .from(equipmentMeterLinksTable)
        .where(and(eq(equipmentMeterLinksTable.companyId, scope.companyId), eq(equipmentMeterLinksTable.meterId, query.meterId)));
      if (rows.length === 0) {
        res.json({ items: [], total: 0, limit: query.limit, offset: query.offset, permissions: permissions(scope, null) });
        return;
      }
      conditions.push(inArray(equipmentTable.id, rows.map((row) => row.equipmentId)));
    }
    if (query.energySourceId !== undefined) {
      const rows = await db.select({ equipmentId: equipmentEnergySourceLinksTable.equipmentId })
        .from(equipmentEnergySourceLinksTable)
        .where(and(eq(equipmentEnergySourceLinksTable.companyId, scope.companyId), eq(equipmentEnergySourceLinksTable.energySourceId, query.energySourceId)));
      if (rows.length === 0) {
        res.json({ items: [], total: 0, limit: query.limit, offset: query.offset, permissions: permissions(scope, null) });
        return;
      }
      conditions.push(inArray(equipmentTable.id, rows.map((row) => row.equipmentId)));
    }

    const [totalRow] = await db.select({ value: count() }).from(equipmentTable).where(and(...conditions));
    const rows = await db.select()
      .from(equipmentTable)
      .where(and(...conditions))
      .orderBy(desc(equipmentTable.updatedAt), desc(equipmentTable.id))
      .limit(query.limit)
      .offset(query.offset);
    const primaryMeters = await db.select().from(equipmentMeterLinksTable)
      .where(and(eq(equipmentMeterLinksTable.companyId, scope.companyId), eq(equipmentMeterLinksTable.isPrimary, true)));
    const primarySources = await db.select().from(equipmentEnergySourceLinksTable)
      .where(and(eq(equipmentEnergySourceLinksTable.companyId, scope.companyId), eq(equipmentEnergySourceLinksTable.isPrimary, true)));
    const primaryMeterByEquipment = new Map(primaryMeters.map((link) => [link.equipmentId, link.meterId]));
    const primarySourceByEquipment = new Map(primarySources.map((link) => [link.equipmentId, link.energySourceId]));
    res.json({
      items: rows.map((row) => ({
        ...serializeEquipment(row),
        technicalNotes: undefined,
        maintenanceNotes: undefined,
        efficiencyOpportunities: undefined,
        plannedImprovements: undefined,
        primaryMeterId: primaryMeterByEquipment.get(row.id) ?? null,
        primaryEnergySourceId: primarySourceByEquipment.get(row.id) ?? null,
      })),
      total: totalRow?.value ?? 0,
      limit: query.limit,
      offset: query.offset,
      permissions: permissions(scope, null),
    });
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman listesi alinamadi" });
  }
});

router.post("/equipment", requireAuth, async (req, res) => {
  try {
    const scope = await resolveCompanyScope(req);
    const parsed = equipmentCreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz ekipman verisi" });
      return;
    }
    const data = parsed.data;
    const unitId = scope.standardUnitId ?? data.unitId;
    if (unitId === undefined) {
      res.status(400).json({ error: "unitId zorunludur" });
      return;
    }
    await validateUnit(scope, unitId);
    validateLifecycleFields(data);

    const result = await db.transaction(async (tx) => {
      await validateRelations({
        tx,
        companyId: scope.companyId,
        unitId,
        subUnitId: data.subUnitId,
        parentEquipmentId: data.parentEquipmentId,
        energyUseGroupId: data.energyUseGroupId,
        meterLinks: data.meterLinks,
        energySourceLinks: data.energySourceLinks,
      });
      const customValidation = await normalizeEquipmentCustomPatch(scope.companyId, {}, data.customValues ?? {});
      if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
      const [created] = await tx.insert(equipmentTable)
        .values({ ...createValues(data, scope.companyId, unitId, scope.userId), customValues: customValidation.value })
        .onConflictDoNothing({ target: [equipmentTable.companyId, equipmentTable.equipmentCode] })
        .returning();
      if (!created) return { status: "duplicate" as const };
      await replaceLinks(tx, {
        equipmentId: created.id,
        companyId: scope.companyId,
        userId: scope.userId,
        meterLinks: data.meterLinks,
        energySourceLinks: data.energySourceLinks,
      });
      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        unitId: created.unitId,
        action: "equipment.created",
        entityType: "equipment",
        entityId: created.id,
        changes: { changedFields: ["created"], previousVersion: 0, newVersion: created.equipmentVersion },
        metadata: {
          equipmentCode: created.equipmentCode,
          meterIds: data.meterLinks.map((link) => link.meterId),
          energySourceIds: data.energySourceLinks.map((link) => link.energySourceId),
          customFieldCodes: Object.keys(customValidation.value),
        },
      });
      return { status: "ok" as const, equipment: created };
    });
    if (result.status === "duplicate") {
      res.status(409).json({ error: "Bu ekipman kodu sirket icinde zaten kullaniliyor" });
      return;
    }
    if (result.status === "custom-validation") {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json(await detailResponse(result.equipment, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman olusturulamadi" });
  }
});

router.get("/equipment/:id", requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, "equipmentId");
    const scope = await resolveRecordScope(req, id);
    res.json(await detailResponse(scope.equipment, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman detayi alinamadi" });
  }
});

router.patch("/equipment/:id", requireAuth, async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, "equipmentId");
    const scope = await resolveRecordScope(req, id);
    if (scope.equipment.status === "archived") {
      res.status(409).json({ error: "Arsivli ekipman guncellenemez" });
      return;
    }
    const parsed = equipmentPatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz ekipman verisi" });
      return;
    }
    const data = parsed.data;
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(equipmentTable)
        .where(and(eq(equipmentTable.id, id), eq(equipmentTable.companyId, scope.companyId)))
        .limit(1)
        .for("update");
      if (!existing) return { status: "not-found" as const };
      if (scope.standardUnitId !== null && existing.unitId !== scope.standardUnitId) return { status: "forbidden" as const };
      if (existing.equipmentVersion !== data.expectedEquipmentVersion) return { status: "conflict" as const, equipment: existing };
      if (existing.status === "archived") return { status: "archived" as const };
      const patch = patchValues(data);
      const effectiveSubUnitId = data.subUnitId !== undefined ? data.subUnitId : existing.subUnitId;
      const effectiveParentId = data.parentEquipmentId !== undefined ? data.parentEquipmentId : existing.parentEquipmentId;
      const effectiveEnergyUseGroupId = data.energyUseGroupId !== undefined ? data.energyUseGroupId : existing.energyUseGroupId;
      validateLifecycleFields({ ...existing, ...data });
      await validateRelations({
        tx,
        companyId: scope.companyId,
        unitId: existing.unitId,
        equipmentId: existing.id,
        subUnitId: effectiveSubUnitId,
        parentEquipmentId: effectiveParentId,
        energyUseGroupId: effectiveEnergyUseGroupId,
        meterLinks: data.meterLinks,
        energySourceLinks: data.energySourceLinks,
      });
      const existingCustomValues = equipmentCustomValues(existing);
      const customValidation = await normalizeEquipmentCustomPatch(scope.companyId, existingCustomValues, data.customValues);
      if (!customValidation.ok) return { status: "custom-validation" as const, error: customValidation.error };
      if (data.customValues !== undefined) patch.customValues = customValidation.value;

      const currentLinks = await Promise.all([
        tx.select().from(equipmentMeterLinksTable).where(eq(equipmentMeterLinksTable.equipmentId, id)),
        tx.select().from(equipmentEnergySourceLinksTable).where(eq(equipmentEnergySourceLinksTable.equipmentId, id)),
      ]);
      const relationChanged = data.meterLinks !== undefined || data.energySourceLinks !== undefined;
      const next = { ...existing, ...patch };
      const changedFields = Object.keys(changedAuditFields(existing, next, [...EQUIPMENT_MUTABLE_FIELDS]));
      const changedCustomCodes = customValidation.changedCodes;
      if (changedFields.length === 0 && !relationChanged && changedCustomCodes.length === 0) return { status: "ok" as const, equipment: existing };
      const now = new Date();
      const [updated] = await tx.update(equipmentTable)
        .set({
          ...patch,
          equipmentVersion: existing.equipmentVersion + 1,
          updatedAt: now,
          updatedBy: scope.userId,
        })
        .where(and(eq(equipmentTable.id, id), eq(equipmentTable.equipmentVersion, data.expectedEquipmentVersion)))
        .returning();
      if (!updated) return { status: "conflict" as const, equipment: existing };
      await replaceLinks(tx, {
        equipmentId: id,
        companyId: scope.companyId,
        userId: scope.userId,
        meterLinks: data.meterLinks,
        energySourceLinks: data.energySourceLinks,
      });
      await writeAuditEvent(tx, {
        request: req,
        companyId: scope.companyId,
        unitId: updated.unitId,
        action: "equipment.updated",
        entityType: "equipment",
        entityId: updated.id,
        changes: {
          changedFields,
          previousVersion: existing.equipmentVersion,
          newVersion: updated.equipmentVersion,
        },
        metadata: {
          equipmentCode: updated.equipmentCode,
          parentChange: existing.parentEquipmentId !== updated.parentEquipmentId ? { before: existing.parentEquipmentId, after: updated.parentEquipmentId } : undefined,
          statusChange: existing.status !== updated.status ? { before: existing.status, after: updated.status } : undefined,
          operationalStatusChange: existing.operationalStatus !== updated.operationalStatus ? { before: existing.operationalStatus, after: updated.operationalStatus } : undefined,
          lifecycleFields: changedFields.filter((field) => ["purchaseDate", "commissioningDate", "manufactureYear", "expectedLifeYears", "plannedReplacementYear"].includes(field)),
          meterIdsBefore: currentLinks[0].map((link) => link.meterId),
          meterIdsAfter: data.meterLinks?.map((link) => link.meterId) ?? undefined,
          energySourceIdsBefore: currentLinks[1].map((link) => link.energySourceId),
          energySourceIdsAfter: data.energySourceLinks?.map((link) => link.energySourceId) ?? undefined,
          customFieldCodes: changedCustomCodes,
        },
      });
      return { status: "ok" as const, equipment: updated };
    });
    if (result.status === "not-found") {
      res.status(404).json({ error: "Ekipman bulunamadi" });
      return;
    }
    if (result.status === "forbidden") {
      res.status(403).json({ error: "Yetki yok" });
      return;
    }
    if (result.status === "archived") {
      res.status(409).json({ error: "Arsivli ekipman guncellenemez" });
      return;
    }
    if (result.status === "custom-validation") {
      res.status(400).json({ error: result.error });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({ error: "Ekipman baska bir oturum tarafindan guncellendi.", equipment: serializeEquipment(result.equipment) });
      return;
    }
    res.json(await detailResponse(result.equipment, scope));
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman guncellenemedi" });
  }
});

async function equipmentStatusMutation(req: Request, res: Response, mode: "archive" | "reactivate") {
  const id = parsePositiveInteger(req.params.id, "equipmentId");
  const scope = await resolveRecordScope(req, id);
  if (!scope.canArchive) throw new EquipmentScopeError(403, "Ekipman arsivleme yetkiniz yok");
  const parsed = (mode === "archive" ? equipmentArchiveRequestSchema : equipmentReactivateRequestSchema).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Gecersiz ekipman durumu" });
    return;
  }
  const payload = parsed.data as EquipmentArchiveRequest | EquipmentReactivateRequest;
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(equipmentTable)
      .where(and(eq(equipmentTable.id, id), eq(equipmentTable.companyId, scope.companyId)))
      .limit(1)
      .for("update");
    if (!existing) return { status: "not-found" as const };
    if (existing.equipmentVersion !== parsed.data.expectedEquipmentVersion) return { status: "conflict" as const, equipment: existing };
    if (mode === "archive" && existing.status === "archived") return { status: "already-archived" as const, equipment: existing };
    if (mode === "reactivate" && existing.status !== "archived") return { status: "not-archived" as const, equipment: existing };
    let dependencyWarnings: DependencyWarning[] = [];
    if (mode === "archive") {
      const childDependency = await activeChildDependency(tx, existing.id, existing.companyId);
      if (childDependency) return childDependency;
    }
    if (mode === "reactivate") {
      await validateUnit(scope, existing.unitId);
      await validateRelations({
        tx,
        companyId: existing.companyId,
        unitId: existing.unitId,
        equipmentId: existing.id,
        subUnitId: existing.subUnitId,
        parentEquipmentId: existing.parentEquipmentId,
        energyUseGroupId: existing.energyUseGroupId,
        meterLinks: undefined,
        energySourceLinks: undefined,
      });
      dependencyWarnings = await validateStoredLinkIntegrity(tx, existing);
      validateLifecycleFields({ ...existing, status: (payload as EquipmentReactivateRequest).status });
    }
    const now = new Date();
    const [updated] = await tx.update(equipmentTable).set({
      status: mode === "archive" ? "archived" : (payload as EquipmentReactivateRequest).status,
      archivedAt: mode === "archive" ? now : null,
      archivedBy: mode === "archive" ? scope.userId : null,
      equipmentVersion: existing.equipmentVersion + 1,
      updatedAt: now,
      updatedBy: scope.userId,
    }).where(and(eq(equipmentTable.id, id), eq(equipmentTable.equipmentVersion, payload.expectedEquipmentVersion))).returning();
    if (!updated) return { status: "conflict" as const, equipment: existing };
    const action: AuditAction = mode === "archive" ? "equipment.archived" : "equipment.reactivated";
    await writeAuditEvent(tx, {
      request: req,
      companyId: updated.companyId,
      unitId: updated.unitId,
      action,
      entityType: "equipment",
      entityId: updated.id,
      changes: {
        changedFields: ["status"],
        previousVersion: existing.equipmentVersion,
        newVersion: updated.equipmentVersion,
      },
      metadata: {
        equipmentCode: updated.equipmentCode,
        reason: mode === "archive" ? (payload as EquipmentArchiveRequest).reason ?? null : null,
        previousStatus: existing.status,
        newStatus: updated.status,
        operationalStatus: updated.operationalStatus,
        dependencyWarnings,
      },
    });
    return { status: "ok" as const, equipment: updated };
  });
  if (result.status === "not-found") {
    res.status(404).json({ error: "Ekipman bulunamadi" });
    return;
  }
  if (result.status === "conflict") {
    res.status(409).json({ error: "Ekipman baska bir oturum tarafindan guncellendi.", equipment: serializeEquipment(result.equipment) });
    return;
  }
  if (result.status === "already-archived") {
    res.status(409).json({ error: "Ekipman zaten arsivli", equipment: serializeEquipment(result.equipment) });
    return;
  }
  if (result.status === "not-archived") {
    res.status(409).json({ error: "Ekipman arsivli degil", equipment: serializeEquipment(result.equipment) });
    return;
  }
  if (result.status === "active-children") {
    res.status(409).json({
      error: "Bu ekipmana bagli aktif alt ekipmanlar bulunuyor.",
      code: "EQUIPMENT_HAS_ACTIVE_CHILDREN",
      activeChildCount: result.activeChildCount,
      children: result.children,
    });
    return;
  }
  res.json(await detailResponse(result.equipment, scope));
}

router.post("/equipment/:id/archive", requireAuth, async (req, res) => {
  try {
    await equipmentStatusMutation(req, res, "archive");
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman arsivlenemedi" });
  }
});

router.post("/equipment/:id/reactivate", requireAuth, async (req, res) => {
  try {
    await equipmentStatusMutation(req, res, "reactivate");
  } catch (error) {
    if (handleScopeError(res, error)) return;
    req.log.error(error);
    res.status(500).json({ error: "Ekipman yeniden aktifi hale getirilemedi" });
  }
});

export default router;
