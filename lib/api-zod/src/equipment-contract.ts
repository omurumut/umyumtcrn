import { z } from "zod/v4";

export const EQUIPMENT_KINDS = ["physical", "logical"] as const;
export const EQUIPMENT_CATEGORIES = [
  "motor",
  "pump",
  "fan",
  "compressor",
  "boiler",
  "chiller",
  "hvac",
  "transformer",
  "generator",
  "ups",
  "lighting",
  "renewable",
  "process_line",
  "other",
] as const;
export const EQUIPMENT_STATUSES = ["active", "standby", "maintenance", "faulty", "out_of_service", "archived"] as const;
export const EQUIPMENT_OPERATIONAL_STATUSES = ["running", "stopped", "standby", "unknown", "not_applicable"] as const;
export const EQUIPMENT_SEASONAL_OPERATION_STATUSES = ["yes", "no", "unknown", "not_applicable"] as const;
export const EQUIPMENT_MEASUREMENT_METHODS = ["direct", "shared", "allocated", "estimated", "unmeasured", "unknown"] as const;
export const EQUIPMENT_MEASUREMENT_CONFIDENCES = ["high", "medium", "low", "unknown"] as const;
export const EQUIPMENT_METER_RELATION_ROLES = ["direct", "shared", "sub_meter", "estimated_reference"] as const;
export const EQUIPMENT_ENERGY_SOURCE_RELATION_ROLES = ["primary", "secondary", "startup", "backup"] as const;

export const EQUIPMENT_TEXT_LIMITS = {
  equipmentCode: 64,
  name: 160,
  subType: 120,
  assetCode: 120,
  manufacturer: 120,
  brand: 120,
  model: 120,
  serialNumber: 120,
  tagCode: 120,
  locationText: 240,
  buildingText: 160,
  processText: 160,
  ratedPowerUnit: 24,
  capacityUnit: 40,
  criticalityReason: 500,
  savingPotential: 500,
  technicalNotes: 1000,
  maintenanceNotes: 1000,
  efficiencyOpportunities: 1000,
  plannedImprovements: 1000,
  archiveReason: 500,
} as const;

export const EQUIPMENT_NUMERIC_LIMITS = {
  ratedPowerValue: { min: 0, max: 1_000_000 },
  installedPowerKw: { min: 0, max: 1_000_000 },
  capacityValue: { min: 0, max: 1_000_000_000 },
  nominalEfficiencyPercent: { min: 0, max: 100 },
  dailyOperatingHours: { min: 0, max: 24 },
  annualOperatingHours: { min: 0, max: 8784 },
  averageLoadPercent: { min: 0, max: 100 },
  manufactureYear: { min: 1900, max: 3000 },
  expectedLifeYears: { min: 0, max: 200 },
  plannedReplacementYear: { min: 1900, max: 3000 },
  sharePercent: { min: 0, max: 100 },
} as const;

const trimRequired = (max: number) => z.string().trim().min(1).max(max);
const trimNullable = (max: number) => z.string().trim().max(max).transform((value) => value === "" ? null : value).nullable();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const optionalDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const idSchema = z.number().int().positive();
const nullableIdSchema = idSchema.nullable();
const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

function boundedNumber(field: keyof typeof EQUIPMENT_NUMERIC_LIMITS) {
  const limits = EQUIPMENT_NUMERIC_LIMITS[field];
  return z.number().min(limits.min).max(limits.max).nullable();
}

function boundedInteger(field: keyof typeof EQUIPMENT_NUMERIC_LIMITS) {
  const limits = EQUIPMENT_NUMERIC_LIMITS[field];
  return z.number().int().min(limits.min).max(limits.max).nullable();
}

export const equipmentMeterLinkInputSchema = z.strictObject({
  meterId: idSchema,
  relationRole: z.enum(EQUIPMENT_METER_RELATION_ROLES).default("direct"),
  sharePercent: boundedNumber("sharePercent").optional(),
  measurementConfidence: z.enum(EQUIPMENT_MEASUREMENT_CONFIDENCES).default("unknown"),
  isPrimary: z.boolean().default(false),
});

