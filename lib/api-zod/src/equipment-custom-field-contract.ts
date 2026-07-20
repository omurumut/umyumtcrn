import { z } from "zod/v4";
import {
  UNIT_TECHNICAL_PROFILE_CUSTOM_BOOLEAN_STATUSES,
  UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPES,
  UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPE_LABELS,
  unitTechnicalProfileCustomFieldOptionSchema,
  unitTechnicalProfileCustomFieldTypeSchema,
  unitTechnicalProfileCustomFieldValidationConfigSchema,
  normalizeUnitTechnicalProfileCustomFieldValue,
} from "./unit-technical-profile-custom-field-contract";

export const EQUIPMENT_CUSTOM_BOOLEAN_STATUSES = UNIT_TECHNICAL_PROFILE_CUSTOM_BOOLEAN_STATUSES;
export const EQUIPMENT_CUSTOM_FIELD_TYPES = UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPES;
export const EQUIPMENT_CUSTOM_FIELD_TYPE_LABELS = UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPE_LABELS;
export const EQUIPMENT_CUSTOM_FIELD_SECTIONS = ["identity", "technical", "operation", "lifecycle", "criticality", "notes", "other"] as const;

export type EquipmentCustomFieldType = typeof EQUIPMENT_CUSTOM_FIELD_TYPES[number];
export type EquipmentCustomFieldSection = typeof EQUIPMENT_CUSTOM_FIELD_SECTIONS[number];
export type EquipmentCustomFieldValueMap = Record<string, unknown>;

const trimNullable = (max: number) => z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  },
  z.string().max(max).nullable(),
);

const equipmentCustomFieldOptionSchema = unitTechnicalProfileCustomFieldOptionSchema.extend({
  displayOrder: z.number().int().min(0).max(10000).default(0),
});

function uniqueOptionCodes(options: Array<{ code: string }>) {
  return new Set(options.map((option) => option.code)).size === options.length;
}

const RESERVED_EQUIPMENT_FIELD_CODES = new Set([
  "equipment_code",
  "name",
  "equipment_kind",
  "category",
  "status",
  "unit_id",
  "sub_unit_id",
  "manufacturer",
  "brand",
  "model",
  "serial_number",
  "rated_power",
  "installed_power_kw",
  "capacity",
  "energy_use_group",
  "meter_links",
  "energy_source_links",
  "primary_meter",
  "primary_energy_source",
  "custom_values",
  "equipment_version",
  "created_at",
  "updated_at",
  "archived_at",
  "audit",
]);

export function isReservedEquipmentFieldCode(code: string) {
  return RESERVED_EQUIPMENT_FIELD_CODES.has(code) || code.startsWith("sys_") || code.startsWith("standard_");
}

export const equipmentCustomFieldDefinitionBaseSchema = z.strictObject({
  code: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,63}$/).max(64),
  label: z.string().trim().min(1).max(160),
  description: trimNullable(1000).optional(),
  section: z.enum(EQUIPMENT_CUSTOM_FIELD_SECTIONS).default("other"),
  fieldType: unitTechnicalProfileCustomFieldTypeSchema,
  unitLabel: trimNullable(40).optional(),
  options: z.array(equipmentCustomFieldOptionSchema).max(50).default([]),
  isRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(10000).default(0),
  validationConfig: unitTechnicalProfileCustomFieldValidationConfigSchema.default({}),
}).superRefine((value, ctx) => {
  if (isReservedEquipmentFieldCode(value.code)) ctx.addIssue({ code: "custom", message: "Standart ekipman alan kodu kullanilamaz", path: ["code"] });
  if (!uniqueOptionCodes(value.options)) ctx.addIssue({ code: "custom", message: "Secenek kodlari benzersiz olmalidir", path: ["options"] });
  if ((value.fieldType === "single_select" || value.fieldType === "multi_select") && value.options.filter((option) => option.isActive).length === 0) {
    ctx.addIssue({ code: "custom", message: "Secimli alan icin en az bir aktif secenek zorunludur", path: ["options"] });
  }
  if (value.fieldType !== "single_select" && value.fieldType !== "multi_select" && value.options.length > 0) {
    ctx.addIssue({ code: "custom", message: "Secenekler sadece secimli alanlarda kullanilir", path: ["options"] });
  }
  if (value.fieldType === "unit_number" && !value.unitLabel) {
    ctx.addIssue({ code: "custom", message: "Birimli sayi icin birim etiketi zorunludur", path: ["unitLabel"] });
  }
});

