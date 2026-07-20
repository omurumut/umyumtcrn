import type {
  ReportConfidentialityLevel,
  ReportCoverStyle,
  ReportLocale,
  ReportSectionRequirement,
} from "@workspace/api-zod";
import { REPORT_FILE_NAME_TOKENS } from "@workspace/api-zod";
import { safePdfFilename } from "./pdf-render.js";
import type { TechnicalProfileReportContext } from "./unit-technical-profile-effective.js";

export const ENERGY_PERFORMANCE_REPORT_TYPE = "energy_performance_monitoring" as const;
export const ENERGY_PERFORMANCE_REPORT_SETTINGS_SNAPSHOT_SCHEMA_VERSION = "2026-07-18.phase-3b-3c.energy-performance";

const CONFIDENTIALITY_LABELS: Record<ReportConfidentialityLevel, string> = {
  public: "Genel",
  internal: "Ic Kullanim",
  confidential: "Gizli",
  restricted: "Kisitli",
};

type EffectiveEnergyPerformanceSection = {
  code: string;
  defaultLabel: string;
  requirement: ReportSectionRequirement;
  canHide: boolean;
  canReorder: boolean;
  canRename: boolean;
  isVisible: boolean;
  displayOrder: number;
  defaultOrder: number;
  label: string;
};

type EffectiveEnergyPerformanceSettings = {
  registryVersion: string;
  reportType: string;
  reportDefinition: {
    displayName: string;
    defaultTitle: string;
    supportedCoverStyles: readonly string[];
  };
  profile: {
    fileNamePattern: string;
    confidentialityLevel: string;
    revisionNumber: string | null;
    documentNumber: string | null;
    revisionDate: string | null;
    preparedBy: string | null;
    checkedBy: string | null;
    approvedBy: string | null;
    footerText: string | null;
    showSignatureFields: boolean;
  };
  profileVersion: number;
  typeSettingsVersion: number;
  title: string;
  subtitle: string | null;
  locale: ReportLocale;
  coverStyle: ReportCoverStyle;
  sections: EffectiveEnergyPerformanceSection[];
};

export type EnergyPerformanceReportSnapshotSection = {
  code: string;
  requirement: ReportSectionRequirement;
  visibilityResult: boolean;
  conditionalEvaluator: {
    applies: boolean;
    dataAvailable: boolean | null;
    reason: string;
  };
  finalOrder: number;
  finalTitle: string;
};

export type EnergyPerformanceReportSnapshot = {
  schemaVersion: typeof ENERGY_PERFORMANCE_REPORT_SETTINGS_SNAPSHOT_SCHEMA_VERSION;
  registryVersion: string;
  companyId: number;
  unitId: number | null;
  reportType: typeof ENERGY_PERFORMANCE_REPORT_TYPE;
  generatedAt: string;
  generatedBy: number | null;
  year: number;
  baselineId: number;
  seuAssessmentItemId: number | null;
  modelType: string | null;
  profileVersion: number;
  typeSettingsVersion: number;
  locale: ReportLocale;
  confidentiality: ReportConfidentialityLevel;
  confidentialityLabel: string;
  coverStyle: ReportCoverStyle;
  filenamePattern: string;
  filename: string;
  title: string;
  subtitle: string | null;
  companyName: string;
  unitLabel: string;
  reportDisplayName: string;
  documentNumber: string | null;
  revisionNumber: string | null;
  revisionDate: string | null;
  preparedBy: string | null;
  checkedBy: string | null;
  approvedBy: string | null;
  footerText: string | null;
  showSignatureFields: boolean;
  sections: EnergyPerformanceReportSnapshotSection[];
  technicalProfile: TechnicalProfileReportContext;
};

