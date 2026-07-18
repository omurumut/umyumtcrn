export const COMPANY_LOCALES = ["tr-TR", "en-US"] as const;
export const COMPANY_CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;
export const COMPANY_DATE_FORMATS = ["DD.MM.YYYY", "DD/MM/YYYY", "YYYY-MM-DD"] as const;
export const COMPANY_DECIMAL_SEPARATORS = ["comma", "dot"] as const;
export const COMPANY_ENERGY_DISPLAY_UNITS = ["auto", "kWh", "MWh", "GJ"] as const;
export const COMPANY_TEP_DISPLAY_MODES = ["auto", "tep", "kgep"] as const;
export const COMPANY_CO2_DISPLAY_MODES = ["kg", "tonne"] as const;

export type CompanyLocale = typeof COMPANY_LOCALES[number];
export type CompanyCurrency = typeof COMPANY_CURRENCIES[number];
export type CompanyDateFormat = typeof COMPANY_DATE_FORMATS[number];
export type CompanyDecimalSeparator = typeof COMPANY_DECIMAL_SEPARATORS[number];
export type CompanyEnergyDisplayUnit = typeof COMPANY_ENERGY_DISPLAY_UNITS[number];
export type CompanyTepDisplayMode = typeof COMPANY_TEP_DISPLAY_MODES[number];
export type CompanyCo2DisplayMode = typeof COMPANY_CO2_DISPLAY_MODES[number];

export type CompanySettingsValues = {
  defaultLocale: CompanyLocale;
  defaultCurrency: CompanyCurrency;
  fiscalYearStartMonth: number;
  dateFormat: CompanyDateFormat;
  decimalSeparator: CompanyDecimalSeparator;
  energyDisplayUnit: CompanyEnergyDisplayUnit;
  tepDisplayMode: CompanyTepDisplayMode;
  co2DisplayMode: CompanyCo2DisplayMode;
};

export const DEFAULT_COMPANY_SETTINGS: CompanySettingsValues = {
  defaultLocale: "tr-TR",
  defaultCurrency: "TRY",
  fiscalYearStartMonth: 1,
  dateFormat: "DD.MM.YYYY",
  decimalSeparator: "comma",
  energyDisplayUnit: "auto",
  tepDisplayMode: "auto",
  co2DisplayMode: "tonne",
};

export const VIRTUAL_DEFAULT_SETTINGS_VERSION = 0;

export const COMPANY_LOGO_POSITIONS = ["left", "center", "right"] as const;
export const COMPANY_LOGO_SIZES = ["small", "medium", "large"] as const;
export const COMPANY_ASSET_TYPES = ["company_logo"] as const;
export const COMPANY_ASSET_STATUSES = ["active", "replaced", "deleted"] as const;
export const COMPANY_LOGO_MIME_TYPES = ["image/png", "image/jpeg"] as const;

export type CompanyLogoPosition = typeof COMPANY_LOGO_POSITIONS[number];
export type CompanyLogoSize = typeof COMPANY_LOGO_SIZES[number];
export type CompanyAssetType = typeof COMPANY_ASSET_TYPES[number];
export type CompanyAssetStatus = typeof COMPANY_ASSET_STATUSES[number];
export type CompanyLogoMimeType = typeof COMPANY_LOGO_MIME_TYPES[number];

export type CompanyBrandSettingsValues = {
  showLogoInReports: boolean;
  logoAltText: string;
  logoPosition: CompanyLogoPosition;
  logoSize: CompanyLogoSize;
};

export const DEFAULT_COMPANY_BRAND_SETTINGS: CompanyBrandSettingsValues = {
  showLogoInReports: true,
  logoAltText: "Firma logosu",
  logoPosition: "left",
  logoSize: "medium",
};

export const VIRTUAL_DEFAULT_BRAND_SETTINGS_VERSION = 0;
export const COMPANY_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const COMPANY_LOGO_MAX_WIDTH = 4000;
export const COMPANY_LOGO_MAX_HEIGHT = 4000;
export const COMPANY_LOGO_MAX_PIXELS = 16_000_000;
export const COMPANY_LOGO_NORMALIZED_MAX_WIDTH = 1200;
export const COMPANY_LOGO_NORMALIZED_MAX_HEIGHT = 600;

