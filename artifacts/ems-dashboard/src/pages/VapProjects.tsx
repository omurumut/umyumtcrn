import { useState, useEffect } from "react";
import { useUnit } from "@/context/UnitContext";
import { useCompany } from "@/context/CompanyContext";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Zap, FolderOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import axios from "axios";

const VAP_STATUSES = [
  { value: "idea", label: "Fikir", color: "bg-muted text-muted-foreground" },
  { value: "feasibility", label: "Fizibilite", color: "bg-purple-500/20 text-purple-400" },
  { value: "planned", label: "Planlandı", color: "bg-blue-500/20 text-blue-400" },
  { value: "in_progress", label: "Devam Ediyor", color: "bg-yellow-500/20 text-yellow-400" },
  { value: "completed", label: "Tamamlandı", color: "bg-green-500/20 text-green-400" },
  { value: "cancelled", label: "İptal", color: "bg-red-500/20 text-red-400" },
];

const FEASIBILITY_STATUSES = [
  { value: "not_started", label: "Başlanmadı" },
  { value: "pre_feasibility", label: "Ön Fizibilite" },
  { value: "detailed_feasibility", label: "Detay Fizibilite" },
  { value: "approved", label: "Onaylandı" },
  { value: "rejected", label: "Reddedildi" },
];

const INCENTIVE_STATUSES = [
  { value: "none", label: "Yok" },
  { value: "evaluating", label: "Değerlendiriliyor" },
  { value: "application_prepared", label: "Başvuru Hazırlanıyor" },
  { value: "applied", label: "Başvuru Yapıldı" },
  { value: "approved", label: "Onaylandı" },
  { value: "rejected", label: "Reddedildi" },
];

const PROJECT_TYPES = [
  "Aydınlatma", "Kompresör", "HVAC / İklimlendirme", "Motor Sistemleri",
  "Yenilenebilir Enerji", "Isı Geri Kazanımı", "Otomasyon / BMS",
  "Proses Optimizasyonu", "Ulaşım / Filo", "Diğer",
];

function fmt(n: number | null | undefined, dec = 1) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function StatusBadge({ status, items }: { status: string | null | undefined; items: { value: string; label: string; color: string }[] }) {
  const s = items.find((i) => i.value === status) ?? { label: status ?? "—", color: "bg-muted text-muted-foreground" };
  return <Badge className={`${s.color} border-0 text-xs`}>{s.label}</Badge>;
}

interface VapForm {
  actionPlanId: string; projectCode: string; projectTitle: string; projectType: string;
  currentSituation: string; proposedSolution: string; technicalDescription: string;
  annualEnergySavingValue: string; annualEnergySavingUnit: string; annualCostSaving: string;
  investmentCost: string; paybackMonths: string; co2ReductionTon: string;
  measurementVerificationMethod: string; incentiveStatus: string; feasibilityStatus: string;
  startDate: string; endDate: string; status: string; notes: string;
}

const EMPTY_FORM: VapForm = {
  actionPlanId: "", projectCode: "", projectTitle: "", projectType: "", currentSituation: "",
  proposedSolution: "", technicalDescription: "", annualEnergySavingValue: "", annualEnergySavingUnit: "kWh",
  annualCostSaving: "", investmentCost: "", paybackMonths: "", co2ReductionTon: "",
  measurementVerificationMethod: "", incentiveStatus: "none", feasibilityStatus: "not_started",
  startDate: "", endDate: "", status: "idea", notes: "",
};

