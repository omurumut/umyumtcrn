import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import { useListUnits, getListUnitsQueryKey, useListCompanies, getListCompaniesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Zap, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const ENERGY_TYPES = [
  { value: "elektrik", label: "Elektrik", color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  { value: "dogalgaz", label: "Doğalgaz", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { value: "buhar", label: "Buhar", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { value: "su", label: "Su", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  { value: "diger", label: "Diğer", color: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
];
const UNITS_LIST = ["kWh", "MWh", "GJ", "m3", "ton", "litre"];

interface EnergySource { id: number; unitId: number; companyId: number; type: string; name: string; unit: string; active: boolean; }
interface ESForm { unitId: string; type: string; name: string; unit: string; active: boolean; }

const API = (token: string | null, method: string, body?: unknown, id?: number) =>
  fetch(id ? `/api/energy-sources/${id}` : "/api/energy-sources", {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.ok ? (r.status === 204 ? null : r.json()) : r.json().then((e: any) => { throw new Error(e.error); }));

export default function EnergySourcesTab({ unitId }: { unitId?: number }) {
  const { user, token } = useAuth();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const isSuperAdmin = user?.role === "superadmin";
  const effectiveUnitId = user?.role !== "admin" && user?.role !== "superadmin" ? user?.unitId : unitId;
  const EMPTY: ESForm = { unitId: effectiveUnitId?.toString() ?? "", type: "elektrik", name: "Elektrik", unit: "kWh", active: true };
  const [form, setForm] = useState<ESForm>(EMPTY);

  const { data: allUnits } = useListUnits({ query: { queryKey: [...getListUnitsQueryKey(), companyId] } });
  const { data: allCompanies } = useListCompanies({ query: { queryKey: getListCompaniesQueryKey(), enabled: isSuperAdmin } });

  const qKey = ["energy-sources", effectiveUnitId, companyId];
  const { data: sources, isLoading } = useQuery<EnergySource[]>({
    queryKey: qKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (effectiveUnitId) params.set("unitId", effectiveUnitId.toString());
      if (companyId !== null) params.set("companyId", companyId.toString());
      const qs = params.toString();
      const url = qs ? `/api/energy-sources?${qs}` : "/api/energy-sources";
      return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then(r => r.ok ? r.json() : []);
    },
  });

  const createMut = useMutation({ mutationFn: (d: ESForm) => API(token, "POST", { ...d, unitId: parseInt(d.unitId) }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setOpen(false); toast({ title: "Enerji kaynağı eklendi" }); }, onError: (e: any) => toast({ title: e.message, variant: "destructive" }) });
  const updateMut = useMutation({ mutationFn: (d: ESForm) => API(token, "PATCH", { type: d.type, name: d.name, unit: d.unit, active: d.active }, editingId!), onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setOpen(false); toast({ title: "Güncellendi" }); }, onError: (e: any) => toast({ title: e.message, variant: "destructive" }) });
  const deleteMut = useMutation({ mutationFn: (id: number) => API(token, "DELETE", undefined, id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); toast({ title: "Silindi" }); }, onError: (e: any) => toast({ title: e.message, variant: "destructive" }) });

  function getCompanyName(cId: number): string {
    if (!allCompanies) return `Firma #${cId}`;
    const found = (allCompanies as any[]).find((c: any) => c.id === cId);
    return found?.name ?? `Firma #${cId}`;
  }

  function openCreate() { setEditingId(null); setForm({ ...EMPTY, unitId: effectiveUnitId?.toString() ?? "" }); setOpen(true); }
  function openEdit(s: EnergySource) { setEditingId(s.id); setForm({ unitId: s.unitId.toString(), type: s.type, name: s.name, unit: s.unit, active: s.active }); setOpen(true); }
  function handleTypeChange(v: string) {
    const def = ENERGY_TYPES.find(t => t.value === v);
    setForm(f => ({ ...f, type: v, name: def?.label ?? v }));
  }
  function handleSave() { if (!form.name || !form.unitId) { toast({ title: "Zorunlu alanlar eksik", variant: "destructive" }); return; } editingId ? updateMut.mutate(form) : createMut.mutate(form); }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Biriminize ait enerji kaynaklarını tanımlayın. Yalnızca tanımladığınız kaynaklar sayaç ve tüketim ekranlarında görünür.</p>
        <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Kaynak Ekle</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (sources ?? []).length === 0 ? (
        <Card><CardContent className="py-12 flex flex-col items-center text-muted-foreground">
          <Zap className="h-10 w-10 mb-3 opacity-20" />
          <p className="font-medium">Enerji kaynağı tanımlanmamış</p>
          <p className="text-sm mt-1">Tanımladığınız kaynaklar sayaç ekranında listelenir</p>
          <Button className="mt-4 gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> Kaynak Ekle</Button>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(sources ?? []).map(s => {
            const tc = ENERGY_TYPES.find(t => t.value === s.type)?.color ?? "bg-slate-500/10 text-slate-400 border-slate-500/20";
            const parentUnit = (allUnits as any[])?.find((u: any) => u.id === s.unitId);
            return (
              <Card key={s.id} className="group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm">{s.name}</h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge className={`text-xs ${tc}`} variant="outline">{ENERGY_TYPES.find(t => t.value === s.type)?.label ?? s.type}</Badge>
                        <span className="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded">{s.unit}</span>
                        {!s.active && <span className="text-xs text-muted-foreground">(Pasif)</span>}
                        {!unitId && parentUnit && (
                          <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
                            {parentUnit.name}
                          </span>
                        )}
                        {isSuperAdmin && s.companyId && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <Building2 className="h-2.5 w-2.5" />
                            {getCompanyName(s.companyId)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(s)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => { if (confirm("Silinsin mi?")) deleteMut.mutate(s.id); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Enerji Kaynağı Düzenle" : "Enerji Kaynağı Ekle"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {(user?.role === "admin" || user?.role === "superadmin") && !unitId && (
              <div className="space-y-1.5">
                <Label>Birim *</Label>
                <Select value={form.unitId} onValueChange={v => setForm(f => ({ ...f, unitId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Birim seçin" /></SelectTrigger>
                  <SelectContent>{(allUnits ?? []).map((u: any) => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Kaynak Türü *</Label>
                <Select value={form.type} onValueChange={handleTypeChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ENERGY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Ölçü Birimi *</Label>
                <Select value={form.unit} onValueChange={v => setForm(f => ({ ...f, unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS_LIST.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Görünen Ad *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ör. Elektrik, Doğalgaz, Buhar" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
              <Label>{form.active ? "Aktif" : "Pasif"}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>{editingId ? "Güncelle" : "Ekle"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
