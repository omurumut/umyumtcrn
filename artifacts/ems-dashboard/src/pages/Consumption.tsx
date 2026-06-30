import { useState, useEffect } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useUnit } from "@/context/UnitContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Loader2, Building2, Upload, Download, FileSpreadsheet, FileText, CheckSquare, MapPin, Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useYear } from "@/context/YearContext";
import ConsumptionImport from "@/components/ConsumptionImport";
import * as XLSX from "xlsx";

const MONTHS = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
const TYPE_COLORS: Record<string, string> = {
  elektrik: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  dogalgaz: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  buhar: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  su: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  diger: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

interface EnergySource { id: number; type: string; name: string; unit: string; }
interface SubUnit { id: number; name: string; city: string; }
interface Meter { id: number; name: string; type: string; subUnitId?: number | null; energySourceId?: number | null; energyUseGroupId?: number | null; energyUseGroupName?: string | null; unit: string; city?: string; }

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

interface FormState {
  meterId: string; year: string; month: string;
  kwh: string; tep: string; co2: string; hdd: string; cdd: string; notes: string;
}
const EMPTY_FORM = (year: number): FormState => ({
  meterId: "", year: year.toString(), month: "1",
  kwh: "", tep: "", co2: "", hdd: "", cdd: "", notes: "",
});

export default function Consumption() {
  const { year } = useYear();
  const { user, token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterEnergySource, setFilterEnergySource] = useState("all");
  const [filterSubUnit, setFilterSubUnit] = useState("all");
  const [filterMeter, setFilterMeter] = useState("all");
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM(year));
  const [formEnergySource, setFormEnergySource] = useState("");
  const [formSubUnit, setFormSubUnit] = useState("");
  const [hddFetching, setHddFetching] = useState(false);
  const [mgmStation, setMgmStation] = useState<{
    name: string | null;
    note: string | null;
    dataMethod?: string;
    matchType?: string | null;
    matchedStationName?: string | null;
    stationFound?: boolean;
    fallbackStation?: { stationKey: string; stationName: string | null; hasData?: boolean } | null;
  } | null>(null);

  const { unitId } = useUnit();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  const esKey = ["energy-sources", unitId];
  const { data: energySources } = useQuery<EnergySource[]>({
    queryKey: esKey,
    queryFn: () => apiFetch(token, unitId !== null ? `/api/energy-sources?unitId=${unitId}` : "/api/energy-sources"),
    enabled: !!token,
  });

  const suKey = ["sub-units", unitId];
  const { data: subUnits } = useQuery<SubUnit[]>({
    queryKey: suKey,
    queryFn: () => apiFetch(token, unitId !== null ? `/api/sub-units?unitId=${unitId}` : "/api/sub-units"),
    enabled: !!token,
  });

  const metersKey = ["meters-all", unitId];
  const { data: allMeters } = useQuery<Meter[]>({
    queryKey: metersKey,
    queryFn: () => apiFetch(token, unitId !== null ? `/api/meters?unitId=${unitId}` : "/api/meters"),
    enabled: !!token,
  });

  const filteredSubUnitsBySource = filterEnergySource !== "all"
    ? (subUnits ?? []).filter(su =>
        (allMeters ?? []).some(m => m.subUnitId === su.id && m.energySourceId?.toString() === filterEnergySource)
      )
    : (subUnits ?? []);

  const filteredMeters = (allMeters ?? []).filter(m => {
    if (filterEnergySource !== "all" && m.energySourceId?.toString() !== filterEnergySource) return false;
    if (filterSubUnit !== "all" && m.subUnitId?.toString() !== filterSubUnit) return false;
    return true;
  });

  const formFilteredMeters = (allMeters ?? []).filter(m => {
    if (formEnergySource && m.energySourceId?.toString() !== formEnergySource) return false;
    if (formSubUnit && m.subUnitId?.toString() !== formSubUnit) return false;
    return true;
  });

  const consParams = new URLSearchParams();
  consParams.set("year", year.toString());
  if (filterMeter !== "all") consParams.set("meterId", filterMeter);
  const { data: records, isLoading } = useQuery<any[]>({
    queryKey: ["consumption", year, filterMeter, filterEnergySource, filterSubUnit],
    queryFn: () => apiFetch(token, `/api/consumption?${consParams}`),
    enabled: !!token,
  });

  const prevParams = new URLSearchParams();
  prevParams.set("year", (year - 1).toString());
  if (filterMeter !== "all") prevParams.set("meterId", filterMeter);
  const { data: prevRecords } = useQuery<any[]>({
    queryKey: ["consumption", year - 1, filterMeter, filterEnergySource, filterSubUnit],
    queryFn: () => apiFetch(token, `/api/consumption?${prevParams}`),
    enabled: !!token,
  });

  const prevMap: Record<number, Record<number, number>> = {};
  for (const r of Array.isArray(prevRecords) ? prevRecords : []) {
    if (!prevMap[r.meterId]) prevMap[r.meterId] = {};
    prevMap[r.meterId][r.month] = r.kwh ?? 0;
  }

  const filteredRecords = (Array.isArray(records) ? records : []).filter(r => {
    if (filterMeter !== "all") return r.meterId?.toString() === filterMeter;
    const m = (allMeters ?? []).find(m => m.id === r.meterId);
    if (!m) return false;
    if (filterEnergySource !== "all" && m.energySourceId?.toString() !== filterEnergySource) return false;
    if (filterSubUnit !== "all" && m.subUnitId?.toString() !== filterSubUnit) return false;
    return true;
  });

  const createC = useMutation({
    mutationFn: (d: any) => apiMutate(token, "POST", "/api/consumption", d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["consumption"] }); setOpen(false); toast({ title: "Veri eklendi" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });
  const updateC = useMutation({
    mutationFn: (d: any) => apiMutate(token, "PATCH", `/api/consumption/${editingId}`, d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["consumption"] }); setOpen(false); toast({ title: "Güncellendi" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });
  const deleteC = useMutation({
    mutationFn: (id: number) => apiMutate(token, "DELETE", `/api/consumption/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["consumption"] }); toast({ title: "Silindi" }); },
  });

  async function fetchHddCdd(city: string, year: string, month: string) {
    if (!city) return;
    setHddFetching(true);
    setMgmStation(null);
    try {
      const params = new URLSearchParams({ city, year, month });
      const res = await fetch(`/api/mgm/lookup?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        const method = data.weatherDataMethod ?? data.dataMethod ?? "station_not_found";
        // Yalnızca resmi aylık veri geldiğinde hdd/cdd alanlarını doldur
        if (method === "official_monthly" && data.hdd != null && data.cdd != null) {
          setForm(f => ({ ...f, hdd: data.hdd.toString(), cdd: data.cdd.toString() }));
        } else {
          // Diğer durumlarda hdd/cdd alanlarını boş bırak (0 yazma)
          setForm(f => ({ ...f, hdd: "", cdd: "" }));
        }
        setMgmStation({
          name: data.stationName ?? null,
          note: data.note ?? null,
          dataMethod: method,
          matchType: data.matchType ?? null,
          matchedStationName: data.matchedStationName ?? null,
          stationFound: data.stationFound ?? false,
          fallbackStation: data.fallbackStation ?? null,
        });
      }
    } catch {}
    setHddFetching(false);
  }

  function openCreate() {
    setEditingId(null);
    setMgmStation(null);
    setFormEnergySource(filterEnergySource !== "all" ? filterEnergySource : "");
    setFormSubUnit(filterSubUnit !== "all" ? filterSubUnit : "");
    setForm({ ...EMPTY_FORM(year), meterId: filterMeter !== "all" ? filterMeter : "" });
    setOpen(true);
  }

  function openEdit(r: any) {
    const m = (allMeters ?? []).find(m => m.id === r.meterId);
    setEditingId(r.id);
    setMgmStation(r.weatherStationName ? { name: r.weatherStationName, note: r.weatherStationNote ?? null, dataMethod: "official_monthly" } : null);
    setFormEnergySource(m?.energySourceId?.toString() ?? "");
    setFormSubUnit(m?.subUnitId?.toString() ?? "");
    setForm({ meterId: r.meterId.toString(), year: r.year.toString(), month: r.month.toString(), kwh: r.kwh.toString(), tep: r.tep.toString(), co2: r.co2.toString(), hdd: r.hdd?.toString() ?? "", cdd: r.cdd?.toString() ?? "", notes: r.notes ?? "" });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const m = (allMeters ?? []).find(m => m.id.toString() === form.meterId);
    if (m?.city && !form.hdd && !form.cdd && !editingId) {
      fetchHddCdd(m.city, form.year, form.month);
    }
  }, [form.meterId]);

  useEffect(() => {
    if (!open || !form.meterId) return;
    const m = (allMeters ?? []).find(m => m.id.toString() === form.meterId);
    if (m?.city) fetchHddCdd(m.city, form.year, form.month);
  }, [form.month, form.year]);

  function handleKwhChange(v: string) {
    const kwh = parseFloat(v) || 0;
    const meter = (allMeters ?? []).find(m => m.id.toString() === form.meterId);
    const type = meter?.type ?? "elektrik";
    const tepFactor = type === "elektrik" ? 0.000086 : type === "dogalgaz" ? 0.00086 : 0.000086;
    const co2Factor = type === "elektrik" ? 0.4 : type === "dogalgaz" ? 0.202 : 0.4;
    setForm(f => ({ ...f, kwh: v, tep: (kwh * tepFactor).toFixed(4), co2: (kwh * co2Factor).toFixed(2) }));
  }

  function handleSave() {
    const data: any = {
      meterId: parseInt(form.meterId), year: parseInt(form.year), month: parseInt(form.month),
      kwh: parseFloat(form.kwh) || 0, tep: parseFloat(form.tep) || 0, co2: parseFloat(form.co2) || 0,
    };
    if (form.hdd) data.hdd = parseFloat(form.hdd);
    if (form.cdd) data.cdd = parseFloat(form.cdd);
    if (form.notes) data.notes = form.notes;
    if (!data.meterId) { toast({ title: "Sayaç seçin", variant: "destructive" }); return; }
    editingId !== null ? updateC.mutate(data) : createC.mutate(data);
  }

  const getSourceName = (meterId: number) => {
    const m = (allMeters ?? []).find(m => m.id === meterId);
    if (!m) return null;
    const es = (energySources ?? []).find(s => s.id === m.energySourceId);
    return es?.name ?? m.type;
  };

  const getSubUnitName = (meterId: number) => {
    const m = (allMeters ?? []).find(m => m.id === meterId);
    if (!m || !m.subUnitId) return null;
    return (subUnits ?? []).find(s => s.id === m.subUnitId)?.name ?? null;
  };

  const getGroupName = (meterId: number) => {
    const m = (allMeters ?? []).find(m => m.id === meterId);
    return m?.energyUseGroupName ?? null;
  };

  function buildExportRows() {
    return filteredRecords.map((r: any) => {
      const m = (allMeters ?? []).find(m => m.id === r.meterId);
      const src = (energySources ?? []).find(s => s.id === m?.energySourceId);
      const su = (subUnits ?? []).find(s => s.id === m?.subUnitId);
      return {
        "Kaynak": src?.name ?? m?.type ?? "",
        "Kullanım Grubu": m?.energyUseGroupName ?? "",
        "Alt Birim": su?.name ?? "",
        "Sayaç": r.meterName ?? "",
        "Yıl": r.year,
        "Ay": MONTHS[(r.month ?? 1) - 1],
        [`Tüketim (${m?.unit ?? "kWh"})`]: r.kwh ?? 0,
        "TEP": r.tep ?? 0,
        "CO2 (ton)": r.co2 ?? 0,
        "HDD": r.hdd ?? "",
        "CDD": r.cdd ?? "",
        "Not": r.notes ?? "",
      };
    });
  }

  const allVisibleIds = filteredRecords.map((r: any) => r.id);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id: number) => selectedIds.has(id));
  const someSelected = allVisibleIds.some((id: number) => selectedIds.has(id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVisibleIds));
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`${selectedIds.size} kayıt kalıcı olarak silinsin mi?`)) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    let failed = 0;
    await Promise.all(ids.map(id =>
      apiMutate(token, "DELETE", `/api/consumption/${id}`).catch(() => { failed++; })
    ));
    await queryClient.invalidateQueries({ queryKey: ["consumption"] });
    setSelectedIds(new Set());
    setBulkDeleting(false);
    if (failed === 0) {
      toast({ title: `${ids.length} kayıt silindi` });
    } else {
      toast({ title: `${ids.length - failed} silindi, ${failed} başarısız`, variant: "destructive" });
    }
  }

  function exportExcel() {
    const rows = buildExportRows();
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tüketim");
    XLSX.writeFile(wb, `tuketim_${year}.xlsx`);
  }

  function exportCsv() {
    const rows = buildExportRows();
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const lines = [
      headers.join(";"),
      ...rows.map(row => headers.map(h => {
        const v = (row as any)[h];
        const s = String(v ?? "");
        return s.includes(";") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(";")),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tuketim_${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tüketim Verileri</h1>
          <p className="text-sm text-muted-foreground mt-1">{year} yılı enerji tüketim kayıtları</p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2" disabled={filteredRecords.length === 0}>
                <Download className="h-4 w-4" /> Dışa Aktar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportExcel} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="h-4 w-4 text-emerald-400" /> Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportCsv} className="gap-2 cursor-pointer">
                <FileText className="h-4 w-4 text-blue-400" /> CSV (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" onClick={() => setImportOpen(true)} className="gap-2"><Upload className="h-4 w-4" /> Toplu İçe Aktar</Button>
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Veri Ekle</Button>
        </div>
      </div>

      {isAdmin && unitId === null ? (
        <Card><CardContent className="py-16 flex flex-col items-center text-muted-foreground">
          <Building2 className="h-10 w-10 mb-3 opacity-30" />
          <p className="font-medium">Birim seçilmedi</p>
          <p className="text-sm mt-1">Üst menüden bir birim seçerek tüketim verilerini görüntüleyin</p>
        </CardContent></Card>
      ) : (<>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterEnergySource} onValueChange={v => { setFilterEnergySource(v); setFilterSubUnit("all"); setFilterMeter("all"); }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Enerji kaynağı" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Kaynaklar</SelectItem>
            {(energySources ?? []).map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSubUnit} onValueChange={v => { setFilterSubUnit(v); setFilterMeter("all"); }}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Alt birim" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Alt Birimler</SelectItem>
            {filteredSubUnitsBySource.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterMeter} onValueChange={setFilterMeter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Sayaç" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Sayaçlar</SelectItem>
            {filteredMeters.map(m => <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filteredRecords.length} kayıt</span>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 ml-auto bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-1.5">
            <CheckSquare className="h-4 w-4 text-destructive" />
            <span className="text-sm font-medium text-destructive">{selectedIds.size} kayıt seçildi</span>
            <Button
              size="sm" variant="destructive" className="h-7 gap-1.5 text-xs"
              onClick={handleBulkDelete} disabled={bulkDeleting}
            >
              {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Seçilenleri Sil
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>
              Seçimi Kaldır
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      data-state={someSelected && !allSelected ? "indeterminate" : undefined}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Tümünü seç"
                    />
                  </TableHead>
                  <TableHead>Kaynak</TableHead>
                  <TableHead>Grup</TableHead>
                  <TableHead>Alt Birim</TableHead>
                  <TableHead>Sayaç</TableHead>
                  <TableHead>Ay</TableHead>
                  <TableHead className="text-right">Tüketim</TableHead>
                  <TableHead className="text-right">TEP</TableHead>
                  <TableHead className="text-right">CO₂ (ton)</TableHead>
                  <TableHead className="text-right">HDD</TableHead>
                  <TableHead className="text-right">CDD</TableHead>
                  <TableHead className="text-right">YoY %</TableHead>
                  <TableHead className="text-right w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecords.length === 0 ? (
                  <TableRow><TableCell colSpan={13} className="text-center py-10 text-muted-foreground">Kayıt bulunamadı. Veri ekleyin.</TableCell></TableRow>
                ) : filteredRecords.map((r: any) => {
                  const srcName = getSourceName(r.meterId);
                  const suName = getSubUnitName(r.meterId);
                  const grpName = getGroupName(r.meterId);
                  const m = (allMeters ?? []).find(m => m.id === r.meterId);
                  const isSelected = selectedIds.has(r.id);
                  return (
                    <TableRow key={r.id} className={isSelected ? "bg-destructive/5" : undefined}>
                      <TableCell>
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(r.id)} aria-label="Satırı seç" />
                      </TableCell>
                      <TableCell>
                        {srcName && <Badge className={`text-xs ${TYPE_COLORS[m?.type ?? "diger"]}`} variant="outline">{srcName}</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{grpName ?? <span className="opacity-40">—</span>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{suName ?? "—"}</TableCell>
                      <TableCell className="font-medium text-sm">{r.meterName ?? "—"}</TableCell>
                      <TableCell className="text-sm">{MONTHS[(r.month ?? 1) - 1]}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{(r.kwh ?? 0).toLocaleString("tr-TR")} <span className="text-xs text-muted-foreground">{m?.unit}</span></TableCell>
                      <TableCell className="text-right font-mono text-sm">{(r.tep ?? 0).toFixed(4)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{(r.co2 ?? 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-sm">
                        {r.hdd != null ? (
                          <span className="group relative">
                            {r.hdd}
                            {r.weatherStationName && (
                              <span className="ml-1 inline-flex items-center text-muted-foreground/50 cursor-default" title={r.weatherStationNote ? `${r.weatherStationName} — ${r.weatherStationNote}` : r.weatherStationName}>
                                <MapPin className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm">{r.cdd != null ? r.cdd : "—"}</TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {(() => {
                          const prev = prevMap[r.meterId]?.[r.month];
                          if (prev === undefined || prev === null) return <span className="text-muted-foreground opacity-40">—</span>;
                          if (prev === 0) return <span className="text-muted-foreground opacity-40">—</span>;
                          const pct = ((r.kwh - prev) / prev) * 100;
                          const abs = Math.abs(pct).toFixed(1);
                          if (pct > 0) return <span className="text-red-400">▲ {abs}%</span>;
                          if (pct < 0) return <span className="text-emerald-400">▼ {abs}%</span>;
                          return <span className="text-muted-foreground">= 0%</span>;
                        })()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => deleteC.mutate(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {filteredRecords.length > 0 && (() => {
                const totalKwh = filteredRecords.reduce((s, r) => s + (r.kwh ?? 0), 0);
                const totalTep = filteredRecords.reduce((s, r) => s + (r.tep ?? 0), 0);
                const totalCo2 = filteredRecords.reduce((s, r) => s + (r.co2 ?? 0), 0);
                return (
                  <TableFooter>
                    <TableRow className="font-semibold text-sm bg-muted/30">
                      <TableCell />
                      <TableCell colSpan={5} className="text-muted-foreground text-xs">
                        TOPLAM ({filteredRecords.length} kayıt)
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {totalKwh.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {totalTep.toFixed(4)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {totalCo2.toFixed(2)}
                      </TableCell>
                      <TableCell colSpan={4} />
                    </TableRow>
                  </TableFooter>
                );
              })()}
            </Table>
          )}
        </CardContent>
      </Card>
      </>)}

      <ConsumptionImport open={importOpen} onOpenChange={setImportOpen} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId !== null ? "Veri Düzenle" : "Tüketim Verisi Ekle"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>1. Enerji Kaynağı *</Label>
              <Select value={formEnergySource} onValueChange={v => { setFormEnergySource(v); setFormSubUnit(""); setForm(f => ({ ...f, meterId: "" })); }}>
                <SelectTrigger><SelectValue placeholder="Kaynak seçin" /></SelectTrigger>
                <SelectContent>
                  {(energySources ?? []).map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {formEnergySource && (
              <div className="space-y-1.5">
                <Label>2. Alt Birim / Lokasyon</Label>
                <Select value={formSubUnit || "all_sub"} onValueChange={v => { setFormSubUnit(v === "all_sub" ? "" : v); setForm(f => ({ ...f, meterId: "" })); }}>
                  <SelectTrigger><SelectValue placeholder="Alt birim seçin" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all_sub">Tümü</SelectItem>
                    {(subUnits ?? [])
                      .filter(su => (allMeters ?? []).some(m => m.subUnitId === su.id && m.energySourceId?.toString() === formEnergySource))
                      .map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formEnergySource && (
              <div className="space-y-1.5">
                <Label>3. Sayaç *</Label>
                <Select value={form.meterId} onValueChange={v => setForm(f => ({ ...f, meterId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Sayaç seçin" /></SelectTrigger>
                  <SelectContent>
                    {formFilteredMeters.map(m => <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Yıl</Label>
                <Input value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Ay</Label>
                <Select value={form.month} onValueChange={v => setForm(f => ({ ...f, month: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i + 1} value={(i + 1).toString()}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Tüketim *</Label>
                <Input type="number" value={form.kwh} onChange={e => handleKwhChange(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>TEP</Label>
                <Input type="number" value={form.tep} onChange={e => setForm(f => ({ ...f, tep: e.target.value }))} placeholder="Otomatik" />
              </div>
              <div className="space-y-1.5">
                <Label>CO₂ (ton)</Label>
                <Input type="number" value={form.co2} onChange={e => setForm(f => ({ ...f, co2: e.target.value }))} placeholder="Otomatik" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-2">
                  HDD
                  {hddFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                </Label>
                <Input type="number" value={form.hdd} onChange={e => setForm(f => ({ ...f, hdd: e.target.value }))} placeholder="Otomatik" />
              </div>
              <div className="space-y-1.5">
                <Label>CDD</Label>
                <Input type="number" value={form.cdd} onChange={e => setForm(f => ({ ...f, cdd: e.target.value }))} placeholder="Otomatik" />
              </div>
            </div>
            {form.meterId && (
              <div className="space-y-1.5">
                {mgmStation ? (
                  <div className={`rounded-md border px-3 py-2 space-y-1 ${
                    mgmStation.dataMethod === "official_monthly"
                      ? "border-emerald-600/30 bg-emerald-950/20"
                      : mgmStation.dataMethod === "no_official_data"
                      ? "border-amber-600/30 bg-amber-950/20"
                      : mgmStation.dataMethod === "district_station_not_found"
                      ? "border-orange-600/30 bg-orange-950/20"
                      : "border-destructive/30 bg-destructive/10"
                  }`}>
                    {/* official_monthly */}
                    {mgmStation.dataMethod === "official_monthly" && (
                      <div className="flex items-center gap-1.5 text-xs flex-wrap">
                        <MapPin className="h-3 w-3 shrink-0 text-emerald-400" />
                        <span className="font-medium text-emerald-300">Resmi MGM HDD/CDD verisi alındı:</span>
                        <span className="text-foreground/80">{mgmStation.name}</span>
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-emerald-600 text-emerald-400 ml-1">Resmi Aylık</Badge>
                      </div>
                    )}
                    {/* no_official_data */}
                    {mgmStation.dataMethod === "no_official_data" && (
                      <div className="flex items-start gap-1.5 text-xs text-amber-400">
                        <Info className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>
                          {mgmStation.name
                            ? <>MGM merkezi bulundu (<strong>{mgmStation.name}</strong>) ancak seçilen dönem için resmi HDD/CDD verisi yok.</>
                            : "MGM merkezi bulundu ancak seçilen dönem için resmi HDD/CDD verisi yok."}
                        </span>
                      </div>
                    )}
                    {/* district_station_not_found */}
                    {mgmStation.dataMethod === "district_station_not_found" && (
                      <div className="flex items-start gap-1.5 text-xs text-orange-400">
                        <Info className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>
                          Girilen ilçe için MGM merkezi bulunamadı. İl merkezi alternatif olarak önerildi ancak otomatik kullanılmadı.
                          {mgmStation.fallbackStation?.stationName && (
                            <> Öneri: <strong>{mgmStation.fallbackStation.stationName}</strong></>
                          )}
                        </span>
                      </div>
                    )}
                    {/* station_not_found */}
                    {mgmStation.dataMethod === "station_not_found" && (
                      <div className="flex items-start gap-1.5 text-xs text-destructive">
                        <Info className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>Sayaç lokasyonu için MGM merkezi bulunamadı.</span>
                      </div>
                    )}
                    {/* alias / fuzzy bilgi mesajı */}
                    {(mgmStation.matchType === "alias" || mgmStation.matchType === "fuzzy") && mgmStation.dataMethod === "official_monthly" && (
                      <div className="flex items-start gap-1.5 text-xs text-blue-400/90">
                        <Info className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>
                          Girilen sayaç lokasyonu MGM kayıtlarında farklı yazımla eşleşti: <strong>{mgmStation.matchedStationName ?? mgmStation.name}</strong>
                          {mgmStation.matchType === "fuzzy" && mgmStation.dataMethod === "official_monthly" && <> (fuzzy)</>}.
                        </span>
                      </div>
                    )}
                    {/* genel not */}
                    {mgmStation.note && mgmStation.matchType !== "alias" && mgmStation.matchType !== "fuzzy" && (
                      <div className="flex items-start gap-1.5 text-xs text-muted-foreground/80">
                        <Info className="h-3 w-3 shrink-0 mt-0.5" />
                        <span>{mgmStation.note}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    HDD/CDD sayaç lokasyonuna ({(allMeters ?? []).find(m => m.id.toString() === form.meterId)?.city ?? "?"}) göre MGM Gün Derece Havuzu'ndan otomatik çekilir.
                    {hddFetching && <span className="ml-1 text-primary">Yükleniyor...</span>}
                  </p>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Not</Label>
              <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="İsteğe bağlı" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createC.isPending || updateC.isPending}>{editingId !== null ? "Güncelle" : "Ekle"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