export const equipmentEnergySourceLinkInputSchema = z.strictObject({
  energySourceId: idSchema,
  relationRole: z.enum(EQUIPMENT_ENERGY_SOURCE_RELATION_ROLES).default("primary"),
  sharePercent: boundedNumber("sharePercent").optional(),
  measurementConfidence: z.enum(EQUIPMENT_MEASUREMENT_CONFIDENCES).default("unknown"),
  isPrimary: z.boolean().default(false),
});

export const equipmentCreateRequestSchema = z.strictObject({
  unitId: idSchema.optional(),
  subUnitId: nullableIdSchema.optional(),
  equipmentCode: trimRequired(EQUIPMENT_TEXT_LIMITS.equipmentCode).regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  name: trimRequired(EQUIPMENT_TEXT_LIMITS.name),
  equipmentKind: z.enum(EQUIPMENT_KINDS).default("physical"),
  category: z.enum(EQUIPMENT_CATEGORIES),
  subType: trimNullable(EQUIPMENT_TEXT_LIMITS.subType).optional(),
  status: z.enum(EQUIPMENT_STATUSES).default("active"),
  assetCode: trimNullable(EQUIPMENT_TEXT_LIMITS.assetCode).optional(),
  manufacturer: trimNullable(EQUIPMENT_TEXT_LIMITS.manufacturer).optional(),
  brand: trimNullable(EQUIPMENT_TEXT_LIMITS.brand).optional(),
  model: trimNullable(EQUIPMENT_TEXT_LIMITS.model).optional(),
  serialNumber: trimNullable(EQUIPMENT_TEXT_LIMITS.serialNumber).optional(),
  tagCode: trimNullable(EQUIPMENT_TEXT_LIMITS.tagCode).optional(),
  locationText: trimNullable(EQUIPMENT_TEXT_LIMITS.locationText).optional(),
  buildingText: trimNullable(EQUIPMENT_TEXT_LIMITS.buildingText).optional(),
  processText: trimNullable(EQUIPMENT_TEXT_LIMITS.processText).optional(),
  parentEquipmentId: nullableIdSchema.optional(),
  energyUseGroupId: nullableIdSchema.optional(),
  measurementMethod: z.enum(EQUIPMENT_MEASUREMENT_METHODS).default("unknown"),
  measurementConfidence: z.enum(EQUIPMENT_MEASUREMENT_CONFIDENCES).default("unknown"),
  ratedPowerValue: boundedNumber("ratedPowerValue").optional(),
  ratedPowerUnit: trimNullable(EQUIPMENT_TEXT_LIMITS.ratedPowerUnit).optional(),
  installedPowerKw: boundedNumber("installedPowerKw").optional(),
  capacityValue: boundedNumber("capacityValue").optional(),
  capacityUnit: trimNullable(EQUIPMENT_TEXT_LIMITS.capacityUnit).optional(),
  nominalEfficiencyPercent: boundedNumber("nominalEfficiencyPercent").optional(),
  operationalStatus: z.enum(EQUIPMENT_OPERATIONAL_STATUSES).nullable().optional(),
  dailyOperatingHours: boundedNumber("dailyOperatingHours").optional(),
  annualOperatingHours: boundedNumber("annualOperatingHours").optional(),
  averageLoadPercent: boundedNumber("averageLoadPercent").optional(),
  seasonalOperationStatus: z.enum(EQUIPMENT_SEASONAL_OPERATION_STATUSES).nullable().optional(),
  purchaseDate: optionalDateOnly,
  commissioningDate: optionalDateOnly,
  manufactureYear: boundedInteger("manufactureYear").optional(),
  expectedLifeYears: boundedInteger("expectedLifeYears").optional(),
  plannedReplacementYear: boundedInteger("plannedReplacementYear").optional(),
  isEnergyIntensive: z.boolean().default(false),
  isCritical: z.boolean().default(false),
  criticalityReason: trimNullable(EQUIPMENT_TEXT_LIMITS.criticalityReason).optional(),
  savingPotential: trimNullable(EQUIPMENT_TEXT_LIMITS.savingPotential).optional(),
  technicalNotes: trimNullable(EQUIPMENT_TEXT_LIMITS.technicalNotes).optional(),
  maintenanceNotes: trimNullable(EQUIPMENT_TEXT_LIMITS.maintenanceNotes).optional(),
  efficiencyOpportunities: trimNullable(EQUIPMENT_TEXT_LIMITS.efficiencyOpportunities).optional(),
  plannedImprovements: trimNullable(EQUIPMENT_TEXT_LIMITS.plannedImprovements).optional(),
  meterLinks: z.array(equipmentMeterLinkInputSchema).max(20).default([]),
  energySourceLinks: z.array(equipmentEnergySourceLinkInputSchema).max(20).default([]),
});

