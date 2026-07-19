import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPE_LABELS,
  UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPES,
  type UnitTechnicalProfileCustomFieldDefinitionDto,
  type UnitTechnicalProfileCustomFieldType,
  type UnitTechnicalProfileCustomFieldDefinitionsResponse,
} from "@workspace/api-zod";
import { Archive, CheckCircle2, Pencil, Plus, RefreshCw, Save } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";

class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    const message = typeof body === "object" && body !== null && "error" in body
      ? String((body as { error?: unknown }).error)
      : `HTTP ${status}`;
    super(message);
    this.status = status;
    this.body = body;
  }
}

type FormState = {
  id: number | null;
  code: string;
  label: string;
  description: string;
  fieldType: UnitTechnicalProfileCustomFieldType;
  unitLabel: string;
  optionsText: string;
  isRequiredForPublish: boolean;
  isActive: boolean;
  sortOrder: string;
  min: string;
  max: string;
  maxLength: string;
  expectedDefinitionVersion: number | null;
  hasValues: boolean;
};

const emptyForm: FormState = {
  id: null,
  code: "",
  label: "",
  description: "",
  fieldType: "short_text",
  unitLabel: "",
  optionsText: "",
  isRequiredForPublish: false,
  isActive: true,
  sortOrder: "0",
  min: "",
  max: "",
  maxLength: "",
  expectedDefinitionVersion: null,
  hasValues: false,
};

function buildUrl(companyId: number | null, isSuperAdmin: boolean) {
  const params = new URLSearchParams();
  if (isSuperAdmin && companyId !== null) params.set("companyId", companyId.toString());
  params.set("includeInactive", "true");
  return `/api/unit-technical-profile-field-definitions?${params.toString()}`;
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

function optionsToText(definition: UnitTechnicalProfileCustomFieldDefinitionDto) {
  return definition.options.map((option) => `${option.code}:${option.label}${option.isActive ? "" : ":passive"}`).join("\n");
}

function formFromDefinition(definition: UnitTechnicalProfileCustomFieldDefinitionDto): FormState {
  return {
    id: definition.id,
    code: definition.code,
    label: definition.label,
    description: definition.description ?? "",
    fieldType: definition.fieldType,
    unitLabel: definition.unitLabel ?? "",
    optionsText: optionsToText(definition),
    isRequiredForPublish: definition.isRequiredForPublish,
    isActive: definition.isActive,
    sortOrder: String(definition.sortOrder),
    min: definition.validationConfig.min === undefined ? "" : String(definition.validationConfig.min),
    max: definition.validationConfig.max === undefined ? "" : String(definition.validationConfig.max),
    maxLength: definition.validationConfig.maxLength === undefined ? "" : String(definition.validationConfig.maxLength),
    expectedDefinitionVersion: definition.definitionVersion,
    hasValues: definition.hasValues === true,
  };
}

function parseOptions(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code, label, state] = line.split(":");
      return { code: (code ?? "").trim(), label: (label ?? code ?? "").trim(), isActive: state !== "passive" };
    });
}

function buildPayload(form: FormState) {
  const validationConfig: Record<string, unknown> = {};
  if (form.min.trim()) validationConfig.min = Number(form.min);
  if (form.max.trim()) validationConfig.max = Number(form.max);
  if (form.maxLength.trim()) validationConfig.maxLength = Number(form.maxLength);
  const needsOptions = form.fieldType === "single_select" || form.fieldType === "multi_select";
  return {
    code: form.code.trim(),
    label: form.label.trim(),
    description: form.description.trim() || null,
    fieldType: form.fieldType,
    unitLabel: form.unitLabel.trim() || null,
    options: needsOptions ? parseOptions(form.optionsText) : [],
    isRequiredForPublish: form.isRequiredForPublish,
    isActive: form.isActive,
    sortOrder: Number(form.sortOrder || 0),
    validationConfig,
  };
}

