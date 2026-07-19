import { z } from "zod/v4";
import {
  unitTechnicalProfileCustomFieldDefinitionSchema,
  unitTechnicalProfileCustomFieldValuesSchema,
} from "./unit-technical-profile-custom-field-contract";

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

export const UNIT_TECHNICAL_PROFILE_SECTIONS = [
  {
    id: "general",
    title: "Genel tesis bilgileri",
    description: "Tesisin kullanim amaci ve temel faaliyetini tanimlar.",
    fields: ["facilityUseType", "mainActivity", "mainProcessDescription"] as const,
  },
  {
    id: "physical",
    title: "Fiziksel yapi",
    description: "Alan ve bina bilgileri enerji yogunlugu ve karsilastirma analizlerinde kullanilir.",
    fields: ["buildingCount", "totalEnclosedAreaM2", "heatedAreaM2", "cooledAreaM2", "openAreaM2", "insulationStatus"] as const,
  },
  {
    id: "operation",
    title: "Operasyon",
    description: "Buraya genel calisma duzenini girin. Aylik degisen uretim veya calisma verilerini Degisken Yonetimi uzerinden takip edin.",
    fields: ["personnelCount", "averageDailyUsers", "dailyOperatingHours", "weeklyOperatingDays", "annualOperatingDays", "shiftCount", "shiftType", "seasonalOperationStatus"] as const,
  },
  {
    id: "hvac",
    title: "Isitma, sogutma ve sicak su",
    description: "Tesiste kullanilan ana iklimlendirme ve sicak su altyapisini tanimlar.",
    fields: ["heatingSystemType", "coolingSystemType", "domesticHotWaterSystem", "buildingAutomationStatus"] as const,
  },
  {
    id: "energySystems",
    title: "Diger enerji sistemleri",
    description: "Tesiste bulunan yardimci enerji ve uretim sistemlerini belirtir.",
    fields: ["compressedAirStatus", "steamSystemStatus", "generatorStatus", "renewableEnergyStatus"] as const,
  },
  {
    id: "technicalNotes",
    title: "Teknik aciklamalar",
    description: "Yapilandirilmis alanlarla ifade edilemeyen teknik baglami ekleyin.",
    fields: ["energyInfrastructureDescription", "knownEnergyIssues", "technicalImprovements", "plannedInfrastructureChanges"] as const,
  },
] as const;

export type UnitTechnicalProfileSectionId = typeof UNIT_TECHNICAL_PROFILE_SECTIONS[number]["id"];
export type UnitTechnicalProfileFieldCode = typeof UNIT_TECHNICAL_PROFILE_SECTIONS[number]["fields"][number] | "profileStatus";

export const UNIT_TECHNICAL_PROFILE_FIELD_LABELS: Record<UnitTechnicalProfileFieldCode, string> = {
  facilityUseType: "Tesis kullanim tipi",
  mainActivity: "Ana faaliyet",
  profileStatus: "Profil durumu",
  mainProcessDescription: "Ana proses aciklamasi",
  buildingCount: "Bina sayisi",
  totalEnclosedAreaM2: "Toplam kapali alan",
  heatedAreaM2: "Isitilan alan",
  cooledAreaM2: "Sogutulan alan",
  openAreaM2: "Acik alan",
  insulationStatus: "Yalitim durumu",
  personnelCount: "Personel sayisi (genel/ortalama)",
  averageDailyUsers: "Ortalama gunluk kullanici",
  dailyOperatingHours: "Gunluk calisma suresi (genel)",
  weeklyOperatingDays: "Haftalik calisma gunu (genel)",
  annualOperatingDays: "Yillik calisma gunu (genel)",
  shiftCount: "Vardiya sayisi (genel)",
  shiftType: "Vardiya tipi",
  seasonalOperationStatus: "Sezonsal operasyon",
  heatingSystemType: "Isitma sistemi",
  coolingSystemType: "Sogutma sistemi",
  domesticHotWaterSystem: "Kullanim sicak su sistemi",
  buildingAutomationStatus: "Bina otomasyonu",
  compressedAirStatus: "Basincili hava sistemi",
  steamSystemStatus: "Buhar sistemi",
  generatorStatus: "Jenerator",
  renewableEnergyStatus: "Yenilenebilir enerji",
  energyInfrastructureDescription: "Enerji altyapisi aciklamasi",
  knownEnergyIssues: "Bilinen enerji sorunlari",
  technicalImprovements: "Teknik iyilestirmeler",
  plannedInfrastructureChanges: "Planlanan altyapi degisiklikleri",
};

