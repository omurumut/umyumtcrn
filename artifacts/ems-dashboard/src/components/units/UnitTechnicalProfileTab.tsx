import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  calculateUnitTechnicalProfileCompletion,
  calculateUnitTechnicalProfileCustomFieldCompletion,
  UNIT_TECHNICAL_PROFILE_FIELD_LABELS,
  UNIT_TECHNICAL_PROFILE_FIELD_UNITS,
  UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS,
  UNIT_TECHNICAL_PROFILE_OPERATION_FIELDS,
  UNIT_TECHNICAL_PROFILE_SECTIONS,
  UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES,
  UNIT_TECHNICAL_PROFILE_TEXT_LIMITS,
  missingRequiredUnitTechnicalProfileCustomFieldsForPublish,
  validateUnitTechnicalProfilePublishMinimum,
  type UnitTechnicalProfileCustomFieldDefinitionDto,
  type UnitTechnicalProfileDto,
  type UnitTechnicalProfileFieldCode,
  type UnitTechnicalProfileGetResponse,
  type UnitTechnicalProfileHistoryResponse,
  type UnitTechnicalProfilePatchRequest,
  type UnitTechnicalProfilePatchResponse,
  type UnitTechnicalProfilePublishResponse,
  type UnitTechnicalProfileSectionId,
  type UnitTechnicalProfileSnapshotDetailResponse,
  type UnitTechnicalProfileSnapshotSummary,
  type UnitTechnicalProfileStatus,
  type UnitTechnicalProfileTechnicalStatus,
  type UnitTechnicalProfileValues,
} from "@workspace/api-zod";
import { AlertCircle, CheckCircle2, Download, Eye, Loader2, RefreshCw, RotateCcw, Save, ScrollText, Upload } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { downloadBlobResponse } from "@/lib/download";

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
    customValues: Record<string, unknown>;
  };

type FieldErrors = Partial<Record<string, string>>;
type ImportIssue = {
  row: number;
  column?: string;
  fieldCode?: string;
  code: string;
  message: string;
  unitKey?: string;
  level: "error" | "warning";
};
type ImportPreview = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  createCount: number;
  updateCount: number;
  noChangeCount: number;
  warningCount: number;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  message: string;
};

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

const sectionStatusLabels = {
  completed: "Tamamlandi",
  partial: "Kismen tamamlandi",
  not_started: "Henuz baslanmadi",
} as const;

type SectionStatus = keyof typeof sectionStatusLabels;
type ProfileCompletionLike = {
  completedFields: number;
  totalFields: number;
  ratio: number;
  sections: ReturnType<typeof calculateUnitTechnicalProfileCompletion>["sections"];
  missingFields: string[];
};

const fieldHelp: Partial<Record<keyof FormState, string>> = {
  personnelCount: "Genel/ortalama personel sayisini girin; donemsel personel veya uretim verileri Degisken Yonetimi altinda izlenmelidir.",
  averageDailyUsers: "Tesisin tipik gunluk kullanici yogunlugunu temsil eder.",
  dailyOperatingHours: "Aylik degisimleri burada degil, Degisken Yonetimi uzerinden takip edin.",
  weeklyOperatingDays: "Standart haftalik calisma duzenini temsil eder.",
  annualOperatingDays: "Yillik genel calisma takvimi icindir; donemsel degisimler Degisken Yonetimi alanina aittir.",
  shiftCount: "Tipik vardiya sayisini girin; gecici vardiya degisimlerini donemsel veri olarak takip edin.",
  seasonalOperationStatus: "Sezonsal calisma varsa genel durumu belirtin.",
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
  customValues: {},
};

function buildUrl(unitId: number, companyId: number | null, isSuperAdmin: boolean) {
  const params = new URLSearchParams();
  if (isSuperAdmin && companyId !== null) params.set("companyId", companyId.toString());
  const qs = params.toString();
  return `/api/unit-technical-profiles/${unitId}${qs ? `?${qs}` : ""}`;
}

function buildChildUrl(unitId: number, childPath: string, companyId: number | null, isSuperAdmin: boolean) {
  const params = new URLSearchParams();
  if (isSuperAdmin && companyId !== null) params.set("companyId", companyId.toString());
  const qs = params.toString();
  return `/api/unit-technical-profiles/${unitId}/${childPath}${qs ? `?${qs}` : ""}`;
}

function buildImportExportUrl(path: string, unitId: number | undefined, companyId: number | null, isSuperAdmin: boolean) {
  const params = new URLSearchParams();
  if (unitId !== undefined) params.set("unitId", unitId.toString());
  if (isSuperAdmin && companyId !== null) params.set("companyId", companyId.toString());
  const qs = params.toString();
  return `/api/unit-technical-profiles/${path}${qs ? `?${qs}` : ""}`;
}

function localToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function profileToForm(profile: UnitTechnicalProfileDto, customValues: Record<string, unknown> = {}): FormState {
  const form = { ...emptyForm, profileStatus: profile.profileStatus, customValues: { ...customValues } };
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
  values.customValues = normalizeCustomValuesForCompare(form.customValues);
  if (includeStatus) values.profileStatus = form.profileStatus;
  return values;
}

function formToProfileValues(form: FormState): Partial<UnitTechnicalProfileValues> {
  return formToComparable(form, true) as Partial<UnitTechnicalProfileValues>;
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
  payload.customFieldValues = normalizeCustomValuesForCompare(form.customValues);
  if (includeStatus) payload.profileStatus = form.profileStatus;
  return payload as UnitTechnicalProfilePatchRequest;
}