export const REPORT_LOCALES = ["tr-TR"] as const;
export const REPORT_CONFIDENTIALITY_LEVELS = ["public", "internal", "confidential", "restricted"] as const;
export const REPORT_COVER_STYLES = ["standard", "compact", "none"] as const;
export const REPORT_SECTION_REQUIREMENTS = ["required", "conditional", "optional"] as const;
export const REPORT_TYPE_CODES = ["annual_energy_performance", "energy_targets_management", "energy_performance_monitoring"] as const;
export const REPORT_FILE_NAME_TOKENS = ["company", "reportType", "year", "unit", "date", "revision"] as const;

export type ReportLocale = typeof REPORT_LOCALES[number];
export type ReportConfidentialityLevel = typeof REPORT_CONFIDENTIALITY_LEVELS[number];
export type ReportCoverStyle = typeof REPORT_COVER_STYLES[number];
export type ReportSectionRequirement = typeof REPORT_SECTION_REQUIREMENTS[number];
export type ReportTypeCode = typeof REPORT_TYPE_CODES[number];

export type ReportSectionDefinition = {
  code: string;
  defaultLabel: string;
  defaultOrder: number;
  requirement: ReportSectionRequirement;
  canHide: boolean;
  canReorder: boolean;
  canRename: boolean;
};

export type ReportTypeDefinition = {
  code: ReportTypeCode;
  defaultTitle: string;
  displayName: string;
  endpoint: string;
  outputType: "html_data_url" | "pdf";
  supportedLocales: readonly ReportLocale[];
  supportedCoverStyles: readonly ReportCoverStyle[];
  sections: readonly ReportSectionDefinition[];
};

export type CompanyReportProfileValues = {
  showLogo: boolean;
  defaultLocale: ReportLocale;
  defaultTitle: string | null;
  defaultSubtitle: string | null;
  documentNumber: string | null;
  revisionNumber: string | null;
  revisionDate: string | null;
  preparedBy: string | null;
  checkedBy: string | null;
  approvedBy: string | null;
  confidentialityLevel: ReportConfidentialityLevel;
  footerText: string | null;
  showSignatureFields: boolean;
  showPageNumbers: boolean;
  coverStyle: ReportCoverStyle;
  fileNamePattern: string;
};

export const DEFAULT_COMPANY_REPORT_PROFILE: CompanyReportProfileValues = {
  showLogo: true,
  defaultLocale: "tr-TR",
  defaultTitle: null,
  defaultSubtitle: null,
  documentNumber: null,
  revisionNumber: null,
  revisionDate: null,
  preparedBy: null,
  checkedBy: null,
  approvedBy: null,
  confidentialityLevel: "internal",
  footerText: "Bu rapor ISO 50001 Enerji Yönetim Sistemi kapsamında otomatik olarak üretilmiştir.",
  showSignatureFields: true,
  showPageNumbers: true,
  coverStyle: "standard",
  fileNamePattern: "{company}_{reportType}_{year}",
};

export const VIRTUAL_DEFAULT_REPORT_PROFILE_VERSION = 0;
export const VIRTUAL_DEFAULT_REPORT_TYPE_SETTINGS_VERSION = 0;

export const REPORT_PROFILE_FIELD_LIMITS = {
  defaultTitle: 250,
  defaultSubtitle: 500,
  documentNumber: 100,
  revisionNumber: 50,
  preparedBy: 150,
  checkedBy: 150,
  approvedBy: 150,
  footerText: 1000,
  fileNamePattern: 250,
  sectionLabel: 150,
} as const;

