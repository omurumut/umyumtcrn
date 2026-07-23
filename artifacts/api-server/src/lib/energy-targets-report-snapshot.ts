import type {
  ReportConfidentialityLevel,
  ReportCoverStyle,
  ReportLocale,
  ReportSectionRequirement,
} from "@workspace/api-zod";
import { REPORT_FILE_NAME_TOKENS } from "@workspace/api-zod";
import { safePdfFilename } from "./pdf-render.js";

export const ENERGY_TARGETS_REPORT_TYPE = "energy_targets_management" as const;
export const REPORT_SETTINGS_SNAPSHOT_SCHEMA_VERSION = "2026-07-18.phase-3b-3b.energy-targets";

const LEGACY_SECTION_PARAMS = {
  includeVap: "vap_portfolio",
  includeProgress: "progress_chronology",
} as const;

const CONFIDENTIALITY_LABELS: Record<ReportConfidentialityLevel, string> = {
  public: "Genel",
  internal: "Ic Kullanim",
  confidential: "Gizli",
  restricted: "Kisitli",
};

type LegacyParamName = keyof typeof LEGACY_SECTION_PARAMS;
type LegacySectionCode = typeof LEGACY_SECTION_PARAMS[LegacyParamName];

type EffectiveEnergyTargetsSection = {
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

type EffectiveEnergyTargetsSettings = {
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
    showLogo: boolean;
    showPageNumbers: boolean;
  };
  profileVersion: number;
  typeSettingsVersion: number;
  title: string;
  subtitle: string | null;
  locale: ReportLocale;
  coverStyle: ReportCoverStyle;
  sections: EffectiveEnergyTargetsSection[];
  logo: {
    mimeType: string;
    width: number;
    height: number;
    version: number;
    altText?: string | null;
  } | null;
};

export type EnergyTargetsLegacyOverrides = Partial<Record<LegacySectionCode, {
  param: LegacyParamName;
  value: boolean;
}>>;

export type EnergyTargetsReportSnapshotSection = {
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
  legacyOverride: { param: LegacyParamName; value: boolean } | null;
};

export type EnergyTargetsReportSnapshot = {
  schemaVersion: typeof REPORT_SETTINGS_SNAPSHOT_SCHEMA_VERSION;
  registryVersion: string;
  companyId: number;
  unitId: number | null;
  reportType: typeof ENERGY_TARGETS_REPORT_TYPE;
  generatedAt: string;
  generatedBy: number | null;
  year: number;
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
  companyLegalName: string | null;
  companyShortName: string | null;
  companyAddress: string | null;
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
  showLogo: boolean;
  showPageNumbers: boolean;
  logo: {
    mimeType: string;
    width: number;
    height: number;
    version: number;
    altText: string | null;
  } | null;
  sections: EnergyTargetsReportSnapshotSection[];
};

export class ReportSettingsSnapshotError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function normalizeConfidentiality(value: string): ReportConfidentialityLevel {
  if (value === "public" || value === "internal" || value === "confidential" || value === "restricted") return value;
  throw new ReportSettingsSnapshotError(400, "Gizlilik seviyesi gecersiz");
}

function assertSingleQueryValue(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) || typeof value !== "string") {
    throw new ReportSettingsSnapshotError(400, `${name} boolean degeri gecersiz`);
  }
  return value;
}

export function parseEnergyTargetsLegacyBoolean(value: unknown, name: LegacyParamName): boolean | undefined {
  const raw = assertSingleQueryValue(value, name);
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ReportSettingsSnapshotError(400, `${name} boolean degeri gecersiz`);
}

