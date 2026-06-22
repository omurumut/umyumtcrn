import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Variable, BarChart3, CloudSun } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const apiFetch = (token: string | null, url: string) =>
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then((r) =>
    r.ok ? r.json() : r.json().then((e: any) => { throw new Error(e.error ?? "İstek başarısız"); })
  );

const apiMutate = (token: string | null, method: string, url: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then((r) =>
    r.ok ? (r.status === 204 ? null : r.json()) : r.json().then((e: any) => { throw new Error(e.error); })
  );

// ─── Category / Type labels ──────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  climate: "İklim",
  operational: "Operasyonel",
  production: "Üretim",
  calculated: "Hesaplanan",
  other: "Diğer",
};

const SOURCE_LABELS: Record<string, string> = {
  weather_auto: "Otomatik (İklim)",
  weather_manual: "Manuel (İklim)",
  production_manual: "Manuel (Üretim)",
  operation_manual: "Manuel (Operasyon)",
  calculated: "Hesaplanan",
};

const SCOPE_LABELS: Record<string, string> = {
  company: "Şirket",
  unit: "Birim",
  sub_unit: "Alt Birim",
  meter: "Sayaç",
};

const QUALITY_LABELS: Record<string, string> = {
  good: "İyi",
  estimated: "Tahmini",
  uncertain: "Belirsiz",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Variable {
  id: number;
  companyId: number;
  name: string;
  code: string | null;
  category: string;
  unitLabel: string | null;
  variableType: string;
  sourceType: string;
  scopeType: string;
  description: string | null;
  isSystemVariable: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface VariableValue {
  id: number;
  variableId: number;
  unitId: number | null;
  subUnitId: number | null;
  meterId: number | null;
  periodStart: string;
  periodEnd: string;
  periodType: string;
  value: number;
  source: string | null;
  dataQuality: string | null;
  variableName: string;
  variableCode: string | null;
  variableUnitLabel: string | null;
  unitName: string | null;
  subUnitName: string | null;
  meterName: string | null;
}

interface WeatherDegreeDay {
  id: number;
  province: string;
  district: string | null;
  date: string;
  periodType: string;
  hdd: number;
  cdd: number;
  avgTemperature: number | null;
  source: string;
}

interface SubUnit { id: number; name: string; }
interface Meter { id: number; name: string; city: string; }

const EMPTY_VAR_FORM = {
  name: "", code: "", category: "operational", unitLabel: "", variableType: "numeric",
  sourceType: "operation_manual", scopeType: "company", description: "", isActive: true,
};

const EMPTY_VAL_FORM = {
  variableId: "", unitId: "", subUnitId: "", meterId: "",
  periodStart: "", periodEnd: "", periodType: "monthly",
  value: "", source: "", dataQuality: "good",
};

// ─── Variables Tab ────────────────────────────────────────────────────────────

function VariablesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_VAR_FORM });
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterActive, setFilterActive] = useState("all");

  const variablesKey = ["variables", filterCategory, filterActive];
  const { data: variables, isLoading } = useQuery<Variable[]>({
    queryKey: variablesKey,
    queryFn: () => apiFetch(token, "/api/variables"),
    enabled: !!token,
  });

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) =>
      editingId
        ? apiMutate(token, "PUT", `/api/variables/${editingId}`, data)
        : apiMutate(token, "POST", "/api/variables", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["variables"] });
      setOpen(false);
      toast({ title: editingId ? "Değişken güncellendi" : "Değişken eklendi" });
    },
    onError: (e: Error) => toast({ title: "Hata", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiMutate(token, "DELETE", `/api/variables/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["variables"] });
      toast({ title: "Değişken silindi" });
    },
    onError: (e: Error) => toast({ title: "Hata", description: e.message, variant: "destructive" }),
  });

  const toggleActive = (v: Variable) =>
    apiMutate(token, "PUT", `/api/variables/${v.id}`, { isActive: !v.isActive })
      .then(() => queryClient.invalidateQueries({ queryKey: ["variables"] }))
      .catch((e: Error) => toast({ title: "Hata", description: e.message, variant: "destructive" }));

  const openAdd = () => { setForm({ ...EMPTY_VAR_FORM }); setEditingId(null); setOpen(true); };
  const openEdit = (v: Variable) => {
    setForm({
      name: v.name, code: v.code ?? "", category: v.category,
      unitLabel: v.unitLabel ?? "", variableType: v.variableType,
      sourceType: v.sourceType, scopeType: v.scopeType,
      description: v.description ?? "", isActive: v.isActive,
    });
    setEditingId(v.id);
    setOpen(true);
  };

  const filtered = (variables ?? []).filter(v => {
    if (filterCategory !== "all" && v.category !== filterCategory) return false;
    if (filterActive === "active" && !v.isActive) return false;
    if (filterActive === "passive" && v.isActive) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-40 bg-background"><SelectValue placeholder="Kategori" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Kategoriler</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterActive} onValueChange={setFilterActive}>
          <SelectTrigger className="w-36 bg-background"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tümü</SelectItem>
            <SelectItem value="active">Aktif</SelectItem>
            <SelectItem value="passive">Pasif</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button onClick={openAdd} size="sm" className="bg-teal-600 hover:bg-teal-700">
            <Plus className="h-4 w-4 mr-1" /> Değişken Ekle
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-3">Ad</th>
                  <th className="text-left px-4 py-3">Kategori</th>
                  <th className="text-left px-4 py-3">Birim</th>
                  <th className="text-left px-4 py-3">Kaynak</th>
                  <th className="text-left px-4 py-3">Kapsam</th>
                  <th className="text-left px-4 py-3">Durum</th>
                  <th className="text-right px-4 py-3">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Değişken bulunamadı
                    </td>
                  </tr>
                )}
                {filtered.map(v => (
                  <tr key={v.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{v.name}</div>
                      {v.code && <div className="text-xs text-muted-foreground">{v.code}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-xs">{CATEGORY_LABELS[v.category] ?? v.category}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{v.unitLabel ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{SOURCE_LABELS[v.sourceType] ?? v.sourceType}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{SCOPE_LABELS[v.scopeType] ?? v.scopeType}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={v.isActive}
                          onCheckedChange={() => toggleActive(v)}
                          className="scale-75"
                        />
                        <span className={`text-xs ${v.isActive ? "text-teal-400" : "text-muted-foreground"}`}>
                          {v.isActive ? "Aktif" : "Pasif"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(v)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {!v.isSystemVariable && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => { if (confirm("Silinsin mi?")) deleteMutation.mutate(v.id); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingId ? "Değişken Düzenle" : "Yeni Değişken"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Değişken Adı *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Örn: Üretim Miktarı" />
              </div>
              <div className="space-y-1.5">
                <Label>Kod</Label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="Örn: PROD_QTY" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Kategori</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Ölçü Birimi</Label>
                <Input value={form.unitLabel} onChange={e => setForm(f => ({ ...f, unitLabel: e.target.value }))} placeholder="Örn: adet, saat, ton" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Veri Kaynağı</Label>
                <Select value={form.sourceType} onValueChange={v => setForm(f => ({ ...f, sourceType: v }))}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SOURCE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Kapsam</Label>
                <Select value={form.scopeType} onValueChange={v => setForm(f => ({ ...f, scopeType: v }))}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCOPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Açıklama</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Değişken açıklaması..." rows={2} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
              <Label>Aktif</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => saveMutation.mutate(form)}
              disabled={!form.name || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Values Tab ───────────────────────────────────────────────────────────────

function ValuesTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_VAL_FORM });
  const [filterVar, setFilterVar] = useState("all");

  const { data: variables } = useQuery<Variable[]>({
    queryKey: ["variables"],
    queryFn: () => apiFetch(token, "/api/variables"),
    enabled: !!token,
  });

  const { data: allUnits } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}) } });

  const subUnitsKey = ["sub-units", form.unitId];
  const { data: subUnits } = useQuery<SubUnit[]>({
    queryKey: subUnitsKey,
    queryFn: () => form.unitId
      ? apiFetch(token, `/api/sub-units?unitId=${form.unitId}`)
      : Promise.resolve([]),
    enabled: !!token && !!form.unitId,
  });

  const metersKey = ["meters", form.subUnitId];
  const { data: meters } = useQuery<Meter[]>({
    queryKey: metersKey,
    queryFn: () => form.subUnitId
      ? apiFetch(token, `/api/meters?subUnitId=${form.subUnitId}`)
      : (form.unitId ? apiFetch(token, `/api/meters?unitId=${form.unitId}`) : Promise.resolve([])),
    enabled: !!token && (!!form.unitId || !!form.subUnitId),
  });

  const valuesKey = ["variable-values", filterVar];
  const { data: values, isLoading } = useQuery<VariableValue[]>({
    queryKey: valuesKey,
    queryFn: () => {
      const p = new URLSearchParams();
      if (filterVar !== "all") p.set("variableId", filterVar);
      return apiFetch(token, `/api/variable-values?${p}`);
    },
    enabled: !!token,
  });

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) =>
      editingId
        ? apiMutate(token, "PUT", `/api/variable-values/${editingId}`, data)
        : apiMutate(token, "POST", "/api/variable-values", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["variable-values"] });
      setOpen(false);
      toast({ title: editingId ? "Değer güncellendi" : "Değer kaydedildi" });
    },
    onError: (e: Error) => toast({ title: "Hata", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiMutate(token, "DELETE", `/api/variable-values/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["variable-values"] });
      toast({ title: "Değer silindi" });
    },
    onError: (e: Error) => toast({ title: "Hata", description: e.message, variant: "destructive" }),
  });

  const openAdd = () => { setForm({ ...EMPTY_VAL_FORM }); setEditingId(null); setOpen(true); };
  const openEdit = (v: VariableValue) => {
    setForm({
      variableId: String(v.variableId), unitId: String(v.unitId ?? ""),
      subUnitId: String(v.subUnitId ?? ""), meterId: String(v.meterId ?? ""),
      periodStart: v.periodStart, periodEnd: v.periodEnd, periodType: v.periodType,
      value: String(v.value), source: v.source ?? "", dataQuality: v.dataQuality ?? "good",
    });
    setEditingId(v.id);
    setOpen(true);
  };

  const scopeLabel = (v: VariableValue) => {
    if (v.meterName) return `Sayaç: ${v.meterName}`;
    if (v.subUnitName) return `Alt Birim: ${v.subUnitName}`;
    if (v.unitName) return `Birim: ${v.unitName}`;
    return "Şirket";
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterVar} onValueChange={setFilterVar}>
          <SelectTrigger className="w-52 bg-background"><SelectValue placeholder="Değişken filtrele" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Değişkenler</SelectItem>
            {(variables ?? []).map(v => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button onClick={openAdd} size="sm" className="bg-teal-600 hover:bg-teal-700">
            <Plus className="h-4 w-4 mr-1" /> Değer Gir
          </Button>
        </div>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-3">Değişken</th>
                  <th className="text-left px-4 py-3">Dönem</th>
                  <th className="text-left px-4 py-3">Kapsam</th>
                  <th className="text-right px-4 py-3">Değer</th>
                  <th className="text-left px-4 py-3">Kalite</th>
                  <th className="text-right px-4 py-3">İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))}
                {!isLoading && (values ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Değer bulunamadı</td>
                  </tr>
                )}
                {(values ?? []).map(v => (
                  <tr key={v.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{v.variableName}</div>
                      {v.variableCode && <div className="text-xs text-muted-foreground">{v.variableCode}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {v.periodStart} → {v.periodEnd}
                      <div className="capitalize">{v.periodType}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{scopeLabel(v)}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium">
                      {v.value.toLocaleString("tr-TR")}
                      {v.variableUnitLabel && <span className="text-xs text-muted-foreground ml-1">{v.variableUnitLabel}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {v.dataQuality && (
                        <Badge variant="outline" className="text-xs">
                          {QUALITY_LABELS[v.dataQuality] ?? v.dataQuality}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(v)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => { if (confirm("Silinsin mi?")) deleteMutation.mutate(v.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingId ? "Değer Düzenle" : "Değer Gir"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Değişken *</Label>
              <Select value={form.variableId} onValueChange={v => setForm(f => ({ ...f, variableId: v }))}>
                <SelectTrigger className="bg-background"><SelectValue placeholder="Değişken seçin" /></SelectTrigger>
                <SelectContent>
                  {(variables ?? []).filter(v => v.isActive).map(v => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Dönem Başlangıç *</Label>
                <Input type="date" value={form.periodStart} onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Dönem Bitiş *</Label>
                <Input type="date" value={form.periodEnd} onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Dönem Tipi</Label>
                <Select value={form.periodType} onValueChange={v => setForm(f => ({ ...f, periodType: v }))}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Günlük</SelectItem>
                    <SelectItem value="monthly">Aylık</SelectItem>
                    <SelectItem value="yearly">Yıllık</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Değer *</Label>
                <Input type="number" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Kapsam: Birim</Label>
              <Select value={form.unitId || "none"} onValueChange={v => setForm(f => ({ ...f, unitId: v === "none" ? "" : v, subUnitId: "", meterId: "" }))}>
                <SelectTrigger className="bg-background"><SelectValue placeholder="Şirket geneli" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Şirket Geneli</SelectItem>
                  {(allUnits ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.unitId && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Alt Birim</Label>
                  <Select value={form.subUnitId || "none"} onValueChange={v => setForm(f => ({ ...f, subUnitId: v === "none" ? "" : v, meterId: "" }))}>
                    <SelectTrigger className="bg-background"><SelectValue placeholder="Tüm alt birimler" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Seçme</SelectItem>
                      {(subUnits ?? []).map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Sayaç</Label>
                  <Select value={form.meterId || "none"} onValueChange={v => setForm(f => ({ ...f, meterId: v === "none" ? "" : v }))}>
                    <SelectTrigger className="bg-background"><SelectValue placeholder="Tüm sayaçlar" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Seçme</SelectItem>
                      {(meters ?? []).map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Veri Kalitesi</Label>
                <Select value={form.dataQuality || "good"} onValueChange={v => setForm(f => ({ ...f, dataQuality: v }))}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(QUALITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Kaynak Notu</Label>
                <Input value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} placeholder="Veri kaynağı" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => saveMutation.mutate(form)}
              disabled={!form.variableId || !form.periodStart || !form.periodEnd || !form.value || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Climate Tab ──────────────────────────────────────────────────────────────

function ClimateTab() {
  const { token } = useAuth();
  const [filterProvince, setFilterProvince] = useState("all");

  const { data: climateData, isLoading } = useQuery<WeatherDegreeDay[]>({
    queryKey: ["weather-degree-days", filterProvince],
    queryFn: () => {
      const p = new URLSearchParams();
      if (filterProvince !== "all") p.set("province", filterProvince);
      return apiFetch(token, `/api/weather-degree-days?${p}`);
    },
    enabled: !!token,
  });

  const { data: meterList } = useQuery<Meter[]>({
    queryKey: ["meters"],
    queryFn: () => apiFetch(token, "/api/meters"),
    enabled: !!token,
  });

  const provinces = [...new Set((climateData ?? []).map(d => d.province))].sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterProvince} onValueChange={setFilterProvince}>
          <SelectTrigger className="w-44 bg-background"><SelectValue placeholder="İl filtrele" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm İller</SelectItem>
            {provinces.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground ml-2">
          {(climateData ?? []).length} kayıt
        </div>
      </div>

      {/* Meter → City info cards */}
      {(meterList ?? []).length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-2">
          {(meterList ?? []).slice(0, 6).map(m => (
            <Card key={m.id} className="bg-muted/30 border-border">
              <CardContent className="px-4 py-3 flex items-center gap-3">
                <CloudSun className="h-4 w-4 text-teal-400 shrink-0" />
                <div>
                  <div className="text-xs font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">{m.city}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-4 py-3">İl / İlçe</th>
                  <th className="text-left px-4 py-3">Dönem</th>
                  <th className="text-right px-4 py-3">HDD</th>
                  <th className="text-right px-4 py-3">CDD</th>
                  <th className="text-right px-4 py-3">Ort. Sıcaklık</th>
                  <th className="text-left px-4 py-3">Kaynak</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))}
                {!isLoading && (climateData ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      İklim verisi bulunamadı. Tüketim girişi yapıldığında HDD/CDD verileri burada görünür.
                    </td>
                  </tr>
                )}
                {(climateData ?? []).map(d => (
                  <tr key={d.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{d.province}</div>
                      {d.district && <div className="text-xs text-muted-foreground">{d.district}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{d.date}</td>
                    <td className="px-4 py-3 text-right font-mono text-blue-400">{d.hdd.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right font-mono text-orange-400">{d.cdd.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {d.avgTemperature != null ? `${d.avgTemperature.toFixed(1)}°C` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground uppercase">{d.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Variables() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Variable className="h-6 w-6 text-teal-400" />
        <div>
          <h1 className="text-xl font-semibold">Değişken Yönetimi</h1>
          <p className="text-sm text-muted-foreground">Enerji tüketimini etkileyen değişkenlerin takibi</p>
        </div>
      </div>

      <Tabs defaultValue="variables">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="variables" className="gap-2">
            <Variable className="h-4 w-4" /> Değişkenler
          </TabsTrigger>
          <TabsTrigger value="values" className="gap-2">
            <BarChart3 className="h-4 w-4" /> Değer Girişi
          </TabsTrigger>
          <TabsTrigger value="climate" className="gap-2">
            <CloudSun className="h-4 w-4" /> İklim Verileri
          </TabsTrigger>
        </TabsList>

        <TabsContent value="variables" className="mt-4">
          <VariablesTab />
        </TabsContent>
        <TabsContent value="values" className="mt-4">
          <ValuesTab />
        </TabsContent>
        <TabsContent value="climate" className="mt-4">
          <ClimateTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