export const UNIT_TECHNICAL_PROFILE_FIELD_UNITS: Partial<Record<UnitTechnicalProfileFieldCode, string>> = {
  totalEnclosedAreaM2: "m²",
  heatedAreaM2: "m²",
  cooledAreaM2: "m²",
  openAreaM2: "m²",
  personnelCount: "kisi",
  averageDailyUsers: "kisi",
  dailyOperatingHours: "saat/gun",
  weeklyOperatingDays: "gun/hafta",
  annualOperatingDays: "gun/yil",
};

export const UNIT_TECHNICAL_PROFILE_COMPLETION_FIELDS = UNIT_TECHNICAL_PROFILE_SECTIONS.flatMap((section) => [...section.fields]);
export const UNIT_TECHNICAL_PROFILE_OPERATION_FIELDS = UNIT_TECHNICAL_PROFILE_SECTIONS.find((section) => section.id === "operation")!.fields;
export const UNIT_TECHNICAL_PROFILE_PUBLISH_REQUIRED_FIELDS = [
  "facilityUseType",
  "mainActivity",
  "totalEnclosedAreaM2",
  "heatingSystemType",
  "coolingSystemType",
] as const;

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
    customFieldValues: unitTechnicalProfileCustomFieldValuesSchema.optional(),
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
  customFieldDefinitions: z.array(unitTechnicalProfileCustomFieldDefinitionSchema).default([]),
  customFieldValues: unitTechnicalProfileCustomFieldValuesSchema,
  permissions: z.strictObject({
    canEdit: z.boolean(),
    canPublish: z.boolean(),
  }),
});

export const unitTechnicalProfilePatchResponseSchema = unitTechnicalProfileGetResponseSchema;

export const unitTechnicalProfilePublishRequestSchema = z.strictObject({
  expectedProfileVersion: z.number().int().min(0),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  changeSummary: nullableTrimmedString(1000).optional(),
});

export const unitTechnicalProfileSnapshotSummarySchema = z.strictObject({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  unitId: z.number().int().positive(),
  sourceProfileId: z.number().int().positive().nullable(),
  snapshotNumber: z.number().int().min(1),
  profileVersion: z.number().int().min(1),
  profileStatus: z.literal("published"),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  publishedAt: z.string(),
  publishedBy: z.number().int().positive().nullable(),
  publishedByName: z.string().nullable().optional(),
  completionPercentage: z.number().int().min(0).max(100),
  changeSummary: z.string().nullable(),
  isCurrent: z.boolean().optional(),
  isEffectiveToday: z.boolean().optional(),
});

export const unitTechnicalProfileSnapshotDetailSchema = unitTechnicalProfileSnapshotSummarySchema.extend({
  standardValues: z.record(z.string(), z.unknown()),
  customFieldValues: unitTechnicalProfileCustomFieldValuesSchema,
  customFieldDefinitions: z.array(unitTechnicalProfileCustomFieldDefinitionSchema),
});

