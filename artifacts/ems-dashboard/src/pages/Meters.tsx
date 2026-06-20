import { useState, useEffect } from "react";
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
import { Plus, Pencil, Trash2, Gauge, MapPin, CloudLightning, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const UNITS = ["kWh", "m3", "ton", "litre", "MWh", "GJ"];
const CITIES = [
  "Adana","Ankara","Antalya","Bursa","Diyarbakır","Eskişehir",
  "Gaziantep","İstanbul","İzmir","Kayseri","Kocaeli","Konya","Mersin","Samsun","Trabzon",
];
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

interface MeterForm {
  name: string; type: string; energySourceId: string; subUnitId: string;
  location: string; city: string; unit: string; description: string;
  unitId: string; energyUseGroupId: string;
}
const EMPTY_FORM: MeterForm = {
  name: "", type: "elektrik", energySourceId: "", subUnitId: "",
  location: "", city: "İstanbul", unit: "kWh", description: "",
  unitId: "", energyUseGroupId: "",
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
    setForm({
      ...EMPTY_FORM,
      unitId: workingUnitId?.toString() ?? "",
      subUnitId: filterSubUnit !== "all" ? filterSubUnit : "",
      city: chosenSubUnit?.city ?? "İstanbul",
      energySourceId: filterSource !== "all" ? filterSource : "",
      type: chosenSource?.type ?? "elektrik",
      unit: chosenSource?.unit ?? "kWh",
    });
    setOpen(true);
  }

  function openEdit(m: any) {
    setEditing(m.id);
    setForm({
      name: m.name, type: m.type,
      energySourceId: m.energySourceId?.toString() ?? "",
      subUnitId: m.subUnitId?.toString() ?? "",
      location: m.location, city: m.city ?? "İstanbul",
      unit: m.unit, description: m.description ?? "",
      unitId: m.unitId?.toString() ?? "",
      energyUseGroupId: m.energyUseGroupId?.toString() ?? "",
    });
    setOpen(true);
  }

  function handleSubUnitChange(v: string) {
    const su = subUnits?.find(s => s.id.toString() === v);
    setForm(f => ({ ...f, subUnitId: v, city: su?.city ?? f.city }));
  }

  function handleEnergySourceChange(v: string) {
    const es = energySources?.find(s => s.id.toString() === v);
    setForm(f => ({ ...f, energySourceId: v, type: es?.type ?? f.type, unit: es?.unit ?? f.unit }));
  }

  function handleSave() {
    if (!form.name || !form.location) { toast({ title: "Ad ve lokasyon zorunludur", variant: "destructive" }); return; }
    editing !== null ? updateMut.mutate(form) : createMut.mutate(form);
  }

  function handleQuickGroupSave() {
    if (!quickGroupForm.name.trim()) { toast({ title: "Grup adı zorunludur", variant: "destructive" }); return; }
    quickGroupMut.mutate(quickGroupForm);
  }

  const filteredMeters = meters ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sayaç Yönetimi</h1>
          <p className="text-sm text-muted-foreground mt-1">Enerji ölçüm cihazlarını yönetin</p>
        </div>
        <Button onClick={openCreate} className="gap-2" disabled={workingUnitId === undefined && isAdmin}>
          <Plus className="h-4 w-4" /> Yeni Sayaç
        </Button>
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
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                    <Layers className="h-3 w-3 shrink-0" />
                    <span className="truncate">{m.energyUseGroupName}</span>
                  </div>
                )}
                {!m.energyUseGroupName && (
                  <div className="text-xs text-muted-foreground/50 mb-2">Grup yok</div>
                )}
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
              <Label>Sayaç Adı *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ör. Ana Elektrik Panosu" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Lokasyon *</Label>
                <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="ör. A Blok - Zemin Kat" />
              </div>
              <div className="space-y-1.5">
                <Label>Şehir (HDD/CDD)</Label>
                <Select value={form.city} onValueChange={v => setForm(f => ({ ...f, city: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Ölçü Birimi *</Label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Açıklama</Label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="İsteğe bağlı" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>{editing !== null ? "Güncelle" : "Ekle"}</Button>
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