export const REPORT_TYPE_REGISTRY = [
  {
    code: "annual_energy_performance",
    displayName: "Yıllık Enerji Performans Raporu",
    defaultTitle: "Yıllık Enerji Performans Raporu",
    endpoint: "/api/reports/generate",
    outputType: "html_data_url",
    supportedLocales: ["tr-TR"],
    supportedCoverStyles: ["standard", "compact"],
    sections: [
      { code: "cover", defaultLabel: "Kapak ve Rapor Bilgileri", defaultOrder: 10, requirement: "required", canHide: false, canReorder: false, canRename: false },
      { code: "summary_indicators", defaultLabel: "Özet Göstergeler", defaultOrder: 20, requirement: "required", canHide: false, canReorder: false, canRename: true },
      { code: "monthly_consumption", defaultLabel: "Aylık Enerji Tüketimi", defaultOrder: 30, requirement: "required", canHide: false, canReorder: false, canRename: true },
      { code: "swot", defaultLabel: "SWOT Analizi", defaultOrder: 40, requirement: "optional", canHide: true, canReorder: true, canRename: true },
      { code: "risks", defaultLabel: "Risk & Fırsat Analizi", defaultOrder: 50, requirement: "optional", canHide: true, canReorder: true, canRename: true },
      { code: "seu", defaultLabel: "Önemli Enerji Kullanımları", defaultOrder: 60, requirement: "optional", canHide: true, canReorder: true, canRename: true },
      { code: "regression", defaultLabel: "Regresyon Analizi", defaultOrder: 70, requirement: "optional", canHide: true, canReorder: true, canRename: true },
    ],
  },
  {
    code: "energy_targets_management",
    displayName: "Hedef, Eylem Planı ve VAP Yönetim Raporu",
    defaultTitle: "ISO 50001 Hedef, Eylem Planı ve VAP Yönetim Raporu",
    endpoint: "/api/reports/energy-targets/pdf",
    outputType: "pdf",
    supportedLocales: ["tr-TR"],
    supportedCoverStyles: ["standard", "compact"],
    sections: [
      { code: "cover", defaultLabel: "Kapak ve Kapsam", defaultOrder: 10, requirement: "required", canHide: false, canReorder: false, canRename: false },
      { code: "executive_summary", defaultLabel: "Yönetici Özeti", defaultOrder: 20, requirement: "required", canHide: false, canReorder: false, canRename: true },
      { code: "energy_targets", defaultLabel: "Enerji Hedefleri Tablosu", defaultOrder: 30, requirement: "required", canHide: false, canReorder: false, canRename: true },
      { code: "action_plans", defaultLabel: "Eylem Planları Tablosu", defaultOrder: 40, requirement: "required", canHide: false, canReorder: false, canRename: true },
      { code: "vap_portfolio", defaultLabel: "VAP Portföyü", defaultOrder: 50, requirement: "optional", canHide: true, canReorder: true, canRename: true },
      { code: "progress_chronology", defaultLabel: "Gerçekleşme Kronolojisi", defaultOrder: 60, requirement: "optional", canHide: true, canReorder: true, canRename: true },
    ],
  },
  {
    code: "energy_performance_monitoring",
    displayName: "EnPG İzleme Raporu",
    defaultTitle: "ISO 50001 - EnPG İzleme Raporu",
    endpoint: "/api/reports/energy-performance/pdf",
    outputType: "pdf",
    supportedLocales: ["tr-TR"],
    supportedCoverStyles: ["standard", "compact"],
    sections: [
      { code: "cover", defaultLabel: "Kapak ve Meta Bilgiler", defaultOrder: 10, requirement: "required", canHide: false, canReorder: false, canRename: false },
      { code: "regression_model", defaultLabel: "Regresyon Modeli", defaultOrder: 20, requirement: "required", canHide: false, canReorder: false, canRename: true },
      { code: "model_variables", defaultLabel: "Model Değişkenleri", defaultOrder: 30, requirement: "conditional", canHide: true, canReorder: true, canRename: true },
      { code: "performance_summary", defaultLabel: "Performans Özeti", defaultOrder: 40, requirement: "required", canHide: false, canReorder: false, canRename: true },
      { code: "monthly_results", defaultLabel: "Aylık EnPG Sonuçları", defaultOrder: 50, requirement: "required", canHide: false, canReorder: false, canRename: true },
    ],
  },
] as const satisfies readonly ReportTypeDefinition[];
