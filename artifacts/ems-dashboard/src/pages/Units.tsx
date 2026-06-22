import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUnits, useCreateUnit, useUpdateUnit, useDeleteUnit, getListUnitsQueryKey,
  useListCompanies, getListCompaniesQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useUnit } from "@/context/UnitContext";
import { useCompany } from "@/context/CompanyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Building2, MapPin, User, AlertCircle, DatabaseZap, Loader2, ChevronDown, Eraser } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import SubUnitsTab from "@/components/units/SubUnitsTab";
import EnergySourcesTab from "@/components/units/EnergySourcesTab";
import UsersTab from "@/components/units/UsersTab";
import { parseIlIlce, buildCityValue } from "@/data/turkiyeIlIlce";
import { IlIlceSelector } from "@/components/ui/IlIlceSelector";

const UNIT_TYPES = [
  { value: "fabrika", label: "Fabrika" },
  { value: "ofis", label: "Ofis" },
  { value: "depo", label: "Depo / Lojistik" },
  { value: "hastane", label: "Hastane / Sağlık" },
  { value: "okul", label: "Okul / Üniversite" },
  { value: "diger", label: "Diğer" },
];

const TYPE_COLORS: Record<string, string> = {
  fabrika: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  ofis: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  depo: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  hastane: "bg-red-500/10 text-red-400 border-red-500/20",
  okul: "bg-green-500/10 text-green-400 border-green-500/20",
  diger: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

interface UnitForm {
  name: string; location: string; type: string; city: string;
  il: string; ilce: string;
  responsible: string; description: string; active: boolean;
}
const EMPTY: UnitForm = { name: "", location: "", type: "diger", city: "İstanbul", il: "İstanbul", ilce: "", responsible: "", description: "", active: true };

function AdminUnitsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { token, user } = useAuth();
  const { setUnitId } = useUnit();
  const { companyId } = useCompany();
  const isSuperAdmin = user?.role === "superadmin";
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<UnitForm>(EMPTY);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedConfirmOpen, setSeedConfirmOpen] = useState(false);
  const [resetMode, setResetMode] = useState<"demo" | "all" | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  const { data: companies } = useListCompanies({ query: { queryKey: getListCompaniesQueryKey(), enabled: isSuperAdmin } });
  const activeCompanyName = companyId !== null
    ? (companies ?? []).find((c: any) => c.id === companyId)?.name ?? `Firma #${companyId}`
    : null;

  async function handleReset(mode: "demo" | "all") {
    setResetMode(null);
    setResetLoading(true);
    try {
      const res = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sunucu hatası");
      setUnitId(null);
      queryClient.clear();
      toast({
        title: mode === "demo" ? "Demo veriler temizlendi ✓" : "Veri tabanı temizlendi ✓",
        description: mode === "demo"
          ? "Demo veriler başarıyla silindi. Kullanıcı verileri korundu."
          : "Tüm veriler silindi. Admin kullanıcısı korundu.",
      });
    } catch (err: any) {
      toast({ title: "İşlem başarısız", description: err.message, variant: "destructive" });
    } finally {
      setResetLoading(false);
    }
  }

  async function handleSeed() {
    setSeedConfirmOpen(false);
    setSeedLoading(true);
    try {
      const body: Record<string, any> = {};
      if (companyId !== null) body.companyId = companyId;
      const res = await fetch("/api/admin/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Sunucu hatası");
      const s = json.summary;
      setUnitId(null);
      queryClient.invalidateQueries();
      toast({
        title: "Demo veriler yüklendi ✓",
        description: `${s.units} birim · ${s.meters} sayaç · ${s.consumptionRecords} tüketim kaydı oluşturuldu${activeCompanyName ? ` (${activeCompanyName})` : ""}`,
      });
    } catch (err: any) {
      toast({ title: "Seed başarısız", description: err.message, variant: "destructive" });
    } finally {
      setSeedLoading(false);
    }
  }

  const unitsParams = companyId !== null ? { companyId } : {};
  const { data: units, isLoading } = useListUnits(
    unitsParams,
    { query: { queryKey: getListUnitsQueryKey(unitsParams) } }
  );
  const createUnit = useCreateUnit();
  const updateUnit = useUpdateUnit();
  const deleteUnit = useDeleteUnit();

  function openCreate() { setEditingId(null); setForm(EMPTY); setOpen(true); }
  function openEdit(u: any) {
    setEditingId(u.id);
    const parsed = parseIlIlce(u.city ?? "");
    setForm({ name: u.name, location: u.location, type: u.type ?? "diger", city: u.city, il: parsed.il || "İstanbul", ilce: parsed.ilce, responsible: u.responsible ?? "", description: u.description ?? "", active: u.active });
    setOpen(true);
  }

  function handleSave() {
    if (!form.name || !form.location) { toast({ title: "Ad ve lokasyon zorunludur", variant: "destructive" }); return; }
    if (!form.il) { toast({ title: "İl seçimi zorunludur", variant: "destructive" }); return; }
    const city = buildCityValue(form.il, form.ilce);
    const data: any = { name: form.name, location: form.location, type: "diger", city, responsible: form.responsible || undefined, description: form.description || undefined, active: form.active, ...(companyId !== null ? { companyId } : {}) };
    if (editingId !== null) {
      updateUnit.mutate({ id: editingId, data }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUnitsQueryKey(unitsParams) }); setOpen(false); toast({ title: "Birim güncellendi" }); },
        onError: () => toast({ title: "Hata oluştu", variant: "destructive" }),
      });
    } else {
      createUnit.mutate({ data }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUnitsQueryKey(unitsParams) }); setOpen(false); toast({ title: "Birim eklendi" }); },
        onError: () => toast({ title: "Hata oluştu", variant: "destructive" }),
      });
    }
  }

  function handleDelete(id: number) {
    if (!window.confirm("Bu birimi silmek istediğinizden emin misiniz?")) return;
    deleteUnit.mutate({ id }, {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListUnitsQueryKey(unitsParams) }); toast({ title: "Birim silindi" }); },
      onError: () => toast({ title: "Silinemedi", variant: "destructive" }),
    });
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2">
          <DatabaseZap className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span>Demo veriler mevcut tüm birim ve tüketim verilerini <strong>sıfırlar</strong> ve yeniden yükler.</span>
        </div>
        <div className="flex gap-2 ml-4">
          <Button
            variant="outline"
            onClick={() => setSeedConfirmOpen(true)}
            disabled={seedLoading || resetLoading}
            className="gap-2 border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
          >
            {seedLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseZap className="h-4 w-4" />}
            {seedLoading ? "Yükleniyor..." : "Demo Veri Yükle"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={resetLoading || seedLoading}
                className="gap-2 border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                {resetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
                {resetLoading ? "Temizleniyor..." : "Verileri Temizle"}
                <ChevronDown className="h-3.5 w-3.5 ml-1 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => setResetMode("demo")}
                className="gap-2 text-orange-400 focus:text-orange-300 focus:bg-orange-500/10 cursor-pointer"
              >
                <Eraser className="h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">Sadece Demo Verilerini Sil</div>
                  <div className="text-xs text-muted-foreground">Kullanıcı verileri korunur</div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setResetMode("all")}
                className="gap-2 text-red-400 focus:text-red-300 focus:bg-red-500/10 cursor-pointer"
              >
                <Trash2 className="h-4 w-4 shrink-0" />
                <div>
                  <div className="font-medium">Tüm Veri Tabanını Temizle</div>
                  <div className="text-xs text-muted-foreground">Tüm veriler silinir</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Yeni Birim</Button>
        </div>
      </div>

      <Dialog open={seedConfirmOpen} onOpenChange={setSeedConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DatabaseZap className="h-5 w-5 text-amber-400" />
              Demo Veri Yükle
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3 text-sm text-muted-foreground">
            {activeCompanyName && (
              <p className="text-amber-400 font-medium flex items-center gap-1">
                🏢 Demo veriler <strong className="text-foreground">{activeCompanyName}</strong> firmasına yüklenecek.
              </p>
            )}
            <p>Mevcut verilerinize dokunulmadan aşağıdaki örnek veriler eklenir:</p>
            <ul className="list-disc list-inside space-y-1 pl-1">
              <li>3 birim (İstanbul Fabrika, Ankara Ofis, İzmir Depo)</li>
              <li>10 alt birim, 8 enerji kaynağı, 15 sayaç</li>
              <li>255 aylık tüketim kaydı</li>
              <li>SWOT, Risk/Fırsat ve ÖEK maddeleri</li>
              <li>3 demo kullanıcı (şifre: <code className="bg-secondary px-1 rounded">demo123</code>)</li>
            </ul>
            <p className="text-green-400 font-medium">✓ Kullanıcı verileriniz korunur. Demo zaten yüklüyse yenilenir.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeedConfirmOpen(false)}>İptal</Button>
            <Button
              onClick={handleSeed}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
            >
              <DatabaseZap className="h-4 w-4" />
              Evet, Demo Veri Yükle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetMode !== null} onOpenChange={(open) => { if (!open) setResetMode(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {resetMode === "demo"
                ? <><Eraser className="h-5 w-5 text-orange-400" /> Sadece Demo Verilerini Sil</>
                : <><Trash2 className="h-5 w-5 text-red-400" /> Tüm Veri Tabanını Temizle</>
              }
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3 text-sm text-muted-foreground">
            {resetMode === "demo" ? (
              <>
                <p>Bu işlem yalnızca <strong className="text-foreground">demo verilerini</strong> silecektir:</p>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li>Demo birimler: İstanbul Fabrika, Ankara Ofis, İzmir Depo</li>
                  <li>Bu birimlere bağlı tüm sayaç, tüketim, SWOT, Risk ve ÖEK verileri</li>
                  <li>Demo kullanıcılar (istanbul_yonetici, ankara_yonetici, izmir_yonetici)</li>
                </ul>
                <p className="text-green-400 font-medium">✓ Manuel eklediğiniz birimler ve veriler korunur.</p>
              </>
            ) : (
              <>
                <p>Bu işlem <strong className="text-foreground">tüm verileri silecektir</strong>:</p>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li>Tüm birimler, alt birimler, enerji kaynakları, sayaçlar</li>
                  <li>Tüm tüketim kayıtları, SWOT, Risk/Fırsat ve ÖEK maddeleri</li>
                  <li>Admin dışındaki tüm kullanıcılar</li>
                </ul>
                <p className="text-red-400 font-medium">⚠ Bu işlem geri alınamaz. Tüm verileriniz silinir.</p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetMode(null)}>İptal</Button>
            <Button
              onClick={() => resetMode && handleReset(resetMode)}
              className={resetMode === "demo"
                ? "bg-orange-600 hover:bg-orange-700 text-white gap-2"
                : "bg-red-600 hover:bg-red-700 text-white gap-2"
              }
            >
              {resetMode === "demo"
                ? <><Eraser className="h-4 w-4" /> Evet, Demo Verileri Sil</>
                : <><Trash2 className="h-4 w-4" /> Evet, Tümünü Temizle</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : (units ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-muted-foreground">
            <Building2 className="h-12 w-12 mb-4 opacity-20" />
            <p className="font-medium text-base">Henüz birim eklenmemiş</p>
            <Button className="mt-5 gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> İlk Birimi Ekle</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(units ?? []).map((u: any) => (
            <Card key={u.id} className="group">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      <h3 className="font-semibold text-sm truncate">{u.name}</h3>
                      {!u.active && <span className="text-xs text-muted-foreground">(Pasif)</span>}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{u.location}</span>
                    </div>
                  </div>
                  <Badge className={`text-xs shrink-0 ${TYPE_COLORS[u.type] ?? TYPE_COLORS.diger}`} variant="outline">
                    {UNIT_TYPES.find(t => t.value === u.type)?.label ?? u.type}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="bg-secondary/50 px-2 py-0.5 rounded">{u.city}</span>
                  {u.responsible && (
                    <div className="flex items-center gap-1">
                      <User className="h-3 w-3" /><span className="truncate max-w-[120px]">{u.responsible}</span>
                    </div>
                  )}
                </div>
                {isSuperAdmin && u.companyId && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-blue-400">
                    <Building2 className="h-2.5 w-2.5" />
                    <span>{(companies ?? []).find((c: any) => c.id === u.companyId)?.name ?? `Firma #${u.companyId}`}</span>
                  </div>
                )}
                <div className="flex items-center justify-end gap-1 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(u)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(u.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId !== null ? "Birim Düzenle" : "Yeni Birim Ekle"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Birim Adı *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ör. Fabrika A — İstanbul" />
            </div>
            <div className="space-y-1.5">
              <Label>Lokasyon / Adres *</Label>
              <Input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="ör. Organize Sanayi Bölgesi, Blok 5" />
            </div>
            <IlIlceSelector
              il={form.il}
              ilce={form.ilce}
              onIlChange={v => setForm(f => ({ ...f, il: v, ilce: "" }))}
              onIlceChange={v => setForm(f => ({ ...f, ilce: v }))}
              ilRequired
            />
            <div className="space-y-1.5">
              <Label>Sorumlu Kişi</Label>
              <Input value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible: e.target.value }))} placeholder="ör. Enerji Yöneticisi" />
            </div>
            <div className="space-y-1.5">
              <Label>Açıklama</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} />
              <Label>{form.active ? "Aktif birim" : "Pasif birim"}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createUnit.isPending || updateUnit.isPending}>
              {editingId !== null ? "Güncelle" : "Ekle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Units() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const [adminUnitFilter, setAdminUnitFilter] = useState<number | undefined>(undefined);

  const nonAdminUnitId = isAdmin ? undefined : (user?.unitId ?? undefined);

  const { data: units } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}) } });
  const myUnit = nonAdminUnitId ? units?.find((u: any) => u.id === nonAdminUnitId) : null;

  const tabUnitId = isAdmin ? adminUnitFilter : nonAdminUnitId;

  if (!isAdmin && !nonAdminUnitId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Birimim</h1>
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-muted-foreground">
            <AlertCircle className="h-10 w-10 mb-3 opacity-30" />
            <p className="font-medium">Henüz bir birime atanmamışsınız</p>
            <p className="text-sm mt-1">Yöneticinize başvurun</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{isAdmin ? "Birim Yönetimi" : "Birimim"}</h1>
          {!isAdmin && myUnit && (
            <div className="flex items-center gap-2 mt-1">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{myUnit.name} — {myUnit.city}</p>
            </div>
          )}
          {isAdmin && <p className="text-sm text-muted-foreground mt-1">Lokasyon ve tesis birimlerini yönetin</p>}
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground font-medium">Sekme filtresi:</span>
            <Select
              value={adminUnitFilter?.toString() ?? "all"}
              onValueChange={v => setAdminUnitFilter(v === "all" ? undefined : parseInt(v))}
            >
              <SelectTrigger className="w-52 h-8 text-xs border-teal-500/40 text-teal-400 focus:ring-teal-500/20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">🏢 Tüm Birimler</SelectItem>
                {(units ?? []).map((u: any) => (
                  <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <Tabs defaultValue={isAdmin ? "birimler" : "alt-birimler"}>
        <TabsList>
          {isAdmin && <TabsTrigger value="birimler">Birimler</TabsTrigger>}
          <TabsTrigger value="alt-birimler">Alt Birimler / Lokasyonlar</TabsTrigger>
          <TabsTrigger value="enerji-kaynaklari">Enerji Kaynakları</TabsTrigger>
          {isAdmin && <TabsTrigger value="kullanicilar">Kullanıcılar</TabsTrigger>}
        </TabsList>

        {isAdmin && (
          <TabsContent value="birimler" className="mt-4">
            <AdminUnitsTab />
          </TabsContent>
        )}

        <TabsContent value="alt-birimler" className="mt-4">
          <SubUnitsTab unitId={tabUnitId} />
        </TabsContent>

        <TabsContent value="enerji-kaynaklari" className="mt-4">
          <EnergySourcesTab unitId={tabUnitId} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="kullanicilar" className="mt-4">
            <UsersTab unitFilter={adminUnitFilter} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