export const unitTechnicalProfileHistoryResponseSchema = z.strictObject({
  items: z.array(unitTechnicalProfileSnapshotSummarySchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  hasNext: z.boolean(),
  permissions: z.strictObject({
    canEdit: z.boolean(),
    canPublish: z.boolean(),
  }),
});

export const unitTechnicalProfileSnapshotDetailResponseSchema = z.strictObject({
  snapshot: unitTechnicalProfileSnapshotDetailSchema,
  permissions: z.strictObject({
    canEdit: z.boolean(),
    canPublish: z.boolean(),
  }),
});

export const unitTechnicalProfileEffectiveResponseSchema = z.strictObject({
  date: z.string(),
  snapshot: unitTechnicalProfileSnapshotDetailSchema,
});

export const unitTechnicalProfilePublishResponseSchema = unitTechnicalProfileGetResponseSchema.extend({
  snapshot: unitTechnicalProfileSnapshotSummarySchema,
});

export const unitTechnicalProfileConflictResponseSchema = z.strictObject({
  error: z.string(),
  profile: unitTechnicalProfileSchema,
  customFieldDefinitions: z.array(unitTechnicalProfileCustomFieldDefinitionSchema).default([]),
  customFieldValues: unitTechnicalProfileCustomFieldValuesSchema,
});

export const unitTechnicalProfilePublishValidationResponseSchema = z.strictObject({
  error: z.string(),
  missingFields: z.array(z.string()),
  missingFieldDetails: z.array(z.strictObject({
    kind: z.enum(["standard", "custom"]),
    code: z.string(),
    label: z.string().optional(),
    definitionId: z.number().int().positive().optional(),
  })).optional(),
});

export type UnitTechnicalProfileDto = z.infer<typeof unitTechnicalProfileSchema>;
export type UnitTechnicalProfileGetResponse = z.infer<typeof unitTechnicalProfileGetResponseSchema>;
export type UnitTechnicalProfilePatchResponse = z.infer<typeof unitTechnicalProfilePatchResponseSchema>;
export type UnitTechnicalProfilePublishRequest = z.infer<typeof unitTechnicalProfilePublishRequestSchema>;
export type UnitTechnicalProfilePublishResponse = z.infer<typeof unitTechnicalProfilePublishResponseSchema>;
export type UnitTechnicalProfileSnapshotSummary = z.infer<typeof unitTechnicalProfileSnapshotSummarySchema>;
export type UnitTechnicalProfileSnapshotDetail = z.infer<typeof unitTechnicalProfileSnapshotDetailSchema>;
export type UnitTechnicalProfileHistoryResponse = z.infer<typeof unitTechnicalProfileHistoryResponseSchema>;
export type UnitTechnicalProfileSnapshotDetailResponse = z.infer<typeof unitTechnicalProfileSnapshotDetailResponseSchema>;
export type UnitTechnicalProfileEffectiveResponse = z.infer<typeof unitTechnicalProfileEffectiveResponseSchema>;
export type UnitTechnicalProfileConflictResponse = z.infer<typeof unitTechnicalProfileConflictResponseSchema>;
export type UnitTechnicalProfilePublishValidationResponse = z.infer<typeof unitTechnicalProfilePublishValidationResponseSchema>;

function hasProfileValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function calculateUnitTechnicalProfileCompletion(profile: Partial<UnitTechnicalProfileValues>) {
  const sections = UNIT_TECHNICAL_PROFILE_SECTIONS.map((section) => {
    const missingFields = section.fields.filter((field) => !hasProfileValue(profile[field]));
    const completedFields = section.fields.length - missingFields.length;
    const ratio = Math.round((completedFields / section.fields.length) * 100);
    const status = completedFields === 0
      ? "not_started"
      : completedFields === section.fields.length
        ? "completed"
        : "partial";
    return {
      id: section.id,
      title: section.title,
      completedFields,
      totalFields: section.fields.length,
      ratio,
      status,
      missingFields,
    };
  });
  const completedFields = sections.reduce((sum, section) => sum + section.completedFields, 0);
  const totalFields = sections.reduce((sum, section) => sum + section.totalFields, 0);
  const missingFields = sections.flatMap((section) => section.missingFields);
  return {
    completedFields,
    totalFields,
    ratio: totalFields === 0 ? 100 : Math.round((completedFields / totalFields) * 100),
    sections,
    missingFields,
    nextIncompleteSectionId: sections.find((section) => section.status !== "completed")?.id ?? null,
  };
}

export function validateUnitTechnicalProfilePublishMinimum(profile: Partial<UnitTechnicalProfileValues>): string[] {
  const missing: string[] = UNIT_TECHNICAL_PROFILE_PUBLISH_REQUIRED_FIELDS.filter((field) => !hasProfileValue(profile[field]));
  const hasOperationValue = UNIT_TECHNICAL_PROFILE_OPERATION_FIELDS.some((field) => hasProfileValue(profile[field]));
  if (!hasOperationValue) missing.push("operation");
  return missing;
}

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
