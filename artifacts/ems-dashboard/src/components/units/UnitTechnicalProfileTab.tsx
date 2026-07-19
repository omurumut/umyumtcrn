import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS,
  UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES,
  UNIT_TECHNICAL_PROFILE_TEXT_LIMITS,
  type UnitTechnicalProfileDto,
  type UnitTechnicalProfileGetResponse,
  type UnitTechnicalProfilePatchRequest,
  type UnitTechnicalProfilePatchResponse,
  type UnitTechnicalProfileStatus,
  type UnitTechnicalProfileTechnicalStatus,
} from "@workspace/api-zod";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, RotateCcw, Save } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type TextField = keyof typeof UNIT_TECHNICAL_PROFILE_TEXT_LIMITS;
type NumericField = keyof typeof UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS;
type TechnicalField =
  | "seasonalOperationStatus"
  | "insulationStatus"
  | "buildingAutomationStatus"
  | "compressedAirStatus"
  | "steamSystemStatus"
  | "generatorStatus"
  | "renewableEnergyStatus";

type FormState = Record<TextField, string> &
  Record<NumericField, string> &
  Record<TechnicalField, UnitTechnicalProfileTechnicalStatus | ""> & {
    profileStatus: UnitTechnicalProfileStatus;
  };

type FieldErrors = Partial<Record<keyof FormState, string>>;

class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    const message = typeof body === "object" && body !== null && "error" in body
      ? String((body as { error?: unknown }).error)
      : "Sunucu hatasi";
    super(message);
    this.status = status;
    this.body = body;
  }
}

const NONE_VALUE = "__none__";

const technicalStatusLabels: Record<UnitTechnicalProfileTechnicalStatus, string> = {
  yes: "Var",
  no: "Yok",
  unknown: "Bilinmiyor",
  not_applicable: "Uygulanamaz",
};

const textFields = Object.keys(UNIT_TECHNICAL_PROFILE_TEXT_LIMITS) as TextField[];
const numericFields = Object.keys(UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS) as NumericField[];
const technicalFields: TechnicalField[] = [
  "seasonalOperationStatus",
  "insulationStatus",
  "buildingAutomationStatus",
  "compressedAirStatus",
  "steamSystemStatus",
  "generatorStatus",
  "renewableEnergyStatus",
];

const integerFields = new Set<NumericField>([
  "buildingCount",
  "personnelCount",
  "averageDailyUsers",
  "annualOperatingDays",
  "shiftCount",
]);

const emptyForm: FormState = {
  facilityUseType: "",
  mainActivity: "",
  mainProcessDescription: "",
  shiftType: "",
  heatingSystemType: "",
  coolingSystemType: "",
  domesticHotWaterSystem: "",
  energyInfrastructureDescription: "",
  knownEnergyIssues: "",
  technicalImprovements: "",
  plannedInfrastructureChanges: "",
  buildingCount: "",
  totalEnclosedAreaM2: "",
  heatedAreaM2: "",
  cooledAreaM2: "",
  openAreaM2: "",
  personnelCount: "",
  averageDailyUsers: "",
  dailyOperatingHours: "",
  weeklyOperatingDays: "",
  annualOperatingDays: "",
  shiftCount: "",
  seasonalOperationStatus: "",
  insulationStatus: "",
  buildingAutomationStatus: "",
  compressedAirStatus: "",
  steamSystemStatus: "",
  generatorStatus: "",
  renewableEnergyStatus: "",
  profileStatus: "draft",
};