export const equipmentPatchRequestSchema = z.strictObject({
  expectedEquipmentVersion: z.number().int().min(1),
  subUnitId: nullableIdSchema.optional(),
  name: trimRequired(EQUIPMENT_TEXT_LIMITS.name).optional(),
  equipmentKind: z.enum(EQUIPMENT_KINDS).optional(),
  category: z.enum(EQUIPMENT_CATEGORIES).optional(),
  subType: trimNullable(EQUIPMENT_TEXT_LIMITS.subType).optional(),
  status: z.enum(["active", "standby", "maintenance", "faulty", "out_of_service"]).optional(),
  assetCode: trimNullable(EQUIPMENT_TEXT_LIMITS.assetCode).optional(),
  manufacturer: trimNullable(EQUIPMENT_TEXT_LIMITS.manufacturer).optional(),
  brand: trimNullable(EQUIPMENT_TEXT_LIMITS.brand).optional(),
  model: trimNullable(EQUIPMENT_TEXT_LIMITS.model).optional(),
  serialNumber: trimNullable(EQUIPMENT_TEXT_LIMITS.serialNumber).optional(),
  tagCode: trimNullable(EQUIPMENT_TEXT_LIMITS.tagCode).optional(),
  locationText: trimNullable(EQUIPMENT_TEXT_LIMITS.locationText).optional(),
  buildingText: trimNullable(EQUIPMENT_TEXT_LIMITS.buildingText).optional(),
  processText: trimNullable(EQUIPMENT_TEXT_LIMITS.processText).optional(),
  parentEquipmentId: nullableIdSchema.optional(),
  energyUseGroupId: nullableIdSchema.optional(),
  measurementMethod: z.enum(EQUIPMENT_MEASUREMENT_METHODS).optional(),
  measurementConfidence: z.enum(EQUIPMENT_MEASUREMENT_CONFIDENCES).optional(),
  ratedPowerValue: boundedNumber("ratedPowerValue").optional(),
  ratedPowerUnit: trimNullable(EQUIPMENT_TEXT_LIMITS.ratedPowerUnit).optional(),
  installedPowerKw: boundedNumber("installedPowerKw").optional(),
  capacityValue: boundedNumber("capacityValue").optional(),
  capacityUnit: trimNullable(EQUIPMENT_TEXT_LIMITS.capacityUnit).optional(),
  nominalEfficiencyPercent: boundedNumber("nominalEfficiencyPercent").optional(),
  operationalStatus: z.enum(EQUIPMENT_OPERATIONAL_STATUSES).nullable().optional(),
  dailyOperatingHours: boundedNumber("dailyOperatingHours").optional(),
  annualOperatingHours: boundedNumber("annualOperatingHours").optional(),
  averageLoadPercent: boundedNumber("averageLoadPercent").optional(),
  seasonalOperationStatus: z.enum(EQUIPMENT_SEASONAL_OPERATION_STATUSES).nullable().optional(),
  purchaseDate: optionalDateOnly,
  commissioningDate: optionalDateOnly,
  manufactureYear: boundedInteger("manufactureYear").optional(),
  expectedLifeYears: boundedInteger("expectedLifeYears").optional(),
  plannedReplacementYear: boundedInteger("plannedReplacementYear").optional(),
  isEnergyIntensive: z.boolean().optional(),
  isCritical: z.boolean().optional(),
  criticalityReason: trimNullable(EQUIPMENT_TEXT_LIMITS.criticalityReason).optional(),
  savingPotential: trimNullable(EQUIPMENT_TEXT_LIMITS.savingPotential).optional(),
  technicalNotes: trimNullable(EQUIPMENT_TEXT_LIMITS.technicalNotes).optional(),
  maintenanceNotes: trimNullable(EQUIPMENT_TEXT_LIMITS.maintenanceNotes).optional(),
  efficiencyOpportunities: trimNullable(EQUIPMENT_TEXT_LIMITS.efficiencyOpportunities).optional(),
  plannedImprovements: trimNullable(EQUIPMENT_TEXT_LIMITS.plannedImprovements).optional(),
  meterLinks: z.array(equipmentMeterLinkInputSchema).max(20).optional(),
  energySourceLinks: z.array(equipmentEnergySourceLinkInputSchema).max(20).optional(),
}).refine(
  (value) => Object.keys(value).some((key) => key !== "expectedEquipmentVersion"),
  "Guncellenecek en az bir ekipman alani gonderilmelidir",
);