function normalizeCustomValuesForCompare(values: Record<string, unknown>) {
  const normalized: Record<string, unknown> = {};
  for (const [code, value] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof value === "string") normalized[code] = value.trim() || null;
    else normalized[code] = value;
  }
  return normalized;
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
      <Label htmlFor={field}>{UNIT_TECHNICAL_PROFILE_FIELD_LABELS[field]}</Label>
      <Input
        id={field}
        data-testid={`utp-field-${field}`}
        value={form[field]}
        maxLength={UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field]}
        disabled={disabled}
        onChange={(event) => onChange(field, event.target.value)}
      />
      {fieldHelp[field] && <p className="text-xs text-muted-foreground">{fieldHelp[field]}</p>}
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
  const unit = UNIT_TECHNICAL_PROFILE_FIELD_UNITS[field];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={field}>{UNIT_TECHNICAL_PROFILE_FIELD_LABELS[field]}{unit ? ` (${unit})` : ""}</Label>
      <Input
        id={field}
        data-testid={`utp-field-${field}`}
        type="number"
        min={UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS[field].min}
        max={UNIT_TECHNICAL_PROFILE_NUMERIC_LIMITS[field].max}
        step={integerFields.has(field) ? 1 : "any"}
        value={form[field]}
        disabled={disabled}
        onChange={(event) => onChange(field, event.target.value)}
      />
      {fieldHelp[field] && <p className="text-xs text-muted-foreground">{fieldHelp[field]}</p>}
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
      <Label>{UNIT_TECHNICAL_PROFILE_FIELD_LABELS[field]}</Label>
      <Select
        value={form[field] || NONE_VALUE}
        disabled={disabled}
        onValueChange={(value) => onChange(field, value === NONE_VALUE ? "" : value as UnitTechnicalProfileTechnicalStatus)}
      >
        <SelectTrigger data-testid={`utp-field-${field}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VALUE}>Secilmedi</SelectItem>
          {UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>{technicalStatusLabels[status]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {fieldHelp[field] && <p className="text-xs text-muted-foreground">{fieldHelp[field]}</p>}
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
      <Label htmlFor={field}>{UNIT_TECHNICAL_PROFILE_FIELD_LABELS[field]}</Label>
      <Textarea
        id={field}
        data-testid={`utp-field-${field}`}
        rows={4}
        value={form[field]}
        maxLength={UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field]}
        disabled={disabled}
        onChange={(event) => onChange(field, event.target.value)}
      />
      {fieldHelp[field] && <p className="text-xs text-muted-foreground">{fieldHelp[field]}</p>}
      <div className="flex items-center justify-between gap-3">
        <FieldError message={errors[field]} />
        <span className="ml-auto text-xs text-muted-foreground">{form[field].length}/{UNIT_TECHNICAL_PROFILE_TEXT_LIMITS[field]}</span>
      </div>
    </div>
  );
}

function customValueToInput(value: unknown) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String);
  return String(value);
}

function CustomFieldInput({
  definition,
  value,
  disabled,
  readOnly,
  missing,
  onChange,
}: {
  definition: UnitTechnicalProfileCustomFieldDefinitionDto;
  value: unknown;
  disabled: boolean;
  readOnly?: boolean;
  missing: boolean;
  onChange: (code: string, value: unknown) => void;
}) {
  const fieldDisabled = disabled || readOnly;
  const label = `${definition.label}${definition.unitLabel ? ` (${definition.unitLabel})` : ""}`;
  const inputValue = customValueToInput(value);
  const error = missing ? "Publish icin zorunlu" : undefined;

  if (readOnly) {
    return (
      <div className="space-y-1.5 rounded-lg border border-dashed p-3">
        <Label>{label}</Label>
        <div className="text-sm text-muted-foreground">{displayCustomValue(definition, value) ?? "-"}</div>
        <Badge variant="outline">Pasif tanim</Badge>
      </div>
    );
  }

  if (definition.fieldType === "long_text") {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`custom-${definition.code}`}>{label}</Label>
        <Textarea
          id={`custom-${definition.code}`}
          data-testid={`utp-custom-field-${definition.code}`}
          rows={3}
          value={typeof inputValue === "string" ? inputValue : ""}
          disabled={fieldDisabled}
          onChange={(event) => onChange(definition.code, event.target.value)}
        />
        <FieldError message={error} />
      </div>
    );
  }

  if (definition.fieldType === "boolean") {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <Select
          value={typeof inputValue === "string" && inputValue ? inputValue : NONE_VALUE}
          disabled={fieldDisabled}
          onValueChange={(next) => onChange(definition.code, next === NONE_VALUE ? null : next)}
        >
          <SelectTrigger data-testid={`utp-custom-field-${definition.code}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>Secilmedi</SelectItem>
            {UNIT_TECHNICAL_PROFILE_TECHNICAL_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>{technicalStatusLabels[status]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError message={error} />
      </div>
    );
  }

  if (definition.fieldType === "single_select") {
    return (
      <div className="space-y-1.5">
        <Label>{label}</Label>
        <Select
          value={typeof inputValue === "string" && inputValue ? inputValue : NONE_VALUE}
          disabled={fieldDisabled}
          onValueChange={(next) => onChange(definition.code, next === NONE_VALUE ? null : next)}
        >
          <SelectTrigger data-testid={`utp-custom-field-${definition.code}`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>Secilmedi</SelectItem>
            {definition.options.filter((option) => option.isActive).map((option) => (
              <SelectItem key={option.code} value={option.code}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldError message={error} />
      </div>
    );
  }

  if (definition.fieldType === "multi_select") {
    const selected = Array.isArray(inputValue) ? inputValue : [];
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <div className="grid gap-2 rounded-lg border p-3">
          {definition.options.filter((option) => option.isActive).map((option) => (
            <label key={option.code} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(option.code)}
                disabled={fieldDisabled}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option.code]
                    : selected.filter((code) => code !== option.code);
                  onChange(definition.code, next);
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
        <FieldError message={error} />
      </div>
    );
  }

  const isNumber = definition.fieldType === "integer" || definition.fieldType === "decimal" || definition.fieldType === "unit_number";
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`custom-${definition.code}`}>{label}</Label>
      <Input
        id={`custom-${definition.code}`}
        data-testid={`utp-custom-field-${definition.code}`}
        type={definition.fieldType === "date" ? "date" : isNumber ? "number" : "text"}
        step={definition.fieldType === "integer" ? 1 : isNumber ? "any" : undefined}
        value={typeof inputValue === "string" ? inputValue : ""}
        disabled={fieldDisabled}
        onChange={(event) => onChange(definition.code, isNumber && event.target.value !== "" ? Number(event.target.value) : event.target.value)}
      />
      <FieldError message={error} />
    </div>
  );
}

type SectionCompletionLike = {
  status: string;
  completedFields: number;
  totalFields: number;
};

function SectionCard({
  id,
  completion,
  children,
}: {
  id: UnitTechnicalProfileSectionId | "custom";
  completion: SectionCompletionLike;
  children: ReactNode;
}) {
  const section = id === "custom"
    ? { title: "Firma ozel alanlar", description: "Firma tarafindan tanimlanan teknik profil alanlari." }
    : UNIT_TECHNICAL_PROFILE_SECTIONS.find((item) => item.id === id)!;
  const badgeClass = completion.status === "completed"
    ? "border-emerald-500/30 text-emerald-400"
    : completion.status === "partial"
      ? "border-amber-500/30 text-amber-400"
      : "border-muted-foreground/30 text-muted-foreground";

  return (
    <Card id={`utp-section-${id}`} data-testid={`unit-technical-profile-section-${id}`}>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">{section.title}</CardTitle>
          <Badge className={badgeClass} variant="outline">
            {sectionStatusLabels[completion.status as SectionStatus]} · {completion.completedFields}/{completion.totalFields}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{section.description}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function displayValue(value: unknown, unit?: string) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim().length === 0) return null;
  if (typeof value === "string" && value in technicalStatusLabels) {
    return technicalStatusLabels[value as UnitTechnicalProfileTechnicalStatus];
  }
  return `${value}${unit ? ` ${unit}` : ""}`;
}

function displayCustomValue(definition: UnitTechnicalProfileCustomFieldDefinitionDto, value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (definition.fieldType === "boolean" && typeof value === "string" && value in technicalStatusLabels) {
    return technicalStatusLabels[value as UnitTechnicalProfileTechnicalStatus];
  }
  if (definition.fieldType === "single_select" && typeof value === "string") {
    return definition.options.find((option) => option.code === value)?.label ?? value;
  }
  if (definition.fieldType === "multi_select" && Array.isArray(value)) {
    return value
      .map((code) => definition.options.find((option) => option.code === code)?.label ?? String(code))
      .join(", ");
  }
  return `${value}${definition.unitLabel ? ` ${definition.unitLabel}` : ""}`;
}

function SummaryItem({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{String(value)}</div>
    </div>
  );
}

function ProfileSummary({
  profile,
  form,
  completion,
  customFieldDefinitions,
  canEdit,
  onEdit,
}: {
  profile: UnitTechnicalProfileDto;
  form: FormState;
  completion: ProfileCompletionLike;
  customFieldDefinitions: UnitTechnicalProfileCustomFieldDefinitionDto[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  const values = formToProfileValues(form);
  const otherSystems = (["compressedAirStatus", "steamSystemStatus", "generatorStatus", "renewableEnergyStatus"] as const)
    .map((field) => [UNIT_TECHNICAL_PROFILE_FIELD_LABELS[field], displayValue(values[field])] as const)
    .filter(([, value]) => value !== null);
  const technicalSummary = displayValue(values.energyInfrastructureDescription)
    ?? displayValue(values.knownEnergyIssues)
    ?? displayValue(values.technicalImprovements)
    ?? displayValue(values.plannedInfrastructureChanges);

  return (
    <Card data-testid="unit-technical-profile-summary">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Teknik profil ozeti</CardTitle>
            <p className="text-sm text-muted-foreground">Girilen temel teknik baglam ve profil durumu.</p>
          </div>
          {canEdit && (
            <Button variant="outline" onClick={onEdit} className="gap-2">
              <ScrollText className="h-4 w-4" /> Forma gec
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryItem label="Profil durumu" value={profile.profileStatus === "published" ? "Published" : "Draft"} />
          <SummaryItem label="Son guncelleme" value={profile.updatedAt ? new Date(profile.updatedAt).toLocaleString("tr-TR") : "Henuz kaydedilmedi"} />
          <SummaryItem label="Profil version" value={profile.profileVersion} />
          <SummaryItem label="Profil doluluk orani" value={`${completion.completedFields}/${completion.totalFields} alan (${completion.ratio}%)`} />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SummaryItem label="Tesis kullanim tipi" value={displayValue(values.facilityUseType)} />
          <SummaryItem label="Ana faaliyet" value={displayValue(values.mainActivity)} />
          <SummaryItem label="Temel alan bilgileri" value={[
            displayValue(values.totalEnclosedAreaM2, UNIT_TECHNICAL_PROFILE_FIELD_UNITS.totalEnclosedAreaM2),
            displayValue(values.heatedAreaM2, UNIT_TECHNICAL_PROFILE_FIELD_UNITS.heatedAreaM2),
            displayValue(values.cooledAreaM2, UNIT_TECHNICAL_PROFILE_FIELD_UNITS.cooledAreaM2),
          ].filter(Boolean).join(" · ") || null} />
          <SummaryItem label="Genel calisma duzeni" value={[
            displayValue(values.dailyOperatingHours, UNIT_TECHNICAL_PROFILE_FIELD_UNITS.dailyOperatingHours),
            displayValue(values.weeklyOperatingDays, UNIT_TECHNICAL_PROFILE_FIELD_UNITS.weeklyOperatingDays),
            displayValue(values.shiftCount),
            displayValue(values.seasonalOperationStatus),
          ].filter(Boolean).join(" · ") || null} />
          <SummaryItem label="Isitma ve sogutma" value={[
            displayValue(values.heatingSystemType),
            displayValue(values.coolingSystemType),
            displayValue(values.domesticHotWaterSystem),
          ].filter(Boolean).join(" · ") || null} />
          <SummaryItem label="Diger enerji sistemleri" value={otherSystems.map(([label, value]) => `${label}: ${value}`).join(" · ") || null} />
        </div>
        <SummaryItem label="Kisa teknik aciklama" value={typeof technicalSummary === "string" && technicalSummary.length > 280 ? `${technicalSummary.slice(0, 277)}...` : technicalSummary} />
        {customFieldDefinitions.length > 0 && (
          <div className="space-y-3">
            <div className="text-sm font-semibold">Firma ozel alanlar</div>
            <div className="grid gap-3 md:grid-cols-2">
              {customFieldDefinitions.map((definition) => (
                <SummaryItem
                  key={definition.id}
                  label={definition.label}
                  value={displayCustomValue(definition, form.customValues[definition.code])}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SnapshotField({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="space-y-0.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="break-words text-sm">{String(value)}</div>
    </div>
  );
}

function HistoryPanel({
  history,
  isLoading,
  selectedSnapshot,
  selectedSnapshotId,
  canEdit,
  onRefresh,
  onSelectSnapshot,
}: {
  history?: UnitTechnicalProfileHistoryResponse;
  isLoading: boolean;
  selectedSnapshot: UnitTechnicalProfileSnapshotDetailResponse["snapshot"] | null;
  selectedSnapshotId: number | null;
  canEdit: boolean;
  onRefresh: () => void;
  onSelectSnapshot: (id: number) => void;
}) {
  const items = history?.items ?? [];
  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]" data-testid="unit-technical-profile-history">
      <Card className="overflow-hidden rounded-lg">
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Surum Gecmisi</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={onRefresh} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Yenile
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">Yayimlanmis immutable teknik profil snapshotlari.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Henuz yayimlanmis teknik profil snapshot'i yok.</div>
          ) : items.map((item: UnitTechnicalProfileSnapshotSummary) => (
            <button
              key={item.id}
              type="button"
              data-testid={`unit-technical-profile-history-row-${item.snapshotNumber}`}
              className={`w-full rounded-lg border p-3 text-left transition ${selectedSnapshotId === item.id ? "border-teal-500 bg-teal-500/10" : "border-border hover:bg-muted/40"}`}
              onClick={() => onSelectSnapshot(item.id)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">Snapshot #{item.snapshotNumber}</div>
                <div className="flex flex-wrap gap-1">
                  {item.isCurrent && <Badge variant="outline">Acik uclu</Badge>}
                  {item.isEffectiveToday && <Badge className="border-emerald-500/30 text-emerald-400" variant="outline">Bugun gecerli</Badge>}
                </div>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {item.validFrom} - {item.validTo ?? "devam ediyor"} · {item.completionPercentage}% · v{item.profileVersion}
              </div>
              {item.changeSummary && <div className="mt-2 text-sm">{item.changeSummary}</div>}
              <div className="mt-1 text-xs text-muted-foreground">
                {item.publishedByName ?? `Kullanici #${item.publishedBy ?? "-"}`} · {new Date(item.publishedAt).toLocaleString("tr-TR")}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-lg" data-testid="unit-technical-profile-snapshot-detail">
        <CardHeader>
          <CardTitle className="text-base">Snapshot Detayi</CardTitle>
          <p className="text-sm text-muted-foreground">Detaylar guncel firma alan tanimlarindan degil, snapshot metadata'sindan okunur.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {!selectedSnapshot ? (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Detay icin bir surum secin.</div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <SnapshotField label="Snapshot" value={`#${selectedSnapshot.snapshotNumber}`} />
                <SnapshotField label="Gecerlilik" value={`${selectedSnapshot.validFrom} - ${selectedSnapshot.validTo ?? "devam ediyor"}`} />
                <SnapshotField label="Yayin" value={new Date(selectedSnapshot.publishedAt).toLocaleString("tr-TR")} />
                <SnapshotField label="Yayinlayan" value={selectedSnapshot.publishedByName ?? selectedSnapshot.publishedBy} />
                <SnapshotField label="Profil version" value={selectedSnapshot.profileVersion} />
                <SnapshotField label="Doluluk" value={`${selectedSnapshot.completionPercentage}%`} />
              </div>
              <SnapshotField label="Degisiklik aciklamasi" value={selectedSnapshot.changeSummary} />

              <div className="space-y-3">
                <div className="text-sm font-semibold">Standart teknik alanlar</div>
                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(UNIT_TECHNICAL_PROFILE_FIELD_LABELS)
                    .filter(([code]) => code !== "profileStatus")
                    .map(([code, label]) => (
                      <SnapshotField
                        key={code}
                        label={label}
                        value={displayValue(selectedSnapshot.standardValues[code], UNIT_TECHNICAL_PROFILE_FIELD_UNITS[code as UnitTechnicalProfileFieldCode])}
                      />
                    ))}
                </div>
              </div>

              {selectedSnapshot.customFieldDefinitions.length > 0 && (
                <div className="space-y-3">
                  <div className="text-sm font-semibold">Firma ozel alanlar</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {selectedSnapshot.customFieldDefinitions.map((definition) => (
                      <SnapshotField
                        key={`${definition.id}-${definition.code}`}
                        label={`${definition.label}${definition.isActive ? "" : " (pasif)"}`}
                        value={displayCustomValue(definition, selectedSnapshot.customFieldValues[definition.code])}
                      />
                    ))}
                  </div>
                </div>
              )}

              {canEdit && (
                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Bu surumden yeni taslak olusturma V1 kapsaminda salt-okunur bir sonraki alt pakete birakildi.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
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
  const [conflictCustomValues, setConflictCustomValues] = useState<Record<string, unknown> | null>(null);
  const [publishMissingFields, setPublishMissingFields] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"summary" | "form">("form");
  const [activeTab, setActiveTab] = useState<"profile" | "history">("profile");
  const [publishPanelOpen, setPublishPanelOpen] = useState(false);
  const [publishValidFrom, setPublishValidFrom] = useState(localToday);
  const [publishChangeSummary, setPublishChangeSummary] = useState("");
  const [publishDateError, setPublishDateError] = useState<string | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);

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

  const historyQueryKey = ["unit-technical-profile-history", activeUnitId, isSuperAdmin ? companyId : "own"];
  const historyQuery = useQuery<UnitTechnicalProfileHistoryResponse>({
    queryKey: historyQueryKey,
    enabled: queryEnabled,
    queryFn: () => apiFetch<UnitTechnicalProfileHistoryResponse>(
      token,
      buildChildUrl(activeUnitId!, "history", companyId, !!isSuperAdmin),
    ),
  });

  const snapshotDetailQuery = useQuery<UnitTechnicalProfileSnapshotDetailResponse>({
    queryKey: ["unit-technical-profile-snapshot", activeUnitId, selectedSnapshotId, isSuperAdmin ? companyId : "own"],
    enabled: queryEnabled && selectedSnapshotId !== null,
    queryFn: () => apiFetch<UnitTechnicalProfileSnapshotDetailResponse>(
      token,
      buildChildUrl(activeUnitId!, `history/${selectedSnapshotId}`, companyId, !!isSuperAdmin),
    ),
  });

  const handleDownloadTemplate = async () => {
    if (!token) return;
    try {
      const response = await fetch(buildImportExportUrl("import/template", activeUnitId, companyId, !!isSuperAdmin), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Sablon indirilemedi");
      await downloadBlobResponse(response, "teknik-profil-template.xlsx");
    } catch (error) {
      toast({ title: "Sablon indirilemedi", description: error instanceof Error ? error.message : "Sunucu hatasi", variant: "destructive" });
    }
  };

  const handleExport = async () => {
    if (!token) return;
    try {
      const response = await fetch(buildImportExportUrl("export", activeUnitId, companyId, !!isSuperAdmin), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Export alinamadi");
      await downloadBlobResponse(response, "teknik-profil.xlsx");
    } catch (error) {
      toast({ title: "Export alinamadi", description: error instanceof Error ? error.message : "Sunucu hatasi", variant: "destructive" });
    }
  };

  const uploadImportFile = async (path: "import/preview" | "import", confirm = false) => {
    if (!token || !importFile) return;
    setImportBusy(true);
    try {
      const formData = new FormData();
      formData.set("file", importFile);
      formData.set("mode", "update_non_empty");
      if (confirm) formData.set("confirm", "true");
      const response = await fetch(buildImportExportUrl(path, undefined, companyId, !!isSuperAdmin), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const body = await response.json().catch(() => null) as ImportPreview | { error?: string } | null;
      if (!response.ok) {
        if (body && "errors" in body) setImportPreview(body as ImportPreview);
        throw new Error(body && "error" in body && body.error ? body.error : "Import islemi tamamlanamadi");
      }
      setImportPreview(body as ImportPreview);
      if (confirm) {
        await queryClient.invalidateQueries({ queryKey });
        await queryClient.invalidateQueries({ queryKey: historyQueryKey });
        toast({ title: "Import uygulandi", description: "Degisiklikler current taslak profile yazildi; snapshot gecmisi degismedi." });
        setImportDialogOpen(false);
        setImportFile(null);
      }
    } catch (error) {
      toast({ title: confirm ? "Import uygulanamadi" : "Preview alinamadi", description: error instanceof Error ? error.message : "Sunucu hatasi", variant: "destructive" });
    } finally {
      setImportBusy(false);
    }
  };

  const canEdit = profileQuery.data?.permissions.canEdit ?? false;
  const canPublish = profileQuery.data?.permissions.canPublish ?? false;
  const customFieldDefinitions = useMemo(
    () => [...(profileQuery.data?.customFieldDefinitions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [profileQuery.data?.customFieldDefinitions],
  );
  const includeStatusInDirty = canPublish;
  const isDirty = loadedForm !== null
    && JSON.stringify(formToComparable(form, includeStatusInDirty)) !== JSON.stringify(formToComparable(loadedForm, includeStatusInDirty));
  const baseCompletion = calculateUnitTechnicalProfileCompletion(formToProfileValues(form));
  const customCompletion = calculateUnitTechnicalProfileCustomFieldCompletion(customFieldDefinitions, form.customValues);
  const completion = {
    ...baseCompletion,
    completedFields: baseCompletion.completedFields + customCompletion.completedFields,
    totalFields: baseCompletion.totalFields + customCompletion.totalFields,
    ratio: baseCompletion.totalFields + customCompletion.totalFields === 0
      ? 100
      : Math.round(((baseCompletion.completedFields + customCompletion.completedFields) / (baseCompletion.totalFields + customCompletion.totalFields)) * 100),
    missingFields: [...baseCompletion.missingFields, ...customCompletion.missingFields],
  };
  const sectionCompletion = new Map(completion.sections.map((section) => [section.id, section]));
  const customSectionCompletion = {
    id: "custom",
    title: "Firma ozel alanlar",
    completedFields: customCompletion.completedFields,
    totalFields: customCompletion.totalFields,
    ratio: customCompletion.ratio,
    status: (customCompletion.completedFields === 0
      ? "not_started"
      : customCompletion.completedFields === customCompletion.totalFields
        ? "completed"
        : "partial") as SectionStatus,
    missingFields: customCompletion.missingFields,
  };

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
    setConflictCustomValues(null);
    setPublishMissingFields([]);
    setErrors({});
  }, [unitId, activeUnitId, isDirty, toast]);

  useEffect(() => {
    const data = profileQuery.data;
    if (!data) return;
    const nextForm = profileToForm(data.profile, data.customFieldValues);
    setForm(nextForm);
    setLoadedForm(nextForm);
    setServerProfile(data.profile);
    setConflictProfile(null);
    setConflictCustomValues(null);
    setPublishMissingFields([]);
    setViewMode(data.permissions.canEdit ? "form" : "summary");
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
      const nextForm = profileToForm(data.profile, data.customFieldValues);
      setForm(nextForm);
      setLoadedForm(nextForm);
      setServerProfile(data.profile);
      setConflictProfile(null);
      setConflictCustomValues(null);
      setPublishMissingFields([]);
      setErrors({});
      queryClient.setQueryData(queryKey, data);
      toast({ title: "Teknik profil kaydedildi" });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409 && typeof error.body === "object" && error.body !== null && "profile" in error.body) {
        const body = error.body as { profile: UnitTechnicalProfileDto; customFieldValues?: Record<string, unknown> };
        setConflictProfile(body.profile);
        setConflictCustomValues(body.customFieldValues ?? null);
        if (body.customFieldValues) {
          setLoadedForm(profileToForm(body.profile, body.customFieldValues));
        }
        toast({ title: "Versiyon cakismasi", description: "Sunucuda daha guncel veri var. Duzenlemeleriniz korunuyor.", variant: "destructive" });
        return;
      }
      if (error instanceof ApiError && error.status === 422 && typeof error.body === "object" && error.body !== null && "missingFields" in error.body) {
        const missingFields = (error.body as { missingFields?: unknown }).missingFields;
        if (Array.isArray(missingFields)) {
          setPublishMissingFields(missingFields.map(String));
          setViewMode("form");
          toast({ title: "Yayin icin alanlar tamamlanmali", description: "Ilk tamamlanmamis bolume yonlendiriliyorsunuz.", variant: "destructive" });
          setTimeout(() => goToFirstMissingField(missingFields.map(String)), 0);
          return;
        }
      }
      toast({ title: "Kaydedilemedi", description: error instanceof Error ? error.message : "Sunucu hatasi", variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: (payload: { expectedProfileVersion: number; validFrom: string; changeSummary: string | null }) => apiFetch<UnitTechnicalProfilePublishResponse>(
      token,
      buildChildUrl(activeUnitId!, "publish", companyId, !!isSuperAdmin),
      { method: "POST", body: JSON.stringify(payload) },
    ),
    onSuccess: async (data) => {
      const nextForm = profileToForm(data.profile, data.customFieldValues);
      setForm(nextForm);
      setLoadedForm(nextForm);
      setServerProfile(data.profile);
      setConflictProfile(null);
      setConflictCustomValues(null);
      setPublishMissingFields([]);
      setPublishPanelOpen(false);
      setPublishDateError(null);
      setErrors({});
      queryClient.setQueryData(queryKey, data);
      await queryClient.invalidateQueries({ queryKey: historyQueryKey });
      toast({ title: `Teknik profil yayimlandi`, description: `Snapshot #${data.snapshot.snapshotNumber} olusturuldu.` });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        const body = error.body as { code?: unknown; profile?: UnitTechnicalProfileDto; customFieldValues?: Record<string, unknown> };
        if (body.code === "valid_from_conflict") {
          setPublishDateError(error.message);
          toast({ title: "Gecerlilik tarihi uygun degil", description: error.message, variant: "destructive" });
          return;
        }
        if (body.profile) {
          setConflictProfile(body.profile);
          setConflictCustomValues(body.customFieldValues ?? null);
          toast({ title: "Versiyon cakismasi", description: "Sunucuda daha guncel veri var. Duzenlemeleriniz korunuyor.", variant: "destructive" });
          return;
        }
      }
      if (error instanceof ApiError && error.status === 422 && typeof error.body === "object" && error.body !== null && "missingFields" in error.body) {
        const missingFields = (error.body as { missingFields?: unknown }).missingFields;
        if (Array.isArray(missingFields)) {
          setPublishMissingFields(missingFields.map(String));
          setActiveTab("profile");
          setViewMode("form");
          toast({ title: "Yayin icin alanlar tamamlanmali", description: "Minimum alanlari kontrol edin.", variant: "destructive" });
          return;
        }
      }
      toast({ title: "Yayimlanamadi", description: error instanceof Error ? error.message : "Sunucu hatasi", variant: "destructive" });
    },
  });

  const disabled = !canEdit || saveMutation.isPending || publishMutation.isPending;
  const superAdminNeedsCompany = isSuperAdmin && companyId === null;

  function setText(field: TextField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setPublishMissingFields((current) => current.filter((item) => item !== field));
  }

  function setNumeric(field: NumericField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setPublishMissingFields((current) => current.filter((item) => item !== field));
  }

  function setTechnical(field: TechnicalField, value: UnitTechnicalProfileTechnicalStatus | "") {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setPublishMissingFields((current) => current.filter((item) => item !== field));
  }

  function setCustomValue(code: string, value: unknown) {
    setForm((current) => ({ ...current, customValues: { ...current.customValues, [code]: value } }));
    setPublishMissingFields((current) => current.filter((item) => item !== code));
  }

  function fieldSection(field: string): UnitTechnicalProfileSectionId | null {
    if (field === "operation") return "operation";
    return UNIT_TECHNICAL_PROFILE_SECTIONS.find((section) => (section.fields as readonly string[]).includes(field))?.id ?? null;
  }

  function focusField(field: string) {
    const targetField = field === "operation"
      ? UNIT_TECHNICAL_PROFILE_OPERATION_FIELDS.find((operationField) => completion.missingFields.includes(operationField)) ?? UNIT_TECHNICAL_PROFILE_OPERATION_FIELDS[0]
      : field;
    const element = document.getElementById(targetField);
    element?.focus({ preventScroll: true });
  }

  function goToFirstMissingField(missingFields: readonly string[] = completion.missingFields) {
    const firstField = missingFields[0];
    if (!firstField) {
      toast({ title: "Profil bolumleri tamamlandi", description: "Tamamlanmamis bolum bulunmuyor." });
      return;
    }
    const sectionId = fieldSection(firstField);
    const section = sectionId ? document.getElementById(`utp-section-${sectionId}`) : document.getElementById("utp-section-custom");
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => focusField(firstField), 250);
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
      const missingFields = validateUnitTechnicalProfilePublishMinimum(formToProfileValues(form));
      const missingCustomFields = missingRequiredUnitTechnicalProfileCustomFieldsForPublish(customFieldDefinitions, form.customValues);
      const combinedMissingFields = [...missingFields, ...missingCustomFields.map((field) => field.code)];
      if (combinedMissingFields.length > 0) {
        setPublishMissingFields(combinedMissingFields);
        toast({ title: "Yayin icin alanlar tamamlanmali", description: "Minimum alanlari kontrol edin.", variant: "destructive" });
        goToFirstMissingField(combinedMissingFields);
        return;
      }
      const ok = window.confirm("Teknik profili yayinlanmis duruma almak istiyor musunuz?");
      if (!ok) return;
    }
    saveMutation.mutate(buildPatchPayload(form, serverProfile.profileVersion, canPublish));
  }

  async function handlePublish() {
    if (!serverProfile || !activeUnitId) return;
    setPublishDateError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(publishValidFrom)) {
      setPublishDateError("Gecerli bir baslangic tarihi girin.");
      return;
    }
    const nextErrors = validateForm(form, canPublish);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast({ title: "Formu kontrol edin", description: "Bazi alanlar beklenen aralikta degil.", variant: "destructive" });
      return;
    }
    const missingFields = validateUnitTechnicalProfilePublishMinimum(formToProfileValues(form));
    const missingCustomFields = missingRequiredUnitTechnicalProfileCustomFieldsForPublish(customFieldDefinitions, form.customValues);
    const combinedMissingFields = [...missingFields, ...missingCustomFields.map((field) => field.code)];
    if (combinedMissingFields.length > 0) {
      setPublishMissingFields(combinedMissingFields);
      setActiveTab("profile");
      setViewMode("form");
      goToFirstMissingField(combinedMissingFields);
      return;
    }

    try {
      let expectedProfileVersion = serverProfile.profileVersion;
      if (isDirty) {
        const saved = await saveMutation.mutateAsync(buildPatchPayload(form, serverProfile.profileVersion, canPublish));
        expectedProfileVersion = saved.profile.profileVersion;
      }
      await publishMutation.mutateAsync({
        expectedProfileVersion,
        validFrom: publishValidFrom,
        changeSummary: publishChangeSummary.trim() || null,
      });
    } catch {
      // Mutation handlers keep form state and user feedback in sync.
    }
  }

  function handleReset() {
    if (!loadedForm) return;
    setForm(loadedForm);
    setConflictProfile(null);
    setConflictCustomValues(null);
    setPublishMissingFields([]);
    setErrors({});
  }

  function loadServerConflict() {
    if (!conflictProfile) return;
    const nextForm = profileToForm(conflictProfile, conflictCustomValues ?? {});
    setForm(nextForm);
    setLoadedForm(nextForm);
    setServerProfile(conflictProfile);
    setConflictProfile(null);
    setConflictCustomValues(null);
    setPublishMissingFields([]);
    setErrors({});
  }

  function continueWithEdits() {
    if (!conflictProfile) return;
    setServerProfile(conflictProfile);
    setLoadedForm(profileToForm(conflictProfile, conflictCustomValues ?? {}));
    setConflictProfile(null);
    setConflictCustomValues(null);
    setPublishMissingFields([]);
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
          <p className="text-sm text-muted-foreground">Profil doluluk orani: {completion.completedFields}/{completion.totalFields} alan ({completion.ratio}%)</p>
          <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-teal-500 transition-all" style={{ width: `${completion.ratio}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button variant="outline" onClick={() => setViewMode(viewMode === "summary" ? "form" : "summary")} className="gap-2">
              {viewMode === "summary" ? <ScrollText className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {viewMode === "summary" ? "Form" : "Ozet"}
            </Button>
          )}
          {canEdit && viewMode === "form" && (
            <Button variant="outline" onClick={() => goToFirstMissingField()} className="gap-2" data-testid="unit-technical-profile-next-incomplete">
              <ScrollText className="h-4 w-4" /> Sonraki tamamlanmamis bolume git
            </Button>
          )}
          {canEdit && viewMode === "form" && (
            <>
              <Button variant="outline" onClick={handleDownloadTemplate} disabled={disabled} className="gap-2" data-testid="unit-technical-profile-template">
                <Download className="h-4 w-4" /> Sablon
              </Button>
              <Button variant="outline" onClick={handleExport} disabled={disabled} className="gap-2" data-testid="unit-technical-profile-export">
                <Download className="h-4 w-4" /> Export
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (isDirty && !window.confirm("Kaydedilmemis degisiklikler var. Import oncesi server verisi esas alinacak. Devam edilsin mi?")) return;
                  setImportDialogOpen(true);
                  setImportPreview(null);
                  setImportFile(null);
                }}
                disabled={disabled}
                className="gap-2"
                data-testid="unit-technical-profile-import-open"
              >
                <Upload className="h-4 w-4" /> Import
              </Button>
              <Button variant="outline" onClick={handleReset} disabled={!isDirty || saveMutation.isPending} className="gap-2">
                <RotateCcw className="h-4 w-4" /> Degisiklikleri geri al
              </Button>
              <Button onClick={handleSave} disabled={!canEdit || !isDirty || saveMutation.isPending} className="gap-2" data-testid="unit-technical-profile-save">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Kaydet
              </Button>
              {canPublish && (
                <Button type="button" variant="secondary" onClick={() => setPublishPanelOpen((open) => !open)} disabled={publishMutation.isPending} className="gap-2" data-testid="unit-technical-profile-open-publish">
                  <CheckCircle2 className="h-4 w-4" /> Yayimla
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={importDialogOpen} onOpenChange={(open) => {
        setImportDialogOpen(open);
        if (!open) {
          setImportPreview(null);
          setImportFile(null);
        }
      }}>
        <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto" data-testid="unit-technical-profile-import-dialog">
          <DialogHeader>
            <DialogTitle>Teknik profil import</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Import taslak/current profil uzerinde calisir</AlertTitle>
              <AlertDescription>Snapshot gecmisi, validFrom/validTo ve yayinlanmis tarihce degismez. Bos hucreler mevcut degeri korur; temizleme token'i __CLEAR__.</AlertDescription>
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleDownloadTemplate} disabled={importBusy} className="gap-2">
                <Download className="h-4 w-4" /> Sablon indir
              </Button>
              <Input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={importBusy}
                onChange={(event) => {
                  setImportFile(event.target.files?.[0] ?? null);
                  setImportPreview(null);
                }}
                className="max-w-sm"
                data-testid="unit-technical-profile-import-file"
              />
              <Button onClick={() => uploadImportFile("import/preview")} disabled={!importFile || importBusy} className="gap-2" data-testid="unit-technical-profile-import-preview">
                {importBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                Preview
              </Button>
            </div>
            {importPreview && (
              <div className="space-y-3" data-testid="unit-technical-profile-import-preview-result">
                <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["Satir", importPreview.totalRows],
                    ["Gecerli", importPreview.validRows],
                    ["Hata", importPreview.errorRows],
                    ["Create", importPreview.createCount],
                    ["Update", importPreview.updateCount],
                    ["No-change", importPreview.noChangeCount],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border p-2">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-lg font-semibold">{value}</div>
                    </div>
                  ))}
                </div>
                {importPreview.warnings.length > 0 && (
                  <Alert className="border-amber-500/40 bg-amber-500/10">
                    <AlertCircle className="h-4 w-4 text-amber-400" />
                    <AlertTitle>Uyarilar</AlertTitle>
                    <AlertDescription>{importPreview.warnings.slice(0, 5).map((issue) => `Satir ${issue.row}: ${issue.code}`).join(", ")}</AlertDescription>
                  </Alert>
                )}
                {importPreview.errors.length > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded-md border" data-testid="unit-technical-profile-import-errors">
                    {importPreview.errors.map((issue, index) => (
                      <div key={`${issue.row}-${issue.code}-${index}`} className="border-b p-2 text-sm last:border-b-0">
                        <span className="font-medium">Satir {issue.row}</span>
                        {issue.column && <span className="text-muted-foreground"> / {issue.column}</span>}
                        <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">{issue.code}</span>
                        <div className="mt-1 text-muted-foreground">{issue.message}</div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-sm text-muted-foreground">{importPreview.message}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)} disabled={importBusy}>Vazgec</Button>
            <Button
              onClick={() => uploadImportFile("import", true)}
              disabled={!importPreview || importPreview.errors.length > 0 || importBusy}
              data-testid="unit-technical-profile-import-apply"
            >
              {importBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Uygula
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "profile" | "history")}>
        <TabsList>
          <TabsTrigger value="profile">Profil</TabsTrigger>
          <TabsTrigger value="history" data-testid="unit-technical-profile-history-tab">Tarihce</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === "profile" && (
      <>
      {publishPanelOpen && canPublish && viewMode === "form" && (
        <Card className="border-teal-500/30" data-testid="unit-technical-profile-publish-panel">
          <CardHeader>
            <CardTitle className="text-base">Kaydet ve yayimla</CardTitle>
            <p className="text-sm text-muted-foreground">Guncel profil once kaydedilir, ardindan bu tarih ile immutable snapshot olusturulur.</p>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-[220px_1fr_auto] md:items-start">
            <div className="space-y-1.5">
              <Label htmlFor="unit-technical-profile-valid-from">Gecerlilik baslangici</Label>
              <Input
                id="unit-technical-profile-valid-from"
                data-testid="unit-technical-profile-valid-from"
                type="date"
                value={publishValidFrom}
                disabled={disabled}
                onChange={(event) => {
                  setPublishValidFrom(event.target.value);
                  setPublishDateError(null);
                }}
              />
              <FieldError message={publishDateError ?? undefined} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unit-technical-profile-change-summary">Degisiklik aciklamasi</Label>
              <Textarea
                id="unit-technical-profile-change-summary"
                data-testid="unit-technical-profile-change-summary"
                rows={2}
                maxLength={1000}
                value={publishChangeSummary}
                disabled={disabled}
                onChange={(event) => setPublishChangeSummary(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Mevcut profile version: {serverProfile.profileVersion}</p>
            </div>
            <Button type="button" onClick={handlePublish} disabled={disabled || publishMutation.isPending} className="gap-2" data-testid="unit-technical-profile-publish">
              {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Kaydet ve yayimla
            </Button>
          </CardContent>
        </Card>
      )}

      {viewMode === "summary" && (
        <ProfileSummary
          profile={serverProfile}
          form={form}
          completion={completion}
          customFieldDefinitions={customFieldDefinitions}
          canEdit={canEdit}
          onEdit={() => setViewMode("form")}
        />
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

      {publishMissingFields.length > 0 && viewMode === "form" && (
        <Alert className="border-amber-500/40 bg-amber-500/10" data-testid="unit-technical-profile-publish-missing">
          <AlertCircle className="h-4 w-4 text-amber-400" />
          <AlertTitle>Yayinlamak icin minimum alanlari tamamlayin</AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <p>Taslak kaydi engellenmez; sadece published durumuna gecis icin bu alanlar gerekir.</p>
              <div className="flex flex-wrap gap-1.5">
                {publishMissingFields.map((field) => (
                  <Badge key={field} variant="outline">
                    {field === "operation"
                      ? "Genel calisma duzeninden en az bir alan"
                      : UNIT_TECHNICAL_PROFILE_FIELD_LABELS[field as UnitTechnicalProfileFieldCode]
                        ?? customFieldDefinitions.find((definition) => definition.code === field)?.label
                        ?? field}
                  </Badge>
                ))}
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {viewMode === "form" && (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard id="general" completion={sectionCompletion.get("general")!}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
        </SectionCard>

        <SectionCard id="physical" completion={sectionCompletion.get("physical")!}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumericInputField field="buildingCount" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="totalEnclosedAreaM2" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="heatedAreaM2" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="cooledAreaM2" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="openAreaM2" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <TechnicalSelectField field="insulationStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
          </div>
        </SectionCard>

        <SectionCard id="operation" completion={sectionCompletion.get("operation")!}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumericInputField field="personnelCount" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="averageDailyUsers" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="dailyOperatingHours" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="weeklyOperatingDays" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="annualOperatingDays" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <NumericInputField field="shiftCount" form={form} errors={errors} disabled={disabled} onChange={setNumeric} />
            <TextInputField field="shiftType" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TechnicalSelectField field="seasonalOperationStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
          </div>
        </SectionCard>

        <SectionCard id="hvac" completion={sectionCompletion.get("hvac")!}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextInputField field="heatingSystemType" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextInputField field="coolingSystemType" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextInputField field="domesticHotWaterSystem" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TechnicalSelectField field="buildingAutomationStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
          </div>
        </SectionCard>

        <SectionCard id="energySystems" completion={sectionCompletion.get("energySystems")!}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TechnicalSelectField field="compressedAirStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
            <TechnicalSelectField field="steamSystemStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
            <TechnicalSelectField field="generatorStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
            <TechnicalSelectField field="renewableEnergyStatus" form={form} errors={errors} disabled={disabled} onChange={setTechnical} />
          </div>
        </SectionCard>

        <SectionCard id="technicalNotes" completion={sectionCompletion.get("technicalNotes")!}>
          <div className="space-y-4">
            <TextAreaField field="energyInfrastructureDescription" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextAreaField field="knownEnergyIssues" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextAreaField field="technicalImprovements" form={form} errors={errors} disabled={disabled} onChange={setText} />
            <TextAreaField field="plannedInfrastructureChanges" form={form} errors={errors} disabled={disabled} onChange={setText} />
          </div>
        </SectionCard>

        {customFieldDefinitions.length > 0 && (
          <SectionCard id="custom" completion={customSectionCompletion}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {customFieldDefinitions.map((definition) => (
                <CustomFieldInput
                  key={definition.id}
                  definition={definition}
                  value={form.customValues[definition.code]}
                  disabled={disabled}
                  readOnly={!definition.isActive}
                  missing={publishMissingFields.includes(definition.code)}
                  onChange={setCustomValue}
                />
              ))}
            </div>
          </SectionCard>
        )}
      </div>
      )}
      </>
      )}

      {activeTab === "history" && (
        <HistoryPanel
          history={historyQuery.data}
          isLoading={historyQuery.isLoading}
          selectedSnapshot={snapshotDetailQuery.data?.snapshot ?? null}
          selectedSnapshotId={selectedSnapshotId}
          canEdit={canEdit}
          onRefresh={() => historyQuery.refetch()}
          onSelectSnapshot={setSelectedSnapshotId}
        />
      )}
    </div>
  );
}
