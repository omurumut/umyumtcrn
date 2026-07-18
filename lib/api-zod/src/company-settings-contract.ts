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