const fieldLabels: Record<keyof FormState, string> = {
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
  personnelCount: "Personel sayisi",
  averageDailyUsers: "Ortalama gunluk kullanici",
  dailyOperatingHours: "Gunluk calisma suresi",
  weeklyOperatingDays: "Haftalik calisma gunu",
  annualOperatingDays: "Yillik calisma gunu",
  shiftCount: "Vardiya sayisi",
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

const numberUnits: Partial<Record<NumericField, string>> = {
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

function buildUrl(unitId: number, companyId: number | null, isSuperAdmin: boolean) {
  const params = new URLSearchParams();
  if (isSuperAdmin && companyId !== null) params.set("companyId", companyId.toString());
  const qs = params.toString();
  return `/api/unit-technical-profiles/${unitId}${qs ? `?${qs}` : ""}`;
}

async function apiFetch<T>(token: string | null, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

function profileToForm(profile: UnitTechnicalProfileDto): FormState {
  const form = { ...emptyForm, profileStatus: profile.profileStatus };
  for (const field of textFields) form[field] = profile[field] ?? "";
  for (const field of numericFields) form[field] = profile[field] === null ? "" : String(profile[field]);
  for (const field of technicalFields) form[field] = profile[field] ?? "";
  return form;
}

function normalizeText(value: string) {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function parseNumberValue(value: string): number | null {
  if (value.trim() === "") return null;
  return Number(value);
}

function formToComparable(form: FormState, includeStatus: boolean) {
  const values: Record<string, unknown> = {};
  for (const field of textFields) values[field] = normalizeText(form[field]);
  for (const field of numericFields) values[field] = parseNumberValue(form[field]);
  for (const field of technicalFields) values[field] = form[field] === "" ? null : form[field];
  if (includeStatus) values.profileStatus = form.profileStatus;
  return values;
}

function validateForm(form: FormState, canPublish: boolean): FieldErrors {
  const errors: FieldErrors = {};

  for (const field of textFields) {
    if (form[field].trim().length > UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field]) {
      errors[field] = `En fazla ${UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field]} karakter`;
    }
  }

  for (const field of numericFields) {
    const raw = form[field].trim();
    if (raw === "") continue;
    const value = Number(raw);
    const limits = UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS[field];
    if (!Number.isFinite(value)) {
      errors[field] = "Gecerli bir sayi girin";
      continue;
    }
    if (integerFields.has(field) && !Number.isInteger(value)) {
      errors[field] = "Tam sayi girin";
      continue;
    }
    if (value < limits.min || value > limits.max) {
      errors[field] = `${limits.min}-${limits.max} araliginda olmali`;
    }
  }

  for (const field of technicalFields) {
    if (form[field] !== "" && !UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES.includes(form[field])) {
      errors[field] = "Gecersiz secim";
    }
  }

  if (!canPublish && form.profileStatus === "published") {
    errors.profileStatus = "Yayinlama yetkiniz yok";
  }

  return errors;
}

function buildPatchPayload(form: FormState, expectedProfileVersion: number, includeStatus: boolean): UnitTechnicalProfilePatchRequest {
  const payload: Record<string, unknown> = { expectedProfileVersion };
  for (const field of textFields) payload[field] = normalizeText(form[field]);
  for (const field of numericFields) payload[field] = parseNumberValue(form[field]);
  for (const field of technicalFields) payload[field] = form[field] === "" ? null : form[field];
  if (includeStatus) payload.profileStatus = form.profileStatus;
  return payload as UnitTechnicalProfilePatchRequest;
}

function completionCount(form: FormState) {
  const values = formToComparable(form, true);
  const fields = [...textFields, ...numericFields, ...technicalFields] as Array<keyof typeof values>;
  return fields.filter((field) => values[field] !== null && values[field] !== "").length;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

function TextInputField({
  field,
  form,
  errors,
  disabled,
  onChange,
}: {
  field: TextField;
  form: FormState;
  errors: FieldErrors;
  disabled: boolean;
  onChange: (field: TextField, value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={field}>{fieldLabels[field]}</Label>
      <Input
        id={field}
        value={form[field]}
        maxLength={UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field]}
        disabled={disabled}
        onChange={(event) => onChange(field, event.target.value)}
      />
      <FieldError message={errors[field]} />
    </div>
  );
}

function NumericInputField({
  field,
  form,
  errors,
  disabled,
  onChange,
}: {
  field: NumericField;
  form: FormState;
  errors: FieldErrors;
  disabled: boolean;
  onChange: (field: NumericField, value: string) => void;
}) {
  const unit = numberUnits[field];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={field}>{fieldLabels[field]}{unit ? ` (${unit})` : ""}</Label>
      <Input
        id={field}
        type="number"
        min={UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS[field].min}
        max={UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS[field].max}
        step={integerFields.has(field) ? 1 : "any"}
        value={form[field]}
        disabled={disabled}
        onChange={(event) => onChange(field, event.target.value)}
      />
      <FieldError message={errors[field]} />
    </div>
  );
}

function TechnicalSelectField({
  field,
  form,
  errors,
  disabled,
  onChange,
}: {
  field: TechnicalField;
  form: FormState;
  errors: FieldErrors;
  disabled: boolean;
  onChange: (field: TechnicalField, value: UnitTechnicalProfileTechnicalStatus | "") => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{fieldLabels[field]}</Label>
      <Select
        value={form[field] || NONE_VALUE}
        disabled={disabled}
        onValueChange={(value) => onChange(field, value === NONE_VALUE ? "" : value as UnitTechnicalProfileTechnicalStatus)}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>Secilmedi</SelectItem>
          {UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>{technicalStatusLabels[status]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError message={errors[field]} />
    </div>
  );
}

function TextAreaField({
  field,
  form,
  errors,
  disabled,
  onChange,
}: {
  field: TextField;
  form: FormState;
  errors: FieldErrors;
  disabled: boolean;
  onChange: (field: TextField, value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={field}>{fieldLabels[field]}</Label>
      <Textarea
        id={field}
        rows={4}
        value={form[field]}
        maxLength={UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field]}
        disabled={disabled}
        onChange={(event) => onChange(field, event.target.value)}
      />
      <div className="flex items-center justify-between gap-3">
        <FieldError message={errors[field]} />
        <span className="ml-auto text-xs text-muted-foreground">{form[field].length}/{UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field]}</span>
      </div>
    </div>
  );
}

export default function UnitTechnicalProfileTab({ unitId }: { unitId?: number }) {
  const { token, user } = useAuth();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === "superadmin";
  const [activeUnitId, setActiveUnitId] = useState<number | undefined>(unitId);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loadedForm, setLoadedForm] = useState<FormState | null>(null);
  const [serverProfile, setServerProfile] = useState<UnitTechnicalProfileDto | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflictProfile, setConflictProfile] = useState<UnitTechnicalProfileDto | null>(null);

  const queryEnabled = !!token && !!activeUnitId && (!isSuperAdmin || companyId !== null);
  const queryKey = ["unit-technical-profile", activeUnitId, isSuperAdmin ? companyId : "own"];

  const profileQuery = useQuery<UnitTechnicalProfileGetResponse>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => apiFetch<UnitTechnicalProfileGetResponse>(
      token,
      buildUrl(activeUnitId!, companyId, !!isSuperAdmin),
    ),
  });

  const canEdit = profileQuery.data?.permissions.canEdit ?? false;
  const canPublish = profileQuery.data?.permissions.canPublish ?? false;
  const includeStatusInDirty = canPublish;
  const isDirty = loadedForm !== null
    && JSON.stringify(formToComparable(form, includeStatusInDirty)) !== JSON.stringify(formToComparable(loadedForm, includeStatusInDirty));
  const completed = completionCount(form);
  const totalCompletable = textFields.length + numericFields.length + technicalFields.length;
  const completionRatio = Math.round((completed / totalCompletable) * 100);

  useEffect(() => {
    if (unitId === activeUnitId) return;
    if (isDirty) {
      const ok = window.confirm("Kaydedilmemis teknik profil degisiklikleri var. Secili birimi degistirmek istiyor musunuz?");
      if (!ok) {
        toast({ title: "Birim degisimi bekletildi", description: "Mevcut duzenlemeler korunuyor." });
        return;
      }
    }
    setActiveUnitId(unitId);
    setConflictProfile(null);
    setErrors({});
  }, [unitId, activeUnitId, isDirty, toast]);

  useEffect(() => {
    const data = profileQuery.data;
    if (!data) return;
    const nextForm = profileToForm(data.profile);
    setForm(nextForm);
    setLoadedForm(nextForm);
    setServerProfile(data.profile);
    setConflictProfile(null);
    setErrors({});
  }, [profileQuery.data]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const saveMutation = useMutation({
    mutationFn: (payload: UnitTechnicalProfilePatchRequest) => apiFetch<UnitTechnicalProfilePatchResponse>(
      token,
      buildUrl(activeUnitId!, companyId, !!isSuperAdmin),
      { method: "PATCH", body: JSON.stringify(payload) },
    ),
    onSuccess: (data) => {
      const nextForm = profileToForm(data.profile);
      setForm(nextForm);
      setLoadedForm(nextForm);
      setServerProfile(data.profile);
      setConflictProfile(null);
      setErrors({});
      queryClient.setQueryData(queryKey, data);
      toast({ title: "Teknik profil kaydedildi" });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409 && typeof error.body === "object" && error.body !== null && "profile" in error.body) {
        setConflictProfile((error.body as { profile: UnitTechnicalProfileDto }).profile);
        toast({ title: "Versiyon cakismasi", description: "Sunucuda daha guncel veri var. Duzenlemeleriniz korunuyor.", variant: "destructive" });
        return;
      }
      toast({ title: "Kaydedilemedi", description: error instanceof Error ? error.message : "Sunucu hatasi", variant: "destructive" });
    },
  });

  const disabled = !canEdit || saveMutation.isPending;
  const superAdminNeedsCompany = isSuperAdmin && companyId === null;

  function setText(field: TextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function setNumeric(field: NumericField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function setTechnical(field: TechnicalField, value: UnitTechnicalProfileTechnicalStatus | "") {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function handleSave() {
    if (!serverProfile || !activeUnitId) return;
    const nextErrors = validateForm(form, canPublish);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast({ title: "Formu kontrol edin", description: "Bazi alanlar beklenen aralikta degil.", variant: "destructive" });
      return;
    }
    if (canPublish && serverProfile.profileStatus !== "published" && form.profileStatus === "published") {
      const ok = window.confirm("Teknik profili yayinlanmis duruma almak istiyor musunuz?");
      if (!ok) return;
    }
    saveMutation.mutate(buildPatchPayload(form, serverProfile.profileVersion, canPublish));
  }

  function handleReset() {
    if (!loadedForm) return;
    setForm(loadedForm);
    setConflictProfile(null);
    setErrors({});
  }

  function loadServerConflict() {
    if (!conflictProfile) return;
    const nextForm = profileToForm(conflictProfile);
    setForm(nextForm);
    setLoadedForm(nextForm);
    setServerProfile(conflictProfile);
    setConflictProfile(null);
    setErrors({});
  }

  function continueWithEdits() {
    if (!conflictProfile) return;
    setServerProfile(conflictProfile);
    setLoadedForm(profileToForm(conflictProfile));
    setConflictProfile(null);
  }

  const statusBadge = useMemo(() => {
    if (!serverProfile) return null;
    return serverProfile.profileStatus === "published"
      ? <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20" variant="outline">Published</Badge>
      : <Badge variant="outline">Draft</Badge>;
  }, [serverProfile]);

  if (!unitId && !activeUnitId) {
    return (
      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center text-muted-foreground">
          <AlertCircle className="h-10 w-10 mb-3 opacity-30" />
          <p className="font-medium">Teknik profil icin bir birim secin</p>
          <p className="text-sm mt-1">Ustteki sekme filtresi tek bir birime ayarlandiginda form yuklenir.</p>
        </CardContent>
      </Card>
    );
  }

  if (superAdminNeedsCompany) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Firma secimi gerekli</AlertTitle>
        <AlertDescription>Superadmin kullanicisi teknik profil okumak ve kaydetmek icin once firma baglamini secmelidir.</AlertDescription>
      </Alert>
    );
  }

  if (profileQuery.isLoading || !loadedForm || !serverProfile) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-56" />)}
        </div>
      </div>
    );
  }

  if (profileQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Teknik profil yuklenemedi</AlertTitle>
        <AlertDescription>{profileQuery.error instanceof Error ? profileQuery.error.message : "Sunucu hatasi"}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4" data-testid="unit-technical-profile-tab">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Birim Teknik Profili</h2>
            {statusBadge}
            {isDirty && <Badge className="border-amber-500/30 text-amber-400" variant="outline">Kaydedilmemis</Badge>}
            {!serverProfile.exists && <Badge variant="outline">Yeni taslak</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">Profil doluluk orani: {completed}/{totalCompletable} alan ({completionRatio}%)</p>
          <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-teal-500 transition-all" style={{ width: `${completionRatio}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleReset} disabled={!isDirty || saveMutation.isPending} className="gap-2">
            <RotateCcw className="h-4 w-4" /> Geri al
          </Button>
          <Button onClick={handleSave} disabled={!canEdit || !isDirty || saveMutation.isPending} className="gap-2" data-testid="unit-technical-profile-save">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Kaydet
          </Button>
        </div>
      </div>

      {!canEdit && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Salt okunur</AlertTitle>
          <AlertDescription>Bu birim teknik profilini duzenleme yetkiniz yok.</AlertDescription>
        </Alert>
      )}

      {conflictProfile && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <AlertCircle className="h-4 w-4 text-amber-400" />
          <AlertTitle>Sunucuda daha guncel surum var</AlertTitle>
          <AlertDescription>
            <div className="space-y-3">
              <p>Mevcut sunucu versiyonu {conflictProfile.profileVersion}. Duzenlemeleriniz kaybolmadi.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={loadServerConflict} className="gap-2">
                  <RefreshCw className="h-4 w-4" /> Guncel veriyi yukle
                </Button>
                <Button size="sm" onClick={continueWithEdits} className="gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Duzenlemeye devam et
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Genel tesis bilgileri</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInputField field="facilityUseType" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextInputField field="mainActivity" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <div className="space-y-1.5">
              <Label>Profil durumu</Label>
              {canPublish ? (
                <Select
                  value={form.profileStatus}
                  disabled={disabled}
                  onValueChange={(value) => setForm((current) => ({ ...current, profileStatus: value as UnitTechnicalProfileStatus }))}
                >
                  <SelectTrigger data-testid="unit-technical-profile-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input value="Draft" disabled />
              )}
              <FieldError message={errors.profileStatus} />
            </div>
            <div className="sm:col-span-2">
              <TextAreaField field="mainProcessDescription" form={form} errors={errors} disabled={disabled} onChange={setText} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Fiziksel yapi</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumericInputField field="buildingCount" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="totalEnclosedAreaM2" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="heatedAreaM2" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="cooledAreaM2" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="openAreaM2" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <TechnicalSelectField field="insulationStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Operasyon</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumericInputField field="personnelCount" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="averageDailyUsers" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="dailyOperatingHours" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="weeklyOperatingDays" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="annualOperatingDays" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="shiftCount" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <TextInputField field="shiftType" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TechnicalSelectField field="seasonalOperationStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Isitma, sogutma ve sicak su</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInputField field="heatingSystemType" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextInputField field="coolingSystemType" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextInputField field="domesticHotWaterSystem" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TechnicalSelectField field="buildingAutomationStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Diger enerji sistemleri</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TechnicalSelectField field="compressedAirStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
            <TechnicalSelectField field="steamSystemStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
            <TechnicalSelectField field="generatorStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
            <TechnicalSelectField field="renewableEnergyStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Teknik aciklamalar</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <TextAreaField field="energyInfrastructureDescription" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextAreaField field="knownEnergyIssues" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextAreaField field="technicalImprovements" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextAreaField field="plannedInfrastructureChanges" form={form} errors={errors} disabled={disabled} onChange={setText} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