export const equipmentArchiveRequestSchema = z.strictObject({
  expectedEquipmentVersion: z.number().int().min(1),
  reason: trimNullable(EQUIPMENT_TEXT_LIMITS.archiveReason).optional(),
});

export const equipmentReactivateRequestSchema = z.strictObject({
  expectedEquipmentVersion: z.number().int().min(1),
  status: z.enum(["active", "standby", "maintenance", "faulty", "out_of_service"]).default("active"),
});

export const equipmentListQuerySchema = z.strictObject({
  companyId: z.coerce.number().int().positive().optional(),
  unitId: z.coerce.number().int().positive().optional(),
  subUnitId: z.coerce.number().int().positive().optional(),
  category: z.enum(EQUIPMENT_CATEGORIES).optional(),
  status: z.enum(EQUIPMENT_STATUSES).optional(),
  energySourceId: z.coerce.number().int().positive().optional(),
  meterId: z.coerce.number().int().positive().optional(),
  energyUseGroupId: z.coerce.number().int().positive().optional(),
  search: z.string().trim().max(120).optional(),
  includeArchived: queryBoolean.default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const equipmentMeterLinkSchema = z.strictObject({
  id: idSchema,
  companyId: idSchema,
  equipmentId: idSchema,
  meterId: idSchema,
  relationRole: z.enum(EQUIPMENT_METER_RELATION_ROLES),
  sharePercent: z.number().nullable(),
  measurementConfidence: z.enum(EQUIPMENT_MEASUREMENT_CONFIDENCES),
  isPrimary: z.boolean(),
  createdAt: z.string(),
  createdBy: idSchema.nullable(),
});

export const equipmentEnergySourceLinkSchema = z.strictObject({
  id: idSchema,
  companyId: idSchema,
  equipmentId: idSchema,
  energySourceId: idSchema,
  relationRole: z.enum(EQUIPMENT_ENERGY_SOURCE_RELATION_ROLES),
  sharePercent: z.number().nullable(),
  measurementConfidence: z.enum(EQUIPMENT_MEASUREMENT_CONFIDENCES),
  isPrimary: z.boolean(),
  createdAt: z.string(),
  createdBy: idSchema.nullable(),
});

export const equipmentSchema = z.strictObject({
  id: idSchema,
  companyId: idSchema,
  unitId: idSchema,
  subUnitId: idSchema.nullable(),
  equipmentCode: z.string(),
  name: z.string(),
  equipmentKind: z.enum(EQUIPMENT_KINDS),
  category: z.enum(EQUIPMENT_CATEGORIES),
  subType: z.string().nullable(),
  status: z.enum(EQUIPMENT_STATUSES),
  assetCode: z.string().nullable(),
  manufacturer: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  tagCode: z.string().nullable(),
  locationText: z.string().nullable(),
  buildingText: z.string().nullable(),
  processText: z.string().nullable(),
  parentEquipmentId: idSchema.nullable(),
  energyUseGroupId: idSchema.nullable(),
  measurementMethod: z.enum(EQUIPMENT_MEASUREMENT_METHODS),
  measurementConfidence: z.enum(EQUIPMENT_MEASUREMENT_CONFIDENCES),
  ratedPowerValue: z.number().nullable(),
  ratedPowerUnit: z.string().nullable(),
  installedPowerKw: z.number().nullable(),
  capacityValue: z.number().nullable(),
  capacityUnit: z.string().nullable(),
  nominalEfficiencyPercent: z.number().nullable(),
  operationalStatus: z.enum(EQUIPMENT_OPERATIONAL_STATUSES).nullable(),
  dailyOperatingHours: z.number().nullable(),
  annualOperatingHours: z.number().nullable(),
  averageLoadPercent: z.number().nullable(),
  seasonalOperationStatus: z.enum(EQUIPMENT_SEASONAL_OPERATION_STATUSES).nullable(),
  purchaseDate: dateOnly,
  commissioningDate: dateOnly,
  manufactureYear: z.number().int().nullable(),
  expectedLifeYears: z.number().int().nullable(),
  plannedReplacementYear: z.number().int().nullable(),
  isEnergyIntensive: z.boolean(),
  isCritical: z.boolean(),
  criticalityReason: z.string().nullable(),
  savingPotential: z.string().nullable(),
  technicalNotes: z.string().nullable(),
  maintenanceNotes: z.string().nullable(),
  efficiencyOpportunities: z.string().nullable(),
  plannedImprovements: z.string().nullable(),
  equipmentVersion: z.number().int().min(1),
  createdAt: z.string(),
  createdBy: idSchema.nullable(),
  updatedAt: z.string(),
  updatedBy: idSchema.nullable(),
  archivedAt: z.string().nullable(),
  archivedBy: idSchema.nullable(),
});

export const equipmentPermissionsSchema = z.strictObject({
  canEdit: z.boolean(),
  canArchive: z.boolean(),
  canReactivate: z.boolean(),
});

export const equipmentDetailResponseSchema = z.strictObject({
  equipment: equipmentSchema,
  meterLinks: z.array(equipmentMeterLinkSchema),
  energySourceLinks: z.array(equipmentEnergySourceLinkSchema),
  permissions: equipmentPermissionsSchema,
});

export const equipmentListResponseSchema = z.strictObject({
  items: z.array(equipmentSchema.omit({
    technicalNotes: true,
    maintenanceNotes: true,
    efficiencyOpportunities: true,
    plannedImprovements: true,
  }).extend({
    primaryMeterId: idSchema.nullable().optional(),
    primaryEnergySourceId: idSchema.nullable().optional(),
  })),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  permissions: equipmentPermissionsSchema,
});

export const equipmentConflictResponseSchema = z.strictObject({
  error: z.string(),
  equipment: equipmentSchema,
});

export type EquipmentCreateRequest = z.infer<typeof equipmentCreateRequestSchema>;
export type EquipmentPatchRequest = z.infer<typeof equipmentPatchRequestSchema>;
export type EquipmentArchiveRequest = z.infer<typeof equipmentArchiveRequestSchema>;
export type EquipmentReactivateRequest = z.infer<typeof equipmentReactivateRequestSchema>;
export type EquipmentDto = z.infer<typeof equipmentSchema>;
export type EquipmentDetailResponse = z.infer<typeof equipmentDetailResponseSchema>;
export type EquipmentListResponse = z.infer<typeof equipmentListResponseSchema>;
