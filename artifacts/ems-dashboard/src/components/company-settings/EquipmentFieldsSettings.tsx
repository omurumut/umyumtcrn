import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Definition = {
  id: number;
  code: string;
  label: string;
  description: string | null;
  section: string;
  fieldType: string;
  unitLabel: string | null;
  options: Array<{ code: string; label: string; isActive: boolean; displayOrder?: number }>;
  isRequired: boolean;
  isActive: boolean;
  displayOrder: number;
  definitionVersion: number;
  usageCount?: number;
  hasValues?: boolean;
};

type DefinitionResponse = { definitions: Definition[]; permissions: { canEdit: boolean } };
type DefinitionForm = {
  code: string;
  label: string;
  description: string;
  section: string;
  fieldType: string;
  unitLabel: string;
  optionsText: string;
  isRequired: boolean;
  displayOrder: string;
};

const EMPTY_FORM: DefinitionForm = {
  code: "",
  label: "",
  description: "",
  section: "technical",
  fieldType: "short_text",
  unitLabel: "",
  optionsText: "",
  isRequired: false,
  displayOrder: "0",
};

const FIELD_TYPES = [
  ["short_text", "Kısa metin"],
  ["long_text", "Uzun metin"],
  ["integer", "Tam sayı"],
  ["decimal", "Ondalık sayı"],
  ["boolean", "Durum"],
  ["single_select", "Tek seçim"],
  ["multi_select", "Çoklu seçim"],
  ["date", "Tarih"],
  ["unit_number", "Birimli sayı"],
] as const;

const SECTIONS = [
  ["identity", "Kimlik"],
  ["technical", "Teknik"],
  ["operation", "Operasyon"],
  ["lifecycle", "Yaşam döngüsü"],
  ["criticality", "Kritiklik"],
  ["notes", "Notlar"],
  ["other", "Diğer"],
] as const;

class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.error ?? "İstek başarısız");
    this.status = status;
    this.body = body;
  }
}

