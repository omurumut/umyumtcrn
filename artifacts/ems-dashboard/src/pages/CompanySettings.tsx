import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useListCompanies, getListCompaniesQueryKey } from "@workspace/api-client-react";
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
import { Skeleton } from "@/components/ui/skeleton";
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
  permissions: {
    canEditGeneral: boolean;
  };
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

const emptyForm: CompanyProfileForm = {
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

const fieldLimits: Record<keyof CompanyProfileForm, number> = {
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

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
}

function formFromCompany(company: CompanyProfile): CompanyProfileForm {
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

function validateForm(form: CompanyProfileForm): string | null {
  for (const [field, limit] of Object.entries(fieldLimits) as Array<[keyof CompanyProfileForm, number]>) {
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

function Field({
  id,
  label,
  children,
  help,
}: {
  id: string;
  label: string;
  children: ReactNode;
  help?: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help && <div className="text-xs text-muted-foreground">{help}</div>}
    </div>
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
  const queryKey = ["company-profile", user?.role, effectiveCompanyId];
  const [form, setForm] = useState<CompanyProfileForm>(emptyForm);
  const [dirty, setDirty] = useState(false);
  const [loadedCompanyKey, setLoadedCompanyKey] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

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

  const profileQuery = useQuery<CompanyProfileResponse, ApiError>({
    queryKey,
    queryFn: () => apiFetch<CompanyProfileResponse>(profileUrl!, token),
    enabled: !!token && profileUrl !== null && selectedCompanyExists,
  });

  const updateMutation = useMutation<CompanyProfileResponse, ApiError, CompanyProfileForm>({
    mutationFn: (nextForm) => apiFetch<CompanyProfileResponse>(profileUrl!, token, {
      method: "PATCH",
      body: JSON.stringify({
        expectedProfileVersion: profileQuery.data?.company.profileVersion,
        ...nextForm,
      }),
    }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      setForm(formFromCompany(data.company));
      setDirty(false);
      setConflict(false);
      setLoadedCompanyKey(`${data.company.id}:${data.company.profileVersion}`);
      toast({ title: "Firma bilgileri güncellendi" });
    },
    onError: (error) => {
      if (error.status === 409) setConflict(true);
      toast({ title: "Güncelleme başarısız", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!profileQuery.data) return;
    const key = `${profileQuery.data.company.id}:${profileQuery.data.company.profileVersion}`;
    if (key === loadedCompanyKey) return;
    if (dirty && loadedCompanyKey !== null && profileQuery.data.company.id !== Number(loadedCompanyKey.split(":")[0])) {
      toast({ title: "Kaydedilmemiş değişiklikler sıfırlandı", description: "Seçili firma değiştiği için form güncel profil ile yenilendi." });
    }
    setForm(formFromCompany(profileQuery.data.company));
    setDirty(false);
    setConflict(false);
    setLoadedCompanyKey(key);
  }, [dirty, loadedCompanyKey, profileQuery.data, toast]);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const company = profileQuery.data?.company;
  const canEdit = profileQuery.data?.permissions.canEditGeneral === true;
  const saving = updateMutation.isPending;
  const disabled = !canEdit || saving;
  const displayName = company?.legalName?.trim() || company?.name || "-";

  function patchField(field: keyof CompanyProfileForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateForm(form);
    if (validationError) {
      toast({ title: "Firma bilgileri kaydedilemedi", description: validationError, variant: "destructive" });
      return;
    }
    updateMutation.mutate(form);
  }

  async function reloadProfile() {
    setConflict(false);
    await profileQuery.refetch();
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
            Kurumsal profil bilgilerini ISO 50001 raporları ve firma bağlamı için yönetin.
          </p>
        </div>
      </div>

      {!canEdit && profileQuery.data && (
        <Alert className="border-teal-600/30 bg-teal-600/10">
          <Info className="h-4 w-4" />
          <AlertTitle>Salt okunur bilgi</AlertTitle>
          <AlertDescription>Bu alanları yalnız firma yöneticileri düzenleyebilir.</AlertDescription>
        </Alert>
      )}

      {isSuperAdmin && effectiveCompanyId === null && (
        <Alert data-testid="company-settings-select-company" className="border-amber-500/30 bg-amber-500/10">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Firma seçiniz</AlertTitle>
          <AlertDescription>Firma profilini görüntülemek için üst çubuktaki firma seçiciden bir firma seçin.</AlertDescription>
        </Alert>
      )}

      {isSuperAdmin && effectiveCompanyId !== null && !companiesLoading && !selectedCompanyExists && (
        <Alert data-testid="company-settings-company-missing" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Şirket bulunamadı</AlertTitle>
          <AlertDescription>Seçili firma listede bulunamadı. Lütfen geçerli bir firma seçin.</AlertDescription>
        </Alert>
      )}

      {profileQuery.isError && (
        <Alert
          data-testid={
            profileQuery.error.status === 403
              ? "company-settings-forbidden"
              : profileQuery.error.status === 404
                ? "company-settings-not-found"
                : "company-settings-error"
          }
          variant="destructive"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{profileQuery.error.status === 403 ? "Yetki yok" : profileQuery.error.status === 404 ? "Firma bulunamadı" : "Profil yüklenemedi"}</AlertTitle>
          <AlertDescription>{profileQuery.error.message}</AlertDescription>
        </Alert>
      )}

      {conflict && (
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
            <form data-testid="company-profile-form" className="space-y-6" onSubmit={handleSubmit}>
              <div className="grid gap-4 lg:grid-cols-2">
                <Field
                  id="company-legal-name"
                  label="Ticari unvan"
                  help={!company.legalName ? <span data-testid="company-legal-name-fallback">Boş bırakılırsa sistem firma adı kullanılır: {company.name}</span> : null}
                >
                  <Input
                    id="company-legal-name"
                    data-testid="company-legal-name-input"
                    value={form.legalName}
                    maxLength={fieldLimits.legalName}
                    disabled={disabled}
                    placeholder={company.name}
                    onChange={(event) => patchField("legalName", event.target.value)}
                  />
                </Field>
                <Field id="company-short-name" label="Kısa ad">
                  <Input
                    id="company-short-name"
                    data-testid="company-short-name-input"
                    value={form.shortName}
                    maxLength={fieldLimits.shortName}
                    disabled={disabled}
                    onChange={(event) => patchField("shortName", event.target.value)}
                  />
                </Field>
                <Field id="company-phone" label="Telefon">
                  <Input
                    id="company-phone"
                    data-testid="company-phone-input"
                    value={form.phone}
                    maxLength={fieldLimits.phone}
                    disabled={disabled}
                    onChange={(event) => patchField("phone", event.target.value)}
                  />
                </Field>
                <Field id="company-email" label="E-posta">
                  <Input
                    id="company-email"
                    data-testid="company-email-input"
                    type="email"
                    value={form.email}
                    maxLength={fieldLimits.email}
                    disabled={disabled}
                    onChange={(event) => patchField("email", event.target.value)}
                  />
                </Field>
                <Field id="company-website" label="Web sitesi">
                  <Input
                    id="company-website"
                    data-testid="company-website-input"
                    value={form.website}
                    maxLength={fieldLimits.website}
                    disabled={disabled}
                    placeholder="https://"
                    onChange={(event) => patchField("website", event.target.value)}
                  />
                </Field>
                <Field id="company-industry" label="Sektör">
                  <Input
                    id="company-industry"
                    data-testid="company-industry-input"
                    value={form.industry}
                    maxLength={fieldLimits.industry}
                    disabled={disabled}
                    onChange={(event) => patchField("industry", event.target.value)}
                  />
                </Field>
                <Field id="company-tax-office" label="Vergi dairesi">
                  <Input
                    id="company-tax-office"
                    data-testid="company-tax-office-input"
                    value={form.taxOffice}
                    maxLength={fieldLimits.taxOffice}
                    disabled={disabled}
                    onChange={(event) => patchField("taxOffice", event.target.value)}
                  />
                </Field>
                <Field id="company-tax-number" label="Vergi numarası">
                  <Input
                    id="company-tax-number"
                    data-testid="company-tax-number-input"
                    value={form.taxNumber}
                    maxLength={fieldLimits.taxNumber}
                    disabled={disabled}
                    onChange={(event) => patchField("taxNumber", event.target.value)}
                  />
                </Field>
              </div>

              <Field id="company-address" label="Adres">
                <Textarea
                  id="company-address"
                  data-testid="company-address-input"
                  value={form.address}
                  maxLength={fieldLimits.address}
                  disabled={disabled}
                  rows={3}
                  onChange={(event) => patchField("address", event.target.value)}
                />
              </Field>

              <Field id="company-report-introduction" label="Rapor giriş metni">
                <Textarea
                  id="company-report-introduction"
                  data-testid="company-report-introduction-input"
                  value={form.reportIntroduction}
                  maxLength={fieldLimits.reportIntroduction}
                  disabled={disabled}
                  rows={5}
                  onChange={(event) => patchField("reportIntroduction", event.target.value)}
                />
              </Field>

              <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  <span data-testid="company-display-name">Görünen firma: {displayName}</span>
                  {dirty && <span className="ml-2 text-amber-400">Kaydedilmemiş değişiklik var.</span>}
                </div>
                {canEdit && (
                  <Button data-testid="company-save-button" type="submit" disabled={!dirty || saving || conflict}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Kaydediliyor" : "Kaydet"}
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
            <ReadOnlyRow
              label="Firma durumu"
              value={
                company.isActive ? (
                  <Badge variant="outline" className="border-green-600/40 bg-green-600/10 text-green-400">Aktif</Badge>
                ) : (
                  <Badge variant="outline" className="border-red-600/40 bg-red-600/10 text-red-400">Pasif</Badge>
                )
              }
            />
            <ReadOnlyRow label="Oluşturulma tarihi" value={formatDate(company.createdAt)} />
            <ReadOnlyRow label="Son güncelleme" value={formatDate(company.updatedAt)} />
            <ReadOnlyRow label="Profil sürümü" value={<span data-testid="company-profile-version">{company.profileVersion}</span>} />
            <ReadOnlyRow label="Düzenleme yetkisi" value={canEdit ? "Düzenlenebilir" : "Salt okunur"} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
