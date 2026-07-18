import type {
  ReportConfidentialityLevel,
  ReportCoverStyle,
  ReportLocale,
  ReportSectionRequirement,
} from "@workspace/api-zod";
import { REPORT_FILE_NAME_TOKENS } from "@workspace/api-zod";
import { safePdfFilename } from "./pdf-render.js";

export const ANNUAL_ENERGY_REPORT_TYPE = "annual_energy_performance" as const;
export const ANNUAL_ENERGY_REPORT_SETTINGS_SNAPSHOT_SCHEMA_VERSION = "2026-07-18.phase-3b-3d.annual-energy";

const LEGACY_SECTION_PARAMS = {
  includeSwot: "swot",
  includeRisks: "risks",
  includeSeu: "seu",
  includeRegression: "regression",
} as const;

const CONFIDENTIALITY_LABELS: Record<ReportConfidentialityLevel, string> = {
  public: "Genel",
  internal: "Ic Kullanim",
  confidential: "Gizli",
  restricted: "Kisitli",
};

type LegacyParamName = keyof typeof LEGACY_SECTION_PARAMS;
type LegacySectionCode = typeof LEGACY_SECTION_PARAMS[LegacyParamName];

type EffectiveAnnualEnergySection = {
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

type EffectiveAnnualEnergySettings = {
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
  sections: EffectiveAnnualEnergySection[];
};

export type AnnualEnergyLegacyOverrides = Partial<Record<LegacySectionCode, {
  param: LegacyParamName;
  value: boolean;
}>>;

export type AnnualEnergyReportSnapshotSection = {
  code: string;
  sectionClass: "required" | "data_conditional";
  requirement: ReportSectionRequirement;
  configuredVisibility: boolean;
  evaluatorResult: {
    applies: boolean;
    dataAvailable: boolean | null;
    reason: string;
    metadata: Record<string, number | boolean | string | null>;
  };
  finalVisibility: boolean;
  visibilityResult: boolean;
  finalOrder: number;
  finalTitle: string;
  titleSource: "registry" | "section_override";
  legacyOverride: { param: LegacyParamName; value: boolean } | null;
};

export type AnnualEnergyReportSnapshot = {
  schemaVersion: typeof ANNUAL_ENERGY_REPORT_SETTINGS_SNAPSHOT_SCHEMA_VERSION;
  registryVersion: string;
  companyId: number;
  unitId: number | null;
  reportType: typeof ANNUAL_ENERGY_REPORT_TYPE;
  generatedAt: string;
  generatedBy: number | null;
  year: number;
  legacyReportId: number;
  profileVersion: number;
  typeSettingsVersion: number;
  locale: ReportLocale;
  confidentiality: ReportConfidentialityLevel;
  confidentialityLabel: string;
  coverStyle: ReportCoverStyle;
  filenamePattern: string;
  outputName: string;
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
  evaluatorSummary: {
    consumptionRows: number;
    meterCount: number;
    swotCount: number;
    riskCount: number;
    seuAssessmentCount: number;
    seuItemCount: number;
    hasRegressionRenderer: boolean;
  };
  legacyOverrides: AnnualEnergyLegacyOverrides;
  sections: AnnualEnergyReportSnapshotSection[];
};

export class AnnualEnergyReportSnapshotError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function normalizeConfidentiality(value: string): ReportConfidentialityLevel {
  if (value === "public" || value === "internal" || value === "confidential" || value === "restricted") return value;
  throw new AnnualEnergyReportSnapshotError(400, "Gizlilik seviyesi gecersiz");
}

function assertBooleanValue(value: unknown, name: LegacyParamName): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  throw new AnnualEnergyReportSnapshotError(400, `${name} boolean degeri gecersiz`);
}

