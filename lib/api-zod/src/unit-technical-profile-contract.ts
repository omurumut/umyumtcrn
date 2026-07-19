import { z } from "zod/v4";

export const UNIT_TECHNICAL_PROFILE_STATUSES = ["draft", "published"] as const;
export const UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES = ["yes", "no", "unknown", "not_applicable"] as const;

export type UnitTechnicalProfileStatus = typeof UNIT_TECHNICAL_PROFILE_STATUSES[number];
export type UnitTechnicalProfileTechnicalStatus = typeof UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES[number];

export const VIRTUAL_DEFAULT_UNIT_TECHNICAL_PROFILE_VERSION = 0;

export const UNIT_TECHNICAL_PROFILE_TEXT_LIMITS = {
  facilityUseType: 80,
  mainActivity: 250,
  shiftType: 80,
  heatingSystemType: 120,
  coolingSystemType: 120,
  domesticHotWaterSystem: 120,
  mainProcessDescription: 2000,
  energyInfrastructureDescription: 2000,
  knownEnergyIssues: 2000,
  technicalImprovements: 2000,
  plannedInfrastructureChanges: 2000,
} as const;

export const UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS = {
  buildingCount: { min: 0, max: 1000 },
  totalEnclosedAreaM2: { min: 0, max: 10_000_000 },
  heatedAreaM2: { min: 0, max: 10_000_000 },
  cooledAreaM2: { min: 0, max: 10_000_000 },
  openAreaM2: { min: 0, max: 100_000_000 },
  personnelCount: { min: 0, max: 1_000_000 },
  averageDailyUsers: { min: 0, max: 1_000_000 },
  dailyOperatingHours: { min: 0, max: 24 },
  weeklyOperatingDays: { min: 0, max: 7 },
  annualOperatingDays: { min: 0, max: 366 },
  shiftCount: { min: 0, max: 4 },
} as const;

const profileStatusSchema = z.enum(UNIT_TECHNICAL_PROFILE_STATUSES);
const technicalStatusSchema = z.enum(UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES);

function nullableTrimmedString(max: number) {
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

function nullableNumber(field: keyof typeof UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS, integer = false) {
  const limits = UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS[field];
  const base = integer ? z.number().int() : z.number();
  return base.min(limits.min).max(limits.max).nullable();
}

export const unitTechnicalProfileValuesSchema = z.strictObject({
  facilityUseType: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.facilityUseType),
  mainActivity: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.mainActivity),
  buildingCount: nullableNumber("buildingCount", true),
  totalEnclosedAreaM2: nullableNumber("totalEnclosedAreaM2"),
  heatedAreaM2: nullableNumber("heatedAreaM2"),
  cooledAreaM2: nullableNumber("cooledAreaM2"),
  openAreaM2: nullableNumber("openAreaM2"),
  personnelCount: nullableNumber("personnelCount", true),
  averageDailyUsers: nullableNumber("averageDailyUsers", true),
  dailyOperatingHours: nullableNumber("dailyOperatingHours"),
  weeklyOperatingDays: nullableNumber("weeklyOperatingDays"),
  annualOperatingDays: nullableNumber("annualOperatingDays", true),
  shiftCount: nullableNumber("shiftCount", true),
  shiftType: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.shiftType),
  seasonalOperationStatus: technicalStatusSchema.nullable(),
  insulationStatus: technicalStatusSchema.nullable(),
  heatingSystemType: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.heatingSystemType),
  coolingSystemType: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.coolingSystemType),
  domesticHotWaterSystem: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.domesticHotWaterSystem),
  buildingAutomationStatus: technicalStatusSchema.nullable(),
  compressedAirStatus: technicalStatusSchema.nullable(),
  steamSystemStatus: technicalStatusSchema.nullable(),
  generatorStatus: technicalStatusSchema.nullable(),
  renewableEnergyStatus: technicalStatusSchema.nullable(),
  mainProcessDescription: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.mainProcessDescription),
  energyInfrastructureDescription: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.energyInfrastructureDescription),
  knownEnergyIssues: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.knownEnergyIssues),
  technicalImprovements: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.technicalImprovements),
  plannedInfrastructureChanges: nullableTrimmedString(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS.plannedInfrastructureChanges),
  profileStatus: profileStatusSchema,
});

export type UnitTechnicalProfileValues = z.infer<typeof unitTechnicalProfileValuesSchema>;

export const unitTechnicalProfilePatchRequestSchema = unitTechnicalProfileValuesSchema
  .partial()
  .extend({
    expectedProfileVersion: z.number().int().min(0),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedProfileVersion"),
    "Guncellenecek en az bir teknik profil alani gonderilmelidir",
  );

export type UnitTechnicalProfilePatchRequest = z.infer<typeof unitTechnicalProfilePatchRequestSchema>;

export const unitTechnicalProfileSchema = unitTechnicalProfileValuesSchema.extend({
  id: z.number().int().positive().nullable(),
  companyId: z.number().int().positive(),
  unitId: z.number().int().positive(),
  exists: z.boolean(),
  profileVersion: z.number().int().min(0),
  createdAt: z.string().nullable(),
  createdBy: z.number().int().positive().nullable(),
  updatedAt: z.string().nullable(),
  updatedBy: z.number().int().positive().nullable(),
});

export const unitTechnicalProfileGetResponseSchema = z.strictObject({
  profile: unitTechnicalProfileSchema,
  permissions: z.strictObject({
    canEdit: z.boolean(),
    canPublish: z.boolean(),
  }),
});

export const unitTechnicalProfilePatchResponseSchema = unitTechnicalProfileGetResponseSchema;

export const unitTechnicalProfileConflictResponseSchema = z.strictObject({
  error: z.string(),
  profile: unitTechnicalProfileSchema,
});

export type UnitTechnicalProfileDto = z.infer<typeof unitTechnicalProfileSchema>;
export type UnitTechnicalProfileGetResponse = z.infer<typeof unitTechnicalProfileGetResponseSchema>;
export type UnitTechnicalProfilePatchResponse = z.infer<typeof unitTechnicalProfilePatchResponseSchema>;
export type UnitTechnicalProfileConflictResponse = z.infer<typeof unitTechnicalProfileConflictResponseSchema>;

export function createDefaultUnitTechnicalProfile(companyId: number, unitId: number): UnitTechnicalProfileDto {
  return {
    id: null,
    companyId,
    unitId,
    exists: false,
    facilityUseType: null,
    mainActivity: null,
    buildingCount: null,
    totalEnclosedAreaM2: null,
    heatedAreaM2: null,
    cooledAreaM2: null,
    openAreaM2: null,
    personnelCount: null,
    averageDailyUsers: null,
    dailyOperatingHours: null,
    weeklyOperatingDays: null,
    annualOperatingDays: null,
    shiftCount: null,
    shiftType: null,
    seasonalOperationStatus: null,
    insulationStatus: null,
    heatingSystemType: null,
    coolingSystemType: null,
    domesticHotWaterSystem: null,
    buildingAutomationStatus: null,
    compressedAirStatus: null,
    steamSystemStatus: null,
    generatorStatus: null,
    renewableEnergyStatus: null,
    mainProcessDescription: null,
    energyInfrastructureDescription: null,
    knownEnergyIssues: null,
    technicalImprovements: null,
    plannedInfrastructureChanges: null,
    profileStatus: "draft",
    profileVersion: VIRTUAL_DEFAULT_UNIT_TECHNICAL_PROFILE_VERSION,
    createdAt: null,
    createdBy: null,
    updatedAt: null,
    updatedBy: null,
  };
}