export default function VapProjects() {
  const { toast } = useToast();
  const { unitId } = useUnit();
  const { companyId } = useCompany();
  const { user } = useAuth();

  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [vapActions, setVapActions] = useState<any[]>([]); // is_vap=true action plans
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<VapForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const authHeader = () => {
    const token = localStorage.getItem("authToken");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  async function loadProjects() {
    setLoading(true);
    try {
      const r = await axios.get("/api/vap-projects", { headers: authHeader() });
      setProjects(r.data);
    } catch { setProjects([]); } finally { setLoading(false); }
  }

  async function loadVapActions() {
    try {
      const r = await axios.get("/api/energy-action-plans", { headers: authHeader() });
      setVapActions(r.data.filter((a: any) => a.isVap));
    } catch { setVapActions([]); }
  }

  useEffect(() => {
    loadProjects();
    loadVapActions();
  }, [unitId, companyId]);

  // VAP actions that don't yet have a project
  const actionIdsWithProject = new Set(projects.map((p) => p.actionPlanId));
  const actionsWithoutProject = vapActions.filter((a) => !actionIdsWithProject.has(a.id));

  function openCreate(prefillAction?: any) {
    setEditingId(null);
    const base = { ...EMPTY_FORM };
    if (prefillAction) {
      base.actionPlanId = prefillAction.id.toString();
      base.projectTitle = prefillAction.title;
      if (prefillAction.investmentCost) base.investmentCost = prefillAction.investmentCost.toString();
      if (prefillAction.expectedCostSaving) base.annualCostSaving = prefillAction.expectedCostSaving.toString();
      if (prefillAction.expectedSavingValue) base.annualEnergySavingValue = prefillAction.expectedSavingValue.toString();
      if (prefillAction.expectedSavingUnit) base.annualEnergySavingUnit = prefillAction.expectedSavingUnit;
      if (prefillAction.paybackMonths) base.paybackMonths = prefillAction.paybackMonths.toString();
    }
    setForm(base);
    setOpen(true);
  }

  function openEdit(p: any) {
    setEditingId(p.id);
    setForm({
      actionPlanId: p.actionPlanId.toString(),
      projectCode: p.projectCode ?? "",
      projectTitle: p.projectTitle,
      projectType: p.projectType ?? "",
      currentSituation: p.currentSituation ?? "",
      proposedSolution: p.proposedSolution ?? "",
      technicalDescription: p.technicalDescription ?? "",
      annualEnergySavingValue: p.annualEnergySavingValue?.toString() ?? "",
      annualEnergySavingUnit: p.annualEnergySavingUnit ?? "kWh",
      annualCostSaving: p.annualCostSaving?.toString() ?? "",
      investmentCost: p.investmentCost?.toString() ?? "",
      paybackMonths: p.paybackMonths?.toString() ?? "",
      co2ReductionTon: p.co2ReductionTon?.toString() ?? "",
      measurementVerificationMethod: p.measurementVerificationMethod ?? "",
      incentiveStatus: p.incentiveStatus ?? "none",
      feasibilityStatus: p.feasibilityStatus ?? "not_started",
      startDate: p.startDate ?? "",
      endDate: p.endDate ?? "",
      status: p.status ?? "idea",
      notes: p.notes ?? "",
    });
    setOpen(true);
  }

  function autoPayback(f: VapForm): VapForm {
    if (!f.paybackMonths && f.investmentCost && f.annualCostSaving) {
      const inv = parseFloat(f.investmentCost);
      const sav = parseFloat(f.annualCostSaving);
      if (!isNaN(inv) && !isNaN(sav) && sav > 0) {
        return { ...f, paybackMonths: (inv / (sav / 12)).toFixed(1) };
      }
    }
    return f;
  }

  function onFormChange(field: keyof VapForm, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      return autoPayback(next);
    });
  }

  async function handleSave() {
    if (!form.actionPlanId) { toast({ title: "Eylem planı seçiniz", variant: "destructive" }); return; }
    if (!form.projectTitle) { toast({ title: "Proje başlığı zorunludur", variant: "destructive" }); return; }

    const payload = {
      actionPlanId: form.actionPlanId,
      projectCode: form.projectCode || null,
      projectTitle: form.projectTitle,
      projectType: form.projectType || null,
      currentSituation: form.currentSituation || null,
      proposedSolution: form.proposedSolution || null,
      technicalDescription: form.technicalDescription || null,
      annualEnergySavingValue: form.annualEnergySavingValue || null,
      annualEnergySavingUnit: form.annualEnergySavingUnit || null,
      annualCostSaving: form.annualCostSaving || null,
      investmentCost: form.investmentCost || null,
      paybackMonths: form.paybackMonths || null,
      co2ReductionTon: form.co2ReductionTon || null,
      measurementVerificationMethod: form.measurementVerificationMethod || null,
      incentiveStatus: form.incentiveStatus,
      feasibilityStatus: form.feasibilityStatus,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      status: form.status,
      notes: form.notes || null,
    };
    try {
      if (editingId !== null) {
        await axios.put(`/api/vap-projects/${editingId}`, payload, { headers: authHeader() });
        toast({ title: "VAP güncellendi" });
      } else {
        await axios.post("/api/vap-projects", payload, { headers: authHeader() });
        toast({ title: "VAP oluşturuldu" });
      }
      setOpen(false);
      await loadProjects();
      await loadVapActions();
    } catch (e: any) {
      toast({ title: e?.response?.data?.error ?? "İşlem başarısız", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    try {
      await axios.delete(`/api/vap-projects/${id}`, { headers: authHeader() });
      toast({ title: "VAP silindi" });
      setDeleteId(null);
      await loadProjects();
    } catch { toast({ title: "Silme başarısız", variant: "destructive" }); }
  }

  // ─── Summary Stats ────────────────────────────────────────
  const total = projects.length;
  const inProgress = projects.filter((p) => p.status === "in_progress").length;
  const completed = projects.filter((p) => p.status === "completed").length;
  const totalEnergy = projects.reduce((s, p) => s + (p.annualEnergySavingValue ?? 0), 0);
  const totalCost = projects.reduce((s, p) => s + (p.annualCostSaving ?? 0), 0);
  const totalInvestment = projects.reduce((s, p) => s + (p.investmentCost ?? 0), 0);

  const selectedActionForForm = vapActions.find((a) => a.id.toString() === form.actionPlanId);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            Verimlilik Artırıcı Projeler
          </h1>
          <p className="text-muted-foreground text-sm mt-1">ISO 50001 — VAP yönetimi ve fizibilite takibi</p>
        </div>
        <Button onClick={() => openCreate()} className="gap-2"><Plus className="h-4 w-4" />Yeni VAP</Button>
      </div>

      {/* Summary */}
      {total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Toplam VAP", value: total, color: "" },
            { label: "Devam Eden", value: inProgress, color: "text-yellow-400" },
            { label: "Tamamlanan", value: completed, color: "text-green-400" },
            { label: "Enerji Tasarrufu", value: `${fmt(totalEnergy, 0)} kWh`, color: "text-blue-400" },
            { label: "Mali Tasarruf", value: `${fmt(totalCost, 0)} ₺`, color: "text-teal-400" },
            { label: "Toplam Yatırım", value: `${fmt(totalInvestment, 0)} ₺`, color: "text-muted-foreground" },
          ].map((c) => (
            <Card key={c.label} className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className={`text-xl font-bold mt-1 ${c.color}`}>{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Actions without VAP detail — prompt to create */}
      {actionsWithoutProject.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">VAP detayı beklenen eylem planları:</p>
          <div className="flex flex-wrap gap-2">
            {actionsWithoutProject.map((a) => (
              <button key={a.id} onClick={() => openCreate(a)} className="flex items-center gap-1.5 text-xs bg-teal-500/10 text-teal-400 border border-teal-500/30 rounded-lg px-3 py-1.5 hover:bg-teal-500/20 transition-colors">
                <Plus className="h-3 w-3" />{a.title} — VAP Detayı Oluştur
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Project List */}
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : projects.length === 0 ? (
        <Card className="border-dashed border-border/50">
          <CardContent className="py-16 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Henüz VAP kaydı yok.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Eylem Planları sekmesinde bir eylem VAP olarak işaretleyip buradan detay oluşturabilirsiniz.</p>
            <Button onClick={() => openCreate()} variant="outline" className="mt-4 gap-2"><Plus className="h-4 w-4" />Yeni VAP</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {projects.map((p: any) => (
            <Card key={p.id} className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {p.projectCode && <span className="text-xs bg-muted/60 px-1.5 py-0.5 rounded font-mono">{p.projectCode}</span>}
                      <span className="font-semibold text-sm">{p.projectTitle}</span>
                      <StatusBadge status={p.status} items={VAP_STATUSES} />
                      {p.projectType && <Badge className="bg-muted text-muted-foreground border-0 text-xs">{p.projectType}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Bağlı Hedef: <span className="text-foreground">{p.targetName ?? "—"}</span>
                      {" · "}Eylem: <span className="text-foreground">{p.actionPlanTitle ?? "—"}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
                      {p.annualEnergySavingValue != null && (
                        <div className="rounded bg-muted/30 px-2 py-1.5">
                          <div className="text-muted-foreground">Enerji Tasarrufu</div>
                          <div className="font-semibold text-blue-400">{fmt(p.annualEnergySavingValue, 0)} {p.annualEnergySavingUnit ?? "kWh"}</div>
                        </div>
                      )}
                      {p.annualCostSaving != null && (
                        <div className="rounded bg-muted/30 px-2 py-1.5">
                          <div className="text-muted-foreground">Mali Tasarruf</div>
                          <div className="font-semibold text-teal-400">{fmt(p.annualCostSaving, 0)} ₺</div>
                        </div>
                      )}
                      {p.investmentCost != null && (
                        <div className="rounded bg-muted/30 px-2 py-1.5">
                          <div className="text-muted-foreground">Yatırım</div>
                          <div className="font-semibold">{fmt(p.investmentCost, 0)} ₺</div>
                        </div>
                      )}
                      {p.paybackMonths != null && (
                        <div className="rounded bg-muted/30 px-2 py-1.5">
                          <div className="text-muted-foreground">Geri Ödeme</div>
                          <div className="font-semibold">{fmt(p.paybackMonths, 0)} ay</div>
                        </div>
                      )}
                      {p.co2ReductionTon != null && (
                        <div className="rounded bg-muted/30 px-2 py-1.5">
                          <div className="text-muted-foreground">CO₂ Azaltım</div>
                          <div className="font-semibold text-green-400">{fmt(p.co2ReductionTon, 1)} ton</div>
                        </div>
                      )}
                      <div className="rounded bg-muted/30 px-2 py-1.5">
                        <div className="text-muted-foreground">Fizibilite</div>
                        <div className="font-semibold">{FEASIBILITY_STATUSES.find((s) => s.value === p.feasibilityStatus)?.label ?? "—"}</div>
                      </div>
                    </div>
                    {p.currentSituation && <p className="text-xs text-muted-foreground mt-2 line-clamp-1">{p.currentSituation}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Form Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "VAP Düzenle" : "Yeni VAP Detayı"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Bağlı Eylem Planı *</Label>
                <Select value={form.actionPlanId} onValueChange={(v) => {
                  const a = vapActions.find((x) => x.id.toString() === v);
                  setForm((prev) => autoPayback({
                    ...prev, actionPlanId: v,
                    projectTitle: prev.projectTitle || (a?.title ?? ""),
                    investmentCost: prev.investmentCost || (a?.investmentCost?.toString() ?? ""),
                    annualCostSaving: prev.annualCostSaving || (a?.expectedCostSaving?.toString() ?? ""),
                    annualEnergySavingValue: prev.annualEnergySavingValue || (a?.expectedSavingValue?.toString() ?? ""),
                    annualEnergySavingUnit: prev.annualEnergySavingUnit || (a?.expectedSavingUnit ?? "kWh"),
                  }));
                }} disabled={!!editingId}>
                  <SelectTrigger><SelectValue placeholder="VAP eylem planı seçin..." /></SelectTrigger>
                  <SelectContent>
                    {vapActions.map((a) => <SelectItem key={a.id} value={a.id.toString()}>{a.title}</SelectItem>)}
                  </SelectContent>
                </Select>
                {selectedActionForForm?.targetName && (
                  <p className="text-xs text-muted-foreground">Bağlı hedef: <span className="text-foreground">{selectedActionForForm.targetName}</span></p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Proje Kodu</Label>
                <Input placeholder="ör. VAP-2025-001" value={form.projectCode} onChange={(e) => onFormChange("projectCode", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Proje Tipi</Label>
                <Select value={form.projectType} onValueChange={(v) => onFormChange("projectType", v)}>
                  <SelectTrigger><SelectValue placeholder="Seçin..." /></SelectTrigger>
                  <SelectContent>{PROJECT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Proje Başlığı *</Label>
                <Input placeholder="Projenin tam adı" value={form.projectTitle} onChange={(e) => onFormChange("projectTitle", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Durum</Label>
                <Select value={form.status} onValueChange={(v) => onFormChange("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{VAP_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Fizibilite Durumu</Label>
                <Select value={form.feasibilityStatus} onValueChange={(v) => onFormChange("feasibilityStatus", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FEASIBILITY_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Teşvik Durumu</Label>
                <Select value={form.incentiveStatus} onValueChange={(v) => onFormChange("incentiveStatus", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{INCENTIVE_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Yıllık Enerji Tasarrufu</Label>
                <Input type="number" min="0" placeholder="Miktar" value={form.annualEnergySavingValue} onChange={(e) => onFormChange("annualEnergySavingValue", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Enerji Tasarrufu Birimi</Label>
                <Input placeholder="kWh, MWh, tep..." value={form.annualEnergySavingUnit} onChange={(e) => onFormChange("annualEnergySavingUnit", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Yıllık Mali Tasarruf (₺)</Label>
                <Input type="number" min="0" value={form.annualCostSaving} onChange={(e) => onFormChange("annualCostSaving", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Yatırım Maliyeti (₺)</Label>
                <Input type="number" min="0" value={form.investmentCost} onChange={(e) => onFormChange("investmentCost", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Geri Ödeme Süresi (ay)</Label>
                <Input type="number" min="0" value={form.paybackMonths} onChange={(e) => onFormChange("paybackMonths", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>CO₂ Azaltımı (ton)</Label>
                <Input type="number" min="0" value={form.co2ReductionTon} onChange={(e) => onFormChange("co2ReductionTon", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Başlangıç Tarihi</Label>
                <Input type="date" value={form.startDate} onChange={(e) => onFormChange("startDate", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Bitiş Tarihi</Label>
                <Input type="date" value={form.endDate} onChange={(e) => onFormChange("endDate", e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Mevcut Durum</Label>
                <Textarea placeholder="Mevcut durumun özeti..." value={form.currentSituation} onChange={(e) => onFormChange("currentSituation", e.target.value)} rows={2} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Önerilen Çözüm</Label>
                <Textarea placeholder="Önerilen iyileştirme..." value={form.proposedSolution} onChange={(e) => onFormChange("proposedSolution", e.target.value)} rows={2} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Teknik Açıklama</Label>
                <Textarea placeholder="Teknik detaylar..." value={form.technicalDescription} onChange={(e) => onFormChange("technicalDescription", e.target.value)} rows={2} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Ölçüm & Doğrulama Yöntemi</Label>
                <Textarea placeholder="M&V planı..." value={form.measurementVerificationMethod} onChange={(e) => onFormChange("measurementVerificationMethod", e.target.value)} rows={2} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Notlar</Label>
                <Textarea placeholder="Ek notlar..." value={form.notes} onChange={(e) => onFormChange("notes", e.target.value)} rows={2} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave}>{editingId !== null ? "Güncelle" : "Oluştur"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>VAP Projesini Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Bu VAP projesini silmek istediğinizden emin misiniz?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>İptal</Button>
            <Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)}>Sil</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
