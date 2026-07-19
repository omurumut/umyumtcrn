import { z } from "zod/v4";

export const UNIT_TECHNICAL_PROFILE_CUSTOM_BOOLEAN_STATUSES = ["yes", "no", "unknown", "not_applicable"] as const;

export const UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPES = [
  "short_text",
  "long_text",
  "integer",
  "decimal",
  "boolean",
  "single_select",
  "multi_select",
  "date",
  "unit_number",
] as const;

export type UnitTechnicalProfileCustomFieldType = typeof UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPES[number];

export const UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPE_LABELS: Record<UnitTechnicalProfileCustomFieldType, string> = {
  short_text: "Kisa metin",
  long_text: "Uzun metin",
  integer: "Tam sayi",
  decimal: "Ondalik sayi",
  boolean: "Durum",
  single_select: "Tek secim",
  multi_select: "Coklu secim",
  date: "Tarih",
  unit_number: "Birimli sayi",
};

export const unitTechnicalProfileCustomFieldTypeSchema = z.enum(UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPES);

export const unitTechnicalProfileCustomFieldOptionSchema = z.strictObject({
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/).max(64),
  label: z.string().trim().min(1).max(120),
  isActive: z.boolean().default(true),
});

export type UnitTechnicalProfileCustomFieldOption = z.infer<typeof unitTechnicalProfileCustomFieldOptionSchema>;

export const unitTechnicalProfileCustomFieldValidationConfigSchema = z.strictObject({
  minLength: z.number().int().min(0).max(2000).optional(),
  maxLength: z.number().int().min(1).max(2000).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  decimalPlaces: z.number().int().min(0).max(6).optional(),
  allowNegative: z.boolean().optional(),
  minSelections: z.number().int().min(0).max(50).optional(),
  maxSelections: z.number().int().min(1).max(50).optional(),
  minDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).superRefine((value, ctx) => {
  if (value.minLength !== undefined && value.maxLength !== undefined && value.minLength > value.maxLength) {
    ctx.addIssue({ code: "custom", message: "minLength maxLength degerinden buyuk olamaz", path: ["minLength"] });
  }
  if (value.min !== undefined && value.max !== undefined && value.min > value.max) {
    ctx.addIssue({ code: "custom", message: "min max degerinden buyuk olamaz", path: ["min"] });
  }
  if (value.minSelections !== undefined && value.maxSelections !== undefined && value.minSelections > value.maxSelections) {
    ctx.addIssue({ code: "custom", message: "minSelections maxSelections degerinden buyuk olamaz", path: ["minSelections"] });
  }
  if (value.minDate !== undefined && value.maxDate !== undefined && value.minDate > value.maxDate) {
    ctx.addIssue({ code: "custom", message: "minDate maxDate degerinden buyuk olamaz", path: ["minDate"] });
  }
});

export type UnitTechnicalProfileCustomFieldValidationConfig = z.infer<typeof unitTechnicalProfileCustomFieldValidationConfigSchema>;

function trimNullable(max: number) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    },
    z.string().max(max).nullable(),
  );
}

function uniqueOptionCodes(options: UnitTechnicalProfileCustomFieldOption[]) {
  return new Set(options.map((option) => option.code)).size === options.length;
}

export const unitTechnicalProfileCustomFieldDefinitionBaseSchema = z.strictObject({
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/).max(64),
  label: z.string().trim().min(1).max(160),
  description: trimNullable(1000).optional(),
  fieldType: unitTechnicalProfileCustomFieldTypeSchema,
  unitLabel: trimNullable(40).optional(),
  options: z.array(unitTechnicalProfileCustomFieldOptionSchema).max(50).default([]),
  isRequiredForPublish: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10000).default(0),
  validationConfig: unitTechnicalProfileCustomFieldValidationConfigSchema.default({}),
}).superRefine((value, ctx) => {
  if (isReservedUnitTechnicalProfileFieldCode(value.code)) {
    ctx.addIssue({ code: "custom", message: "Standart teknik profil alan kodu kullanilamaz", path: ["code"] });
  }
  if (!uniqueOptionCodes(value.options)) {
    ctx.addIssue({ code: "custom", message: "Secenek kodlari benzersiz olmalidir", path: ["options"] });
  }
  if ((value.fieldType === "single_select" || value.fieldType === "multi_select") && value.options.filter((option) => option.isActive).length === 0) {
    ctx.addIssue({ code: "custom", message: "Secimli alan icin en az bir aktif secenek zorunludur", path: ["options"] });
  }
  if (value.fieldType !== "single_select" && value.fieldType !== "multi_select" && value.options.length > 0) {
    ctx.addIssue({ code: "custom", message: "Secenekler sadece secimli alanlarda kullanilir", path: ["options"] });
  }
});

