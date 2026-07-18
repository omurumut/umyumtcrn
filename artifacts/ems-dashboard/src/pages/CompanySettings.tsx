import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
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
  DEFAULT_COMPANY_SETTINGS,
  type CompanySettingsValues,
} from "@workspace/api-zod";
import { AlertCircle, Building2, Info, RefreshCw, Save } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
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
  return res.json();
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
  const [profileForm, setProfileForm] = useState<CompanyProfileForm>(emptyProfileForm);
  const [profileDirty, setProfileDirty] = useState(false);
  const [loadedProfileKey, setLoadedProfileKey] = useState<string | null>(null);
  const [profileConflict, setProfileConflict] = useState(false);
  const [settingsForm, setSettingsForm] = useState<CompanySettingsValues>(DEFAULT_COMPANY_SETTINGS);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [loadedSettingsKey, setLoadedSettingsKey] = useState<string | null>(null);
  const [settingsConflict, setSettingsConflict] = useState(false);
  const [settingsErrors, setSettingsErrors] = useState<Partial<Record<keyof CompanySettingsValues, string>>>({});

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
    if (!profileDirty && !settingsDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [profileDirty, settingsDirty]);

  const company = profileQuery.data?.company;
  const canEditProfile = profileQuery.data?.permissions.canEditGeneral === true;
  const canEditSettings = settingsQuery.data?.permissions.canEdit === true;
  const profileSaving = profileMutation.isPending;
  const settingsSaving = settingsMutation.isPending;
  const profileDisabled = !canEditProfile || profileSaving;
  const settingsDisabled = !canEditSettings || settingsSaving;
  const displayName = company?.legalName?.trim() || company?.name || "-";

  function patchProfileField(field: keyof CompanyProfileForm, value: string) {
    setProfileForm((current) => ({ ...current, [field]: value }));
    setProfileDirty(true);
  }

  function patchSettingsField<K extends keyof CompanySettingsValues>(field: K, value: CompanySettingsValues[K]) {
    setSettingsForm((current) => ({ ...current, [field]: value }));
    setSettingsDirty(true);
    setSettingsErrors((current) => ({ ...current, [field]: undefined }));
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

  async function reloadProfile() {
    setProfileConflict(false);
    await profileQuery.refetch();
  }

  async function reloadSettings() {
    setSettingsConflict(false);
    await settingsQuery.refetch();
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

      {(profileQuery.data || settingsQuery.data) && !canEditProfile && !canEditSettings && (
        <Alert className="border-teal-600/30 bg-teal-600/10">
          <Info className="h-4 w-4" />
          <AlertTitle>Salt okunur bilgi</AlertTitle>
          <AlertDescription>Bu alanları yalnız firma yöneticileri düzenleyebilir.</AlertDescription>
        </Alert>
      )}

      {(profileQuery.isError || settingsQuery.isError) && (
        <Alert data-testid="company-settings-error" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ayarlar yüklenemedi</AlertTitle>
          <AlertDescription>{profileQuery.error?.message ?? settingsQuery.error?.message}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger data-testid="company-general-tab" value="general">Genel Bilgiler</TabsTrigger>
          <TabsTrigger data-testid="company-localization-tab" value="localization">Yerelleştirme ve Gösterim</TabsTrigger>
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
      </Tabs>
    </div>
  );
}