async function apiFetch<T>(token: string | null, url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

function formFromDefinition(definition: Definition): DefinitionForm {
  return {
    code: definition.code,
    label: definition.label,
    description: definition.description ?? "",
    section: definition.section,
    fieldType: definition.fieldType,
    unitLabel: definition.unitLabel ?? "",
    optionsText: definition.options.map((option) => `${option.code}:${option.label}`).join("\n"),
    isRequired: definition.isRequired,
    displayOrder: String(definition.displayOrder),
  };
}

function payload(form: DefinitionForm, expectedDefinitionVersion?: number) {
  const needsOptions = form.fieldType === "single_select" || form.fieldType === "multi_select";
  return {
    ...(expectedDefinitionVersion ? { expectedDefinitionVersion } : {}),
    code: form.code.trim().toLowerCase(),
    label: form.label.trim(),
    description: form.description.trim() || null,
    section: form.section,
    fieldType: form.fieldType,
    unitLabel: form.unitLabel.trim() || null,
    options: needsOptions
      ? form.optionsText.split(/\r?\n/).map((line, index) => {
        const [code, ...labelParts] = line.split(":");
        return { code: code.trim().toLowerCase(), label: (labelParts.join(":").trim() || code.trim()), isActive: true, displayOrder: index };
      }).filter((option) => option.code)
      : [],
    isRequired: form.isRequired,
    displayOrder: Number.parseInt(form.displayOrder, 10) || 0,
    validationConfig: {},
  };
}

export function EquipmentFieldsSettings({ companyId }: { companyId: number | null }) {
  const { user, token } = useAuth();
  const { companyId: contextCompanyId } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === "superadmin";
  const effectiveCompanyId = isSuperAdmin ? contextCompanyId : null;
  const enabled = !!token && (!isSuperAdmin || companyId !== null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Definition | null>(null);
  const [form, setForm] = useState<DefinitionForm>(EMPTY_FORM);

  const query = useQuery<DefinitionResponse, ApiError>({
    queryKey: ["equipment-field-definitions-settings", effectiveCompanyId],
    queryFn: () => apiFetch(token, `/api/equipment-field-definitions?includeArchived=true${effectiveCompanyId ? `&companyId=${effectiveCompanyId}` : ""}`),
    enabled,
  });

  const mutation = useMutation({
    mutationFn: () => apiFetch<{ definition: Definition }>(
      token,
      editing ? `/api/equipment-field-definitions/${editing.id}${effectiveCompanyId ? `?companyId=${effectiveCompanyId}` : ""}` : `/api/equipment-field-definitions${effectiveCompanyId ? `?companyId=${effectiveCompanyId}` : ""}`,
      { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload(form, editing?.definitionVersion)) },
    ),
    onSuccess: async () => {
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await queryClient.invalidateQueries({ queryKey: ["equipment-field-definitions-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["equipment-custom-field-definitions"] });
      toast({ title: "Ekipman özel alanı kaydedildi" });
    },
    onError: (error: ApiError) => toast({ title: error.message, variant: "destructive" }),
  });

  const lifecycleMutation = useMutation({
    mutationFn: ({ definition, action }: { definition: Definition; action: "archive" | "reactivate" }) => apiFetch(
      token,
      `/api/equipment-field-definitions/${definition.id}/${action}${effectiveCompanyId ? `?companyId=${effectiveCompanyId}` : ""}`,
      { method: "POST", body: JSON.stringify({ expectedDefinitionVersion: definition.definitionVersion }) },
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["equipment-field-definitions-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["equipment-custom-field-definitions"] });
    },
    onError: (error: ApiError) => toast({ title: error.message, variant: "destructive" }),
  });

  if (isSuperAdmin && companyId === null) {
    return <Alert><AlertTitle>Firma bağlamı gerekli</AlertTitle><AlertDescription>Ekipman özel alanlarını yönetmek için firma seçin.</AlertDescription></Alert>;
  }

  const canEdit = query.data?.permissions.canEdit === true;
  return (
    <Card data-testid="equipment-fields-settings">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Ekipman Özel Alanları</CardTitle>
        <Button type="button" disabled={!canEdit} onClick={() => { setEditing(null); setForm(EMPTY_FORM); setDialogOpen(true); }} className="gap-2" data-testid="equipment-field-create">
          <Plus className="h-4 w-4" /> Yeni alan
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Sıra</th>
                <th className="px-3 py-2">Etiket</th>
                <th className="px-3 py-2">Kod</th>
                <th className="px-3 py-2">Bölüm</th>
                <th className="px-3 py-2">Tip</th>
                <th className="px-3 py-2">Zorunlu</th>
                <th className="px-3 py-2">Durum</th>
                <th className="px-3 py-2">Kullanım</th>
                <th className="px-3 py-2 text-right">Aksiyon</th>
              </tr>
            </thead>
            <tbody>
              {(query.data?.definitions ?? []).map((definition) => (
                <tr key={definition.id} className="border-t">
                  <td className="px-3 py-2">{definition.displayOrder}</td>
                  <td className="px-3 py-2">{definition.label}</td>
                  <td className="px-3 py-2 font-mono text-xs">{definition.code}</td>
                  <td className="px-3 py-2">{SECTIONS.find(([key]) => key === definition.section)?.[1] ?? definition.section}</td>
                  <td className="px-3 py-2">{FIELD_TYPES.find(([key]) => key === definition.fieldType)?.[1] ?? definition.fieldType}</td>
                  <td className="px-3 py-2">{definition.isRequired ? "Evet" : "Hayır"}</td>
                  <td className="px-3 py-2"><Badge variant="outline">{definition.isActive ? "Aktif" : "Pasif"}</Badge></td>
                  <td className="px-3 py-2">{definition.usageCount ?? 0}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" size="sm" disabled={!canEdit} onClick={() => { setEditing(definition); setForm(formFromDefinition(definition)); setDialogOpen(true); }} aria-label={`${definition.code} düzenle`}><Pencil className="h-4 w-4" /></Button>
                      {definition.isActive ? (
                        <Button type="button" variant="ghost" size="sm" disabled={!canEdit} onClick={() => lifecycleMutation.mutate({ definition, action: "archive" })} aria-label={`${definition.code} arşivle`}><Archive className="h-4 w-4" /></Button>
                      ) : (
                        <Button type="button" variant="ghost" size="sm" disabled={!canEdit} onClick={() => lifecycleMutation.mutate({ definition, action: "reactivate" })} aria-label={`${definition.code} aktifleştir`}><RotateCcw className="h-4 w-4" /></Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Ekipman Alanını Düzenle" : "Yeni Ekipman Alanı"}</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={(event: FormEvent) => { event.preventDefault(); mutation.mutate(); }}>
            <div className="grid gap-3 md:grid-cols-2">
              <TextInput id="equipment-field-label" labelText="Etiket" value={form.label} onChange={(label) => setForm((current) => ({ ...current, label }))} />
              <TextInput id="equipment-field-code" labelText="Kod" value={form.code} disabled={editing?.hasValues} onChange={(code) => setForm((current) => ({ ...current, code }))} />
              <SelectInput labelText="Bölüm" value={form.section} options={SECTIONS} onChange={(section) => setForm((current) => ({ ...current, section }))} />
              <SelectInput labelText="Tip" value={form.fieldType} options={FIELD_TYPES} disabled={editing?.hasValues} onChange={(fieldType) => setForm((current) => ({ ...current, fieldType }))} />
              <TextInput id="equipment-field-unit" labelText="Birim etiketi" value={form.unitLabel} onChange={(unitLabel) => setForm((current) => ({ ...current, unitLabel }))} />
              <TextInput id="equipment-field-order" labelText="Sıra" type="number" value={form.displayOrder} onChange={(displayOrder) => setForm((current) => ({ ...current, displayOrder }))} />
            </div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.isRequired} onCheckedChange={(checked) => setForm((current) => ({ ...current, isRequired: checked === true }))} /> Kaydetmek için zorunlu</label>
            <div className="space-y-1">
              <Label htmlFor="equipment-field-description">Açıklama</Label>
              <Textarea id="equipment-field-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
            </div>
            {(form.fieldType === "single_select" || form.fieldType === "multi_select") && (
              <div className="space-y-1">
                <Label htmlFor="equipment-field-options">Seçenekler</Label>
                <Textarea id="equipment-field-options" value={form.optionsText} onChange={(event) => setForm((current) => ({ ...current, optionsText: event.target.value }))} placeholder={"ie4:IE4\nie3:IE3"} />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Vazgeç</Button>
              <Button type="submit" disabled={!canEdit || mutation.isPending}>Kaydet</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TextInput({ id, labelText, value, onChange, type = "text", disabled = false }: {
  id: string;
  labelText: string;
  value: string;
  type?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return <div className="space-y-1"><Label htmlFor={id}>{labelText}</Label><Input id={id} type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></div>;
}

function SelectInput({ labelText, value, options, onChange, disabled = false }: {
  labelText: string;
  value: string;
  options: readonly (readonly [string, string])[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{labelText}</Label>
      <Select value={value} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}