export function parseAnnualEnergyLegacyOverrides(body: Record<string, unknown>): AnnualEnergyLegacyOverrides {
  const overrides: AnnualEnergyLegacyOverrides = {};
  for (const param of Object.keys(LEGACY_SECTION_PARAMS) as LegacyParamName[]) {
    const value = assertBooleanValue(body[param], param);
    if (value !== undefined) overrides[LEGACY_SECTION_PARAMS[param]] = { param, value };
  }
  return overrides;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function validateFileNamePattern(pattern: string): void {
  if (!pattern || pattern.length > 250) {
    throw new AnnualEnergyReportSnapshotError(400, "Dosya adi deseni gecersiz");
  }
  if (/[\u0000-\u001f\u007f/\\]/.test(pattern) || pattern.includes("..")) {
    throw new AnnualEnergyReportSnapshotError(400, "Dosya adi deseni guvenli degil");
  }
  const allowed = new Set<string>(REPORT_FILE_NAME_TOKENS);
  const tokens = pattern.match(/\{[^{}]+\}/g) ?? [];
  for (const token of tokens) {
    const name = token.slice(1, -1);
    if (!allowed.has(name)) throw new AnnualEnergyReportSnapshotError(400, "Bilinmeyen dosya adi tokeni");
  }
  if (pattern.match(/[{}]/g)?.length !== tokens.length * 2) {
    throw new AnnualEnergyReportSnapshotError(400, "Dosya adi deseni gecersiz");
  }
}

function resolveFileName(pattern: string, tokens: Record<string, string | number>): string {
  validateFileNamePattern(pattern);
  const base = pattern.replace(/\{([a-zA-Z]+)\}/g, (_match, token: string) => String(tokens[token] ?? ""));
  return safePdfFilename([base]).replace(/\.pdf$/i, ".html");
}

export function buildAnnualEnergyReportSnapshot({
  effective,
  companyId,
  unitId,
  companyName,
  unitLabel,
  year,
  legacyReportId,
  generatedAt,
  generatedBy,
  data,
  legacyOverrides,
}: {
  effective: EffectiveAnnualEnergySettings;
  companyId: number;
  unitId: number | null;
  companyName: string;
  unitLabel: string;
  year: number;
  legacyReportId: number;
  generatedAt: Date;
  generatedBy: number | null;
  data: {
    consumptionRows: number;
    meterCount: number;
    swotCount: number;
    riskCount: number;
    seuAssessmentCount: number;
    seuItemCount: number;
    hasRegressionRenderer: boolean;
  };
  legacyOverrides: AnnualEnergyLegacyOverrides;
}): AnnualEnergyReportSnapshot {
  const supportedCoverStyles = new Set(effective.reportDefinition.supportedCoverStyles);
  if (!supportedCoverStyles.has(effective.coverStyle)) {
    throw new AnnualEnergyReportSnapshotError(400, "Rapor tipi bu kapak stilini desteklemiyor");
  }

  const dataBySection: Record<LegacySectionCode, { available: boolean; reason: string; metadata: Record<string, number | boolean | string | null> }> = {
    swot: { available: data.swotCount > 0, reason: data.swotCount > 0 ? "data_available" : "no_swot_rows", metadata: { rowCount: data.swotCount } },
    risks: { available: data.riskCount > 0, reason: data.riskCount > 0 ? "data_available" : "no_risk_rows", metadata: { rowCount: data.riskCount } },
    seu: {
      available: data.seuAssessmentCount > 0 && data.seuItemCount > 0,
      reason: data.seuAssessmentCount === 0 ? "no_official_assessment" : data.seuItemCount === 0 ? "no_official_items" : "data_available",
      metadata: { assessmentCount: data.seuAssessmentCount, itemCount: data.seuItemCount },
    },
    regression: {
      available: data.hasRegressionRenderer,
      reason: data.hasRegressionRenderer ? "data_available" : "renderer_not_implemented",
      metadata: { hasRenderer: data.hasRegressionRenderer },
    },
  };

  const sections = effective.sections.map((section) => {
    const conditionalCode: LegacySectionCode | null = section.code === "swot" || section.code === "risks" || section.code === "seu" || section.code === "regression"
      ? section.code
      : null;
    const legacyOverride = conditionalCode ? legacyOverrides[conditionalCode] : undefined;
    const configuredVisibility = section.requirement === "required"
      ? true
      : legacyOverride?.value ?? section.isVisible;
    const evaluator = conditionalCode ? dataBySection[conditionalCode] : null;
    const finalVisibility = section.requirement === "required"
      ? true
      : evaluator
        ? Boolean(configuredVisibility && evaluator.available)
        : Boolean(configuredVisibility);
    const titleSource = (section.canRename && section.label !== section.defaultLabel ? "section_override" : "registry") as "registry" | "section_override";

    return {
      code: section.code,
      sectionClass: (section.requirement === "required" ? "required" : "data_conditional") as "required" | "data_conditional",
      requirement: section.requirement,
      configuredVisibility,
      evaluatorResult: {
        applies: evaluator !== null,
        dataAvailable: evaluator?.available ?? null,
        reason: evaluator?.reason ?? "not_conditional",
        metadata: evaluator?.metadata ?? {},
      },
      finalVisibility,
      visibilityResult: finalVisibility,
      finalOrder: section.displayOrder,
      finalTitle: section.canRename ? section.label : section.defaultLabel,
      titleSource,
      legacyOverride: legacyOverride ?? null,
    };
  });

  const pattern = effective.profile.fileNamePattern;
  const confidentiality = normalizeConfidentiality(effective.profile.confidentialityLevel);
  const outputName = resolveFileName(pattern, {
    company: companyName,
    reportType: effective.reportDefinition.displayName,
    year,
    unit: unitLabel,
    date: isoDate(generatedAt),
    revision: effective.profile.revisionNumber ?? "",
  });

  return {
    schemaVersion: ANNUAL_ENERGY_REPORT_SETTINGS_SNAPSHOT_SCHEMA_VERSION,
    registryVersion: effective.registryVersion,
    companyId,
    unitId,
    reportType: ANNUAL_ENERGY_REPORT_TYPE,
    generatedAt: generatedAt.toISOString(),
    generatedBy,
    year,
    legacyReportId,
    profileVersion: effective.profileVersion,
    typeSettingsVersion: effective.typeSettingsVersion,
    locale: effective.locale,
    confidentiality,
    confidentialityLabel: CONFIDENTIALITY_LABELS[confidentiality],
    coverStyle: effective.coverStyle,
    filenamePattern: pattern,
    outputName,
    filename: outputName,
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
    evaluatorSummary: data,
    legacyOverrides,
    sections,
  };
}

export function visibleAnnualEnergySections(snapshot: AnnualEnergyReportSnapshot) {
  return snapshot.sections
    .filter((section) => section.finalVisibility)
    .sort((a, b) => a.finalOrder - b.finalOrder);
}
