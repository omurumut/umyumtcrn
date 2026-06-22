import { useState, useEffect, useRef } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import { useCompany } from "@/context/CompanyContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Gauge, MapPin, CloudLightning, Layers, Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { parseIlIlce, buildCityValue } from "@/data/turkiyeIlIlce";
import { IlIlceSelector } from "@/components/ui/IlIlceSelector";
import * as XLSX from "xlsx";

const TYPE_COLORS: Record<string, string> = {
  elektrik: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  dogalgaz: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  buhar: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  su: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  diger: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const GROUP_TYPES = [
  { value: "production", label: "Üretim" },
  { value: "building", label: "Bina" },
  { value: "utility", label: "Yardımcı Hizmet" },
  { value: "vehicle", label: "Araç" },
  { value: "process", label: "Proses" },
  { value: "hvac", label: "HVAC" },
  { value: "lighting", label: "Aydınlatma" },
  { value: "other", label: "Diğer" },
];

interface SubUnit { id: number; name: string; city: string; }
interface EnergySource { id: number; type: string; name: string; unit: string; }
interface EnergyUseGroup { id: number; name: string; groupType: string; isActive: boolean; }

// UI'da kullanıcıya gösterilen 2 seçenek; backend'e uiRecordType olarak gönderilir
const UI_RECORD_TYPES = [
  { value: "measurement", label: "Ölçüm Noktası", description: "Fiziksel veya sanal sayaç" },
  { value: "manual", label: "Manuel / Fatura / Tahmini Tüketim", description: "Fatura bazlı, manuel veya hesaplanan tüketim" },
] as const;

// DB'deki 5 tip → UI 2 seçeneğe dönüştürme
function dbToUiRecordType(rt: string | null | undefined): "measurement" | "manual" {
  if (!rt) return "measurement";
  return ["invoice_based", "manual_consumption_point", "calculated"].includes(rt) ? "manual" : "measurement";
}

// Liste ekranında gösterilecek sade etiket
function uiRecordTypeLabel(rt: string | null | undefined): string {
  return dbToUiRecordType(rt) === "manual" ? "Manuel Tüketim Noktası" : "Ölçüm Noktası";
}

interface MeterForm {
  name: string; type: string; energySourceId: string; subUnitId: string;
  location: string; city: string; il: string; ilce: string;
  unit: string; description: string;
  unitId: string; energyUseGroupId: string;
  uiRecordType: "measurement" | "manual";
}
const EMPTY_FORM: MeterForm = {
  name: "", type: "elektrik", energySourceId: "", subUnitId: "",
  location: "", city: "İstanbul", il: "İstanbul", ilce: "",
  unit: "kWh", description: "",
  unitId: "", energyUseGroupId: "",
  uiRecordType: "measurement",
};

interface QuickGroupForm {
  name: string; groupType: string;
}
const EMPTY_QUICK_GROUP: QuickGroupForm = { name: "", groupType: "other" };

const apiFetch = (token: string | null, url: string) =>
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(r => r.ok ? r.json() : r.json().then((e: any) => {
      const err: any = new Error(e.error ?? "İstek başarısız");
      err.status = r.status;
      throw err;
    }));

const apiMutate = (token: string | null, method: string, url: string, body?: unknown) =>
  fetch(url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    .then(r => r.ok ? (r.status === 204 ? null : r.json()) : r.json().then((e: any) => { throw new Error(e.error); }));

export default function Meters() {
  const { user, token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<MeterForm>(EMPTY_FORM);
  const [filterSubUnit, setFilterSubUnit] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hızlı grup oluşturma modali
  const [quickGroupOpen, setQuickGroupOpen] = useState(false);
  const [quickGroupForm, setQuickGroupForm] = useState<QuickGroupForm>(EMPTY_QUICK_GROUP);

  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const isSuperAdmin = user?.role === "superadmin";
  const effectiveUnitId = isAdmin ? undefined : (user?.unitId ?? undefined);
  const { companyId } = useCompany();

  const { data: allUnits } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}) } });
  const [selectedAdminUnit, setSelectedAdminUnit] = useState<string>("");

  const workingUnitId = isAdmin ? (selectedAdminUnit ? parseInt(selectedAdminUnit) : undefined) : effectiveUnitId;
  const effectiveCompanyId = isSuperAdmin && !workingUnitId ? companyId : undefined;

  const subUnitsKey = ["sub-units", workingUnitId, effectiveCompanyId];
  const { data: subUnits } = useQuery<SubUnit[]>({
    queryKey: subUnitsKey,
    queryFn: () => {
      if (workingUnitId) return apiFetch(token, `/api/sub-units?unitId=${workingUnitId}`);
      if (effectiveCompanyId) return apiFetch(token, `/api/sub-units?companyId=${effectiveCompanyId}`);
      return apiFetch(token, "/api/sub-units");
    },
    enabled: workingUnitId !== undefined || effectiveCompanyId !== null || !isAdmin,
  });

  const energySourcesKey = ["energy-sources", workingUnitId, effectiveCompanyId];
  const { data: energySources } = useQuery<EnergySource[]>({
    queryKey: energySourcesKey,
    queryFn: () => {
      if (workingUnitId) return apiFetch(token, `/api/energy-sources?unitId=${workingUnitId}`);
      if (effectiveCompanyId) return apiFetch(token, `/api/energy-sources?companyId=${effectiveCompanyId}`);
      return apiFetch(token, "/api/energy-sources");
    },
    enabled: workingUnitId !== undefined || effectiveCompanyId !== null || !isAdmin,
  });

  const energyUseGroupsKey = ["energy-use-groups-active"];
  const { data: energyUseGroups, refetch: refetchGroups } = useQuery<EnergyUseGroup[]>({
    queryKey: energyUseGroupsKey,
    queryFn: () => apiFetch(token, "/api/energy-use-groups?isActive=true"),
    enabled: !!token,
  });

  const metersKey = ["meters", workingUnitId, effectiveCompanyId, filterSubUnit, filterSource];
  const { data: meters, isLoading } = useQuery<any[]>({
    queryKey: metersKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (workingUnitId) params.set("unitId", workingUnitId.toString());
      else if (effectiveCompanyId) params.set("companyId", effectiveCompanyId.toString());
      if (filterSubUnit !== "all") params.set("subUnitId", filterSubUnit);
      if (filterSource !== "all") params.set("energySourceId", filterSource);
      return apiFetch(token, `/api/meters?${params}`);
    },
    enabled: workingUnitId !== undefined || effectiveCompanyId !== null || !isAdmin,
  });

  const createMut = useMutation({
    mutationFn: (d: MeterForm) => apiMutate(token, "POST", "/api/meters", {
      name: d.name, type: d.type, location: d.location, city: d.city, unit: d.unit,
      description: d.description || undefined,
      unitId: d.unitId || workingUnitId,
      subUnitId: d.subUnitId || undefined,
      energySourceId: d.energySourceId || undefined,
      energyUseGroupId: d.energyUseGroupId || undefined,
      uiRecordType: d.uiRecordType,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["meters"] }); setOpen(false); toast({ title: "Sayaç eklendi" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (d: MeterForm) => apiMutate(token, "PATCH", `/api/meters/${editing}`, {
      name: d.name, type: d.type, location: d.location, city: d.city, unit: d.unit,
      description: d.description || undefined,
      subUnitId: d.subUnitId || null,
      energySourceId: d.energySourceId || null,
      energyUseGroupId: d.energyUseGroupId || null,
      uiRecordType: d.uiRecordType,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["meters"] }); setOpen(false); toast({ title: "Sayaç güncellendi" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => apiMutate(token, "DELETE", `/api/meters/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["meters"] }); toast({ title: "Sayaç silindi" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const quickGroupMut = useMutation({
    mutationFn: (d: QuickGroupForm) => apiMutate(token, "POST", "/api/energy-use-groups", {
      name: d.name, groupType: d.groupType,
    }),
    onSuccess: async (newGroup: any) => {
      await refetchGroups();
      setForm(f => ({ ...f, energyUseGroupId: newGroup.id.toString() }));
      setQuickGroupOpen(false);
      setQuickGroupForm(EMPTY_QUICK_GROUP);
      toast({ title: "Grup oluşturuldu ve seçildi" });
    },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditing(null);
    const chosenSubUnit = subUnits?.find(s => s.id.toString() === filterSubUnit);
    const chosenSource = energySources?.find(s => s.id.toString() === filterSource);
    const rawCity = chosenSubUnit?.city ?? "İstanbul";
    const parsed = parseIlIlce(rawCity);
    setForm({
      ...EMPTY_FORM,
      unitId: workingUnitId?.toString() ?? "",
      subUnitId: filterSubUnit !== "all" ? filterSubUnit : "",
      city: rawCity,
      il: parsed.il || "İstanbul",
      ilce: parsed.ilce,
      energySourceId: filterSource !== "all" ? filterSource : "",
      type: chosenSource?.type ?? "elektrik",
      unit: chosenSource?.unit ?? "kWh",
    });
    setOpen(true);
  }

  function openEdit(m: any) {
    setEditing(m.id);
    const rawCity = m.city ?? "İstanbul";
    const parsed = parseIlIlce(rawCity);
    setForm({
      name: m.name, type: m.type,
      energySourceId: m.energySourceId?.toString() ?? "",
      subUnitId: m.subUnitId?.toString() ?? "",
      location: m.location ?? "", city: rawCity,
      il: parsed.il || "İstanbul", ilce: parsed.ilce,
      unit: m.unit, description: m.description ?? "",
      unitId: m.unitId?.toString() ?? "",
      energyUseGroupId: m.energyUseGroupId?.toString() ?? "",
      uiRecordType: dbToUiRecordType(m.recordType),
    });
    setOpen(true);
  }

  function handleSubUnitChange(v: string) {
    const su = subUnits?.find(s => s.id.toString() === v);
    if (su?.city) {
      const parsed = parseIlIlce(su.city);
      setForm(f => ({ ...f, subUnitId: v, city: su.city, il: parsed.il || f.il, ilce: parsed.ilce }));
    } else {
      setForm(f => ({ ...f, subUnitId: v }));
    }
  }

  function handleEnergySourceChange(v: string) {
    const es = energySources?.find(s => s.id.toString() === v);
    setForm(f => ({ ...f, energySourceId: v, type: es?.type ?? f.type, unit: es?.unit ?? f.unit }));
  }

  function handleSave() {
    if (!form.name) { toast({ title: "Sayaç adı zorunludur", variant: "destructive" }); return; }
    const city = buildCityValue(form.il, form.ilce);
    const formWithCity = { ...form, city };
    editing !== null ? updateMut.mutate(formWithCity) : createMut.mutate(formWithCity);
  }

  function handleQuickGroupSave() {
    if (!quickGroupForm.name.trim()) { toast({ title: "Grup adı zorunludur", variant: "destructive" }); return; }
    quickGroupMut.mutate(quickGroupForm);
  }

  function handleExport() {
    if (!filteredMeters.length) { toast({ title: "Dışa aktarılacak sayaç yok", variant: "destructive" }); return; }
    const rows = filteredMeters.map((m: any) => {
      const parsed = parseIlIlce(m.city ?? "");
      return {
        "Sayaç Adı": m.name,
        "Kayıt Tipi": dbToUiRecordType(m.recordType) === "manual" ? "manuel" : "olcum",
        "Enerji Kaynağı": m.energySourceName ?? "",
        "Alt Birim": m.subUnitName ?? "",
        "Enerji Kullanım Grubu": m.energyUseGroupName ?? "",
        "İl": parsed.il || m.city || "",
        "İlçe": parsed.ilce || "",
        "Açıklama": m.description ?? "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sayaçlar");
    XLSX.writeFile(wb, "sayaclar.xlsx");
    toast({ title: `${rows.length} sayaç dışa aktarıldı` });
  }

  function downloadTemplate() {
    const rows = [
      {
        "Sayaç Adı": "Ana Elektrik Panosu",
        "Kayıt Tipi": "olcum",
        "Enerji Kaynağı": (energySources ?? [])[0]?.name ?? "",
        "Alt Birim": (subUnits ?? [])[0]?.name ?? "",
        "Enerji Kullanım Grubu": "",
        "İl": "İstanbul",
        "İlçe": "Beşiktaş",
        "Açıklama": "İsteğe bağlı açıklama",
      },
    ];
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Şablon");
    XLSX.writeFile(wb, "sayac_sablonu.xlsx");
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportResult(null);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws) as any[];
      if (!rows.length) { setImportResult({ success: 0, errors: ["Dosyada veri satırı bulunamadı"] }); setImporting(false); return; }

      let success = 0;
      const errors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const name = row["Sayaç Adı"]?.toString().trim();
        if (!name) { errors.push(`Satır ${rowNum}: "Sayaç Adı" sütunu boş`); continue; }

        const esName = row["Enerji Kaynağı"]?.toString().trim();
        const es = esName ? (energySources ?? []).find((s: EnergySource) => s.name === esName) : undefined;

        const suName = row["Alt Birim"]?.toString().trim();
        const su = suName ? (subUnits ?? []).find((s: SubUnit) => s.name === suName) : undefined;

        const eugName = row["Enerji Kullanım Grubu"]?.toString().trim();
        const eug = eugName ? (energyUseGroups ?? []).find((g: EnergyUseGroup) => g.name === eugName) : undefined;

        const uiRecordType = row["Kayıt Tipi"]?.toString().trim() === "manuel" ? "manual" : "measurement";
        const il = row["İl"]?.toString().trim() || "İstanbul";
        const ilce = row["İlçe"]?.toString().trim() || "";
        const city = buildCityValue(il, ilce);

        try {
          await apiMutate(token, "POST", "/api/meters", {
            name,
            type: es?.type ?? "diger",
            unit: es?.unit ?? "kWh",
            city,
            description: row["Açıklama"]?.toString().trim() || undefined,
            unitId: workingUnitId,
            subUnitId: su?.id || undefined,
            energySourceId: es?.id || undefined,
            energyUseGroupId: eug?.id || undefined,
            uiRecordType,
          });
          success++;
        } catch (e: any) {
          errors.push(`Satır ${rowNum} (${name}): ${e.message}`);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["meters"] });
      setImportResult({ success, errors });
    } catch {
      setImportResult({ success: 0, errors: ["Dosya okunamadı veya desteklenmeyen format"] });
    } finally {
      setImporting(false);
    }
  }

  const filteredMeters = meters ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sayaç Yönetimi</h1>
          <p className="text-sm text-muted-foreground mt-1">Enerji ölçüm cihazlarını yönetin</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={!filteredMeters.length}>
            <Download className="h-4 w-4" /> Dışa Aktar
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { setImportResult(null); setImportOpen(true); }} disabled={workingUnitId === undefined && isAdmin}>
            <Upload className="h-4 w-4" /> İçe Aktar
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ""; }} />
          <Button onClick={openCreate} className="gap-2" disabled={workingUnitId === undefined && isAdmin}>
            <Plus className="h-4 w-4" /> Yeni Sayaç
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {isAdmin && (
          <Select value={selectedAdminUnit} onValueChange={setSelectedAdminUnit}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Birim seçin..." />
            </SelectTrigger>
            <SelectContent>
              {(allUnits ?? []).map((u: any) => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={filterSubUnit} onValueChange={setFilterSubUnit}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Alt birim" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Alt Birimler</SelectItem>
            {(subUnits ?? []).map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Enerji kaynağı" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Kaynaklar</SelectItem>
            {(energySources ?? []).map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filteredMeters.length} sayaç</span>
      </div>

      {isAdmin && !workingUnitId ? (
        <Card><CardContent className="py-12 flex flex-col items-center text-muted-foreground">
          <Gauge className="h-10 w-10 mb-3 opacity-20" />
          <p>Sayaçları görmek için bir birim seçin</p>
        </CardContent></Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : filteredMeters.length === 0 ? (
        <Card><CardContent className="py-16 flex flex-col items-center text-muted-foreground">
          <Gauge className="h-10 w-10 mb-3 opacity-30" />
          <p className="font-medium">Sayaç bulunamadı</p>
          <Button className="mt-4 gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> Sayaç Ekle</Button>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMeters.map((m: any) => (
            <Card key={m.id} className="group">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 mr-2">
                    <h3 className="font-semibold text-sm truncate">{m.name}</h3>
                    {m.subUnitName && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <MapPin className="h-3 w-3" /><span>{m.subUnitName}</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">{m.location}</p>
                  </div>
                  <Badge className={`text-xs shrink-0 ${TYPE_COLORS[m.type] ?? TYPE_COLORS.diger}`} variant="outline">
                    {m.energySourceName ?? m.type}
                  </Badge>
                </div>
                {m.energyUseGroupName && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <Layers className="h-3 w-3 shrink-0" />
                    <span className="truncate">{m.energyUseGroupName}</span>
                  </div>
                )}
                {!m.energyUseGroupName && (
                  <div className="text-xs text-muted-foreground/50 mb-1">Grup yok</div>
                )}
                <div className="mb-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    dbToUiRecordType(m.recordType) === "manual"
                      ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                      : "bg-teal-500/10 text-teal-400 border-teal-500/20"
                  }`}>
                    {uiRecordTypeLabel(m.recordType)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded font-mono">{m.unit}</span>
                    {m.city && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <CloudLightning className="h-3 w-3" />{m.city}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => { if (confirm("Sayaç silinsin mi?")) deleteMut.mutate(m.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                {m.description && <p className="text-xs text-muted-foreground mt-2 truncate">{m.description}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Sayaç Oluştur / Düzenle Dialogu */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing !== null ? "Sayaç Düzenle" : "Yeni Sayaç Ekle"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {(energySources ?? []).length > 0 && (
              <div className="space-y-1.5">
                <Label>Enerji Kaynağı *</Label>
                <Select value={form.energySourceId} onValueChange={handleEnergySourceChange}>
                  <SelectTrigger><SelectValue placeholder="Enerji kaynağı seçin" /></SelectTrigger>
                  <SelectContent>
                    {(energySources ?? []).map(s => (
                      <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(subUnits ?? []).length > 0 && (
              <div className="space-y-1.5">
                <Label>Alt Birim / Lokasyon</Label>
                <Select value={form.subUnitId || "none"} onValueChange={v => handleSubUnitChange(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Alt birim seçin" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(subUnits ?? []).map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Enerji Kullanım Grubu</Label>
              <div className="flex gap-2">
                <Select
                  value={form.energyUseGroupId || "none"}
                  onValueChange={v => setForm(f => ({ ...f, energyUseGroupId: v === "none" ? "" : v }))}
                >
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Grup seçin (opsiyonel)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(energyUseGroups ?? []).map(g => (
                      <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button" variant="outline" size="sm" className="shrink-0 gap-1 px-2"
                  onClick={() => { setQuickGroupForm(EMPTY_QUICK_GROUP); setQuickGroupOpen(true); }}
                >
                  <Plus className="h-3.5 w-3.5" /> Yeni
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Kayıt Tipi *</Label>
              <Select value={form.uiRecordType} onValueChange={v => setForm(f => ({ ...f, uiRecordType: v as "measurement" | "manual" }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UI_RECORD_TYPES.map(rt => (
                    <SelectItem key={rt.value} value={rt.value}>
                      <div>
                        <div className="font-medium text-sm">{rt.label}</div>
                        <div className="text-xs text-muted-foreground">{rt.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Sayaç Adı *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ör. Ana Elektrik Panosu" />
            </div>
            <IlIlceSelector
              il={form.il}
              ilce={form.ilce}
              onIlChange={v => setForm(f => ({ ...f, il: v, ilce: "" }))}
              onIlceChange={v => setForm(f => ({ ...f, ilce: v }))}
              ilLabel="İl (HDD/CDD için)"
            />
            <div className="space-y-1.5">
              <Label>Açıklama</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="İsteğe bağlı" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>{editing !== null ? "Güncelle" : "Ekle"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* İçe Aktarma Dialogu */}
      <Dialog open={importOpen} onOpenChange={o => { if (!importing) setImportOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Excel ile Toplu Sayaç İçe Aktar</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {!importResult ? (
              <>
                <p className="text-sm text-muted-foreground">Şablonu indirip doldurun, ardından dosyayı yükleyin. Sütunlar: <span className="font-mono text-xs">Sayaç Adı, Kayıt Tipi, Enerji Kaynağı, Alt Birim, Enerji Kullanım Grubu, İl, İlçe, Açıklama</span></p>
                <div className="bg-muted/40 rounded-lg p-3 text-xs space-y-1">
                  <p><span className="font-medium">Kayıt Tipi:</span> <code>olcum</code> veya <code>manuel</code></p>
                  <p><span className="font-medium">Enerji Kaynağı / Alt Birim:</span> sistemdeki isimle tam eşleşmeli</p>
                  <p><span className="font-medium">İl / İlçe:</span> Türkiye il/ilçe adları</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-2 flex-1" onClick={downloadTemplate}>
                    <Download className="h-4 w-4" /> Şablon İndir (.xlsx)
                  </Button>
                  <Button size="sm" className="gap-2 flex-1" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                    <Upload className="h-4 w-4" /> {importing ? "Yükleniyor..." : "Dosya Seç & Yükle"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                {importResult.success > 0 && (
                  <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span><strong>{importResult.success}</strong> sayaç başarıyla eklendi</span>
                  </div>
                )}
                {importResult.errors.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{importResult.errors.length} satırda hata</span>
                    </div>
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-destructive/20 bg-destructive/5 p-2 space-y-1">
                      {importResult.errors.map((e, i) => <p key={i} className="text-xs text-destructive/80">{e}</p>)}
                    </div>
                  </div>
                )}
                <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> Başka Dosya Yükle
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>Kapat</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Hızlı Grup Oluşturma Modali */}
      <Dialog open={quickGroupOpen} onOpenChange={setQuickGroupOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Hızlı Grup Oluştur</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Grup Adı *</Label>
              <Input
                value={quickGroupForm.name}
                onChange={e => setQuickGroupForm(f => ({ ...f, name: e.target.value }))}
                placeholder="ör. Kazan Dairesi"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Grup Tipi</Label>
              <Select value={quickGroupForm.groupType} onValueChange={v => setQuickGroupForm(f => ({ ...f, groupType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GROUP_TYPES.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickGroupOpen(false)}>İptal</Button>
            <Button onClick={handleQuickGroupSave} disabled={quickGroupMut.isPending}>Oluştur ve Seç</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
