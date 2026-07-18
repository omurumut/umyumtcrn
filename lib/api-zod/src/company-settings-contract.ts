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
