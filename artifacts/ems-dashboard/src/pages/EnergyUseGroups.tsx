import { useState } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Layers, Power, PowerOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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

const GROUP_TYPE_COLORS: Record<string, string> = {
  production: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  building: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  utility: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  vehicle: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  process: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  hvac: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  lighting: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  other: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

function groupTypeLabel(v: string) {
  return GROUP_TYPES.find(g => g.value === v)?.label ?? v;
}

interface SubUnit { id: number; name: string; }
interface EnergySource { id: number; name: string; type: string; }

interface GroupForm {
  name: string; code: string; groupType: string;
  energySourceId: string; unitId: string; subUnitId: string;
  description: string; isSeuCandidate: boolean; isActive: boolean;
}

const EMPTY_FORM: GroupForm = {
  name: "", code: "", groupType: "other",
  energySourceId: "", unitId: "", subUnitId: "",
  description: "", isSeuCandidate: false, isActive: true,
};

const apiFetch = (token: string | null, url: string) =>
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(r => r.ok ? r.json() : r.json().then((e: any) => { throw new Error(e.error ?? "İstek başarısız"); }));

const apiMutate = (token: string | null, method: string, url: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.ok ? (r.status === 204 ? null : r.json()) : r.json().then((e: any) => { throw new Error(e.error); }));

export default function EnergyUseGroups() {
  const { token } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { companyId } = useCompany();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<GroupForm>(EMPTY_FORM);
  const [filterGroupType, setFilterGroupType] = useState("all");
  const [filterUnit, setFilterUnit] = useState("all");
  const [filterSource, setFilterSource] = useState("all");
  const [filterActive, setFilterActive] = useState("all");

  const { data: allUnits } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}) } });

  const subUnitsKey = ["sub-units", form.unitId];
  const { data: subUnits } = useQuery<SubUnit[]>({
    queryKey: subUnitsKey,
    queryFn: () => form.unitId
      ? apiFetch(token, `/api/sub-units?unitId=${form.unitId}`)
      : apiFetch(token, "/api/sub-units"),
    enabled: !!token,
  });

  const { data: energySources } = useQuery<EnergySource[]>({
    queryKey: ["energy-sources"],
    queryFn: () => apiFetch(token, "/api/energy-sources"),
    enabled: !!token,
  });

  const groupsKey = ["energy-use-groups", filterGroupType, filterUnit, filterSource, filterActive, companyId];
  const { data: groups, isLoading } = useQuery<any[]>({
    queryKey: groupsKey,
    queryFn: () => {
      const p = new URLSearchParams();
      if (filterActive !== "all") p.set("isActive", filterActive);
      if (filterGroupType !== "all") p.set("groupType", filterGroupType);
      if (filterUnit !== "all") p.set("unitId", filterUnit);
      if (filterSource !== "all") p.set("energySourceId", filterSource);
      if (companyId) p.set("companyId", companyId.toString());
      return apiFetch(token, `/api/energy-use-groups?${p}`);
    },
    enabled: !!token,
  });

  const createMut = useMutation({
    mutationFn: (d: GroupForm) => apiMutate(token, "POST", "/api/energy-use-groups", {
      name: d.name, code: d.code || undefined, groupType: d.groupType,
      energySourceId: d.energySourceId || undefined,
      unitId: d.unitId || undefined, subUnitId: d.subUnitId || undefined,
      description: d.description || undefined,
      isSeuCandidate: d.isSeuCandidate, isActive: d.isActive,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["energy-use-groups"] }); setOpen(false); toast({ title: "Grup oluşturuldu" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (d: GroupForm) => apiMutate(token, "PUT", `/api/energy-use-groups/${editingId}`, {
      name: d.name, code: d.code || undefined, groupType: d.groupType,
      energySourceId: d.energySourceId || undefined,
      unitId: d.unitId || undefined, subUnitId: d.subUnitId || undefined,
      description: d.description || undefined,
      isSeuCandidate: d.isSeuCandidate, isActive: d.isActive,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["energy-use-groups"] }); setOpen(false); toast({ title: "Grup güncellendi" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiMutate(token, "PATCH", `/api/energy-use-groups/${id}/status`, { isActive }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["energy-use-groups"] }); toast({ title: "Durum güncellendi" }); },
    onError: (e: any) => toast({ title: e.message, variant: "destructive" }),
  });

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(g: any) {
    setEditingId(g.id);
    setForm({
      name: g.name, code: g.code ?? "",
      groupType: g.groupType,
      energySourceId: g.energySourceId?.toString() ?? "",
      unitId: g.unitId?.toString() ?? "",
      subUnitId: g.subUnitId?.toString() ?? "",
      description: g.description ?? "",
      isSeuCandidate: g.isSeuCandidate ?? false,
      isActive: g.isActive ?? true,
    });
    setOpen(true);
  }

  function handleSave() {
    if (!form.name.trim()) { toast({ title: "Grup adı zorunludur", variant: "destructive" }); return; }
    if (!form.groupType) { toast({ title: "Grup tipi zorunludur", variant: "destructive" }); return; }
    editingId !== null ? updateMut.mutate(form) : createMut.mutate(form);
  }

  function handleUnitChange(v: string) {
    setForm(f => ({ ...f, unitId: v === "none" ? "" : v, subUnitId: "" }));
  }

  const displayedGroups = groups ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Enerji Kullanım Grupları</h1>
          <p className="text-sm text-muted-foreground mt-1">ISO 50001 analizi için enerji kullanım gruplarını yönetin</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Yeni Grup
        </Button>
      </div>

      {/* Filtreler */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterActive} onValueChange={setFilterActive}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Durum" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Durumlar</SelectItem>
            <SelectItem value="true">Aktif</SelectItem>
            <SelectItem value="false">Pasif</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterGroupType} onValueChange={setFilterGroupType}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Grup tipi" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Tipler</SelectItem>
            {GROUP_TYPES.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterUnit} onValueChange={setFilterUnit}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Birim" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Birimler</SelectItem>
            {(allUnits ?? []).map((u: any) => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Enerji kaynağı" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Kaynaklar</SelectItem>
            {(energySources ?? []).map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{displayedGroups.length} grup</span>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : displayedGroups.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-muted-foreground">
            <Layers className="h-10 w-10 mb-3 opacity-30" />
            <p className="font-medium">Enerji kullanım grubu bulunamadı</p>
            <Button className="mt-4 gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> Grup Ekle</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayedGroups.map((g: any) => (
            <Card key={g.id} className={`group transition-opacity ${!g.isActive ? "opacity-60" : ""}`}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-sm truncate">{g.name}</h3>
                      {!g.isActive && (
                        <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded shrink-0">Pasif</span>
                      )}
                    </div>
                    {g.code && <p className="text-xs text-muted-foreground font-mono mt-0.5">{g.code}</p>}
                  </div>
                  <Badge
                    className={`text-xs shrink-0 ${GROUP_TYPE_COLORS[g.groupType] ?? GROUP_TYPE_COLORS.other}`}
                    variant="outline"
                  >
                    {groupTypeLabel(g.groupType)}
                  </Badge>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  {g.energySourceName && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0" />
                      <span>{g.energySourceName}</span>
                    </div>
                  )}
                  {(g.unitName || g.subUnitName) && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      <span>{[g.unitName, g.subUnitName].filter(Boolean).join(" / ")}</span>
                    </div>
                  )}
                  {g.description && (
                    <p className="truncate pt-0.5">{g.description}</p>
                  )}
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/40">
                  <div className="flex items-center gap-2">
                    {g.isSeuCandidate && (
                      <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded">
                        ÖEK Adayı
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {g.meterCount ?? 0} sayaç
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm" variant="ghost" className="h-7 w-7 p-0"
                      title={g.isActive ? "Pasifleştir" : "Aktifleştir"}
                      onClick={() => statusMut.mutate({ id: g.id, isActive: !g.isActive })}
                    >
                      {g.isActive
                        ? <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />
                        : <Power className="h-3.5 w-3.5 text-emerald-400" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(g)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Oluştur / Düzenle Dialogu */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "Grubu Düzenle" : "Yeni Enerji Kullanım Grubu"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Grup Adı *</Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="ör. Kazan Dairesi"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Kısa Kod</Label>
                <Input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                  placeholder="ör. KD-01"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Grup Tipi *</Label>
              <Select value={form.groupType} onValueChange={v => setForm(f => ({ ...f, groupType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GROUP_TYPES.map(g => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Enerji Kaynağı</Label>
              <Select value={form.energySourceId || "none"} onValueChange={v => setForm(f => ({ ...f, energySourceId: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Seçin (opsiyonel)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {(energySources ?? []).map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Bağlı Birim</Label>
                <Select value={form.unitId || "none"} onValueChange={handleUnitChange}>
                  <SelectTrigger><SelectValue placeholder="Seçin (opsiyonel)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(allUnits ?? []).map((u: any) => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Alt Birim</Label>
                <Select
                  value={form.subUnitId || "none"}
                  onValueChange={v => setForm(f => ({ ...f, subUnitId: v === "none" ? "" : v }))}
                  disabled={!form.unitId}
                >
                  <SelectTrigger><SelectValue placeholder="Seçin (opsiyonel)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(subUnits ?? []).map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Açıklama</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="İsteğe bağlı"
              />
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="seu-candidate"
                  checked={form.isSeuCandidate}
                  onCheckedChange={v => setForm(f => ({ ...f, isSeuCandidate: v }))}
                />
                <Label htmlFor="seu-candidate" className="cursor-pointer">ÖEK Adayı</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="is-active"
                  checked={form.isActive}
                  onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))}
                />
                <Label htmlFor="is-active" className="cursor-pointer">Aktif</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {editingId !== null ? "Güncelle" : "Oluştur"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
