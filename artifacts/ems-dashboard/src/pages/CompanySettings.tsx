import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useListCompanies, getListCompaniesQueryKey } from "@workspace/api-client-react";
import {
  COMPANY_CO2_DISPLAY_MODES,
  COMPANY_CURRENCIES,
  COMPANY_DATE_FORMATS,
  COMPANY_DECIMAL_SEPARATORS,
  COMPANY_ENERGY_DISPLAY_UNITS,
  COMPANY_LOCALES,
  COMPANY_TEP_DISPLAY_MODES,
  COMPANY_LOGO_MAX_BYTES,
  COMPANY_LOGO_MAX_HEIGHT,
  COMPANY_LOGO_MAX_PIXELS,
  COMPANY_LOGO_MAX_WIDTH,
  COMPANY_LOGO_POSITIONS,
  COMPANY_LOGO_SIZES,
  DEFAULT_COMPANY_BRAND_SETTINGS,
  DEFAULT_COMPANY_REPORT_PROFILE,
  DEFAULT_COMPANY_SETTINGS,
  REPORT_CONFIDENTIALITY_LEVELS,
  REPORT_COVER_STYLES,
  REPORT_LOCALES,
  REPORT_PROFILE_FIELD_LIMITS,
  type CompanyBrandSettingsValues,
  type CompanyReportProfileValues,
  type CompanySettingsValues,
  type ReportCoverStyle,
  type ReportLocale,
  type ReportSectionDefinition,
  type ReportTypeCode,
} from "@workspace/api-zod";
import { AlertCircle, ArrowDown, ArrowUp, Building2, FileText, ImageIcon, Info, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { TechnicalProfileFieldsSettings } from "@/components/company-settings/TechnicalProfileFieldsSettings";
import { EquipmentFieldsSettings } from "@/components/company-settings/EquipmentFieldsSettings";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type CompanyProfile = {
  id: number;
  name: string;
  subdomain: string;
  legalName: string | null;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  taxOffice: string | null;
  taxNumber: string | null;
  industry: string | null;
  reportIntroduction: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
  profileVersion: number;
};

type CompanyProfileResponse = {
  company: CompanyProfile;
  permissions: { canEditGeneral: boolean };
};

type CompanyProfileForm = {
  legalName: string;
  shortName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxOffice: string;
  taxNumber: string;
  industry: string;
  reportIntroduction: string;
};

type CompanySettings = CompanySettingsValues & {
  companyId: number;
  settingsVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type CompanySettingsResponse = {
  settings: CompanySettings;
  permissions: { canEdit: boolean };
  isDefault: boolean;
};

type CompanyBrandSettings = CompanyBrandSettingsValues & {
  companyId: number;
  brandSettingsVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
  hasLogo: boolean;
  logoAssetId: number | null;
  logoVersion: number | null;
};

type CompanyBrandResponse = {
  brand: CompanyBrandSettings;
  permissions: { canEdit: boolean; canManageLogo: boolean };
  isDefault: boolean;
};

type PendingLogo = {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  mimeType: string;
};

type CompanyReportProfile = CompanyReportProfileValues & {
  companyId: number;
  profileVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type CompanyReportProfileResponse = {
  profile: CompanyReportProfile;
  permissions: { canEdit: boolean };
  isDefault: boolean;
};

type ReportTypeSummary = {
  code: ReportTypeCode;
  displayName: string;
  defaultTitle: string;
  endpoint: string;
  outputType: "html_data_url" | "pdf";
  supportsCustomization: boolean;
  isCustomized: boolean;
};

type ReportTypesResponse = {
  reportTypes: ReportTypeSummary[];
  permissions: { canEdit: boolean };
};

type EffectiveReportSection = ReportSectionDefinition & {
  isVisible: boolean;
  displayOrder: number;
  label: string;
  labelOverride: string | null;
};

type ReportTypeSettingsResponse = {
  settings: {
    reportType: ReportTypeCode;
    typeSettingsVersion: number;
    title: string;
    subtitle: string | null;
    locale: ReportLocale;
    coverStyle: ReportCoverStyle;
    reportDefinition: {
      code: ReportTypeCode;
      displayName: string;
      defaultTitle: string;
      endpoint: string;
      outputType: "html_data_url" | "pdf";
      supportedLocales: readonly ReportLocale[];
      supportedCoverStyles: readonly ReportCoverStyle[];
      sections: readonly ReportSectionDefinition[];
    };
    sections: EffectiveReportSection[];
    logo: { mimeType: string; width: number; height: number; version: number } | null;
  };
  permissions: { canEdit: boolean };
  isDefault: boolean;
};

type ReportTypeForm = {
  titleOverride: string;
  subtitleOverride: string;
  localeOverride: ReportLocale | "inherit";
  coverStyleOverride: ReportCoverStyle | "inherit";
  sections: EffectiveReportSection[];
};

type ReportRetentionSettings = {
  companyId: number;
  retentionEnabled: boolean;
  completedRetentionDays: number;
  failedRetentionDays: number;
  deletedGraceDays: number;
  automaticCleanupAllowed: boolean;
  settingsVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type ReportRetentionResponse = {
  settings: ReportRetentionSettings;
  permissions: { canEdit: boolean };
  isDefault: boolean;
};

type ReportRetentionForm = Pick<ReportRetentionSettings, "retentionEnabled" | "completedRetentionDays" | "failedRetentionDays" | "deletedGraceDays">;

const DEFAULT_REPORT_RETENTION_FORM: ReportRetentionForm = {
  retentionEnabled: false,
  completedRetentionDays: 3650,
  failedRetentionDays: 90,
  deletedGraceDays: 30,
};

const emptyProfileForm: CompanyProfileForm = {
  legalName: "",
  shortName: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  taxOffice: "",
  taxNumber: "",
  industry: "",
  reportIntroduction: "",
};

const profileFieldLimits: Record<keyof CompanyProfileForm, number> = {
  legalName: 250,
  shortName: 100,
  address: 1000,
  phone: 50,
  email: 254,
  website: 500,
  taxOffice: 150,
  taxNumber: 50,
  industry: 250,
  reportIntroduction: 5000,
};

const monthNames = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function apiFetch<T>(url: string, token: string | null, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = "İşlem başarısız";
    let body: unknown;
    try {
      body = await res.json();
      if (typeof (body as { error?: unknown })?.error === "string") message = (body as { error: string }).error;
    } catch {
      message = `HTTP ${res.status}`;
    }
    throw new ApiError(res.status, message, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function blobFetch(url: string, token: string | null): Promise<Blob> {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
  return res.blob();
}

function formatDate(value: string | null, format = "long"): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  if (format === "short") return date.toLocaleDateString("tr-TR");
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
}

function profileFormFromCompany(company: CompanyProfile): CompanyProfileForm {
  return {
    legalName: company.legalName ?? "",
    shortName: company.shortName ?? "",
    address: company.address ?? "",
    phone: company.phone ?? "",
    email: company.email ?? "",
    website: company.website ?? "",
    taxOffice: company.taxOffice ?? "",
    taxNumber: company.taxNumber ?? "",
    industry: company.industry ?? "",
    reportIntroduction: company.reportIntroduction ?? "",
  };
}

function settingsFormFromResponse(settings: CompanySettings): CompanySettingsValues {
  return {
    defaultLocale: settings.defaultLocale,
    defaultCurrency: settings.defaultCurrency,
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    dateFormat: settings.dateFormat,
    decimalSeparator: settings.decimalSeparator,
    energyDisplayUnit: settings.energyDisplayUnit,
    tepDisplayMode: settings.tepDisplayMode,
    co2DisplayMode: settings.co2DisplayMode,
  };
}

function brandFormFromResponse(brand: CompanyBrandSettings): CompanyBrandSettingsValues {
  return {
    showLogoInReports: brand.showLogoInReports,
    logoAltText: brand.logoAltText,
    logoPosition: brand.logoPosition,
    logoSize: brand.logoSize,
  };
}

function reportProfileFormFromResponse(profile: CompanyReportProfile): CompanyReportProfileValues {
  return {
    showLogo: profile.showLogo,
    defaultLocale: profile.defaultLocale,
    defaultTitle: profile.defaultTitle,
    defaultSubtitle: profile.defaultSubtitle,
    documentNumber: profile.documentNumber,
    revisionNumber: profile.revisionNumber,
    revisionDate: profile.revisionDate,
    preparedBy: profile.preparedBy,
    checkedBy: profile.checkedBy,
    approvedBy: profile.approvedBy,
    confidentialityLevel: profile.confidentialityLevel,
    footerText: profile.footerText,
    showSignatureFields: profile.showSignatureFields,
    showPageNumbers: profile.showPageNumbers,
    coverStyle: profile.coverStyle,
    fileNamePattern: profile.fileNamePattern,
  };
}

function reportTypeFormFromResponse(response: ReportTypeSettingsResponse): ReportTypeForm {
  return {
    titleOverride: "",
    subtitleOverride: "",
    localeOverride: "inherit",
    coverStyleOverride: "inherit",
    sections: response.settings.sections.map((section) => ({ ...section })),
  };
}

function reportRetentionFormFromResponse(settings: ReportRetentionSettings): ReportRetentionForm {
  return {
    retentionEnabled: settings.retentionEnabled,
    completedRetentionDays: settings.completedRetentionDays,
    failedRetentionDays: settings.failedRetentionDays,
    deletedGraceDays: settings.deletedGraceDays,
  };
}

function validateFileNamePattern(pattern: string): string | null {
  if (!pattern.trim()) return "Dosya adı kuralı boş olamaz.";
  if (pattern.length > REPORT_PROFILE_FIELD_LIMITS.fileNamePattern) return "Dosya adı kuralı çok uzun.";
  if (/[\u0000-\u001f\u007f]/.test(pattern) || /[\\/]/.test(pattern) || pattern.includes("..")) return "Dosya adı kuralı güvenli değil.";
  const allowed = new Set(["company", "reportType", "year", "unit", "date", "revision"]);
  const tokens = [...pattern.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
  if (tokens.some((token) => !allowed.has(token))) return "Bilinmeyen dosya adı tokenı var.";
  if (/[{}]/.test(pattern.replace(/\{[^{}]+\}/g, ""))) return "Dosya adı token biçimi geçersiz.";
  return null;
}

function normalizeNullable(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

function validateReportProfile(form: CompanyReportProfileValues): string | null {
  const checks: Array<[string | null, number, string]> = [
    [form.defaultTitle, REPORT_PROFILE_FIELD_LIMITS.defaultTitle, "Varsayılan başlık"],
    [form.defaultSubtitle, REPORT_PROFILE_FIELD_LIMITS.defaultSubtitle, "Alt başlık"],
    [form.documentNumber, REPORT_PROFILE_FIELD_LIMITS.documentNumber, "Doküman numarası"],
    [form.revisionNumber, REPORT_PROFILE_FIELD_LIMITS.revisionNumber, "Revizyon numarası"],
    [form.preparedBy, REPORT_PROFILE_FIELD_LIMITS.preparedBy, "Hazırlayan"],
    [form.checkedBy, REPORT_PROFILE_FIELD_LIMITS.checkedBy, "Kontrol eden"],
    [form.approvedBy, REPORT_PROFILE_FIELD_LIMITS.approvedBy, "Onaylayan"],
    [form.footerText, REPORT_PROFILE_FIELD_LIMITS.footerText, "Alt bilgi"],
  ];
  for (const [value, limit, label] of checks) {
    if ((value ?? "").trim().length > limit) return `${label} ${limit} karakteri aşamaz.`;
  }
  return validateFileNamePattern(form.fileNamePattern);
}

function validateReportRetention(form: ReportRetentionForm): string | null {
  if (!Number.isSafeInteger(form.completedRetentionDays) || form.completedRetentionDays < 365 || form.completedRetentionDays > 36500) return "Tamamlanan rapor saklama suresi 365-36500 gun arasinda olmalidir.";
  if (!Number.isSafeInteger(form.failedRetentionDays) || form.failedRetentionDays < 30 || form.failedRetentionDays > 3650) return "Hatali rapor saklama suresi 30-3650 gun arasinda olmalidir.";
  if (!Number.isSafeInteger(form.deletedGraceDays) || form.deletedGraceDays < 7 || form.deletedGraceDays > 365) return "Silinen rapor bekleme suresi 7-365 gun arasinda olmalidir.";
  return null;
}

function validateBrandForm(form: CompanyBrandSettingsValues): string | null {
  if (form.logoAltText.trim().length > 250) return "Logo alternatif metni 250 karakteri aşamaz.";
  return null;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
}

async function inspectImageFile(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("invalid-image"));
    });
    image.src = url;
    await loaded;
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function validateProfileForm(form: CompanyProfileForm): string | null {
  for (const [field, limit] of Object.entries(profileFieldLimits) as Array<[keyof CompanyProfileForm, number]>) {
    if (form[field].trim().length > limit) return `${limit} karakter sınırı aşıldı.`;
  }
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return "Geçerli bir e-posta adresi girin.";
  }
  if (form.website.trim()) {
    try {
      const parsed = new URL(form.website.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Web sitesi http:// veya https:// ile başlamalıdır.";
    } catch {
      return "Web sitesi http:// veya https:// ile başlamalıdır.";
    }
  }
  return null;
}

function validateSettingsForm(form: CompanySettingsValues): Partial<Record<keyof CompanySettingsValues, string>> {
  const errors: Partial<Record<keyof CompanySettingsValues, string>> = {};
  if (form.fiscalYearStartMonth < 1 || form.fiscalYearStartMonth > 12) errors.fiscalYearStartMonth = "Mali yıl başlangıç ayı 1-12 arasında olmalıdır.";
  return errors;
}

function companyLocale(settings: CompanySettingsValues) {
  return COMPANY_LOCALES.includes(settings.defaultLocale) ? settings.defaultLocale : DEFAULT_COMPANY_SETTINGS.defaultLocale;
}

function safeCurrency(settings: CompanySettingsValues) {
  return COMPANY_CURRENCIES.includes(settings.defaultCurrency) ? settings.defaultCurrency : DEFAULT_COMPANY_SETTINGS.defaultCurrency;
}

function formatPreviewNumber(value: number, settings: CompanySettingsValues, digits = 2) {
  let output = new Intl.NumberFormat(companyLocale(settings), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  if (settings.decimalSeparator === "comma") output = output.replace(/,/g, "§").replace(/\./g, ",").replace(/§/g, ".");
  if (settings.decimalSeparator === "dot") output = output.replace(/\./g, "§").replace(/,/g, ".").replace(/§/g, ",");
  return output;
}

function formatPreviewCurrency(value: number, settings: CompanySettingsValues) {
  return new Intl.NumberFormat(companyLocale(settings), {
    style: "currency",
    currency: safeCurrency(settings),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPreviewDate(settings: CompanySettingsValues) {
  const day = "18";
  const month = "07";
  const year = "2026";
  if (settings.dateFormat === "DD/MM/YYYY") return `${day}/${month}/${year}`;
  if (settings.dateFormat === "YYYY-MM-DD") return `${year}-${month}-${day}`;
  return `${day}.${month}.${year}`;
}

function formatPreviewEnergy(settings: CompanySettingsValues) {
  const kwh = 12345.6;
  if (settings.energyDisplayUnit === "kWh") return `${formatPreviewNumber(kwh, settings)} kWh`;
  if (settings.energyDisplayUnit === "GJ") return `${formatPreviewNumber(kwh * 0.0036, settings)} GJ`;
  return `${formatPreviewNumber(kwh / 1000, settings)} MWh`;
}

function formatPreviewTep(settings: CompanySettingsValues) {
  const tep = 4.28;
  if (settings.tepDisplayMode === "kgep") return `${formatPreviewNumber(tep * 1000, settings)} kgep`;
  return `${formatPreviewNumber(tep, settings)} tep`;
}

function formatPreviewCo2(settings: CompanySettingsValues) {
  const kg = 18400;
  if (settings.co2DisplayMode === "kg") return `${formatPreviewNumber(kg, settings)} kgCO2`;
  return `${formatPreviewNumber(kg / 1000, settings)} tCO2`;
}

function Field({ id, label, children, help, error }: {
  id: string;
  label: string;
  children: ReactNode;
  help?: ReactNode;
  error?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help && <div className="text-xs text-muted-foreground">{help}</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}

function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  disabled,
  help,
  error,
  testId,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly T[];
  disabled: boolean;
  help?: ReactNode;
  error?: string;
  testId: string;
  onChange: (value: T) => void;
}) {
  return (
    <Field id={id} label={label} help={help} error={error}>
      <Select value={value} disabled={disabled} onValueChange={(next) => {
        if (next) onChange(next as T);
      }}>
        <SelectTrigger id={id} data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border/60 py-3 last:border-b-0 sm:grid-cols-[180px_1fr] sm:gap-4">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

export default function CompanySettings() {
  const { user, token } = useAuth();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === "superadmin";
  const effectiveCompanyId = isSuperAdmin ? companyId : user?.companyId ?? null;
  const profileQueryKey = ["company-profile", user?.role, effectiveCompanyId];
  const settingsQueryKey = ["company-settings", user?.role, effectiveCompanyId];
  const brandQueryKey = ["company-brand", user?.role, effectiveCompanyId];
  const logoQueryKey = ["company-brand-logo", user?.role, effectiveCompanyId];
  const reportProfileQueryKey = ["company-report-settings-profile", user?.role, effectiveCompanyId];
  const reportTypesQueryKey = ["company-report-settings-types", user?.role, effectiveCompanyId];
  const reportRetentionQueryKey = ["company-report-settings-retention", user?.role, effectiveCompanyId];
  const [profileForm, setProfileForm] = useState<CompanyProfileForm>(emptyProfileForm);
  const [profileDirty, setProfileDirty] = useState(false);
  const [loadedProfileKey, setLoadedProfileKey] = useState<string | null>(null);
  const [profileConflict, setProfileConflict] = useState(false);
  const [settingsForm, setSettingsForm] = useState<CompanySettingsValues>(DEFAULT_COMPANY_SETTINGS);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [loadedSettingsKey, setLoadedSettingsKey] = useState<string | null>(null);
  const [settingsConflict, setSettingsConflict] = useState(false);
  const [settingsErrors, setSettingsErrors] = useState<Partial<Record<keyof CompanySettingsValues, string>>>({});
  const [brandForm, setBrandForm] = useState<CompanyBrandSettingsValues>(DEFAULT_COMPANY_BRAND_SETTINGS);
  const [brandDirty, setBrandDirty] = useState(false);
  const [loadedBrandKey, setLoadedBrandKey] = useState<string | null>(null);
  const [brandConflict, setBrandConflict] = useState(false);
  const [pendingLogo, setPendingLogo] = useState<PendingLogo | null>(null);
  const [fetchedLogoUrl, setFetchedLogoUrl] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [reportProfileForm, setReportProfileForm] = useState<CompanyReportProfileValues>(DEFAULT_COMPANY_REPORT_PROFILE);
  const [reportProfileDirty, setReportProfileDirty] = useState(false);
  const [loadedReportProfileKey, setLoadedReportProfileKey] = useState<string | null>(null);
  const [reportProfileConflict, setReportProfileConflict] = useState(false);
  const [reportRetentionForm, setReportRetentionForm] = useState<ReportRetentionForm>(DEFAULT_REPORT_RETENTION_FORM);
  const [reportRetentionDirty, setReportRetentionDirty] = useState(false);
  const [loadedReportRetentionKey, setLoadedReportRetentionKey] = useState<string | null>(null);
  const [reportRetentionConflict, setReportRetentionConflict] = useState(false);
  const [selectedReportType, setSelectedReportType] = useState<ReportTypeCode | null>(null);
  const [reportTypeForms, setReportTypeForms] = useState<Partial<Record<ReportTypeCode, ReportTypeForm>>>({});
  const [reportTypeDirty, setReportTypeDirty] = useState<Partial<Record<ReportTypeCode, boolean>>>({});
  const [loadedReportTypeKeys, setLoadedReportTypeKeys] = useState<Partial<Record<ReportTypeCode, string>>>({});
  const [reportTypeConflict, setReportTypeConflict] = useState<Partial<Record<ReportTypeCode, boolean>>>({});
  const pendingLogoUrlRef = useRef<string | null>(null);
  const fetchedLogoUrlRef = useRef<string | null>(null);

  const { data: companies = [], isLoading: companiesLoading } = useListCompanies({
    query: {
      queryKey: getListCompaniesQueryKey(),
      enabled: isSuperAdmin,
    },
  });

  const selectedCompanyExists = useMemo(() => {
    if (!isSuperAdmin || effectiveCompanyId === null) return true;
    return (companies as Array<{ id: number }>).some((company) => company.id === effectiveCompanyId);
  }, [companies, effectiveCompanyId, isSuperAdmin]);

  const profileUrl = effectiveCompanyId === null
    ? null
    : isSuperAdmin
      ? `/api/company-profile?companyId=${effectiveCompanyId}`
      : "/api/company-profile";
  const settingsUrl = effectiveCompanyId === null
    ? null
    : isSuperAdmin
      ? `/api/company-settings?companyId=${effectiveCompanyId}`
      : "/api/company-settings";
  const brandUrl = effectiveCompanyId === null
    ? null
    : isSuperAdmin
      ? `/api/company-brand?companyId=${effectiveCompanyId}`
      : "/api/company-brand";
  const logoUrl = effectiveCompanyId === null
    ? null
    : isSuperAdmin
      ? `/api/company-brand/logo?companyId=${effectiveCompanyId}`
      : "/api/company-brand/logo";
  const reportProfileUrl = effectiveCompanyId === null
    ? null
    : isSuperAdmin
      ? `/api/company-report-settings/profile?companyId=${effectiveCompanyId}`
      : "/api/company-report-settings/profile";
  const reportTypesUrl = effectiveCompanyId === null
    ? null
    : isSuperAdmin
      ? `/api/company-report-settings/types?companyId=${effectiveCompanyId}`
      : "/api/company-report-settings/types";
  const reportRetentionUrl = effectiveCompanyId === null
    ? null
    : isSuperAdmin
      ? `/api/company-report-settings/retention?companyId=${effectiveCompanyId}`
      : "/api/company-report-settings/retention";
  const selectedReportTypeQueryKey = ["company-report-settings-type", user?.role, effectiveCompanyId, selectedReportType];
  const selectedReportTypeUrl = effectiveCompanyId === null || !selectedReportType
    ? null
    : isSuperAdmin
      ? `/api/company-report-settings/types/${selectedReportType}?companyId=${effectiveCompanyId}`
      : `/api/company-report-settings/types/${selectedReportType}`;

  const profileQuery = useQuery<CompanyProfileResponse, ApiError>({
    queryKey: profileQueryKey,
    queryFn: () => apiFetch<CompanyProfileResponse>(profileUrl!, token),
    enabled: !!token && profileUrl !== null && selectedCompanyExists,
  });

  const settingsQuery = useQuery<CompanySettingsResponse, ApiError>({
    queryKey: settingsQueryKey,
    queryFn: () => apiFetch<CompanySettingsResponse>(settingsUrl!, token),
    enabled: !!token && settingsUrl !== null && selectedCompanyExists,
  });

  const brandQuery = useQuery<CompanyBrandResponse, ApiError>({
    queryKey: brandQueryKey,
    queryFn: () => apiFetch<CompanyBrandResponse>(brandUrl!, token),
    enabled: !!token && brandUrl !== null && selectedCompanyExists,
  });

  const logoQuery = useQuery<Blob, ApiError>({
    queryKey: logoQueryKey,
    queryFn: () => blobFetch(logoUrl!, token),
    enabled: !!token && logoUrl !== null && selectedCompanyExists && brandQuery.data?.brand.hasLogo === true,
    retry: false,
  });

  const reportProfileQuery = useQuery<CompanyReportProfileResponse, ApiError>({
    queryKey: reportProfileQueryKey,
    queryFn: () => apiFetch<CompanyReportProfileResponse>(reportProfileUrl!, token),
    enabled: !!token && reportProfileUrl !== null && selectedCompanyExists,
  });

  const reportTypesQuery = useQuery<ReportTypesResponse, ApiError>({
    queryKey: reportTypesQueryKey,
    queryFn: () => apiFetch<ReportTypesResponse>(reportTypesUrl!, token),
    enabled: !!token && reportTypesUrl !== null && selectedCompanyExists,
  });

  const reportRetentionQuery = useQuery<ReportRetentionResponse, ApiError>({
    queryKey: reportRetentionQueryKey,
    queryFn: () => apiFetch<ReportRetentionResponse>(reportRetentionUrl!, token),
    enabled: !!token && reportRetentionUrl !== null && selectedCompanyExists,
  });

  const selectedReportTypeQuery = useQuery<ReportTypeSettingsResponse, ApiError>({
    queryKey: selectedReportTypeQueryKey,
    queryFn: () => apiFetch<ReportTypeSettingsResponse>(selectedReportTypeUrl!, token),
    enabled: !!token && selectedReportTypeUrl !== null && selectedCompanyExists,
  });

  const profileMutation = useMutation<CompanyProfileResponse, ApiError, CompanyProfileForm>({
    mutationFn: (nextForm) => apiFetch<CompanyProfileResponse>(profileUrl!, token, {
      method: "PATCH",
      body: JSON.stringify({
        expectedProfileVersion: profileQuery.data?.company.profileVersion,
        ...nextForm,
      }),
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(profileQueryKey, data);
      setProfileForm(profileFormFromCompany(data.company));
      setProfileDirty(false);
      setProfileConflict(false);
      setLoadedProfileKey(`${data.company.id}:${data.company.profileVersion}`);
      toast({ title: "Firma bilgileri güncellendi" });
    },
    onError: (error) => {
      if (error.status === 409) setProfileConflict(true);
      toast({ title: "Güncelleme başarısız", description: error.message, variant: "destructive" });
    },
  });

  const settingsMutation = useMutation<CompanySettingsResponse, ApiError, CompanySettingsValues>({
    mutationFn: (nextForm) => apiFetch<CompanySettingsResponse>(settingsUrl!, token, {
      method: "PATCH",
      body: JSON.stringify({
        expectedSettingsVersion: settingsQuery.data?.settings.settingsVersion,
        ...nextForm,
      }),
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(settingsQueryKey, data);
      setSettingsForm(settingsFormFromResponse(data.settings));
      setSettingsDirty(false);
      setSettingsConflict(false);
      setSettingsErrors({});
      setLoadedSettingsKey(`${data.settings.companyId}:${data.settings.settingsVersion}`);
      toast({ title: "Firma tercihleri güncellendi." });
    },
    onError: (error) => {
      if (error.status === 409) setSettingsConflict(true);
      toast({ title: "Firma tercihleri kaydedilemedi", description: error.message, variant: "destructive" });
    },
  });

  const brandMutation = useMutation<CompanyBrandResponse, ApiError, CompanyBrandSettingsValues>({
    mutationFn: (nextForm) => apiFetch<CompanyBrandResponse>(brandUrl!, token, {
      method: "PATCH",
      body: JSON.stringify({
        expectedBrandSettingsVersion: brandQuery.data?.brand.brandSettingsVersion,
        ...nextForm,
        logoAltText: nextForm.logoAltText.trim(),
      }),
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(brandQueryKey, data);
      setBrandForm(brandFormFromResponse(data.brand));
      setBrandDirty(false);
      setBrandConflict(false);
      setLoadedBrandKey(`${data.brand.companyId}:${data.brand.brandSettingsVersion}:${data.brand.logoVersion ?? 0}`);
      toast({ title: "Kurumsal kimlik ayarları güncellendi." });
    },
    onError: (error) => {
      if (error.status === 409) setBrandConflict(true);
      toast({ title: "Kurumsal kimlik kaydedilemedi", description: error.message, variant: "destructive" });
    },
  });

  const logoUploadMutation = useMutation<unknown, ApiError, File>({
    mutationFn: (file) => {
      const data = new FormData();
      data.append("logo", file);
      return apiFetch<unknown>(logoUrl!, token, { method: "POST", body: data });
    },
    onSuccess: async () => {
      clearPendingLogo();
      await queryClient.invalidateQueries({ queryKey: brandQueryKey });
      await queryClient.invalidateQueries({ queryKey: logoQueryKey });
      toast({ title: "Firma logosu güncellendi." });
    },
    onError: (error) => {
      toast({ title: "Logo yüklenemedi", description: error.message, variant: "destructive" });
    },
  });

  const logoDeleteMutation = useMutation<unknown, ApiError>({
    mutationFn: () => apiFetch<unknown>(logoUrl!, token, { method: "DELETE" }),
    onSuccess: async () => {
      setDeleteDialogOpen(false);
      clearPendingLogo();
      revokeFetchedLogoUrl();
      await queryClient.invalidateQueries({ queryKey: brandQueryKey });
      await queryClient.invalidateQueries({ queryKey: logoQueryKey });
      toast({ title: "Firma logosu silindi." });
    },
    onError: (error) => {
      toast({ title: "Logo silinemedi", description: error.message, variant: "destructive" });
    },
  });

  const reportProfileMutation = useMutation<CompanyReportProfileResponse, ApiError, CompanyReportProfileValues>({
    mutationFn: (nextForm) => apiFetch<CompanyReportProfileResponse>(reportProfileUrl!, token, {
      method: "PATCH",
      body: JSON.stringify({
        expectedProfileVersion: reportProfileQuery.data?.profile.profileVersion,
        ...nextForm,
        defaultTitle: normalizeNullable(nextForm.defaultTitle),
        defaultSubtitle: normalizeNullable(nextForm.defaultSubtitle),
        documentNumber: normalizeNullable(nextForm.documentNumber),
        revisionNumber: normalizeNullable(nextForm.revisionNumber),
        revisionDate: normalizeNullable(nextForm.revisionDate),
        preparedBy: normalizeNullable(nextForm.preparedBy),
        checkedBy: normalizeNullable(nextForm.checkedBy),
        approvedBy: normalizeNullable(nextForm.approvedBy),
        footerText: normalizeNullable(nextForm.footerText),
      }),
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(reportProfileQueryKey, data);
      setReportProfileForm(reportProfileFormFromResponse(data.profile));
      setReportProfileDirty(false);
      setReportProfileConflict(false);
      setLoadedReportProfileKey(`${data.profile.companyId}:${data.profile.profileVersion}`);
      toast({ title: "Rapor profili güncellendi." });
    },
    onError: (error) => {
      if (error.status === 409) setReportProfileConflict(true);
      toast({ title: "Rapor profili kaydedilemedi", description: error.message, variant: "destructive" });
    },
  });

  const reportTypeMutation = useMutation<ReportTypeSettingsResponse, ApiError, { reportType: ReportTypeCode; form: ReportTypeForm }>({
    mutationFn: ({ reportType, form }) => {
      const separator = isSuperAdmin ? `?companyId=${effectiveCompanyId}` : "";
      return apiFetch<ReportTypeSettingsResponse>(`/api/company-report-settings/types/${reportType}${separator}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          expectedTypeSettingsVersion: selectedReportTypeQuery.data?.settings.typeSettingsVersion,
          titleOverride: normalizeNullable(form.titleOverride),
          subtitleOverride: normalizeNullable(form.subtitleOverride),
          localeOverride: form.localeOverride === "inherit" ? null : form.localeOverride,
          coverStyleOverride: form.coverStyleOverride === "inherit" ? null : form.coverStyleOverride,
          sections: form.sections.map((section) => ({
            code: section.code,
            isVisible: section.isVisible,
            displayOrder: section.displayOrder,
            labelOverride: normalizeNullable(section.labelOverride),
          })),
        }),
      });
    },
    onSuccess: async (data) => {
      const reportType = data.settings.reportType;
      queryClient.setQueryData(["company-report-settings-type", user?.role, effectiveCompanyId, reportType], data);
      setReportTypeForms((current) => ({ ...current, [reportType]: reportTypeFormFromResponse(data) }));
      setReportTypeDirty((current) => ({ ...current, [reportType]: false }));
      setReportTypeConflict((current) => ({ ...current, [reportType]: false }));
      setLoadedReportTypeKeys((current) => ({ ...current, [reportType]: `${data.settings.reportType}:${data.settings.typeSettingsVersion}` }));
      await queryClient.invalidateQueries({ queryKey: reportTypesQueryKey });
      toast({ title: "Rapor türü ayarları güncellendi." });
    },
    onError: (error, variables) => {
      if (error.status === 409) setReportTypeConflict((current) => ({ ...current, [variables.reportType]: true }));
      toast({ title: "Rapor türü kaydedilemedi", description: error.message, variant: "destructive" });
    },
  });

  const reportRetentionMutation = useMutation<ReportRetentionResponse, ApiError, ReportRetentionForm>({
    mutationFn: (nextForm) => apiFetch<ReportRetentionResponse>(reportRetentionUrl!, token, {
      method: "PATCH",
      body: JSON.stringify({
        expectedSettingsVersion: reportRetentionQuery.data?.settings.settingsVersion,
        ...nextForm,
      }),
    }),
    onSuccess: async (data) => {
      queryClient.setQueryData(reportRetentionQueryKey, data);
      setReportRetentionForm(reportRetentionFormFromResponse(data.settings));
      setReportRetentionDirty(false);
      setReportRetentionConflict(false);
      setLoadedReportRetentionKey(`${data.settings.companyId}:${data.settings.settingsVersion}`);
      await reportRetentionQuery.refetch();
      toast({ title: "Rapor saklama politikasi guncellendi." });
    },
    onError: (error) => {
      if (error.status === 409) setReportRetentionConflict(true);
      toast({ title: "Saklama politikasi kaydedilemedi", description: error.message, variant: "destructive" });
    },
  });

  function revokeFetchedLogoUrl() {
    if (fetchedLogoUrlRef.current) {
      URL.revokeObjectURL(fetchedLogoUrlRef.current);
      fetchedLogoUrlRef.current = null;
    }
    setFetchedLogoUrl(null);
  }

  function clearPendingLogo() {
    if (pendingLogoUrlRef.current) {
      URL.revokeObjectURL(pendingLogoUrlRef.current);
      pendingLogoUrlRef.current = null;
    }
    setPendingLogo(null);
  }

  useEffect(() => {
    if (!profileQuery.data) return;
    const key = `${profileQuery.data.company.id}:${profileQuery.data.company.profileVersion}`;
    if (key === loadedProfileKey) return;
    if (profileDirty && loadedProfileKey !== null && profileQuery.data.company.id !== Number(loadedProfileKey.split(":")[0])) {
      toast({ title: "Kaydedilmemiş değişiklikler sıfırlandı", description: "Seçili firma değiştiği için genel bilgiler güncel profil ile yenilendi." });
    }
    setProfileForm(profileFormFromCompany(profileQuery.data.company));
    setProfileDirty(false);
    setProfileConflict(false);
    setLoadedProfileKey(key);
  }, [loadedProfileKey, profileDirty, profileQuery.data, toast]);

  useEffect(() => {
    if (!settingsQuery.data) return;
    const key = `${settingsQuery.data.settings.companyId}:${settingsQuery.data.settings.settingsVersion}`;
    if (key === loadedSettingsKey) return;
    if (settingsDirty && loadedSettingsKey !== null && settingsQuery.data.settings.companyId !== Number(loadedSettingsKey.split(":")[0])) {
      toast({ title: "Kaydedilmemiş tercihler sıfırlandı", description: "Seçili firma değiştiği için yerelleştirme formu güncel ayarlarla yenilendi." });
    }
    setSettingsForm(settingsFormFromResponse(settingsQuery.data.settings));
    setSettingsDirty(false);
    setSettingsConflict(false);
    setSettingsErrors({});
    setLoadedSettingsKey(key);
  }, [loadedSettingsKey, settingsDirty, settingsQuery.data, toast]);

  useEffect(() => {
    if (!brandQuery.data) return;
    const key = `${brandQuery.data.brand.companyId}:${brandQuery.data.brand.brandSettingsVersion}:${brandQuery.data.brand.logoVersion ?? 0}`;
    if (key === loadedBrandKey) return;
    if (brandDirty && loadedBrandKey !== null && brandQuery.data.brand.companyId !== Number(loadedBrandKey.split(":")[0])) {
      toast({ title: "Kaydedilmemiş kurumsal kimlik değişiklikleri sıfırlandı", description: "Seçili firma değiştiği için kurumsal kimlik formu güncel ayarlarla yenilendi." });
    }
    setBrandForm(brandFormFromResponse(brandQuery.data.brand));
    setBrandDirty(false);
    setBrandConflict(false);
    clearPendingLogo();
    setLoadedBrandKey(key);
  }, [brandDirty, brandQuery.data, loadedBrandKey, toast]);

  useEffect(() => {
    if (!reportProfileQuery.data) return;
    const key = `${reportProfileQuery.data.profile.companyId}:${reportProfileQuery.data.profile.profileVersion}`;
    if (key === loadedReportProfileKey) return;
    if (reportProfileDirty && loadedReportProfileKey !== null && reportProfileQuery.data.profile.companyId !== Number(loadedReportProfileKey.split(":")[0])) {
      toast({ title: "Kaydedilmemiş rapor profili sıfırlandı", description: "Seçili firma değiştiği için rapor ayarları güncel profil ile yenilendi." });
    }
    setReportProfileForm(reportProfileFormFromResponse(reportProfileQuery.data.profile));
    setReportProfileDirty(false);
    setReportProfileConflict(false);
    setLoadedReportProfileKey(key);
    setSelectedReportType(null);
    setReportTypeForms({});
    setReportTypeDirty({});
    setLoadedReportTypeKeys({});
    setReportTypeConflict({});
  }, [loadedReportProfileKey, reportProfileDirty, reportProfileQuery.data, toast]);

  useEffect(() => {
    if (!selectedReportType || !selectedReportTypeQuery.data) return;
    const key = `${selectedReportTypeQuery.data.settings.reportType}:${selectedReportTypeQuery.data.settings.typeSettingsVersion}`;
    if (loadedReportTypeKeys[selectedReportType] === key || reportTypeDirty[selectedReportType]) return;
    setReportTypeForms((current) => ({ ...current, [selectedReportType]: reportTypeFormFromResponse(selectedReportTypeQuery.data!) }));
    setReportTypeConflict((current) => ({ ...current, [selectedReportType]: false }));
    setLoadedReportTypeKeys((current) => ({ ...current, [selectedReportType]: key }));
  }, [loadedReportTypeKeys, reportTypeDirty, selectedReportType, selectedReportTypeQuery.data]);

  useEffect(() => {
    if (!reportRetentionQuery.data) return;
    const key = `${reportRetentionQuery.data.settings.companyId}:${reportRetentionQuery.data.settings.settingsVersion}`;
    if (key === loadedReportRetentionKey) return;
    if (reportRetentionDirty && loadedReportRetentionKey !== null && reportRetentionQuery.data.settings.companyId !== Number(loadedReportRetentionKey.split(":")[0])) {
      toast({ title: "Kaydedilmemis saklama politikasi sifirlandi", description: "Secili firma degistigi icin guncel politika yuklendi." });
    }
    setReportRetentionForm(reportRetentionFormFromResponse(reportRetentionQuery.data.settings));
    setReportRetentionDirty(false);
    setReportRetentionConflict(false);
    setLoadedReportRetentionKey(key);
  }, [loadedReportRetentionKey, reportRetentionDirty, reportRetentionQuery.data, toast]);

  useEffect(() => {
    revokeFetchedLogoUrl();
    if (!logoQuery.data) return;
    const nextUrl = URL.createObjectURL(logoQuery.data);
    fetchedLogoUrlRef.current = nextUrl;
    setFetchedLogoUrl(nextUrl);
  }, [logoQuery.data]);

  useEffect(() => () => {
    if (pendingLogoUrlRef.current) URL.revokeObjectURL(pendingLogoUrlRef.current);
    if (fetchedLogoUrlRef.current) URL.revokeObjectURL(fetchedLogoUrlRef.current);
  }, []);

  useEffect(() => {
    if (!profileDirty && !settingsDirty && !brandDirty && !pendingLogo && !reportProfileDirty && !reportRetentionDirty && !Object.values(reportTypeDirty).some(Boolean)) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [brandDirty, pendingLogo, profileDirty, reportProfileDirty, reportRetentionDirty, reportTypeDirty, settingsDirty]);

  const company = profileQuery.data?.company;
  const canEditProfile = profileQuery.data?.permissions.canEditGeneral === true;
  const canEditSettings = settingsQuery.data?.permissions.canEdit === true;
  const canEditBrand = brandQuery.data?.permissions.canEdit === true;
  const canManageLogo = brandQuery.data?.permissions.canManageLogo === true;
  const canEditReports = reportProfileQuery.data?.permissions.canEdit === true || reportRetentionQuery.data?.permissions.canEdit === true;
  const profileSaving = profileMutation.isPending;
  const settingsSaving = settingsMutation.isPending;
  const brandSaving = brandMutation.isPending;
  const reportProfileSaving = reportProfileMutation.isPending;
  const reportRetentionSaving = reportRetentionMutation.isPending;
  const logoUploading = logoUploadMutation.isPending;
  const logoDeleting = logoDeleteMutation.isPending;
  const profileDisabled = !canEditProfile || profileSaving;
  const settingsDisabled = !canEditSettings || settingsSaving;
  const brandDisabled = !canEditBrand || brandSaving;
  const reportProfileDisabled = !canEditReports || reportProfileSaving;
  const reportRetentionDisabled = !canEditReports || reportRetentionSaving;
  const displayName = company?.legalName?.trim() || company?.name || "-";
  const activeLogoUrl = pendingLogo?.previewUrl ?? fetchedLogoUrl;
  const selectedReportForm = selectedReportType ? reportTypeForms[selectedReportType] : undefined;
  const selectedReportDirty = selectedReportType ? reportTypeDirty[selectedReportType] === true : false;
  const selectedReportConflict = selectedReportType ? reportTypeConflict[selectedReportType] === true : false;

  function patchProfileField(field: keyof CompanyProfileForm, value: string) {
    setProfileForm((current) => ({ ...current, [field]: value }));
    setProfileDirty(true);
  }

  function patchSettingsField<K extends keyof CompanySettingsValues>(field: K, value: CompanySettingsValues[K]) {
    setSettingsForm((current) => ({ ...current, [field]: value }));
    setSettingsDirty(true);
    setSettingsErrors((current) => ({ ...current, [field]: undefined }));
  }

  function patchBrandField<K extends keyof CompanyBrandSettingsValues>(field: K, value: CompanyBrandSettingsValues[K]) {
    setBrandForm((current) => ({ ...current, [field]: value }));
    setBrandDirty(true);
    setBrandConflict(false);
  }

  function handleProfileSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateProfileForm(profileForm);
    if (validationError) {
      toast({ title: "Firma bilgileri kaydedilemedi", description: validationError, variant: "destructive" });
      return;
    }
    profileMutation.mutate(profileForm);
  }

  function handleSettingsSubmit(event: FormEvent) {
    event.preventDefault();
    const errors = validateSettingsForm(settingsForm);
    setSettingsErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast({ title: "Firma tercihleri kaydedilemedi", description: "Lütfen işaretli alanları kontrol edin.", variant: "destructive" });
      return;
    }
    settingsMutation.mutate(settingsForm);
  }

  function handleBrandSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateBrandForm(brandForm);
    if (validationError) {
      toast({ title: "Kurumsal kimlik kaydedilemedi", description: validationError, variant: "destructive" });
      return;
    }
    brandMutation.mutate(brandForm);
  }

  async function handleLogoInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      toast({ title: "Geçersiz format", description: "Yalnız PNG veya JPEG logo yükleyebilirsiniz.", variant: "destructive" });
      return;
    }
    if (file.size > COMPANY_LOGO_MAX_BYTES) {
      toast({ title: "Logo dosyası izin verilen boyutu aşıyor.", description: `Maksimum ${formatBytes(COMPANY_LOGO_MAX_BYTES)}.`, variant: "destructive" });
      return;
    }
    try {
      const dimensions = await inspectImageFile(file);
      if (
        dimensions.width > COMPANY_LOGO_MAX_WIDTH ||
        dimensions.height > COMPANY_LOGO_MAX_HEIGHT ||
        dimensions.width * dimensions.height > COMPANY_LOGO_MAX_PIXELS
      ) {
        toast({ title: "Logo ölçüleri çok büyük", description: "En fazla 4000 x 4000 px ve 16 milyon piksel desteklenir.", variant: "destructive" });
        return;
      }
      clearPendingLogo();
      const previewUrl = URL.createObjectURL(file);
      pendingLogoUrlRef.current = previewUrl;
      setPendingLogo({ file, previewUrl, width: dimensions.width, height: dimensions.height, mimeType: file.type });
    } catch {
      toast({ title: "Logo okunamadı", description: "Yalnız PNG veya JPEG logo yükleyebilirsiniz.", variant: "destructive" });
    }
  }

  async function reloadProfile() {
    setProfileConflict(false);
    await profileQuery.refetch();
  }

  async function reloadSettings() {
    setSettingsConflict(false);
    await settingsQuery.refetch();
  }

  async function reloadBrand() {
    setBrandConflict(false);
    await brandQuery.refetch();
    await logoQuery.refetch();
  }

  function patchReportProfileField<K extends keyof CompanyReportProfileValues>(field: K, value: CompanyReportProfileValues[K]) {
    setReportProfileForm((current) => ({ ...current, [field]: value }));
    setReportProfileDirty(true);
    setReportProfileConflict(false);
  }

  function patchReportRetentionField<K extends keyof ReportRetentionForm>(field: K, value: ReportRetentionForm[K]) {
    setReportRetentionForm((current) => ({ ...current, [field]: value }));
    setReportRetentionDirty(true);
    setReportRetentionConflict(false);
  }

  function handleReportProfileSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateReportProfile(reportProfileForm);
    if (validationError) {
      toast({ title: "Rapor profili kaydedilemedi", description: validationError, variant: "destructive" });
      return;
    }
    reportProfileMutation.mutate(reportProfileForm);
  }

  function handleReportRetentionSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateReportRetention(reportRetentionForm);
    if (validationError) {
      toast({ title: "Saklama politikasi kaydedilemedi", description: validationError, variant: "destructive" });
      return;
    }
    reportRetentionMutation.mutate(reportRetentionForm);
  }

  function patchReportTypeForm(reportType: ReportTypeCode, updater: (current: ReportTypeForm) => ReportTypeForm) {
    const current = reportTypeForms[reportType] ?? (selectedReportTypeQuery.data ? reportTypeFormFromResponse(selectedReportTypeQuery.data) : null);
    if (!current) return;
    setReportTypeForms((forms) => ({ ...forms, [reportType]: updater(current) }));
    setReportTypeDirty((dirty) => ({ ...dirty, [reportType]: true }));
    setReportTypeConflict((conflicts) => ({ ...conflicts, [reportType]: false }));
  }

  function updateSection(reportType: ReportTypeCode, code: string, patch: Partial<Pick<EffectiveReportSection, "isVisible" | "labelOverride">>) {
    patchReportTypeForm(reportType, (current) => ({
      ...current,
      sections: current.sections.map((section) => section.code === code ? { ...section, ...patch } : section),
    }));
  }

  function moveSection(reportType: ReportTypeCode, code: string, direction: -1 | 1) {
    patchReportTypeForm(reportType, (current) => {
      const sections = [...current.sections];
      const index = sections.findIndex((section) => section.code === code);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= sections.length) return current;
      if (!sections[index].canReorder || !sections[targetIndex].canReorder) return current;
      [sections[index], sections[targetIndex]] = [sections[targetIndex], sections[index]];
      return { ...current, sections: sections.map((section, orderIndex) => ({ ...section, displayOrder: section.canReorder ? (orderIndex + 1) * 10 : section.defaultOrder })) };
    });
  }

  function handleReportTypeSubmit(reportType: ReportTypeCode) {
    const form = reportTypeForms[reportType];
    if (!form) return;
    reportTypeMutation.mutate({ reportType, form });
  }

  async function reloadReportProfile() {
    setReportProfileConflict(false);
    await reportProfileQuery.refetch();
  }

  async function reloadReportRetention() {
    setReportRetentionConflict(false);
    await reportRetentionQuery.refetch();
  }

  async function reloadReportType(reportType: ReportTypeCode) {
    setReportTypeConflict((current) => ({ ...current, [reportType]: false }));
    await selectedReportTypeQuery.refetch();
  }

  return (
    <div data-testid="company-settings-page" className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <Building2 className="h-6 w-6 shrink-0 text-teal-400" />
            <h1 className="text-2xl font-bold">Firma Ayarları</h1>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Kurumsal profil bilgilerini ve firma düzeyindeki gösterim tercihlerini yönetin.
          </p>
        </div>
      </div>

      {isSuperAdmin && effectiveCompanyId === null && (
        <Alert data-testid="company-settings-select-company" className="border-amber-500/30 bg-amber-500/10">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Firma seçiniz</AlertTitle>
          <AlertDescription>Firma ayarlarını görüntülemek için üst çubuktaki firma seçiciden bir firma seçin.</AlertDescription>
        </Alert>
      )}

      {isSuperAdmin && effectiveCompanyId !== null && !companiesLoading && !selectedCompanyExists && (
        <Alert data-testid="company-settings-company-missing" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Şirket bulunamadı</AlertTitle>
          <AlertDescription>Seçili firma listede bulunamadı. Lütfen geçerli bir firma seçin.</AlertDescription>
        </Alert>
      )}

      {(profileQuery.data || settingsQuery.data || brandQuery.data || reportProfileQuery.data || reportRetentionQuery.data) && !canEditProfile && !canEditSettings && !canEditBrand && !canEditReports && (
        <Alert className="border-teal-600/30 bg-teal-600/10">
          <Info className="h-4 w-4" />
          <AlertTitle>Salt okunur bilgi</AlertTitle>
          <AlertDescription>Bu alanları yalnız firma yöneticileri düzenleyebilir.</AlertDescription>
        </Alert>
      )}

      {(profileQuery.isError || settingsQuery.isError || brandQuery.isError || reportProfileQuery.isError || reportTypesQuery.isError || reportRetentionQuery.isError || selectedReportTypeQuery.isError) && (
        <Alert data-testid="company-settings-error" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ayarlar yüklenemedi</AlertTitle>
          <AlertDescription>{profileQuery.error?.message ?? settingsQuery.error?.message ?? brandQuery.error?.message ?? reportProfileQuery.error?.message ?? reportTypesQuery.error?.message ?? reportRetentionQuery.error?.message ?? selectedReportTypeQuery.error?.message}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger data-testid="company-general-tab" value="general">Genel Bilgiler</TabsTrigger>
          <TabsTrigger data-testid="company-localization-tab" value="localization">Yerelleştirme ve Gösterim</TabsTrigger>
          <TabsTrigger data-testid="company-brand-tab" value="brand">Kurumsal Kimlik</TabsTrigger>
          <TabsTrigger data-testid="company-reports-tab" value="reports">Raporlar</TabsTrigger>
          <TabsTrigger data-testid="company-technical-profile-fields-tab" value="technical-profile-fields">Teknik Profil Alanlari</TabsTrigger>
          <TabsTrigger data-testid="company-equipment-fields-tab" value="equipment-fields">Ekipman Özel Alanları</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          {profileConflict && (
            <Alert data-testid="company-profile-conflict" variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Profil güncel değil</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Başka bir oturum bu profili güncelledi. Kaydetmeden önce güncel bilgileri yükleyin.</span>
                <Button type="button" variant="secondary" size="sm" onClick={reloadProfile}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Güncel bilgileri yükle
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Card className="overflow-hidden rounded-lg">
            <CardHeader>
              <CardTitle>Genel Bilgiler</CardTitle>
              <CardDescription>Raporlarda ve firma profilinde kullanılacak kurumsal bilgiler.</CardDescription>
            </CardHeader>
            <CardContent>
              {profileQuery.isLoading || (isSuperAdmin && companiesLoading && effectiveCompanyId !== null) ? (
                <div data-testid="company-settings-loading" className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : company ? (
                <form data-testid="company-profile-form" className="space-y-6" onSubmit={handleProfileSubmit}>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Field
                      id="company-legal-name"
                      label="Ticari unvan"
                      help={!company.legalName ? <span data-testid="company-legal-name-fallback">Boş bırakılırsa sistem firma adı kullanılır: {company.name}</span> : null}
                    >
                      <Input id="company-legal-name" data-testid="company-legal-name-input" value={profileForm.legalName} maxLength={profileFieldLimits.legalName} disabled={profileDisabled} placeholder={company.name} onChange={(event) => patchProfileField("legalName", event.target.value)} />
                    </Field>
                    <Field id="company-short-name" label="Kısa ad">
                      <Input id="company-short-name" data-testid="company-short-name-input" value={profileForm.shortName} maxLength={profileFieldLimits.shortName} disabled={profileDisabled} onChange={(event) => patchProfileField("shortName", event.target.value)} />
                    </Field>
                    <Field id="company-phone" label="Telefon">
                      <Input id="company-phone" data-testid="company-phone-input" value={profileForm.phone} maxLength={profileFieldLimits.phone} disabled={profileDisabled} onChange={(event) => patchProfileField("phone", event.target.value)} />
                    </Field>
                    <Field id="company-email" label="E-posta">
                      <Input id="company-email" data-testid="company-email-input" type="email" value={profileForm.email} maxLength={profileFieldLimits.email} disabled={profileDisabled} onChange={(event) => patchProfileField("email", event.target.value)} />
                    </Field>
                    <Field id="company-website" label="Web sitesi">
                      <Input id="company-website" data-testid="company-website-input" value={profileForm.website} maxLength={profileFieldLimits.website} disabled={profileDisabled} placeholder="https://" onChange={(event) => patchProfileField("website", event.target.value)} />
                    </Field>
                    <Field id="company-industry" label="Sektör">
                      <Input id="company-industry" data-testid="company-industry-input" value={profileForm.industry} maxLength={profileFieldLimits.industry} disabled={profileDisabled} onChange={(event) => patchProfileField("industry", event.target.value)} />
                    </Field>
                    <Field id="company-tax-office" label="Vergi dairesi">
                      <Input id="company-tax-office" data-testid="company-tax-office-input" value={profileForm.taxOffice} maxLength={profileFieldLimits.taxOffice} disabled={profileDisabled} onChange={(event) => patchProfileField("taxOffice", event.target.value)} />
                    </Field>
                    <Field id="company-tax-number" label="Vergi numarası">
                      <Input id="company-tax-number" data-testid="company-tax-number-input" value={profileForm.taxNumber} maxLength={profileFieldLimits.taxNumber} disabled={profileDisabled} onChange={(event) => patchProfileField("taxNumber", event.target.value)} />
                    </Field>
                  </div>

                  <Field id="company-address" label="Adres">
                    <Textarea id="company-address" data-testid="company-address-input" value={profileForm.address} maxLength={profileFieldLimits.address} disabled={profileDisabled} rows={3} onChange={(event) => patchProfileField("address", event.target.value)} />
                  </Field>

                  <Field id="company-report-introduction" label="Rapor giriş metni">
                    <Textarea id="company-report-introduction" data-testid="company-report-introduction-input" value={profileForm.reportIntroduction} maxLength={profileFieldLimits.reportIntroduction} disabled={profileDisabled} rows={5} onChange={(event) => patchProfileField("reportIntroduction", event.target.value)} />
                  </Field>

                  <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      <span data-testid="company-display-name">Görünen firma: {displayName}</span>
                      {profileDirty && <span className="ml-2 text-amber-400">Kaydedilmemiş değişiklik var.</span>}
                    </div>
                    {canEditProfile && (
                      <Button data-testid="company-save-button" type="submit" disabled={!profileDirty || profileSaving || profileConflict}>
                        <Save className="mr-2 h-4 w-4" />
                        {profileSaving ? "Kaydediliyor" : "Kaydet"}
                      </Button>
                    )}
                  </div>
                </form>
              ) : (
                <div data-testid="company-settings-empty" className="py-8 text-sm text-muted-foreground">
                  Görüntülenecek firma profili yok.
                </div>
              )}
            </CardContent>
          </Card>

          {company && (
            <Card data-testid="company-profile-card" className="overflow-hidden rounded-lg">
              <CardHeader>
                <CardTitle>Platform Bilgileri</CardTitle>
                <CardDescription>Sistem tarafından yönetilen teknik firma alanları.</CardDescription>
              </CardHeader>
              <CardContent>
                <ReadOnlyRow label="Firma adı" value={<span className="break-words">{company.name}</span>} />
                <ReadOnlyRow label="Subdomain" value={<code className="break-all rounded bg-muted px-2 py-1 text-xs">{company.subdomain}</code>} />
                <ReadOnlyRow label="Firma durumu" value={company.isActive ? <Badge variant="outline" className="border-green-600/40 bg-green-600/10 text-green-400">Aktif</Badge> : <Badge variant="outline" className="border-red-600/40 bg-red-600/10 text-red-400">Pasif</Badge>} />
                <ReadOnlyRow label="Oluşturulma tarihi" value={formatDate(company.createdAt)} />
                <ReadOnlyRow label="Son güncelleme" value={formatDate(company.updatedAt)} />
                <ReadOnlyRow label="Profil sürümü" value={<span data-testid="company-profile-version">{company.profileVersion}</span>} />
                <ReadOnlyRow label="Düzenleme yetkisi" value={canEditProfile ? "Düzenlenebilir" : "Salt okunur"} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="localization" className="space-y-6">
          {settingsConflict && (
            <Alert data-testid="company-settings-conflict" variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Firma tercihleri güncel değil</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Firma tercihleri başka bir kullanıcı tarafından güncellendi. Güncel ayarları yeniden yükleyin.</span>
                <Button data-testid="company-settings-reload-button" type="button" variant="secondary" size="sm" onClick={reloadSettings}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Güncel ayarları yükle
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {settingsQuery.data && !canEditSettings && (
            <Alert className="border-teal-600/30 bg-teal-600/10">
              <Info className="h-4 w-4" />
              <AlertTitle>Salt okunur tercihler</AlertTitle>
              <AlertDescription>Yerelleştirme ve gösterim tercihlerini yalnız firma yöneticileri düzenleyebilir.</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="overflow-hidden rounded-lg">
              <CardHeader>
                <CardTitle>Yerelleştirme ve Gösterim</CardTitle>
                <CardDescription>Tarih, sayı, para ve enerji değerlerinin firma düzeyindeki varsayılan gösterimi.</CardDescription>
              </CardHeader>
              <CardContent>
                {settingsQuery.isLoading || (isSuperAdmin && companiesLoading && effectiveCompanyId !== null) ? (
                  <div data-testid="company-settings-preferences-loading" className="space-y-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : settingsQuery.data ? (
                  <form data-testid="company-settings-form" className="space-y-6" onSubmit={handleSettingsSubmit}>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <SelectField id="settings-default-locale" label="Varsayılan dil/bölge" value={settingsForm.defaultLocale} options={COMPANY_LOCALES} disabled={settingsDisabled} testId="settings-default-locale-select" onChange={(value) => patchSettingsField("defaultLocale", value)} help="Rapor ve ekranlarda tarih, sayı ve para gösterimi için kullanılacak varsayılan bölgesel biçim. Bu tercih şu anda uygulama arayüzünün dilini değiştirmez." />
                      <SelectField id="settings-default-currency" label="Varsayılan para birimi" value={settingsForm.defaultCurrency} options={COMPANY_CURRENCIES} disabled={settingsDisabled} testId="settings-default-currency-select" onChange={(value) => patchSettingsField("defaultCurrency", value)} help="Yalnız gösterim ve gelecekteki mali rapor varsayılanıdır; mevcut parasal değerleri dönüştürmez." />
                      <Field id="settings-fiscal-year-start-month" label="Mali yıl başlangıç ayı" help="Rapor ve dönem seçimlerinde kullanılacak mali yıl başlangıç ayı. Mevcut raporlara aşamalı olarak uygulanacaktır." error={settingsErrors.fiscalYearStartMonth}>
        <Select value={String(settingsForm.fiscalYearStartMonth)} disabled={settingsDisabled} onValueChange={(value) => {
          if (value) patchSettingsField("fiscalYearStartMonth", Number(value));
        }}>
                          <SelectTrigger id="settings-fiscal-year-start-month" data-testid="settings-fiscal-year-start-month-select">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {monthNames.map((month, index) => (
                              <SelectItem key={month} value={String(index + 1)}>{month}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <SelectField id="settings-date-format" label="Tarih biçimi" value={settingsForm.dateFormat} options={COMPANY_DATE_FORMATS} disabled={settingsDisabled} testId="settings-date-format-select" onChange={(value) => patchSettingsField("dateFormat", value)} />
                      <SelectField id="settings-decimal-separator" label="Ondalık ayırıcı" value={settingsForm.decimalSeparator} options={COMPANY_DECIMAL_SEPARATORS} disabled={settingsDisabled} testId="settings-decimal-separator-select" onChange={(value) => patchSettingsField("decimalSeparator", value)} help="Ekran gösterimi ve gelecekteki içe aktarma şablonlarında varsayılan biçim olarak kullanılacaktır." />
                      <SelectField id="settings-energy-display-unit" label="Enerji gösterim birimi" value={settingsForm.energyDisplayUnit} options={COMPANY_ENERGY_DISPLAY_UNITS} disabled={settingsDisabled} testId="settings-energy-display-unit-select" onChange={(value) => patchSettingsField("energyDisplayUnit", value)} help="Yalnızca görüntüleme biçimini etkiler; kayıtlı tüketim verilerini ve hesaplama yöntemini değiştirmez." />
                      <SelectField id="settings-tep-display-mode" label="TEP gösterim tercihi" value={settingsForm.tepDisplayMode} options={COMPANY_TEP_DISPLAY_MODES} disabled={settingsDisabled} testId="settings-tep-display-mode-select" onChange={(value) => patchSettingsField("tepDisplayMode", value)} help="Sadece TEP değerlerinin sunumunu etkiler; dönüşüm katsayılarını değiştirmez." />
                      <SelectField id="settings-co2-display-mode" label="CO2 gösterim tercihi" value={settingsForm.co2DisplayMode} options={COMPANY_CO2_DISPLAY_MODES} disabled={settingsDisabled} testId="settings-co2-display-mode-select" onChange={(value) => patchSettingsField("co2DisplayMode", value)} help="CO2 teknik değeri korunur; tercih yalnızca sunum birimini belirler." />
                    </div>

                    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        <span data-testid="company-settings-version">Tercih sürümü: {settingsQuery.data.settings.settingsVersion}</span>
                        {settingsQuery.data.isDefault && <span className="ml-2 text-teal-300">Varsayılan değerler gösteriliyor.</span>}
                        {settingsDirty && <span className="ml-2 text-amber-400">Kaydedilmemiş tercih var.</span>}
                      </div>
                      {canEditSettings && (
                        <Button data-testid="company-settings-save-button" type="submit" disabled={!settingsDirty || settingsSaving || settingsConflict}>
                          <Save className="mr-2 h-4 w-4" />
                          {settingsSaving ? "Kaydediliyor" : "Kaydet"}
                        </Button>
                      )}
                    </div>
                  </form>
                ) : (
                  <div data-testid="company-settings-preferences-empty" className="py-8 text-sm text-muted-foreground">
                    Görüntülenecek firma tercihi yok.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="company-settings-preview" className="overflow-hidden rounded-lg">
              <CardHeader>
                <CardTitle>Gösterim Ön İzlemesi</CardTitle>
                <CardDescription>Seçili değerlerle örnek sunum.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <ReadOnlyRow label="Tarih" value={<span data-testid="settings-preview-date">{formatPreviewDate(settingsForm)}</span>} />
                  <ReadOnlyRow label="Sayı" value={<span data-testid="settings-preview-number">{formatPreviewNumber(1234.56, settingsForm)}</span>} />
                  <ReadOnlyRow label="Para" value={<span data-testid="settings-preview-currency">{formatPreviewCurrency(1234.56, settingsForm)}</span>} />
                  <ReadOnlyRow label="Enerji" value={<span data-testid="settings-preview-energy">{formatPreviewEnergy(settingsForm)}</span>} />
                  <ReadOnlyRow label="TEP" value={<span data-testid="settings-preview-tep">{formatPreviewTep(settingsForm)}</span>} />
                  <ReadOnlyRow label="CO2" value={<span data-testid="settings-preview-co2">{formatPreviewCo2(settingsForm)}</span>} />
                  <ReadOnlyRow label="Mali yıl başlangıcı" value={<span data-testid="settings-preview-fiscal-month">{monthNames[settingsForm.fiscalYearStartMonth - 1] ?? "-"}</span>} />
                  {settingsQuery.data?.settings.createdAt && <ReadOnlyRow label="Oluşturulma" value={formatDate(settingsQuery.data.settings.createdAt, "short")} />}
                  {settingsQuery.data?.settings.updatedAt && <ReadOnlyRow label="Güncellenme" value={formatDate(settingsQuery.data.settings.updatedAt, "short")} />}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="brand" className="space-y-6">
          {brandConflict && (
            <Alert data-testid="company-brand-conflict" variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Kurumsal kimlik güncel değil</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Kurumsal kimlik ayarları başka bir oturum tarafından güncellendi. Güncel bilgileri yeniden yükleyin.</span>
                <Button data-testid="company-brand-reload-button" type="button" variant="secondary" size="sm" onClick={reloadBrand}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Güncel bilgileri yükle
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {brandQuery.data && !canEditBrand && (
            <Alert className="border-teal-600/30 bg-teal-600/10">
              <Info className="h-4 w-4" />
              <AlertTitle>Salt okunur kurumsal kimlik</AlertTitle>
              <AlertDescription>Logo ve kurumsal kimlik ayarlarını yalnız firma yöneticileri düzenleyebilir.</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card className="overflow-hidden rounded-lg">
              <CardHeader>
                <CardTitle>Kurumsal Kimlik</CardTitle>
                <CardDescription>Firma logosu ve rapor başlığında kullanılacak sınırlı kurumsal görünüm tercihleri.</CardDescription>
              </CardHeader>
              <CardContent>
                {brandQuery.isLoading || (isSuperAdmin && companiesLoading && effectiveCompanyId !== null) ? (
                  <div data-testid="company-brand-loading" className="space-y-4">
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : brandQuery.data ? (
                  <div data-testid="company-brand-form" className="space-y-6">
                    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
                      <div className="space-y-3">
                        <div className="flex aspect-[2/1] items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/30 p-4" data-testid="company-logo-preview">
                          {activeLogoUrl ? (
                            <img src={activeLogoUrl} alt={brandForm.logoAltText || "Firma logosu"} className="max-h-full max-w-full object-contain" />
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                              <ImageIcon className="h-8 w-8" />
                              Logo yok
                            </div>
                          )}
                        </div>
                        {pendingLogo && (
                          <div data-testid="company-logo-pending" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                            Seçili dosya: {pendingLogo.file.name} ({pendingLogo.width} x {pendingLogo.height}, {formatBytes(pendingLogo.file.size)}). Sunucuya göndermek için Yükle düğmesine basın.
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground">
                          PNG veya JPEG, en fazla {formatBytes(COMPANY_LOGO_MAX_BYTES)}. Önerilen oran 2:1, normalize çıktı en fazla 1200 x 600 px olur.
                        </div>
                      </div>

                      <div className="space-y-4">
                        {canManageLogo && (
                          <div className="flex flex-wrap gap-2">
                            <Input id="company-logo-file" data-testid="company-logo-file-input" type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleLogoInputChange} disabled={logoUploading || logoDeleting} />
                            <Button type="button" variant="secondary" onClick={() => document.getElementById("company-logo-file")?.click()} disabled={logoUploading || logoDeleting}>
                              <ImageIcon className="mr-2 h-4 w-4" />
                              {brandQuery.data.brand.hasLogo ? "Değiştir" : "Logo seç"}
                            </Button>
                            <Button data-testid="company-logo-upload-button" type="button" onClick={() => pendingLogo && logoUploadMutation.mutate(pendingLogo.file)} disabled={!pendingLogo || logoUploading || logoDeleting}>
                              <Upload className="mr-2 h-4 w-4" />
                              {logoUploading ? "Yükleniyor" : "Yükle"}
                            </Button>
                            <Button type="button" variant="ghost" onClick={clearPendingLogo} disabled={!pendingLogo || logoUploading || logoDeleting}>
                              Seçimi temizle
                            </Button>
                            {brandQuery.data.brand.hasLogo && (
                              <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                                <AlertDialogTrigger asChild>
                                  <Button data-testid="company-logo-delete-button" type="button" variant="destructive" disabled={logoUploading || logoDeleting}>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Sil
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Logo silinsin mi?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Aktif logo rapor ön izlemelerinde artık görünmez. Eski asset fiziksel olarak hemen silinmez.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                                    <AlertDialogAction data-testid="company-logo-delete-confirm" onClick={() => logoDeleteMutation.mutate()} disabled={logoDeleting}>
                                      Sil
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        )}

                        <form className="space-y-4" onSubmit={handleBrandSubmit}>
                          <div className="flex items-center justify-between rounded-lg border border-border p-3">
                            <div>
                              <Label htmlFor="brand-show-logo">Raporlarda logo göster</Label>
                              <div className="text-xs text-muted-foreground">Bu tercih yalnız rapor sunum varsayımıdır.</div>
                            </div>
                            <Switch id="brand-show-logo" data-testid="brand-show-logo-switch" checked={brandForm.showLogoInReports} disabled={brandDisabled} onCheckedChange={(checked) => patchBrandField("showLogoInReports", checked)} />
                          </div>
                          <Field id="brand-logo-alt-text" label="Logo alternatif metni">
                            <Input id="brand-logo-alt-text" data-testid="brand-logo-alt-text-input" value={brandForm.logoAltText} maxLength={250} disabled={brandDisabled} onChange={(event) => patchBrandField("logoAltText", event.target.value)} />
                          </Field>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <SelectField id="brand-logo-position" label="Logo konumu" value={brandForm.logoPosition} options={COMPANY_LOGO_POSITIONS} disabled={brandDisabled} testId="brand-logo-position-select" onChange={(value) => patchBrandField("logoPosition", value)} />
                            <SelectField id="brand-logo-size" label="Logo boyutu" value={brandForm.logoSize} options={COMPANY_LOGO_SIZES} disabled={brandDisabled} testId="brand-logo-size-select" onChange={(value) => patchBrandField("logoSize", value)} />
                          </div>
                          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-sm text-muted-foreground">
                              <span data-testid="company-brand-version">Kurumsal kimlik sürümü: {brandQuery.data.brand.brandSettingsVersion}</span>
                              {brandQuery.data.isDefault && <span className="ml-2 text-teal-300">Varsayılan değerler gösteriliyor.</span>}
                              {brandDirty && <span className="ml-2 text-amber-400">Kaydedilmemiş kurumsal kimlik tercihi var.</span>}
                            </div>
                            {canEditBrand && (
                              <Button data-testid="company-brand-save-button" type="submit" disabled={!brandDirty || brandSaving || brandConflict}>
                                <Save className="mr-2 h-4 w-4" />
                                {brandSaving ? "Kaydediliyor" : "Kaydet"}
                              </Button>
                            )}
                          </div>
                        </form>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div data-testid="company-brand-empty" className="py-8 text-sm text-muted-foreground">
                    Görüntülenecek kurumsal kimlik ayarı yok.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="company-brand-preview" className="overflow-hidden rounded-lg">
              <CardHeader>
                <CardTitle>Rapor Başlığı Ön İzlemesi</CardTitle>
                <CardDescription>Seçili logo ve sunum tercihlerinin basit gösterimi.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className={`flex items-center gap-4 ${brandForm.logoPosition === "center" ? "justify-center text-center" : brandForm.logoPosition === "right" ? "flex-row-reverse justify-between text-right" : "justify-between"}`}>
                    {brandForm.showLogoInReports && activeLogoUrl ? (
                      <img
                        src={activeLogoUrl}
                        alt={brandForm.logoAltText || "Firma logosu"}
                        className={`object-contain ${brandForm.logoSize === "small" ? "h-10 max-w-28" : brandForm.logoSize === "large" ? "h-20 max-w-48" : "h-14 max-w-36"}`}
                      />
                    ) : (
                      <div className="flex h-14 w-28 items-center justify-center rounded border border-dashed border-border text-xs text-muted-foreground">Logo yok</div>
                    )}
                    <div className="min-w-0">
                      <div className="text-base font-semibold" data-testid="brand-preview-company">{displayName}</div>
                      <div className="text-xs text-muted-foreground">ISO 50001 Enerji Yönetim Raporu</div>
                    </div>
                  </div>
                  <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                    Logo konumu: {brandForm.logoPosition} · Boyut: {brandForm.logoSize}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="reports" className="space-y-6">
          {reportProfileConflict && (
            <Alert data-testid="company-report-profile-conflict" variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Rapor profili güncel değil</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Rapor profili başka bir oturum tarafından güncellendi. Kaydetmeden önce güncel bilgileri yükleyin.</span>
                <Button type="button" variant="secondary" size="sm" onClick={reloadReportProfile}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Güncel bilgileri yükle
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {reportProfileQuery.data && !canEditReports && (
            <Alert className="border-teal-600/30 bg-teal-600/10">
              <Info className="h-4 w-4" />
              <AlertTitle>Salt okunur rapor ayarları</AlertTitle>
              <AlertDescription>Rapor profili ve bölüm ayarlarını yalnız firma yöneticileri düzenleyebilir.</AlertDescription>
            </Alert>
          )}

          {reportRetentionConflict && (
            <Alert data-testid="company-report-retention-conflict" variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Saklama politikası güncel değil</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Saklama politikası başka bir oturum tarafından güncellendi. Kaydetmeden önce güncel bilgileri yükleyin.</span>
                <Button type="button" variant="secondary" size="sm" onClick={reloadReportRetention}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Güncel bilgileri yükle
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <Card className="overflow-hidden rounded-lg">
            <CardHeader>
              <CardTitle>Rapor Saklama Politikası</CardTitle>
              <CardDescription>Bu politika otomatik scheduler çalıştırmaz; yalnız manuel veya operasyonel temizleme planlarında uygulanır.</CardDescription>
            </CardHeader>
            <CardContent>
              {reportRetentionQuery.isLoading ? (
                <div data-testid="company-report-retention-loading" className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : reportRetentionQuery.data ? (
                <form data-testid="company-report-retention-form" className="space-y-5" onSubmit={handleReportRetentionSubmit}>
                  <div className="flex items-center justify-between rounded-lg border border-border p-3">
                    <div>
                      <Label htmlFor="report-retention-enabled">Retention enabled</Label>
                      <div className="text-xs text-muted-foreground">Kapalıyken tamamlanan veya hatalı arşivler retention nedeniyle purge adayı sayılmaz.</div>
                    </div>
                    <Switch id="report-retention-enabled" data-testid="report-retention-enabled-switch" checked={reportRetentionForm.retentionEnabled} disabled={reportRetentionDisabled} onCheckedChange={(checked) => patchReportRetentionField("retentionEnabled", checked)} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field id="report-completed-retention-days" label="Tamamlanan raporlar" help="365-36500 gün">
                      <Input id="report-completed-retention-days" data-testid="report-completed-retention-days-input" type="number" min={365} max={36500} value={reportRetentionForm.completedRetentionDays} disabled={reportRetentionDisabled} onChange={(event) => patchReportRetentionField("completedRetentionDays", Number(event.target.value))} />
                    </Field>
                    <Field id="report-failed-retention-days" label="Hatalı raporlar" help="30-3650 gün">
                      <Input id="report-failed-retention-days" data-testid="report-failed-retention-days-input" type="number" min={30} max={3650} value={reportRetentionForm.failedRetentionDays} disabled={reportRetentionDisabled} onChange={(event) => patchReportRetentionField("failedRetentionDays", Number(event.target.value))} />
                    </Field>
                    <Field id="report-deleted-grace-days" label="Soft-delete grace" help="7-365 gün">
                      <Input id="report-deleted-grace-days" data-testid="report-deleted-grace-days-input" type="number" min={7} max={365} value={reportRetentionForm.deletedGraceDays} disabled={reportRetentionDisabled} onChange={(event) => patchReportRetentionField("deletedGraceDays", Number(event.target.value))} />
                    </Field>
                  </div>
                  <Alert className="border-amber-500/30 bg-amber-500/10">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Kalıcı silme kontrollü işlemdir</AlertTitle>
                    <AlertDescription>Soft-delete storage nesnesini hemen silmez. Kalıcı purge için explicit ACK ve operasyonel cleanup gerekir.</AlertDescription>
                  </Alert>
                  <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      <span data-testid="company-report-retention-version">Saklama politikası sürümü: {reportRetentionQuery.data.settings.settingsVersion}</span>
                      {reportRetentionQuery.data.isDefault && <span className="ml-2 text-teal-300">Varsayılan ve kapalı.</span>}
                      {reportRetentionDirty && <span className="ml-2 text-amber-400">Kaydedilmemiş politika var.</span>}
                    </div>
                    {canEditReports && (
                      <Button data-testid="company-report-retention-save-button" type="submit" disabled={!reportRetentionDirty || reportRetentionSaving || reportRetentionConflict}>
                        <Save className="mr-2 h-4 w-4" />
                        {reportRetentionSaving ? "Kaydediliyor" : "Kaydet"}
                      </Button>
                    )}
                  </div>
                </form>
              ) : (
                <div className="py-8 text-sm text-muted-foreground">Görüntülenecek saklama politikası yok.</div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card className="overflow-hidden rounded-lg">
              <CardHeader>
                <CardTitle>Genel Rapor Ayarları</CardTitle>
                <CardDescription>Tüm rapor türleri için ortak belge varsayılanları.</CardDescription>
              </CardHeader>
              <CardContent>
                {reportProfileQuery.isLoading ? (
                  <div data-testid="company-report-profile-loading" className="space-y-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : reportProfileQuery.data ? (
                  <form data-testid="company-report-profile-form" className="space-y-6" onSubmit={handleReportProfileSubmit}>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="flex items-center justify-between rounded-lg border border-border p-3 lg:col-span-2">
                        <div>
                          <Label htmlFor="report-show-logo">Logo göster</Label>
                          <div className="text-xs text-muted-foreground">Aktif logo yoksa renderer firma adını kullanabilir.</div>
                        </div>
                        <Switch id="report-show-logo" data-testid="report-show-logo-switch" checked={reportProfileForm.showLogo} disabled={reportProfileDisabled} onCheckedChange={(checked) => patchReportProfileField("showLogo", checked)} />
                      </div>
                      <SelectField id="report-default-locale" label="Varsayılan rapor dili" value={reportProfileForm.defaultLocale} options={REPORT_LOCALES} disabled={reportProfileDisabled} testId="report-default-locale-select" onChange={(value) => patchReportProfileField("defaultLocale", value)} />
                      <SelectField id="report-cover-style" label="Kapak biçimi" value={reportProfileForm.coverStyle} options={REPORT_COVER_STYLES} disabled={reportProfileDisabled} testId="report-cover-style-select" onChange={(value) => patchReportProfileField("coverStyle", value)} />
                      <Field id="report-default-title" label="Varsayılan başlık">
                        <Input id="report-default-title" data-testid="report-default-title-input" value={reportProfileForm.defaultTitle ?? ""} maxLength={REPORT_PROFILE_FIELD_LIMITS.defaultTitle} disabled={reportProfileDisabled} onChange={(event) => patchReportProfileField("defaultTitle", event.target.value)} />
                      </Field>
                      <Field id="report-default-subtitle" label="Alt başlık">
                        <Input id="report-default-subtitle" data-testid="report-default-subtitle-input" value={reportProfileForm.defaultSubtitle ?? ""} maxLength={REPORT_PROFILE_FIELD_LIMITS.defaultSubtitle} disabled={reportProfileDisabled} onChange={(event) => patchReportProfileField("defaultSubtitle", event.target.value)} />
                      </Field>
                      <Field id="report-document-number" label="Doküman numarası">
                        <Input id="report-document-number" value={reportProfileForm.documentNumber ?? ""} maxLength={REPORT_PROFILE_FIELD_LIMITS.documentNumber} disabled={reportProfileDisabled} onChange={(event) => patchReportProfileField("documentNumber", event.target.value)} />
                      </Field>
                      <Field id="report-revision-number" label="Revizyon numarası">
                        <Input id="report-revision-number" value={reportProfileForm.revisionNumber ?? ""} maxLength={REPORT_PROFILE_FIELD_LIMITS.revisionNumber} disabled={reportProfileDisabled} onChange={(event) => patchReportProfileField("revisionNumber", event.target.value)} />
                      </Field>
                      <Field id="report-revision-date" label="Revizyon tarihi">
                        <Input id="report-revision-date" type="date" value={reportProfileForm.revisionDate ?? ""} disabled={reportProfileDisabled} onChange={(event) => patchReportProfileField("revisionDate", event.target.value)} />
                      </Field>
                      <SelectField id="report-confidentiality-level" label="Gizlilik derecesi" value={reportProfileForm.confidentialityLevel} options={REPORT_CONFIDENTIALITY_LEVELS} disabled={reportProfileDisabled} testId="report-confidentiality-select" onChange={(value) => patchReportProfileField("confidentialityLevel", value)} />
                      <Field id="report-prepared-by" label="Hazırlayan">
                        <Input id="report-prepared-by" value={reportProfileForm.preparedBy ?? ""} maxLength={REPORT_PROFILE_FIELD_LIMITS.preparedBy} disabled={reportProfileDisabled} onChange={(event) => patchReportProfileField("preparedBy", event.target.value)} />
                      </Field>
                      <Field id="report-checked-by" label="Kontrol eden">
                        <Input id="report-checked-by" value={reportProfileForm.checkedBy ?? ""} maxLength={REPORT_PROFILE_FIELD_LIMITS.checkedBy} disabled={reportProfileDisabled} onChange={(event) => patchReportProfileField("checkedBy", event.target.value)} />
                      </Field>
                      <Field id="report-approved-by" label="Onaylayan">
                        <Input id="report-approved-by" value={reportProfileForm.approvedBy ?? ""} maxLength={REPORT_PROFILE_FIELD_LIMITS.approvedBy} disabled={reportProfileDisabled} onChange={(event) => patchReportProfileField("approvedBy", event.target.value)} />
                      </Field>
                      <Field id="report-file-name-pattern" label="Dosya adı kuralı" help="{company}, {reportType}, {year}, {unit}, {date}, {revision}">
                        <Input id="report-file-name-pattern" data-testid="report-file-name-pattern-input" value={reportProfileForm.fileNamePattern} maxLength={REPORT_PROFILE_FIELD_LIMITS.fileNamePattern} disabled={reportProfileDisabled} onChange={(event) => patchReportProfileField("fileNamePattern", event.target.value)} />
                      </Field>
                      <div className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div>
                          <Label htmlFor="report-signatures">İmza alanları</Label>
                          <div className="text-xs text-muted-foreground">Hazırlayan/kontrol/onay alanlarını göster.</div>
                        </div>
                        <Switch id="report-signatures" checked={reportProfileForm.showSignatureFields} disabled={reportProfileDisabled} onCheckedChange={(checked) => patchReportProfileField("showSignatureFields", checked)} />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div>
                          <Label htmlFor="report-page-numbers">Sayfa numarası</Label>
                          <div className="text-xs text-muted-foreground">PDF entegrasyonunda sayfa numarası göster.</div>
                        </div>
                        <Switch id="report-page-numbers" checked={reportProfileForm.showPageNumbers} disabled={reportProfileDisabled} onCheckedChange={(checked) => patchReportProfileField("showPageNumbers", checked)} />
                      </div>
                      <Field id="report-footer-text" label="Alt bilgi">
                        <Textarea id="report-footer-text" value={reportProfileForm.footerText ?? ""} maxLength={REPORT_PROFILE_FIELD_LIMITS.footerText} disabled={reportProfileDisabled} rows={3} onChange={(event) => patchReportProfileField("footerText", event.target.value)} />
                      </Field>
                    </div>
                    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        <span data-testid="company-report-profile-version">Rapor profili sürümü: {reportProfileQuery.data.profile.profileVersion}</span>
                        {reportProfileQuery.data.isDefault && <span className="ml-2 text-teal-300">Varsayılan değerler gösteriliyor.</span>}
                        {reportProfileDirty && <span className="ml-2 text-amber-400">Kaydedilmemiş rapor profili var.</span>}
                      </div>
                      {canEditReports && (
                        <Button data-testid="company-report-profile-save-button" type="submit" disabled={!reportProfileDirty || reportProfileSaving || reportProfileConflict}>
                          <Save className="mr-2 h-4 w-4" />
                          {reportProfileSaving ? "Kaydediliyor" : "Kaydet"}
                        </Button>
                      )}
                    </div>
                  </form>
                ) : (
                  <div className="py-8 text-sm text-muted-foreground">Görüntülenecek rapor profili yok.</div>
                )}
              </CardContent>
            </Card>

            <Card data-testid="company-report-preview" className="overflow-hidden rounded-lg">
              <CardHeader>
                <CardTitle>Rapor Ön İzleme</CardTitle>
                <CardDescription>Bu ön izleme yerleşim ve içerik tercihlerini temsil eder. Nihai PDF görünümü rapor türüne göre farklılık gösterebilir.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-border bg-background p-4 text-sm">
                  <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{reportProfileForm.defaultTitle || selectedReportTypeQuery.data?.settings.title || "ISO 50001 Raporu"}</div>
                      <div className="text-xs text-muted-foreground">{reportProfileForm.defaultSubtitle || displayName}</div>
                    </div>
                    {reportProfileForm.showLogo && activeLogoUrl ? <img src={activeLogoUrl} alt="" className="h-10 max-w-24 object-contain" /> : <div className="text-xs text-muted-foreground">{displayName}</div>}
                  </div>
                  <div className="mt-3 grid gap-2 text-xs">
                    <div>Doküman: {reportProfileForm.documentNumber || "-"}</div>
                    <div>Revizyon: {reportProfileForm.revisionNumber || "-"} {reportProfileForm.revisionDate || ""}</div>
                    <div>Gizlilik: {reportProfileForm.confidentialityLevel}</div>
                    <div>Dosya: {reportProfileForm.fileNamePattern}</div>
                  </div>
                  <div className="mt-4 space-y-1 border-t border-border pt-3">
                    {(selectedReportForm?.sections ?? []).filter((section) => section.isVisible).slice(0, 6).map((section, index) => (
                      <div key={section.code} className="text-xs">{index + 1}. {section.labelOverride || section.defaultLabel}</div>
                    ))}
                  </div>
                  <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                    {reportProfileForm.footerText || "Alt bilgi yok"} {reportProfileForm.showPageNumbers ? "· Sayfa 1" : ""}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <Card className="overflow-hidden rounded-lg">
              <CardHeader>
                <CardTitle>Rapor Türleri</CardTitle>
                <CardDescription>Registry tarafından tanımlanan gerçek rapor türleri.</CardDescription>
              </CardHeader>
              <CardContent>
                {reportTypesQuery.isLoading ? (
                  <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div>
                ) : (
                  <div data-testid="company-report-types-list" className="space-y-2">
                    {(reportTypesQuery.data?.reportTypes ?? []).map((reportType) => (
                      <button
                        key={reportType.code}
                        type="button"
                        className={`w-full rounded-lg border p-3 text-left transition ${selectedReportType === reportType.code ? "border-teal-500 bg-teal-500/10" : "border-border hover:bg-muted/40"}`}
                        onClick={() => setSelectedReportType(reportType.code)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{reportType.displayName}</div>
                          <Badge variant="outline">{reportType.isCustomized ? "Özelleştirilmiş" : "Varsayılan"}</Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <FileText className="h-3.5 w-3.5" />
                          {reportType.outputType === "pdf" ? "PDF" : "HTML arşiv"}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-lg">
              <CardHeader>
                <CardTitle>Rapor Türü Ayarları</CardTitle>
                <CardDescription>Başlık override ve bölüm görünürlüğü/sırası.</CardDescription>
              </CardHeader>
              <CardContent>
                {!selectedReportType ? (
                  <div data-testid="company-report-type-empty" className="py-10 text-sm text-muted-foreground">Düzenlemek için bir rapor türü seçin.</div>
                ) : selectedReportTypeQuery.isLoading || !selectedReportForm ? (
                  <div data-testid="company-report-type-loading" className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                ) : (
                  <div data-testid="company-report-type-form" className="space-y-5">
                    {selectedReportConflict && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Rapor türü ayarları güncel değil</AlertTitle>
                        <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <span>Bu rapor türü başka bir oturum tarafından güncellendi.</span>
                          <Button type="button" variant="secondary" size="sm" onClick={() => reloadReportType(selectedReportType)}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Yeniden yükle
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="grid gap-4 lg:grid-cols-2">
                      <Field id="report-type-title-override" label="Başlık override">
                        <Input id="report-type-title-override" data-testid="report-type-title-override-input" value={selectedReportForm.titleOverride} disabled={!canEditReports || reportTypeMutation.isPending} onChange={(event) => patchReportTypeForm(selectedReportType, (current) => ({ ...current, titleOverride: event.target.value }))} />
                      </Field>
                      <Field id="report-type-subtitle-override" label="Alt başlık override">
                        <Input id="report-type-subtitle-override" value={selectedReportForm.subtitleOverride} disabled={!canEditReports || reportTypeMutation.isPending} onChange={(event) => patchReportTypeForm(selectedReportType, (current) => ({ ...current, subtitleOverride: event.target.value }))} />
                      </Field>
                      <SelectField id="report-type-locale-override" label="Dil override" value={selectedReportForm.localeOverride} options={["inherit", ...REPORT_LOCALES] as const} disabled={!canEditReports || reportTypeMutation.isPending} testId="report-type-locale-override-select" onChange={(value) => patchReportTypeForm(selectedReportType, (current) => ({ ...current, localeOverride: value }))} />
                      <SelectField id="report-type-cover-override" label="Kapak override" value={selectedReportForm.coverStyleOverride} options={["inherit", "standard", "compact"] as const} disabled={!canEditReports || reportTypeMutation.isPending} testId="report-type-cover-override-select" onChange={(value) => patchReportTypeForm(selectedReportType, (current) => ({ ...current, coverStyleOverride: value }))} />
                    </div>

                    <div className="space-y-3">
                      <div className="text-sm font-medium">Bölümler</div>
                      {selectedReportForm.sections.map((section, index) => (
                        <div key={section.code} data-testid={`report-section-${section.code}`} className="grid gap-3 rounded-lg border border-border p-3 lg:grid-cols-[1fr_auto]">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{section.labelOverride || section.defaultLabel}</span>
                              <Badge variant="outline">{section.requirement}</Badge>
                              {section.requirement === "required" && <span className="text-xs text-muted-foreground">Bu bölüm sistem tarafından zorunludur.</span>}
                              {section.requirement === "conditional" && <span className="text-xs text-muted-foreground">İlgili veri bulunduğunda sistem tarafından zorunlu gösterilebilir.</span>}
                            </div>
                            {section.canRename && (
                              <Input
                                value={section.labelOverride ?? ""}
                                placeholder={section.defaultLabel}
                                disabled={!canEditReports || reportTypeMutation.isPending}
                                onChange={(event) => updateSection(selectedReportType, section.code, { labelOverride: event.target.value })}
                              />
                            )}
                          </div>
                          <div className="flex items-center gap-2 justify-self-start lg:justify-self-end">
                            {canEditReports && (
                              <>
                                <Switch
                                  data-testid={`report-section-visible-${section.code}`}
                                  checked={section.isVisible}
                                  disabled={!section.canHide || section.requirement === "required" || reportTypeMutation.isPending}
                                  onCheckedChange={(checked) => updateSection(selectedReportType, section.code, { isVisible: checked })}
                                />
                                <Button type="button" variant="ghost" size="icon" disabled={!section.canReorder || index === 0 || !selectedReportForm.sections[index - 1]?.canReorder || reportTypeMutation.isPending} onClick={() => moveSection(selectedReportType, section.code, -1)}>
                                  <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" disabled={!section.canReorder || index === selectedReportForm.sections.length - 1 || !selectedReportForm.sections[index + 1]?.canReorder || reportTypeMutation.isPending} onClick={() => moveSection(selectedReportType, section.code, 1)}>
                                  <ArrowDown className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        <span data-testid="company-report-type-version">Tür ayarı sürümü: {selectedReportTypeQuery.data?.settings.typeSettingsVersion ?? 0}</span>
                        {selectedReportDirty && <span className="ml-2 text-amber-400">Kaydedilmemiş tür ayarı var.</span>}
                      </div>
                      {canEditReports && (
                        <Button data-testid="company-report-type-save-button" type="button" disabled={!selectedReportDirty || reportTypeMutation.isPending || selectedReportConflict} onClick={() => handleReportTypeSubmit(selectedReportType)}>
                          <Save className="mr-2 h-4 w-4" />
                          {reportTypeMutation.isPending ? "Kaydediliyor" : "Kaydet"}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="technical-profile-fields" className="space-y-6">
          <TechnicalProfileFieldsSettings companyId={effectiveCompanyId} />
        </TabsContent>
        <TabsContent value="equipment-fields" className="space-y-6">
          <EquipmentFieldsSettings companyId={effectiveCompanyId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
