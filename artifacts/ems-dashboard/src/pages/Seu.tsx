import { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useUnit } from "@/context/UnitContext";
import { useCompany } from "@/context/CompanyContext";
import { useListSeu, useCreateSeu, useUpdateSeu, useDeleteSeu, getListSeuQueryKey } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, AlertTriangle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import SeuAnalysisTab from "@/components/seu/SeuAnalysisTab";
import SeuAssessmentList from "@/components/seu/SeuAssessmentList";
import SeuMethodTab from "@/components/seu/SeuMethodTab";
import SeuAdminTabs from "@/components/seu/SeuAdminTabs";
import SeuDecisionItemsList from "@/components/seu/SeuDecisionItemsList";

const CATEGORIES = [
  { value: "uretim", label: "Üretim" },
  { value: "aydinlatma", label: "Aydınlatma" },
  { value: "iklimlendirme", label: "İklimlendirme" },
  { value: "kompresör", label: "Kompresör" },
  { value: "diger", label: "Diğer" },
];

interface SeuForm {
  name: string; category: string; annualKwh: string; percentage: string;
  priority: string; targetReductionPercent: string; responsible: string; notes: string;
}
const EMPTY: SeuForm = { name: "", category: "uretim", annualKwh: "", percentage: "", priority: "1", targetReductionPercent: "", responsible: "", notes: "" };

function computeManualPriority(share: number, hasOpp: boolean): number {
  if (share >= 20) return hasOpp ? 1 : 2;
  if (share >= 10) return hasOpp ? 2 : 3;
  if (share >= 5) return hasOpp ? 3 : 4;
  return hasOpp ? 4 : 5;
}