export function parseEnergyTargetsLegacyOverrides(query: {
  includeVap?: unknown;
  includeProgress?: unknown;
}): EnergyTargetsLegacyOverrides {
  const overrides: EnergyTargetsLegacyOverrides = {};
  for (const param of Object.keys(LEGACY_SECTION_PARAMS) as LegacyParamName[]) {
    const value = parseEnergyTargetsLegacyBoolean(query[param], param);
    if (value !== undefined) {
      overrides[LEGACY_SECTION_PARAMS[param]] = { param, value };
    }
  }
  return overrides;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function validateFileNamePattern(pattern: string): void {
  if (!pattern || pattern.length > 250) {
    throw new ReportSettingsSnapshotError(400, "Dosya adi deseni gecersiz");
  }
  if (/[\u0000-\u001f\u007f/\\]/.test(pattern) || pattern.includes("..")) {
    throw new ReportSettingsSnapshotError(400, "Dosya adi deseni guvenli degil");
  }
  const allowed = new Set<string>(REPORT_FILE_NAME_TOKENS);
  const tokens = pattern.match(/\{[^{}]+\}/g) ?? [];
  for (const token of tokens) {
    const name = token.slice(1, -1);
    if (!allowed.has(name)) throw new ReportSettingsSnapshotError(400, "Bilinmeyen dosya adi tokeni");
  }
  if (pattern.match(/[{}]/g)?.length !== tokens.length * 2) {
    throw new ReportSettingsSnapshotError(400, "Dosya adi deseni gecersiz");
  }
}

function resolveFileName(pattern: string, tokens: Record<string, string | number>): string {
  validateFileNamePattern(pattern);
  const base = pattern.replace(/\{([a-zA-Z]+)\}/g, (_match, token: string) => String(tokens[token] ?? ""));
  return safePdfFilename([base]);
}

export function buildEnergyTargetsReportSnapshot({
  effective,
  companyId,
  unitId,
  companyName,
  companyLegalName,
  companyShortName,
  companyAddress,
  unitLabel,
  year,
  generatedAt,
  generatedBy,
  hasVapProjects,
  hasProgressRows,
  legacyOverrides,
}: {
  effective: EffectiveEnergyTargetsSettings;
  companyId: number;
  unitId: number | null;
  companyName: string;
  companyLegalName: string | null;
  companyShortName: string | null;
  companyAddress: string | null;
  unitLabel: string;
  year: number;
  generatedAt: Date;
  generatedBy: number | null;
  hasVapProjects: boolean;
  hasProgressRows: boolean;
  legacyOverrides: EnergyTargetsLegacyOverrides;
}): EnergyTargetsReportSnapshot {
  const supportedCoverStyles = new Set(effective.reportDefinition.supportedCoverStyles);
  if (!supportedCoverStyles.has(effective.coverStyle)) {
    throw new ReportSettingsSnapshotError(400, "Rapor tipi bu kapak stilini desteklemiyor");
  }

  const conditionalData: Record<LegacySectionCode, boolean> = {
    vap_portfolio: hasVapProjects,
    progress_chronology: hasProgressRows,
  };

  const sections = effective.sections.map((section) => {
    const conditionalCode: LegacySectionCode | null = section.code === "vap_portfolio" || section.code === "progress_chronology"
      ? section.code
      : null;
    const legacyOverride = conditionalCode
      ? legacyOverrides[conditionalCode]
      : undefined;
    const configuredVisible = section.requirement === "required"
      ? true
      : legacyOverride?.value ?? section.isVisible;
    const hasConditionalEvaluator = conditionalCode !== null;
    const dataAvailable = conditionalCode ? conditionalData[conditionalCode] : null;
    const visibilityResult = section.requirement === "required"
      ? true
      : hasConditionalEvaluator
        ? Boolean(configuredVisible && dataAvailable)
        : Boolean(configuredVisible);

    return {
      code: section.code,
      requirement: section.requirement,
      visibilityResult,
      conditionalEvaluator: {
        applies: hasConditionalEvaluator,
        dataAvailable,
        reason: hasConditionalEvaluator
          ? dataAvailable ? "data_available" : "no_report_data"
          : "not_conditional",
      },
      finalOrder: section.displayOrder,
      finalTitle: section.canRename ? section.label : section.defaultLabel,
      legacyOverride: legacyOverride ?? null,
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
    schemaVersion: REPORT_SETTINGS_SNAPSHOT_SCHEMA_VERSION,
    registryVersion: effective.registryVersion,
    companyId,
    unitId,
    reportType: ENERGY_TARGETS_REPORT_TYPE,
    generatedAt: generatedAt.toISOString(),
    generatedBy,
    year,
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
    companyLegalName,
    companyShortName,
    companyAddress,
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
    showLogo: effective.profile.showLogo,
    showPageNumbers: effective.profile.showPageNumbers,
    logo: effective.logo && effective.profile.showLogo
      ? {
          mimeType: effective.logo.mimeType,
          width: effective.logo.width,
          height: effective.logo.height,
          version: effective.logo.version,
          altText: effective.logo.altText ?? null,
        }
      : null,
    sections,
  };
}

export function visibleEnergyTargetsSections(snapshot: EnergyTargetsReportSnapshot) {
  return snapshot.sections
    .filter((section) => section.visibilityResult)
    .sort((a, b) => a.finalOrder - b.finalOrder);
}
