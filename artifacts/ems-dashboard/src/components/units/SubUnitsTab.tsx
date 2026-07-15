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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, MapPin, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parseIlIlce, buildCityValue } from "@/data/turkiyeIlIlce";
import { IlIlceSelector } from "@/components/ui/IlIlceSelector";

interface SubUnit { id: number; unitId: number; companyId: number; name: string; city: string; description?: string | null; active: boolean; }
interface SubUnitForm { unitId: string; name: string; city: string; il: string; ilce: string; description: string; active: boolean; }

const API = (token: string | null, method: string, body?: unknown, id?: number) =>
  fetch(id ? `/api/sub-units/${id}` : "/api/sub-units", {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.ok ? (r.status === 204 ? null : r.json()) : r.json().then((e: any) => { throw new Error(e.error); }));

export default function SubUnitsTab({ unitId }: { unitId?: number }) {
  const { user, token } = useAuth();
  const { companyId } = useCompany();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const isSuperAdmin = user?.role === "superadmin";
  const isAdmin = user?.role === "admin" || user?.role === "kontrol_admin" || isSuperAdmin;
  const effectiveUnitId = isAdmin ? unitId : user?.unitId;
  const EMPTY: SubUnitForm = { unitId: effectiveUnitId?.toString() ?? "", name: "", city: "İstanbul", il: "İstanbul", ilce: "", description: "", active: true };
  const [form, setForm] = useState<SubUnitForm>(EMPTY);

  const { data: allUnits } = useListUnits({}, { query: { queryKey: [...getListUnitsQueryKey({}), companyId] } });
  const { data: allCompanies } = useListCompanies({ query: { queryKey: getListCompaniesQueryKey(), enabled: isSuperAdmin } });

  const qKey = ["sub-units", effectiveUnitId, companyId];
  const { data: subUnits, isLoading } = useQuery<SubUnit[]>({
    queryKey: qKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (effectiveUnitId) params.set("unitId", effectiveUnitId.toString());
      if (companyId !== null) params.set("companyId", companyId.toString());
      const qs = params.toString();
      const url = qs ? `/api/sub-units?${qs}` : "/api/sub-units";
      return fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
        .then(r => r.ok ? r.json() : []);
    },
    enabled: !!token,
  });

  const createMut = useMutation({ mutationFn: (d: SubUnitForm) => API(token, "POST", { ...d, unitId: parseInt(d.unitId) }), onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setOpen(false); toast({ title: "Alt birim eklendi" }); }, onError: (e: any) => toast({ title: e.message, variant: "destructive" }) });
  const updateMut = useMutation({ mutationFn: (d: SubUnitForm) => API(token, "PATCH", { name: d.name, city: d.city, description: d.description, active: d.active }, editingId!), onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); setOpen(false); toast({ title: "Alt birim güncellendi" }); }, onError: (e: any) => toast({ title: e.message, variant: "destructive" }) });
  const deleteMut = useMutation({ mutationFn: (id: number) => API(token, "DELETE", undefined, id), onSuccess: () => { queryClient.invalidateQueries({ queryKey: qKey }); toast({ title: "Alt birim silindi" }); }, onError: (e: any) => toast({ title: e.message, variant: "destructive" }) });

  function getCompanyName(cId: number): string {
    if (!allCompanies) return `Firma #${cId}`;
    const found = (allCompanies as any[]).find((c: any) => c.id === cId);
    return found?.name ?? `Firma #${cId}`;
  }

  function openCreate() { setEditingId(null); setForm({ ...EMPTY, unitId: effectiveUnitId?.toString() ?? "" }); setOpen(true); }
  function openEdit(s: SubUnit) {
    setEditingId(s.id);
    const parsed = parseIlIlce(s.city ?? "");
    setForm({ unitId: s.unitId.toString(), name: s.name, city: s.city, il: parsed.il || "İstanbul", ilce: parsed.ilce, description: s.description ?? "", active: s.active });
    setOpen(true);
  }
  function handleSave() {
    if (!form.name) { toast({ title: "Ad zorunludur", variant: "destructive" }); return; }
    if (!form.il) { toast({ title: "İl seçimi zorunludur", variant: "destructive" }); return; }
    const city = buildCityValue(form.il, form.ilce);
    const formWithCity = { ...form, city };
    editingId ? updateMut.mutate(formWithCity) : createMut.mutate(formWithCity);
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Birime bağlı alt birim ve lokasyonları yönetin</p>
        <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Alt Birim Ekle</Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (subUnits ?? []).length === 0 ? (
        <Card><CardContent className="py-12 flex flex-col items-center text-muted-foreground">
          <MapPin className="h-10 w-10 mb-3 opacity-20" />
          <p className="font-medium">Alt birim tanımlanmamış</p>
          <Button className="mt-4 gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> İlk Alt Birimi Ekle</Button>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(subUnits ?? []).map(s => {
            const parentUnit = (allUnits as any[])?.find((u: any) => u.id === s.unitId);
            return (
              <Card key={s.id} className="group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm">{s.name}</h3>
                        {!s.active && <span className="text-xs text-muted-foreground">(Pasif)</span>}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <MapPin className="h-3 w-3" /><span>{s.city}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
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
                  {s.description && <p className="text-xs text-muted-foreground truncate">{s.description}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingId ? "Alt Birim Düzenle" : "Alt Birim Ekle"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {isAdmin && !unitId && (
              <div className="space-y-1.5">
                <Label>Birim *</Label>
                <Select value={form.unitId} onValueChange={v => setForm(f => ({ ...f, unitId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Birim seçin" /></SelectTrigger>
                  <SelectContent>{(allUnits ?? []).map((u: any) => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Alt Birim / Lokasyon Adı *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ör. A Blok, Üretim Sahası, Depo 2" />
            </div>
            <IlIlceSelector
              il={form.il}
              ilce={form.ilce}
              onIlChange={v => setForm(f => ({ ...f, il: v, ilce: "" }))}
              onIlceChange={v => setForm(f => ({ ...f, ilce: v }))}
              ilLabel="İl (HDD/CDD için)"
              ilRequired
            />
            <div className="space-y-1.5">
              <Label>Açıklama</Label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="İsteğe bağlı" />
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
