import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useYear } from "@/context/YearContext";
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
import { Plus, Pencil, Trash2, Variable, BarChart3, Download, Upload, FileSpreadsheet, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import VariableValueImport from "@/components/VariableValueImport";

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
  operational: "Operasyonel",
  production: "Üretim",
  calculated: "Hesaplanan",
  other: "Diğer",
};

const SOURCE_LABELS: Record<string, string> = {
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

interface SubUnit { id: number; name: string; }
interface Meter { id: number; name: string; city: string; }

type VariableTabValue = "variables" | "values";

interface ValuesDeepLinkSelection {
  tab: VariableTabValue | null;
  year?: number;
  unitId?: number;
  variableId?: number;
}

const EMPTY_VAR_FORM = {
  name: "", code: "", category: "operational", unitLabel: "", variableType: "numeric",
  sourceType: "operation_manual", scopeType: "company", description: "", isActive: true,
};

const EMPTY_VAL_FORM = {
  variableId: "", unitId: "", subUnitId: "", meterId: "",
  periodStart: "", periodEnd: "", periodType: "monthly",
  value: "", source: "", dataQuality: "good",
};

function parsePositiveIntParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseYearParam(value: string | null): number | undefined {
  const parsed = parsePositiveIntParam(value);
  return parsed !== undefined && parsed >= 2000 && parsed <= 2100 ? parsed : undefined;
}

function isAdminLike(role: string | undefined): boolean {
  return role === "admin" || role === "kontrol_admin";
}

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
    if (v.isSystemVariable) return false;
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
                <Input maxLength={255} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Örn: Üretim Miktarı" />
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

function ValuesTab({ deepLink }: { deepLink: ValuesDeepLinkSelection }) {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canUseUnitFilter = isAdminLike(user?.role);

  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_VAL_FORM });
  const [filterVar, setFilterVar] = useState("all");
  const [filterYear, setFilterYear] = useState(deepLink.year ? String(deepLink.year) : "");
  const [filterUnitId, setFilterUnitId] = useState("all");
  const [highlightedVariableId, setHighlightedVariableId] = useState<number | null>(deepLink.variableId ?? null);
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const highlightedRowRef = useRef<HTMLTableRowElement | null>(null);

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

  const valuesKey = ["variable-values", filterVar, canUseUnitFilter ? filterUnitId : "all"];
  const { data: values, isLoading } = useQuery<VariableValue[]>({
    queryKey: valuesKey,
    queryFn: () => {
      const p = new URLSearchParams();
      if (filterVar !== "all") p.set("variableId", filterVar);
      if (canUseUnitFilter && filterUnitId !== "all") p.set("unitId", filterUnitId);
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

  // Seçili değişkenin scopeType'ını türet
  const selectedVar = (variables ?? []).find(v => String(v.id) === form.variableId);
  const scopeType = selectedVar?.scopeType ?? "company";

  const SCOPE_HINTS: Record<string, string> = {
    company: "Bu değişken şirket genelinde geçerlidir; birim/alt birim/sayaç seçimi gerekmez.",
    unit: "Bu değişken birim kapsamındadır. Hangi birim için veri girdiğinizi seçin (zorunlu).",
    sub_unit: "Bu değişken alt birim kapsamındadır. Birim ve alt birim seçimi zorunludur.",
    meter: "Bu değişken sayaç kapsamındadır. Birim, alt birim ve sayaç seçimi zorunludur.",
  };

  const scopeMissing =
    (scopeType === "unit"     && !form.unitId) ||
    (scopeType === "sub_unit" && (!form.unitId || !form.subUnitId)) ||
    (scopeType === "meter"    && (!form.unitId || !form.subUnitId || !form.meterId));

  useEffect(() => {
    if (deepLinkApplied) return;
    if (deepLink.variableId !== undefined && variables === undefined) return;
    if (canUseUnitFilter && deepLink.unitId !== undefined && allUnits === undefined) return;

    if (deepLink.year !== undefined) {
      setFilterYear(String(deepLink.year));
    }

    const unitExists = deepLink.unitId !== undefined
      && canUseUnitFilter
      && (allUnits ?? []).some((unit: any) => unit.id === deepLink.unitId);
    if (unitExists) {
      setFilterUnitId(String(deepLink.unitId));
    }

    if (deepLink.variableId !== undefined) {
      const variable = (variables ?? []).find((candidate) => candidate.id === deepLink.variableId);
      if (variable?.isActive && !variable.isSystemVariable) {
        const variableId = String(variable.id);
        setFilterVar(variableId);
        setHighlightedVariableId(variable.id);
        setForm((current) => ({
          ...current,
          variableId,
          unitId: unitExists && variable.scopeType !== "company" ? String(deepLink.unitId) : current.unitId,
        }));
      } else {
        setHighlightedVariableId(null);
      }
    }

    setDeepLinkApplied(true);
  }, [allUnits, canUseUnitFilter, deepLink, deepLinkApplied, variables]);

  const activeYearFilter = /^\d{4}$/.test(filterYear.trim()) ? filterYear.trim() : "";
  const visibleValues = useMemo(
    () => (values ?? []).filter((value) => {
      if (activeYearFilter && !value.periodStart.startsWith(`${activeYearFilter}-`)) return false;
      return true;
    }),
    [activeYearFilter, values],
  );

  useEffect(() => {
    if (!deepLinkApplied || highlightedVariableId === null) return;
    const target = highlightedRowRef.current ?? toolbarRef.current;
    window.setTimeout(() => {
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }, [deepLinkApplied, highlightedVariableId, visibleValues.length]);

  function handleExportExcel() {
    const rows = visibleValues.map(v => ({
      "Değişken": v.variableName ?? "",
      "Kod": v.variableCode ?? "",
      "Birim": v.unitName ?? "Şirket",
      "Alt Birim": v.subUnitName ?? "",
      "Sayaç": v.meterName ?? "",
      "Dönem Başlangıç": v.periodStart,
      "Dönem Bitiş": v.periodEnd,
      "Dönem Tipi": v.periodType,
      "Değer": v.value,
      "Birim Etiketi": v.variableUnitLabel ?? "",
      "Veri Kalitesi": v.dataQuality ?? "",
      "Kaynak": (v as any).source ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Değişken Değerleri");
    XLSX.writeFile(wb, "degisken_degerleri.xlsx");
  }

  function handleExportCsv() {
    const rows = visibleValues.map(v => ({
      "Değişken": v.variableName ?? "",
      "Kod": v.variableCode ?? "",
      "Birim": v.unitName ?? "Şirket",
      "Alt Birim": v.subUnitName ?? "",
      "Dönem Başlangıç": v.periodStart,
      "Dönem Bitiş": v.periodEnd,
      "Değer": v.value,
      "Birim Etiketi": v.variableUnitLabel ?? "",
    }));
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const lines = [
      headers.join(";"),
      ...rows.map(row => headers.map(h => {
        const s = String((row as any)[h] ?? "");
        return s.includes(";") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(";")),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "degisken_degerleri.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const openAdd = () => {
    const nextForm = { ...EMPTY_VAL_FORM };
    if (filterVar !== "all") {
      nextForm.variableId = filterVar;
      const variable = (variables ?? []).find((candidate) => String(candidate.id) === filterVar);
      if (canUseUnitFilter && filterUnitId !== "all" && variable?.scopeType !== "company") {
        nextForm.unitId = filterUnitId;
      }
    }
    setForm(nextForm);
    setEditingId(null);
    setOpen(true);
  };
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
        <span ref={toolbarRef} className="sr-only" />
        <Input
          className="w-28 bg-background"
          inputMode="numeric"
          maxLength={4}
          placeholder="Yıl"
          value={filterYear}
          onChange={(event) => setFilterYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
        />
        {canUseUnitFilter && (
          <Select value={filterUnitId} onValueChange={setFilterUnitId}>
            <SelectTrigger className="w-48 bg-background"><SelectValue placeholder="Birim" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm Birimler</SelectItem>
              {(allUnits ?? []).map((unit: any) => (
                <SelectItem key={unit.id} value={String(unit.id)}>{unit.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" disabled={visibleValues.length === 0}>
                <Download className="h-4 w-4" /> Dışa Aktar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportExcel} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="h-4 w-4 text-emerald-400" /> Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportCsv} className="gap-2 cursor-pointer">
                <FileText className="h-4 w-4 text-blue-400" /> CSV (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} className="gap-2">
            <Upload className="h-4 w-4" /> Toplu İçe Aktar
          </Button>
          <Button onClick={openAdd} size="sm" className="bg-teal-600 hover:bg-teal-700">
            <Plus className="h-4 w-4 mr-1" /> Değer Gir
          </Button>
        </div>
      </div>

      <VariableValueImport open={importOpen} onOpenChange={setImportOpen} />

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
                {!isLoading && visibleValues.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Değer bulunamadı</td>
                  </tr>
                )}
                {visibleValues.map(v => {
                  const isHighlighted = highlightedVariableId === v.variableId;
                  return (
                  <tr
                    key={v.id}
                    ref={isHighlighted ? highlightedRowRef : undefined}
                    className={`border-b border-border/50 transition-colors ${isHighlighted ? "bg-teal-950/30 ring-1 ring-inset ring-teal-500/60" : "hover:bg-muted/30"}`}
                  >
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
                  );
                })}
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
              <Select
                value={form.variableId}
                onValueChange={v => setForm(f => ({ ...f, variableId: v, unitId: "", subUnitId: "", meterId: "" }))}
              >
                <SelectTrigger className="bg-background"><SelectValue placeholder="Değişken seçin" /></SelectTrigger>
                <SelectContent>
                  {(variables ?? []).filter(v => v.isActive && !v.isSystemVariable).map(v => (
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
            {/* Kapsam bilgi kutusu */}
            {form.variableId && (
              <div className={`rounded-md border px-3 py-2 text-xs ${
                scopeType === "company"
                  ? "border-border bg-muted/40 text-muted-foreground"
                  : "border-teal-700/50 bg-teal-950/30 text-teal-300"
              }`}>
                <span className="font-medium mr-1">Kapsam: {SCOPE_LABELS[scopeType] ?? scopeType} —</span>
                {SCOPE_HINTS[scopeType]}
              </div>
            )}

            {/* Birim seçimi: company kapsamında gizle */}
            {scopeType !== "company" && (
              <div className="space-y-1.5">
                <Label>
                  Birim
                  {(scopeType === "unit" || scopeType === "sub_unit" || scopeType === "meter") && (
                    <span className="text-destructive ml-0.5">*</span>
                  )}
                </Label>
                <Select
                  value={form.unitId || "none"}
                  onValueChange={v => setForm(f => ({ ...f, unitId: v === "none" ? "" : v, subUnitId: "", meterId: "" }))}
                >
                  <SelectTrigger className="bg-background"><SelectValue placeholder="Birim seçin" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Seçin —</SelectItem>
                    {(allUnits ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Alt Birim: sub_unit veya meter kapsamında, birim seçildikten sonra */}
            {(scopeType === "sub_unit" || scopeType === "meter") && form.unitId && (
              <div className="space-y-1.5">
                <Label>
                  Alt Birim<span className="text-destructive ml-0.5">*</span>
                </Label>
                <Select
                  value={form.subUnitId || "none"}
                  onValueChange={v => setForm(f => ({ ...f, subUnitId: v === "none" ? "" : v, meterId: "" }))}
                >
                  <SelectTrigger className="bg-background"><SelectValue placeholder="Alt birim seçin" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Seçin —</SelectItem>
                    {(subUnits ?? []).map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Sayaç: yalnızca meter kapsamında, alt birim seçildikten sonra */}
            {scopeType === "meter" && form.subUnitId && (
              <div className="space-y-1.5">
                <Label>
                  Sayaç<span className="text-destructive ml-0.5">*</span>
                </Label>
                <Select
                  value={form.meterId || "none"}
                  onValueChange={v => setForm(f => ({ ...f, meterId: v === "none" ? "" : v }))}
                >
                  <SelectTrigger className="bg-background"><SelectValue placeholder="Sayaç seçin" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Seçin —</SelectItem>
                    {(meters ?? []).map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
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
              disabled={!form.variableId || !form.periodStart || !form.periodEnd || !form.value || scopeMissing || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Variables() {
  const { setYear } = useYear();
  const [deepLink] = useState<ValuesDeepLinkSelection>(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") === "values" ? "values" : null;
    return {
      tab,
      year: parseYearParam(params.get("year")),
      unitId: parsePositiveIntParam(params.get("unitId")),
      variableId: parsePositiveIntParam(params.get("variableId")),
    };
  });
  const [activeTab, setActiveTab] = useState<VariableTabValue>(deepLink.tab === "values" ? "values" : "variables");

  useEffect(() => {
    if (deepLink.year !== undefined) {
      setYear(deepLink.year);
    }
  }, [deepLink.year, setYear]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Variable className="h-6 w-6 text-teal-400" />
        <div>
          <h1 className="text-xl font-semibold">Değişken Yönetimi</h1>
          <p className="text-sm text-muted-foreground">Enerji tüketimini etkileyen değişkenlerin takibi</p>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-md border border-blue-800/40 bg-blue-950/20 px-4 py-3 text-xs text-blue-300">
        <span className="mt-0.5 shrink-0 text-blue-400">ℹ</span>
        <span>
          <strong className="text-blue-200">HDD ve CDD iklim verileri sistem tarafından otomatik yönetilir.</strong>{" "}
          Tüketim verisi girilirken sayaç lokasyonuna göre MGM verisi otomatik alınır ve EnPI / regresyon analizlerinde kullanılır.
          Bu nedenle HDD/CDD manuel değişken listesinde gösterilmez.
        </span>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as VariableTabValue)}>
        <TabsList className="bg-muted/50">
          <TabsTrigger value="variables" className="gap-2">
            <Variable className="h-4 w-4" /> Değişkenler
          </TabsTrigger>
          <TabsTrigger value="values" className="gap-2">
            <BarChart3 className="h-4 w-4" /> Değer Girişi
          </TabsTrigger>
        </TabsList>

        <TabsContent value="variables" className="mt-4">
          <VariablesTab />
        </TabsContent>
        <TabsContent value="values" className="mt-4">
          <ValuesTab deepLink={deepLink} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