export const equipmentCustomFieldDefinitionCreateSchema = equipmentCustomFieldDefinitionBaseSchema;
export const equipmentCustomFieldDefinitionPatchSchema = equipmentCustomFieldDefinitionBaseSchema.partial().extend({
  expectedDefinitionVersion: z.number().int().min(1),
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== "expectedDefinitionVersion"),
  "Guncellenecek en az bir alan tanimi gonderilmelidir",
);
export const equipmentCustomFieldDefinitionArchiveSchema = z.strictObject({
  expectedDefinitionVersion: z.number().int().min(1),
});

export const equipmentCustomFieldDefinitionSchema = equipmentCustomFieldDefinitionBaseSchema.extend({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  definitionVersion: z.number().int().min(1),
  createdAt: z.string(),
  createdBy: z.number().int().positive().nullable(),
  updatedAt: z.string(),
  updatedBy: z.number().int().positive().nullable(),
  archivedAt: z.string().nullable(),
  archivedBy: z.number().int().positive().nullable(),
  usageCount: z.number().int().min(0).optional(),
  hasValues: z.boolean().optional(),
});

export const equipmentCustomFieldDefinitionsResponseSchema = z.strictObject({
  definitions: z.array(equipmentCustomFieldDefinitionSchema),
  permissions: z.strictObject({ canEdit: z.boolean() }),
});

export const equipmentCustomFieldValuesSchema = z.record(z.string(), z.unknown()).default({});

export type EquipmentCustomFieldDefinitionCreate = z.infer<typeof equipmentCustomFieldDefinitionCreateSchema>;
export type EquipmentCustomFieldDefinitionPatch = z.infer<typeof equipmentCustomFieldDefinitionPatchSchema>;
export type EquipmentCustomFieldDefinitionDto = z.infer<typeof equipmentCustomFieldDefinitionSchema>;
export type EquipmentCustomFieldDefinitionsResponse = z.infer<typeof equipmentCustomFieldDefinitionsResponseSchema>;

function hasCustomValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function validateEquipmentCustomFieldValues(
  definitions: Array<Pick<EquipmentCustomFieldDefinitionDto, "id" | "code" | "fieldType" | "label" | "options" | "validationConfig" | "isActive" | "isRequired">>,
  values: Record<string, unknown>,
  options: { allowInactiveExistingCodes?: Set<string>; enforceRequired?: boolean } = {},
) {
  const byCode = new Map(definitions.map((definition) => [definition.code, definition]));
  const normalized: Record<string, unknown> = {};
  for (const [code, rawValue] of Object.entries(values)) {
    const definition = byCode.get(code);
    if (!definition) return { ok: false as const, error: `${code} aktif bir ekipman ozel alan kodu degil` };
    if (!definition.isActive && !options.allowInactiveExistingCodes?.has(code)) {
      return { ok: false as const, error: `${code} pasif ekipman ozel alanidir` };
    }
    const parsed = normalizeUnitTechnicalProfileCustomFieldValue(definition, rawValue);
    if (!parsed.ok) return parsed;
    normalized[code] = parsed.value;
  }
  if (options.enforceRequired) {
    const missing = definitions.find((definition) => definition.isActive && definition.isRequired && !hasCustomValue(normalized[definition.code]));
    if (missing) return { ok: false as const, error: `${missing.label} zorunludur` };
  }
  return { ok: true as const, value: normalized };
}

export function changedEquipmentCustomValueCodes(before: Record<string, unknown>, after: Record<string, unknown>) {
  const codes = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...codes].filter((code) => JSON.stringify(before[code] ?? null) !== JSON.stringify(after[code] ?? null));
}