export const unitTechnicalProfileCustomFieldDefinitionCreateSchema = unitTechnicalProfileCustomFieldDefinitionBaseSchema;

export const unitTechnicalProfileCustomFieldDefinitionPatchSchema = unitTechnicalProfileCustomFieldDefinitionBaseSchema
  .partial()
  .extend({
    expectedDefinitionVersion: z.number().int().min(1),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedDefinitionVersion"),
    "Guncellenecek en az bir alan tanimi gonderilmelidir",
  );

export const unitTechnicalProfileCustomFieldDefinitionArchiveSchema = z.strictObject({
  expectedDefinitionVersion: z.number().int().min(1),
});

export const unitTechnicalProfileCustomFieldDefinitionSchema = unitTechnicalProfileCustomFieldDefinitionBaseSchema.extend({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  definitionVersion: z.number().int().min(1),
  createdAt: z.string(),
  createdBy: z.number().int().positive().nullable(),
  updatedAt: z.string(),
  updatedBy: z.number().int().positive().nullable(),
  usageCount: z.number().int().min(0).optional(),
  hasValues: z.boolean().optional(),
});

export type UnitTechnicalProfileCustomFieldDefinitionCreate = z.infer<typeof unitTechnicalProfileCustomFieldDefinitionCreateSchema>;
export type UnitTechnicalProfileCustomFieldDefinitionPatch = z.infer<typeof unitTechnicalProfileCustomFieldDefinitionPatchSchema>;
export type UnitTechnicalProfileCustomFieldDefinitionDto = z.infer<typeof unitTechnicalProfileCustomFieldDefinitionSchema>;

export const unitTechnicalProfileCustomFieldDefinitionsResponseSchema = z.strictObject({
  definitions: z.array(unitTechnicalProfileCustomFieldDefinitionSchema),
  permissions: z.strictObject({
    canEdit: z.boolean(),
  }),
});

export type UnitTechnicalProfileCustomFieldDefinitionsResponse = z.infer<typeof unitTechnicalProfileCustomFieldDefinitionsResponseSchema>;

export type UnitTechnicalProfileCustomFieldValueMap = Record<string, unknown>;

export const unitTechnicalProfileCustomFieldValuesSchema = z.record(z.string(), z.unknown()).default({});

const RESERVED_FIELD_CODES = new Set<string>([
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
  "customFieldDefinitions",
  "customFieldValues",
  "expectedProfileVersion",
]);

export function isReservedUnitTechnicalProfileFieldCode(code: string) {
  return RESERVED_FIELD_CODES.has(code) || code.startsWith("sys_") || code.startsWith("standard_");
}

function hasCustomValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function optionCodes(definition: Pick<UnitTechnicalProfileCustomFieldDefinitionDto, "options">, activeOnly = true) {
  return new Set(definition.options.filter((option) => !activeOnly || option.isActive).map((option) => option.code));
}

export function normalizeUnitTechnicalProfileCustomFieldValue(
  definition: Pick<UnitTechnicalProfileCustomFieldDefinitionDto, "code" | "fieldType" | "label" | "options" | "validationConfig">,
  rawValue: unknown,
): ValidationResult<unknown> {
  const config = definition.validationConfig ?? {};
  if (rawValue === null || rawValue === undefined || rawValue === "") return { ok: true, value: null };

  if (definition.fieldType === "short_text" || definition.fieldType === "long_text") {
    if (typeof rawValue !== "string") return { ok: false, error: `${definition.label} metin olmalidir` };
    const value = rawValue.trim();
    const defaultMax = definition.fieldType === "short_text" ? 250 : 2000;
    const minLength = config.minLength ?? 0;
    const maxLength = config.maxLength ?? defaultMax;
    if (value.length < minLength) return { ok: false, error: `${definition.label} cok kisa` };
    if (value.length > maxLength) return { ok: false, error: `${definition.label} cok uzun` };
    return { ok: true, value: value || null };
  }

  if (definition.fieldType === "integer" || definition.fieldType === "decimal" || definition.fieldType === "unit_number") {
    const value = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" && rawValue.trim() !== "" ? Number(rawValue) : Number.NaN;
    if (!Number.isFinite(value)) return { ok: false, error: `${definition.label} sayi olmalidir` };
    if (definition.fieldType === "integer" && !Number.isInteger(value)) return { ok: false, error: `${definition.label} tam sayi olmalidir` };
    if (!config.allowNegative && value < 0) return { ok: false, error: `${definition.label} negatif olamaz` };
    if (config.min !== undefined && value < config.min) return { ok: false, error: `${definition.label} minimum degerin altinda` };
    if (config.max !== undefined && value > config.max) return { ok: false, error: `${definition.label} maksimum degerin ustunde` };
    if (config.decimalPlaces !== undefined && !Number.isInteger(value * (10 ** config.decimalPlaces))) {
      return { ok: false, error: `${definition.label} ondalik hassasiyeti gecersiz` };
    }
    return { ok: true, value };
  }

  if (definition.fieldType === "boolean") {
    if (typeof rawValue !== "string" || !(UNIT_TECHNICAL_PROFILE_CUSTOM_BOOLEAN_STATUSES as readonly string[]).includes(rawValue)) {
      return { ok: false, error: `${definition.label} durumu gecersiz` };
    }
    return { ok: true, value: rawValue };
  }

  if (definition.fieldType === "single_select") {
    if (typeof rawValue !== "string") return { ok: false, error: `${definition.label} secimi gecersiz` };
    if (!optionCodes(definition).has(rawValue)) return { ok: false, error: `${definition.label} secimi aktif degil` };
    return { ok: true, value: rawValue };
  }

  if (definition.fieldType === "multi_select") {
    if (!Array.isArray(rawValue) || rawValue.some((value) => typeof value !== "string")) {
      return { ok: false, error: `${definition.label} secimleri gecersiz` };
    }
    const values = [...new Set(rawValue as string[])];
    if (values.length !== rawValue.length) return { ok: false, error: `${definition.label} secimleri tekrarlanamaz` };
    const allowed = optionCodes(definition);
    if (values.some((value) => !allowed.has(value))) return { ok: false, error: `${definition.label} secimi aktif degil` };
    if (config.minSelections !== undefined && values.length < config.minSelections) return { ok: false, error: `${definition.label} secimi eksik` };
    if (config.maxSelections !== undefined && values.length > config.maxSelections) return { ok: false, error: `${definition.label} cok fazla secim iceriyor` };
    return { ok: true, value: values };
  }

  if (definition.fieldType === "date") {
    if (typeof rawValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return { ok: false, error: `${definition.label} tarihi gecersiz` };
    if (config.minDate !== undefined && rawValue < config.minDate) return { ok: false, error: `${definition.label} tarihi minimum degerin altinda` };
    if (config.maxDate !== undefined && rawValue > config.maxDate) return { ok: false, error: `${definition.label} tarihi maksimum degerin ustunde` };
    return { ok: true, value: rawValue };
  }

  return { ok: false, error: `${definition.label} tipi desteklenmiyor` };
}

export function validateUnitTechnicalProfileCustomFieldValues(
  definitions: Array<Pick<UnitTechnicalProfileCustomFieldDefinitionDto, "code" | "fieldType" | "label" | "options" | "validationConfig" | "isActive">>,
  values: Record<string, unknown>,
): ValidationResult<Record<string, unknown>> {
  const activeByCode = new Map(definitions.filter((definition) => definition.isActive).map((definition) => [definition.code, definition]));
  const normalized: Record<string, unknown> = {};
  for (const [code, rawValue] of Object.entries(values)) {
    const definition = activeByCode.get(code);
    if (!definition) return { ok: false, error: `${code} aktif bir firma ozel alan kodu degil` };
    const parsed = normalizeUnitTechnicalProfileCustomFieldValue(definition, rawValue);
    if (!parsed.ok) return parsed;
    normalized[code] = parsed.value;
  }
  return { ok: true, value: normalized };
}

export function missingRequiredUnitTechnicalProfileCustomFieldsForPublish(
  definitions: Array<Pick<UnitTechnicalProfileCustomFieldDefinitionDto, "id" | "code" | "label" | "isActive" | "isRequiredForPublish">>,
  values: Record<string, unknown>,
) {
  return definitions
    .filter((definition) => definition.isActive && definition.isRequiredForPublish && !hasCustomValue(values[definition.code]))
    .map((definition) => ({
      kind: "custom" as const,
      code: definition.code,
      label: definition.label,
      definitionId: definition.id,
    }));
}

export function calculateUnitTechnicalProfileCustomFieldCompletion(
  definitions: Array<Pick<UnitTechnicalProfileCustomFieldDefinitionDto, "code" | "isActive">>,
  values: Record<string, unknown>,
) {
  const activeDefinitions = definitions.filter((definition) => definition.isActive);
  const completedFields = activeDefinitions.filter((definition) => hasCustomValue(values[definition.code])).length;
  const totalFields = activeDefinitions.length;
  return {
    completedFields,
    totalFields,
    ratio: totalFields === 0 ? 100 : Math.round((completedFields / totalFields) * 100),
    missingFields: activeDefinitions.filter((definition) => !hasCustomValue(values[definition.code])).map((definition) => definition.code),
  };
}