export class EnergyPerformanceReportSnapshotError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function normalizeConfidentiality(value: string): ReportConfidentialityLevel {
  if (value === "public" || value === "internal" || value === "confidential" || value === "restricted") return value;
  throw new EnergyPerformanceReportSnapshotError(400, "Gizlilik seviyesi gecersiz");
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function validateFileNamePattern(pattern: string): void {
  if (!pattern || pattern.length > 250) {
    throw new EnergyPerformanceReportSnapshotError(400, "Dosya adi deseni gecersiz");
  }
  if (/[\u0000-\u001f\u007f/\\]/.test(pattern) || pattern.includes("..")) {
    throw new EnergyPerformanceReportSnapshotError(400, "Dosya adi deseni guvenli degil");
  }
  const allowed = new Set<string>(REPORT_FILE_NAME_TOKENS);
  const tokens = pattern.match(/\{[^{}]+\}/g) ?? [];
  for (const token of tokens) {
    const name = token.slice(1, -1);
    if (!allowed.has(name)) throw new EnergyPerformanceReportSnapshotError(400, "Bilinmeyen dosya adi tokeni");
  }
  if (pattern.match(/[{}]/g)?.length !== tokens.length * 2) {
    throw new EnergyPerformanceReportSnapshotError(400, "Dosya adi deseni gecersiz");
  }
}

function resolveFileName(pattern: string, tokens: Record<string, string | number>): string {
  validateFileNamePattern(pattern);
  const base = pattern.replace(/\{([a-zA-Z]+)\}/g, (_match, token: string) => String(tokens[token] ?? ""));
  return safePdfFilename([base]);
}

export function buildEnergyPerformanceReportSnapshot({
  effective,
  companyId,
  unitId,
  companyName,
  unitLabel,
  year,
  baselineId,
  seuAssessmentItemId,
  modelType,
  generatedAt,
  generatedBy,
  hasModelVariables,
  technicalProfile,
}: {
  effective: EffectiveEnergyPerformanceSettings;
  companyId: number;
  unitId: number | null;
  companyName: string;
  unitLabel: string;
  year: number;
  baselineId: number;
  seuAssessmentItemId: number | null;
  modelType: string | null;
  generatedAt: Date;
  generatedBy: number | null;
  hasModelVariables: boolean;
  technicalProfile: TechnicalProfileReportContext;
}): EnergyPerformanceReportSnapshot {
  const supportedCoverStyles = new Set(effective.reportDefinition.supportedCoverStyles);
  if (!supportedCoverStyles.has(effective.coverStyle)) {
    throw new EnergyPerformanceReportSnapshotError(400, "Rapor tipi bu kapak stilini desteklemiyor");
  }

  const sections = effective.sections.map((section) => {
    const applies = section.code === "model_variables";
    const configuredVisible = section.requirement === "required" ? true : section.isVisible;
    const visibilityResult = section.requirement === "required"
      ? true
      : applies
        ? Boolean(configuredVisible && hasModelVariables)
        : Boolean(configuredVisible);

    return {
      code: section.code,
      requirement: section.requirement,
      visibilityResult,
      conditionalEvaluator: {
        applies,
        dataAvailable: applies ? hasModelVariables : null,
        reason: applies
          ? hasModelVariables ? "data_available" : "no_model_variables"
          : "not_conditional",
      },
      finalOrder: section.displayOrder,
      finalTitle: section.canRename ? section.label : section.defaultLabel,
    };
  });

  const pattern = effective.profile.fileNamePattern;
  const confidentiality = normalizeConfidentiality(effective.profile.confidentialityLevel);
  const filename = resolveFileName(pattern, {
    company: companyName,
    reportType: effective.reportDefinition.displayName,
    year,
    unit: unitLabel,
    date: isoDate(generatedAt),
    revision: effective.profile.revisionNumber ?? "",
  });

  return {
    schemaVersion: ENERGY_PERFORMANCE_REPORT_SETTINGS_SNAPSHOT_SCHEMA_VERSION,
    registryVersion: effective.registryVersion,
    companyId,
    unitId,
    reportType: ENERGY_PERFORMANCE_REPORT_TYPE,
    generatedAt: generatedAt.toISOString(),
    generatedBy,
    year,
    baselineId,
    seuAssessmentItemId,
    modelType,
    profileVersion: effective.profileVersion,
    typeSettingsVersion: effective.typeSettingsVersion,
    locale: effective.locale,
    confidentiality,
    confidentialityLabel: CONFIDENTIALITY_LABELS[confidentiality],
    coverStyle: effective.coverStyle,
    filenamePattern: pattern,
    filename,
    title: effective.title,
    subtitle: effective.subtitle,
    companyName,
    unitLabel,
    reportDisplayName: effective.reportDefinition.displayName,
    documentNumber: effective.profile.documentNumber,
    revisionNumber: effective.profile.revisionNumber,
    revisionDate: effective.profile.revisionDate,
    preparedBy: effective.profile.preparedBy,
    checkedBy: effective.profile.checkedBy,
    approvedBy: effective.profile.approvedBy,
    footerText: effective.profile.footerText,
    showSignatureFields: effective.profile.showSignatureFields,
    sections,
    technicalProfile,
  };
}

export function visibleEnergyPerformanceSections(snapshot: EnergyPerformanceReportSnapshot) {
  return snapshot.sections
    .filter((section) => section.visibilityResult)
    .sort((a, b) => a.finalOrder - b.finalOrder);
}