function ManualSeuList() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { unitId } = useUnit();
  const { companyId } = useCompany();
  const { token, user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const unitParam = unitId !== null ? { unitId } : companyId !== null ? { companyId } : undefined;
  const currentYear = new Date().getFullYear();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SeuForm>(EMPTY);
  const [formYear, setFormYear] = useState(currentYear);
  const [hasOpportunity, setHasOpportunity] = useState(false);

  const { data: items, isLoading } = useListSeu(unitParam, { query: { queryKey: getListSeuQueryKey(unitParam) } });
  const createSeu = useCreateSeu();
  const updateSeu = useUpdateSeu();
  const deleteSeu = useDeleteSeu();

  const effectiveUnitId = isAdmin ? null : (unitId ?? null);
  const { data: kpiData, isFetching: kpiFetching } = useQuery({
    queryKey: ["manual-seu-kpi", formYear, effectiveUnitId],
    queryFn: async () => {
      const p = new URLSearchParams({ year: String(formYear) });
      if (effectiveUnitId !== null) p.set("unitId", String(effectiveUnitId));
      const res = await fetch(`/api/dashboard/kpi?${p}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: open && effectiveUnitId !== null,
    staleTime: 60_000,
  });

  const totalTep: number = kpiData?.totalTep ?? 0;
  const annualTep = parseFloat(form.annualKwh) || 0;
  const autoPercentage = totalTep > 0 ? Math.round((annualTep / totalTep) * 10000) / 100 : 0;
  const autoPriority = computeManualPriority(autoPercentage, hasOpportunity);

  function openCreate() { setEditingId(null); setForm(EMPTY); setHasOpportunity(false); setFormYear(currentYear); setOpen(true); }
  function openEdit(item: any) {
    setEditingId(item.id);
    setForm({ name: item.name, category: item.category, annualKwh: item.annualKwh.toString(), percentage: item.percentage.toString(), priority: item.priority.toString(), targetReductionPercent: item.targetReductionPercent?.toString() ?? "", responsible: item.responsible ?? "", notes: item.notes ?? "" });
    setHasOpportunity(false);
    setOpen(true);
  }

  function handleSave() {
    if (!form.name || !form.category) { toast({ title: "Zorunlu alanlar eksik", variant: "destructive" }); return; }
    if (!annualTep) { toast({ title: "TEP tüketimi girilmedi", variant: "destructive" }); return; }
    const autoPerc = totalTep > 0 ? autoPercentage : (parseFloat(form.percentage) || 0);
    const data: any = {
      name: form.name, category: form.category,
      annualKwh: annualTep,
      percentage: autoPerc,
      priority: autoPriority,
    };
    if (form.targetReductionPercent) data.targetReductionPercent = parseFloat(form.targetReductionPercent);
    if (form.responsible) data.responsible = form.responsible;
    if (form.notes) data.notes = form.notes;
    if (unitId !== null) data.unitId = unitId;
    if (editingId !== null) {
      updateSeu.mutate({ id: editingId, data }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListSeuQueryKey(unitParam) }); setOpen(false); toast({ title: "Güncellendi" }); } });
    } else {
      createSeu.mutate({ data }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListSeuQueryKey(unitParam) }); setOpen(false); toast({ title: "ÖEK eklendi" }); } });
    }
  }

  function handleDelete(id: number) {
    deleteSeu.mutate({ id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListSeuQueryKey(unitParam) }); toast({ title: "Silindi" }); } });
  }

  const sorted = [...(items ?? [])].sort((a: any, b: any) => a.priority - b.priority);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/20 bg-amber-500/5 text-sm text-amber-300">
        <Info className="h-4 w-4 shrink-0" />
        <span>Bu kayıtlar tüketim analizinden otomatik oluşturulmadı. ISO denetimi için ÖEK Analizi sekmesini kullanmanız önerilir.</span>
      </div>

      <div className="flex justify-end">
        <Button onClick={openCreate} size="sm" className="gap-2"><Plus className="h-4 w-4" /> Manuel ÖEK Ekle</Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : sorted.length === 0 ? (
        <Card><CardContent className="py-12 flex flex-col items-center text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-sm">Manuel ÖEK kaydı yok</p>
        </CardContent></Card>
      ) : (
        sorted.map((item: any) => (
          <Card key={item.id} className="group">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{item.name}</p>
                    <Badge variant="outline" className="text-xs">{CATEGORIES.find(c => c.value === item.category)?.label ?? item.category}</Badge>
                    <Badge variant="outline" className="text-xs">Öncelik {item.priority}</Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    <span className="font-mono text-foreground">{item.annualKwh.toFixed(4)} TEP/yıl</span>
                    <span className="text-teal-400">%{item.percentage.toFixed(1)}</span>
                    {item.targetReductionPercent && <span className="text-amber-400">Hedef: -%{item.targetReductionPercent}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId !== null ? "ÖEK Düzenle" : "Yeni Manuel ÖEK"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Ad *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="ör. Ana Kompresör Sistemi" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Kategori *</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Yıl</Label>
                <Select value={String(formYear)} onValueChange={v => setFormYear(parseInt(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Yıllık TEP Tüketimi *</Label>
                <Input type="number" value={form.annualKwh} onChange={e => setForm(f => ({ ...f, annualKwh: e.target.value }))} placeholder="0.0000" step="0.0001" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Pay % (Otomatik)</Label>
                <div className="relative">
                  <Input
                    readOnly
                    value={totalTep > 0 ? `${autoPercentage.toFixed(1)}% (${totalTep.toFixed(2)} TEP toplam)` : kpiFetching ? "Hesaplanıyor…" : "Toplam TEP bulunamadı"}
                    className="bg-muted/30 text-xs pr-2 cursor-not-allowed"
                  />
                </div>
                {!kpiFetching && totalTep === 0 && open && effectiveUnitId !== null && (
                  <p className="text-xs text-amber-400 mt-0.5">Bu yıl ve birim için toplam TEP bulunamadı. Tüketim girişlerini kontrol edin.</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setHasOpportunity(v => !v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${hasOpportunity ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-border bg-muted/30 text-muted-foreground"}`}
              >
                İyileştirme Fırsatı: {hasOpportunity ? "Var" : "Yok"}
              </button>
              <span className="text-xs text-muted-foreground">
                Otomatik Öncelik: <strong className="text-foreground">{autoPriority}</strong>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Hedef Azaltım (%)</Label>
                <Input type="number" value={form.targetReductionPercent} onChange={e => setForm(f => ({ ...f, targetReductionPercent: e.target.value }))} placeholder="İsteğe bağlı" />
              </div>
              <div className="space-y-1.5">
                <Label>Sorumlu</Label>
                <Input value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible: e.target.value }))} placeholder="Birim / Kişi" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Not</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createSeu.isPending || updateSeu.isPending}>{editingId !== null ? "Güncelle" : "Ekle"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Seu() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const isSuperAdmin = user?.role === "superadmin";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Önemli Enerji Kullanımları (ÖEK)</h1>
        <p className="text-sm text-muted-foreground mt-1">ISO 50001 — Significant Energy Uses (SEU)</p>
      </div>

      {isAdmin ? (
        <SeuAdminTabs />
      ) : (
        <Tabs defaultValue="analysis">
          <TabsList className="mb-4">
            <TabsTrigger value="analysis">ÖEK Analizi</TabsTrigger>
            <TabsTrigger value="list">Karar Kayıtları</TabsTrigger>
            <TabsTrigger value="manual">Manuel Kayıt</TabsTrigger>
            <TabsTrigger value="method">Metot</TabsTrigger>
          </TabsList>

          <TabsContent value="analysis">
            <SeuAnalysisTab isAdminMode={false} />
          </TabsContent>

          <TabsContent value="list">
            <SeuDecisionItemsList />
          </TabsContent>

          <TabsContent value="manual">
            <ManualSeuList />
          </TabsContent>

          <TabsContent value="method">
            <SeuMethodTab isSuperAdmin={isSuperAdmin} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