export function TechnicalProfileFieldsSettings({ companyId }: { companyId: number | null }) {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === "superadmin";
  const queryEnabled = !!token && (!isSuperAdmin || companyId !== null);
  const url = queryEnabled ? buildUrl(companyId, !!isSuperAdmin) : null;
  const queryKey = ["unit-technical-profile-field-definitions", user?.role, isSuperAdmin ? companyId : "own"];
  const [form, setForm] = useState<FormState>(emptyForm);

  const query = useQuery<UnitTechnicalProfileCustomFieldDefinitionsResponse, ApiError>({
    queryKey,
    enabled: queryEnabled,
    queryFn: () => apiFetch<UnitTechnicalProfileCustomFieldDefinitionsResponse>(token, url!),
  });

  const canEdit = query.data?.permissions.canEdit === true;
  const isEditing = form.id !== null;
  const disabled = !canEdit;

  useEffect(() => {
    if (!query.data) return;
    setForm(emptyForm);
  }, [companyId, query.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPayload(form);
      if (isEditing) {
        return apiFetch(token, `/api/unit-technical-profile-field-definitions/${form.id}${isSuperAdmin && companyId !== null ? `?companyId=${companyId}` : ""}`, {
          method: "PATCH",
          body: JSON.stringify({ ...payload, expectedDefinitionVersion: form.expectedDefinitionVersion }),
        });
      }
      return apiFetch(token, `/api/unit-technical-profile-field-definitions${isSuperAdmin && companyId !== null ? `?companyId=${companyId}` : ""}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      toast({ title: "Teknik profil alani kaydedildi" });
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toast({ title: "Kaydedilemedi", description: error instanceof Error ? error.message : "Sunucu hatasi", variant: "destructive" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (definition: UnitTechnicalProfileCustomFieldDefinitionDto) => apiFetch(
      token,
      `/api/unit-technical-profile-field-definitions/${definition.id}/archive${isSuperAdmin && companyId !== null ? `?companyId=${companyId}` : ""}`,
      { method: "POST", body: JSON.stringify({ expectedDefinitionVersion: definition.definitionVersion }) },
    ),
    onSuccess: async () => {
      toast({ title: "Alan pasife alindi" });
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toast({ title: "Pasife alinamadi", description: error instanceof Error ? error.message : "Sunucu hatasi", variant: "destructive" });
    },
  });

  const definitions = useMemo(
    () => [...(query.data?.definitions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    [query.data?.definitions],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    saveMutation.mutate();
  }

  return (
    <div className="space-y-4" data-testid="technical-profile-fields-settings">
      {query.isError && (
        <Alert variant="destructive">
          <AlertTitle>Alanlar yuklenemedi</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      {query.data && !canEdit && (
        <Alert className="border-teal-600/30 bg-teal-600/10">
          <AlertTitle>Salt okunur</AlertTitle>
          <AlertDescription>Firma ozel teknik profil alanlarini yalniz firma yoneticileri duzenleyebilir.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden rounded-lg">
          <CardHeader>
            <CardTitle>Teknik Profil Alanlari</CardTitle>
            <CardDescription>Firma bazinda birim teknik profil formuna eklenecek ozel alanlar.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading ? (
              <div className="text-sm text-muted-foreground">Yukleniyor...</div>
            ) : definitions.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Henuz firma ozel alani yok.</div>
            ) : definitions.map((definition) => (
              <div key={definition.id} className="grid gap-3 rounded-lg border p-3 lg:grid-cols-[1fr_auto]">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{definition.label}</div>
                    <Badge variant="outline">{definition.code}</Badge>
                    <Badge variant={definition.isActive ? "default" : "outline"}>{definition.isActive ? "Aktif" : "Pasif"}</Badge>
                    {definition.isRequiredForPublish && <Badge className="border-amber-500/30 text-amber-400" variant="outline">Publish zorunlu</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPE_LABELS[definition.fieldType]}
                    {definition.unitLabel ? ` · ${definition.unitLabel}` : ""}
                    {definition.usageCount !== undefined ? ` · ${definition.usageCount} profilde deger var` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" disabled={!canEdit} onClick={() => setForm(formFromDefinition(definition))}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" disabled={!canEdit || !definition.isActive || archiveMutation.isPending} onClick={() => archiveMutation.mutate(definition)}>
                    <Archive className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-lg">
          <CardHeader>
            <CardTitle>{isEditing ? "Alani Duzenle" : "Yeni Alan"}</CardTitle>
            <CardDescription>Kod ve tip, alan kullanildiktan sonra kilitlenir.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="utp-custom-code">Kod</Label>
                  <Input id="utp-custom-code" value={form.code} disabled={disabled || form.hasValues} pattern="[a-z][a-z0-9_]{1,63}" onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="utp-custom-label">Etiket</Label>
                  <Input id="utp-custom-label" value={form.label} disabled={disabled} maxLength={160} onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tip</Label>
                  <Select value={form.fieldType} disabled={disabled || form.hasValues} onValueChange={(value) => setForm((current) => ({ ...current, fieldType: value as UnitTechnicalProfileCustomFieldType }))}>
                    <SelectTrigger data-testid="technical-profile-field-type-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>{UNIT_TECHNICAL_PROFILE_CUSTOM_FIELD_TYPE_LABELS[type]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="utp-custom-unit">Birim</Label>
                  <Input id="utp-custom-unit" value={form.unitLabel} disabled={disabled} maxLength={40} onChange={(event) => setForm((current) => ({ ...current, unitLabel: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="utp-custom-sort">Sira</Label>
                  <Input id="utp-custom-sort" type="number" min={0} max={10000} value={form.sortOrder} disabled={disabled} onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="utp-custom-required">Publish zorunlu</Label>
                  <Switch id="utp-custom-required" checked={form.isRequiredForPublish} disabled={disabled} onCheckedChange={(checked) => setForm((current) => ({ ...current, isRequiredForPublish: checked }))} />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <Label htmlFor="utp-custom-active">Aktif</Label>
                  <Switch id="utp-custom-active" checked={form.isActive} disabled={disabled} onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="utp-custom-description">Aciklama</Label>
                <Textarea id="utp-custom-description" value={form.description} disabled={disabled} rows={3} maxLength={1000} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
              </div>
              {(form.fieldType === "single_select" || form.fieldType === "multi_select") && (
                <div className="space-y-1.5">
                  <Label htmlFor="utp-custom-options">Secenekler</Label>
                  <Textarea id="utp-custom-options" value={form.optionsText} disabled={disabled} rows={4} placeholder="kod:Etiket" onChange={(event) => setForm((current) => ({ ...current, optionsText: event.target.value }))} />
                </div>
              )}
              {(["integer", "decimal", "unit_number", "short_text", "long_text"] as UnitTechnicalProfileCustomFieldType[]).includes(form.fieldType) && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="utp-custom-min">Min</Label>
                    <Input id="utp-custom-min" type="number" value={form.min} disabled={disabled || form.fieldType === "short_text" || form.fieldType === "long_text"} onChange={(event) => setForm((current) => ({ ...current, min: event.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="utp-custom-max">Max</Label>
                    <Input id="utp-custom-max" type="number" value={form.max} disabled={disabled || form.fieldType === "short_text" || form.fieldType === "long_text"} onChange={(event) => setForm((current) => ({ ...current, max: event.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="utp-custom-max-length">Max uzunluk</Label>
                    <Input id="utp-custom-max-length" type="number" value={form.maxLength} disabled={disabled || !["short_text", "long_text"].includes(form.fieldType)} onChange={(event) => setForm((current) => ({ ...current, maxLength: event.target.value }))} />
                  </div>
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setForm(emptyForm)}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Temizle
                </Button>
                {canEdit && (
                  <Button type="submit" disabled={saveMutation.isPending}>
                    {isEditing ? <Save className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
                    {saveMutation.isPending ? "Kaydediliyor" : isEditing ? "Kaydet" : "Ekle"}
                  </Button>
                )}
              </div>
              {isEditing && form.hasValues && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" /> Bu alan kullanildigi icin kod ve tip kilitlidir.
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
