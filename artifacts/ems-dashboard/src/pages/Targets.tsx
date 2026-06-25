import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUnit } from "@/context/UnitContext";
import { useCompany } from "@/context/CompanyContext";
import { useAuth } from "@/context/AuthContext";
import {
  useListTargets, useDeleteTarget,
  getListTargetsQueryKey, useListUnits, getListUnitsQueryKey,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Pencil, Trash2, Target, CheckCircle2, Clock, Building2,
  TrendingDown, AlertCircle, BarChart3, ListChecks, Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";
import axios from "axios";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 20 }, (_, i) => CURRENT_YEAR - 10 + i);

const TARGET_TYPES = [
  { value: "consumption_reduction", label: "Tüketim Azaltımı" },
  { value: "efficiency_improvement", label: "Verimlilik Artışı" },
  { value: "emission_reduction", label: "Emisyon Azaltımı" },
  { value: "cost_reduction", label: "Maliyet Azaltımı" },
  { value: "monitoring", label: "İzleme / Kontrol" },
];

const TARGET_STATUSES = [
  { value: "draft", label: "Taslak", color: "bg-muted text-muted-foreground" },
  { value: "active", label: "Devam Ediyor", color: "bg-blue-500/20 text-blue-400" },
  { value: "completed", label: "Tamamlandı", color: "bg-green-500/20 text-green-400" },
  { value: "cancelled", label: "İptal", color: "bg-red-500/20 text-red-400" },
];

const ACTION_STATUSES = [
  { value: "planned", label: "Planlandı", color: "bg-muted text-muted-foreground" },
  { value: "in_progress", label: "Devam Ediyor", color: "bg-blue-500/20 text-blue-400" },
  { value: "completed", label: "Tamamlandı", color: "bg-green-500/20 text-green-400" },
  { value: "delayed", label: "Gecikti", color: "bg-orange-500/20 text-orange-400" },
  { value: "cancelled", label: "İptal", color: "bg-red-500/20 text-red-400" },
];

const PRIORITIES = [
  { value: "low", label: "Düşük", color: "bg-muted text-muted-foreground" },
  { value: "medium", label: "Orta", color: "bg-yellow-500/20 text-yellow-400" },
  { value: "high", label: "Yüksek", color: "bg-red-500/20 text-red-400" },
];

function fmt(n: number | null | undefined, dec = 1) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function StatusBadge({ status, items }: { status: string | null | undefined; items: { value: string; label: string; color: string }[] }) {
  const s = items.find((i) => i.value === status) ?? { label: status ?? "—", color: "bg-muted text-muted-foreground" };
  return <Badge className={`${s.color} border-0 text-xs`}>{s.label}</Badge>;
}

function ProgressBar({ actual, target }: { actual: number | null; target: number }) {
  if (actual === null) return <div className="text-xs text-muted-foreground">Veri yok</div>;
  const pct = Math.min(100, (Math.max(0, actual) / target) * 100);
  const color = actual >= target ? "bg-green-500" : actual > 0 ? "bg-blue-500" : "bg-muted-foreground/30";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Gerçekleşen: <span className="text-foreground font-medium">{fmt(actual)}%</span></span>
        <span>Hedef: <span className="text-foreground font-medium">{fmt(target)}%</span></span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EnpiChart({ target }: { target: any }) {
  if (!target.yearlyProgress?.length) return null;
  const data = target.yearlyProgress.map((p: any) => {
    const years = p.year - target.baselineYear;
    const linearTarget = years === 0 ? 0 : parseFloat(
      ((target.targetReductionPercent / (target.targetYear - target.baselineYear)) * years).toFixed(2)
    );
    return { year: p.year, gerceklesen: p.reductionPercent, hedef: parseFloat(linearTarget.toFixed(2)), kwh: p.actualKwh };
  });
  if (target.targetYear > CURRENT_YEAR) {
    data.push({ year: target.targetYear, gerceklesen: null, hedef: target.targetReductionPercent, kwh: null });
  }
  return (
    <div className="mt-4 pt-4 border-t border-border/50">
      <p className="text-xs text-muted-foreground mb-2 font-medium">EnPI İlerleme Grafiği (% azalma)</p>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="%" />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
            formatter={(v: any, name: string) => [v != null ? `${fmt(v)}%` : "—", name === "gerceklesen" ? "Gerçekleşen" : "Hedef Seyri"]}
          />
          <Legend formatter={(v) => v === "gerceklesen" ? "Gerçekleşen" : "Hedef Seyri"} wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 2" />
          <Line type="monotone" dataKey="hedef" stroke="#6366f1" strokeDasharray="5 3" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="gerceklesen" stroke="#22c55e" dot={{ fill: "#22c55e", r: 3 }} strokeWidth={2} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── TARGET FORM ──────────────────────────────────────────
interface TargetForm {
  name: string; baselineYear: string; targetYear: string; targetReductionPercent: string;
  unitId: string; objectiveText: string; targetText: string; targetType: string;
  subUnitId: string; energySourceId: string; unitLabel: string; status: string;
  baselineValue: string; targetValue: string; actualValue: string; notes: string;
}
const EMPTY_TARGET: TargetForm = {
  name: "", baselineYear: (CURRENT_YEAR - 1).toString(), targetYear: (CURRENT_YEAR + 4).toString(),
  targetReductionPercent: "10", unitId: "", objectiveText: "", targetText: "", targetType: "",
  subUnitId: "", energySourceId: "", unitLabel: "", status: "active",
  baselineValue: "", targetValue: "", actualValue: "", notes: "",
};

// ─── ACTION PLAN FORM ────────────────────────────────────
interface ActionPlanForm {
  targetId: string; title: string; description: string; responsibleName: string;
  priority: string; expectedSavingValue: string; expectedSavingUnit: string;
  expectedCostSaving: string; investmentCost: string; paybackMonths: string;
  startDate: string; dueDate: string; completionDate: string; progressPercent: string;
  status: string; isVap: boolean; notes: string;
}
const EMPTY_ACTION: ActionPlanForm = {
  targetId: "", title: "", description: "", responsibleName: "", priority: "medium",
  expectedSavingValue: "", expectedSavingUnit: "kWh", expectedCostSaving: "", investmentCost: "",
  paybackMonths: "", startDate: "", dueDate: "", completionDate: "", progressPercent: "0",
  status: "planned", isVap: false, notes: "",
};

// ─── PROGRESS FORM ──────────────────────────────────────
interface ProgressForm {
  targetId: string; periodYear: string; periodMonth: string;
  actualValue: string; actualSavingValue: string; comment: string;
}
const EMPTY_PROGRESS: ProgressForm = {
  targetId: "", periodYear: CURRENT_YEAR.toString(), periodMonth: "",
  actualValue: "", actualSavingValue: "", comment: "",
};

export default function Targets() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { unitId } = useUnit();
  const { companyId } = useCompany();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const unitParam = unitId !== null ? { unitId } : companyId !== null ? { companyId } : undefined;

  // ── Targets ─────────────────────────────────────────────
  const [targetOpen, setTargetOpen] = useState(false);
  const [editingTargetId, setEditingTargetId] = useState<number | null>(null);
  const [targetForm, setTargetForm] = useState<TargetForm>(EMPTY_TARGET);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);

  // ── Action Plans ────────────────────────────────────────
  const [actionOpen, setActionOpen] = useState(false);
  const [editingActionId, setEditingActionId] = useState<number | null>(null);
  const [actionForm, setActionForm] = useState<ActionPlanForm>(EMPTY_ACTION);
  const [deleteActionId, setDeleteActionId] = useState<number | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string>("");
  const [actions, setActions] = useState<any[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);

  // ── Progress ────────────────────────────────────────────
  const [progressOpen, setProgressOpen] = useState(false);
  const [deleteProgressId, setDeleteProgressId] = useState<number | null>(null);
  const [progressForm, setProgressForm] = useState<ProgressForm>(EMPTY_PROGRESS);
  const [selectedProgressTargetId, setSelectedProgressTargetId] = useState<string>("");
  const [progressList, setProgressList] = useState<any[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);

  const { data: targets, isLoading } = useListTargets(unitParam, { query: { queryKey: getListTargetsQueryKey(unitParam) } });
  const { data: allUnits } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}), enabled: isAdmin && unitId === null } });

  const unitMap: Record<number, string> = Object.fromEntries((allUnits ?? []).map((u: any) => [u.id, u.name]));
  const deleteTarget = useDeleteTarget();
  const [isSavingTarget, setIsSavingTarget] = useState(false);

  const authHeader = () => {
    const token = localStorage.getItem("eys_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // ─── Target handlers ─────────────────────────────────────
  function openCreateTarget() {
    setEditingTargetId(null);
    setTargetForm({ ...EMPTY_TARGET, unitId: unitId !== null ? unitId.toString() : "" });
    setTargetOpen(true);
  }
  function openEditTarget(t: any) {
    setEditingTargetId(t.id);
    setTargetForm({
      name: t.name, baselineYear: t.baselineYear.toString(), targetYear: t.targetYear.toString(),
      targetReductionPercent: t.targetReductionPercent.toString(), unitId: t.unitId?.toString() ?? "",
      objectiveText: t.objectiveText ?? "", targetText: t.targetText ?? "", targetType: t.targetType ?? "",
      subUnitId: t.subUnitId?.toString() ?? "", energySourceId: t.energySourceId?.toString() ?? "",
      unitLabel: t.unitLabel ?? "", status: t.status ?? "active",
      baselineValue: t.baselineValue?.toString() ?? "", targetValue: t.targetValue?.toString() ?? "",
      actualValue: t.actualValue?.toString() ?? "", notes: t.notes ?? "",
    });
    setTargetOpen(true);
  }

  async function handleSaveTarget() {
    const { name, baselineYear, targetYear, targetReductionPercent, unitId: fUnitId, status } = targetForm;
    if (!name) { toast({ title: "Hedef adı gerekli", variant: "destructive" }); return; }
    if (parseInt(targetYear) < parseInt(baselineYear)) { toast({ title: "Hedef yılı baz yıldan küçük olamaz", variant: "destructive" }); return; }
    const r = parseFloat(targetReductionPercent);
    if (isNaN(r) || r < 0 || r > 100) { toast({ title: "Azaltma oranı 0-100 arası olmalı", variant: "destructive" }); return; }

    const payload: any = {
      name,
      baselineYear: parseInt(baselineYear),
      targetYear: parseInt(targetYear),
      targetReductionPercent: r,
      notes: targetForm.notes || null,
      objectiveText: targetForm.objectiveText || null,
      targetText: targetForm.targetText || null,
      targetType: targetForm.targetType || null,
      unitLabel: targetForm.unitLabel || null,
      status: status || "active",
      baselineValue: targetForm.baselineValue !== "" ? targetForm.baselineValue : null,
      targetValue: targetForm.targetValue !== "" ? targetForm.targetValue : null,
      actualValue: targetForm.actualValue !== "" ? targetForm.actualValue : null,
      subUnitId: targetForm.subUnitId || null,
      energySourceId: targetForm.energySourceId || null,
      seuAssessmentId: null,
      unitId: fUnitId || null,
    };

    setIsSavingTarget(true);
    try {
      if (editingTargetId !== null) {
        await axios.patch(`/api/targets/${editingTargetId}`, payload, { headers: authHeader() });
        toast({ title: "Hedef güncellendi" });
      } else {
        await axios.post("/api/targets", payload, { headers: authHeader() });
        toast({ title: "Hedef eklendi" });
      }
      queryClient.invalidateQueries({ queryKey: getListTargetsQueryKey(unitParam) });
      setTargetOpen(false);
    } catch (e: any) {
      toast({ title: e?.response?.data?.error ?? "İşlem başarısız", variant: "destructive" });
    } finally {
      setIsSavingTarget(false);
    }
  }

  function handleDeleteTarget(id: number) {
    deleteTarget.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTargetsQueryKey(unitParam) });
        setDeleteTargetId(null);
        toast({ title: "Hedef silindi" });
      },
      onError: () => toast({ title: "Silme başarısız", variant: "destructive" }),
    });
  }

  // ─── Action Plan handlers ─────────────────────────────────
  async function loadActions(targetId: string) {
    if (!targetId) { setActions([]); return; }
    setActionsLoading(true);
    try {
      const r = await axios.get(`/api/energy-action-plans?targetId=${targetId}`, { headers: authHeader() });
      setActions(r.data);
    } catch { setActions([]); } finally { setActionsLoading(false); }
  }

  async function handleSaveAction() {
    const { targetId, title, priority, status, isVap, progressPercent } = actionForm;
    if (!targetId) { toast({ title: "Hedef seçiniz", variant: "destructive" }); return; }
    if (!title) { toast({ title: "Eylem adı zorunludur", variant: "destructive" }); return; }
    const prog = parseFloat(progressPercent);
    if (isNaN(prog) || prog < 0 || prog > 100) { toast({ title: "İlerleme 0-100 arası olmalı", variant: "destructive" }); return; }

    const payload = {
      targetId, title, description: actionForm.description || null,
      responsibleName: actionForm.responsibleName || null, priority,
      expectedSavingValue: actionForm.expectedSavingValue || null,
      expectedSavingUnit: actionForm.expectedSavingUnit || null,
      expectedCostSaving: actionForm.expectedCostSaving || null,
      investmentCost: actionForm.investmentCost || null,
      paybackMonths: actionForm.paybackMonths || null,
      startDate: actionForm.startDate || null, dueDate: actionForm.dueDate || null,
      completionDate: actionForm.completionDate || null,
      progressPercent: prog, status, isVap, notes: actionForm.notes || null,
    };
    try {
      if (editingActionId !== null) {
        await axios.put(`/api/energy-action-plans/${editingActionId}`, payload, { headers: authHeader() });
        toast({ title: "Eylem planı güncellendi" });
      } else {
        await axios.post("/api/energy-action-plans", payload, { headers: authHeader() });
        toast({ title: "Eylem planı eklendi" });
      }
      setActionOpen(false);
      await loadActions(selectedTargetId);
    } catch (e: any) {
      toast({ title: e?.response?.data?.error ?? "İşlem başarısız", variant: "destructive" });
    }
  }

  async function handleDeleteAction(id: number) {
    try {
      await axios.delete(`/api/energy-action-plans/${id}`, { headers: authHeader() });
      toast({ title: "Eylem planı silindi" });
      setDeleteActionId(null);
      await loadActions(selectedTargetId);
    } catch { toast({ title: "Silme başarısız", variant: "destructive" }); }
  }

  // ─── Progress handlers ────────────────────────────────────
  async function loadProgress(targetId: string) {
    if (!targetId) { setProgressList([]); return; }
    setProgressLoading(true);
    try {
      const r = await axios.get(`/api/energy-target-progress?targetId=${targetId}`, { headers: authHeader() });
      setProgressList(r.data);
    } catch { setProgressList([]); } finally { setProgressLoading(false); }
  }

  async function handleSaveProgress() {
    const { targetId, periodYear, actualValue } = progressForm;
    if (!targetId) { toast({ title: "Hedef seçiniz", variant: "destructive" }); return; }
    if (!periodYear) { toast({ title: "Yıl zorunludur", variant: "destructive" }); return; }
    if (actualValue === "") { toast({ title: "Gerçekleşen değer zorunludur", variant: "destructive" }); return; }
    if (parseFloat(actualValue) < 0) { toast({ title: "Değer negatif olamaz", variant: "destructive" }); return; }
    try {
      await axios.post("/api/energy-target-progress", {
        targetId, periodYear, periodMonth: progressForm.periodMonth || null,
        actualValue, actualSavingValue: progressForm.actualSavingValue || null,
        comment: progressForm.comment || null,
      }, { headers: authHeader() });
      toast({ title: "Gerçekleşme kaydedildi" });
      setProgressOpen(false);
      await loadProgress(selectedProgressTargetId);
      queryClient.invalidateQueries({ queryKey: getListTargetsQueryKey(unitParam) });
    } catch (e: any) {
      toast({ title: e?.response?.data?.error ?? "İşlem başarısız", variant: "destructive" });
    }
  }

  async function handleDeleteProgress(id: number) {
    try {
      await axios.delete(`/api/energy-target-progress/${id}`, { headers: authHeader() });
      toast({ title: "Kayıt silindi" });
      setDeleteProgressId(null);
      await loadProgress(selectedProgressTargetId);
    } catch { toast({ title: "Silme başarısız", variant: "destructive" }); }
  }

  // ─── Summary stats ────────────────────────────────────────
  const targetList = targets ?? [];
  const totalTargets = targetList.length;
  const achieved = targetList.filter((t: any) => t.yearlyProgress?.at(-1)?.reductionPercent >= t.targetReductionPercent).length;
  const inProgress = targetList.filter((t: any) => {
    const r = t.yearlyProgress?.at(-1)?.reductionPercent;
    return r !== null && r > 0 && r < t.targetReductionPercent;
  }).length;
  const avgTarget = totalTargets > 0 ? targetList.reduce((s: number, t: any) => s + t.targetReductionPercent, 0) / totalTargets : 0;


  // ─── Action plan auto payback ─────────────────────────────
  function onActionFormChange(field: keyof ActionPlanForm, value: string | boolean) {
    setActionForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "investmentCost" || field === "expectedCostSaving") {
        const inv = parseFloat(field === "investmentCost" ? (value as string) : prev.investmentCost);
        const saving = parseFloat(field === "expectedCostSaving" ? (value as string) : prev.expectedCostSaving);
        if (!isNaN(inv) && !isNaN(saving) && saving > 0) {
          next.paybackMonths = ((inv / saving) * 12).toFixed(1);
        } else {
          next.paybackMonths = "";
        }
      }
      return next;
    });
  }

  const selectedTarget = targetList.find((t: any) => t.id.toString() === selectedTargetId);
  const selectedProgressTarget = targetList.find((t: any) => t.id.toString() === selectedProgressTargetId) as any;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Enerji Amaçları, Hedefleri ve Eylem Planları
          </h1>
          <p className="text-muted-foreground text-sm mt-1">ISO 50001 — Amaç, hedef ve eylem planı yönetimi</p>
        </div>
      </div>

      {/* Summary Cards */}
      {totalTargets > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card/50 border-border/50"><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Toplam Hedef</p>
            <p className="text-2xl font-bold mt-1">{totalTargets}</p>
          </CardContent></Card>
          <Card className="bg-card/50 border-border/50"><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Hedefe Ulaşılan</p>
            <p className="text-2xl font-bold mt-1 text-green-400">{achieved}</p>
          </CardContent></Card>
          <Card className="bg-card/50 border-border/50"><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Devam Eden</p>
            <p className="text-2xl font-bold mt-1 text-blue-400">{inProgress}</p>
          </CardContent></Card>
          <Card className="bg-card/50 border-border/50"><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Ort. Hedef Azalma</p>
            <p className="text-2xl font-bold mt-1">%{fmt(avgTarget)}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="objectives">
        <TabsList className="bg-muted/40">
          <TabsTrigger value="objectives" className="gap-2"><Target className="h-4 w-4" />Amaç ve Hedefler</TabsTrigger>
          <TabsTrigger value="actions" className="gap-2"><ListChecks className="h-4 w-4" />Eylem Planları</TabsTrigger>
          <TabsTrigger value="progress" className="gap-2"><Activity className="h-4 w-4" />İzleme ve Gerçekleşme</TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Objectives / Targets ── */}
        <TabsContent value="objectives" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={openCreateTarget} className="gap-2"><Plus className="h-4 w-4" />Yeni Hedef</Button>
          </div>
          {isLoading ? (
            <div className="grid md:grid-cols-2 gap-4">{[1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>
          ) : !targetList.length ? (
            <Card className="border-dashed border-border/50">
              <CardContent className="py-16 text-center">
                <Target className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">Henüz enerji hedefi tanımlanmamış.</p>
                <Button onClick={openCreateTarget} variant="outline" className="mt-4 gap-2"><Plus className="h-4 w-4" />İlk Hedefi Ekle</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {targetList.map((t: any) => {
                const lastReduction = t.yearlyProgress?.at(-1)?.reductionPercent ?? null;
                return (
                  <Card key={t.id} className="bg-card/50 border-border/50">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-base truncate">{t.name}</CardTitle>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground">{t.baselineYear} → {t.targetYear}</span>
                            {isAdmin && t.unitId && (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Building2 className="h-3 w-3" />{unitMap[t.unitId] ?? `Birim #${t.unitId}`}
                              </span>
                            )}
                            <StatusBadge status={t.status ?? "active"} items={TARGET_STATUSES} />
                            {t.targetType && (
                              <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                {TARGET_TYPES.find((x) => x.value === t.targetType)?.label ?? t.targetType}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditTarget(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteTargetId(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {t.objectiveText && <p className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-2">{t.objectiveText}</p>}
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-muted/40 px-2 py-2">
                          <p className="text-xs text-muted-foreground">Hedef Azalma</p>
                          <p className="text-lg font-bold text-primary">%{fmt(t.targetReductionPercent)}</p>
                        </div>
                        <div className="rounded-lg bg-muted/40 px-2 py-2">
                          <p className="text-xs text-muted-foreground">Gerçekleşen</p>
                          <p className={`text-lg font-bold ${lastReduction !== null && lastReduction >= t.targetReductionPercent ? "text-green-400" : lastReduction !== null && lastReduction > 0 ? "text-blue-400" : "text-muted-foreground"}`}>
                            {lastReduction !== null ? `%${fmt(lastReduction)}` : "—"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/40 px-2 py-2">
                          <p className="text-xs text-muted-foreground">Hedef Değer</p>
                          <p className="text-sm font-semibold">
                            {t.targetValue != null ? `${fmt(t.targetValue, 0)} ${t.unitLabel ?? ""}` : "—"}
                          </p>
                        </div>
                      </div>
                      <ProgressBar actual={lastReduction} target={t.targetReductionPercent} />
                      <EnpiChart target={t} />
                      {t.notes && <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">{t.notes}</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── TAB 2: Action Plans ── */}
        <TabsContent value="actions" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 max-w-xs">
              <Select value={selectedTargetId} onValueChange={(v) => { setSelectedTargetId(v); loadActions(v); }}>
                <SelectTrigger><SelectValue placeholder="Hedef seçin..." /></SelectTrigger>
                <SelectContent>
                  {targetList.map((t: any) => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => { setEditingActionId(null); setActionForm({ ...EMPTY_ACTION, targetId: selectedTargetId }); setActionOpen(true); }} disabled={!selectedTargetId} className="gap-2">
              <Plus className="h-4 w-4" />Eylem Ekle
            </Button>
          </div>

          {!selectedTargetId ? (
            <Card className="border-dashed border-border/50">
              <CardContent className="py-12 text-center">
                <ListChecks className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Eylem planlarını görüntülemek için bir hedef seçin.</p>
              </CardContent>
            </Card>
          ) : actionsLoading ? (
            <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          ) : actions.length === 0 ? (
            <Card className="border-dashed border-border/50">
              <CardContent className="py-12 text-center">
                <ListChecks className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Bu hedefe ait eylem planı yok.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {actions.map((a: any) => (
                <Card key={a.id} className="bg-card/50 border-border/50">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{a.title}</span>
                          {a.isVap && <Badge className="bg-teal-500/20 text-teal-400 border-0 text-xs">VAP</Badge>}
                          <StatusBadge status={a.status} items={ACTION_STATUSES} />
                          <StatusBadge status={a.priority} items={PRIORITIES} />
                        </div>
                        {a.description && <p className="text-xs text-muted-foreground mt-1">{a.description}</p>}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
                          {a.responsibleName && <span className="text-muted-foreground">Sorumlu: <span className="text-foreground">{a.responsibleName}</span></span>}
                          {a.startDate && <span className="text-muted-foreground">Başlangıç: <span className="text-foreground">{a.startDate}</span></span>}
                          {a.dueDate && <span className="text-muted-foreground">Bitiş: <span className="text-foreground">{a.dueDate}</span></span>}
                          {a.expectedSavingValue && <span className="text-muted-foreground">Tasarruf: <span className="text-foreground">{fmt(a.expectedSavingValue, 0)} {a.expectedSavingUnit ?? ""}</span></span>}
                          {a.investmentCost && <span className="text-muted-foreground">Yatırım: <span className="text-foreground">{fmt(a.investmentCost, 0)} ₺</span></span>}
                          {a.paybackMonths && <span className="text-muted-foreground">Geri Ödeme: <span className="text-foreground">{fmt(a.paybackMonths, 0)} ay</span></span>}
                        </div>
                        <div className="mt-2">
                          <div className="flex justify-between text-xs text-muted-foreground mb-1">
                            <span>İlerleme</span><span className="text-foreground font-medium">%{fmt(a.progressPercent, 0)}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, a.progressPercent ?? 0)}%` }} />
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                          setEditingActionId(a.id);
                          setActionForm({
                            targetId: a.targetId.toString(), title: a.title, description: a.description ?? "",
                            responsibleName: a.responsibleName ?? "", priority: a.priority,
                            expectedSavingValue: a.expectedSavingValue?.toString() ?? "",
                            expectedSavingUnit: a.expectedSavingUnit ?? "kWh",
                            expectedCostSaving: a.expectedCostSaving?.toString() ?? "",
                            investmentCost: a.investmentCost?.toString() ?? "",
                            paybackMonths: a.paybackMonths?.toString() ?? "",
                            startDate: a.startDate ?? "", dueDate: a.dueDate ?? "", completionDate: a.completionDate ?? "",
                            progressPercent: a.progressPercent?.toString() ?? "0", status: a.status,
                            isVap: a.isVap, notes: a.notes ?? "",
                          });
                          setActionOpen(true);
                        }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteActionId(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── TAB 3: Progress ── */}
        <TabsContent value="progress" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex-1 max-w-xs">
              <Select value={selectedProgressTargetId} onValueChange={(v) => { setSelectedProgressTargetId(v); loadProgress(v); }}>
                <SelectTrigger><SelectValue placeholder="Hedef seçin..." /></SelectTrigger>
                <SelectContent>
                  {targetList.map((t: any) => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => { setProgressForm({ ...EMPTY_PROGRESS, targetId: selectedProgressTargetId }); setProgressOpen(true); }} disabled={!selectedProgressTargetId} className="gap-2">
              <Plus className="h-4 w-4" />Kayıt Ekle
            </Button>
          </div>

          {selectedProgressTarget && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Baz Değer", value: selectedProgressTarget.baselineValue != null ? `${fmt(selectedProgressTarget.baselineValue, 0)} ${selectedProgressTarget.unitLabel ?? ""}` : "—" },
                { label: "Hedef Değer", value: selectedProgressTarget.targetValue != null ? `${fmt(selectedProgressTarget.targetValue, 0)} ${selectedProgressTarget.unitLabel ?? ""}` : "—" },
                { label: "Gerçekleşen", value: selectedProgressTarget.actualValue != null ? `${fmt(selectedProgressTarget.actualValue, 0)} ${selectedProgressTarget.unitLabel ?? ""}` : "—" },
                {
                  label: "Durum",
                  value: (() => {
                    const { baselineValue, targetValue, actualValue } = selectedProgressTarget;
                    if (baselineValue == null || targetValue == null) return "Değer girilmemiş";
                    if (actualValue == null) return "Kayıt yok";
                    return actualValue <= targetValue ? "✓ Hedef Sağlandı" : "⚠ Riskli";
                  })(),
                },
              ].map((c) => (
                <Card key={c.label} className="bg-card/50 border-border/50">
                  <CardContent className="p-3">
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                    <p className="text-sm font-semibold mt-0.5">{c.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {selectedProgressTarget && selectedProgressTarget.baselineValue == null && (
            <p className="text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg">
              Baz değer ve hedef değer girildiğinde gerçekleşme durumu hesaplanır.
            </p>
          )}

          {!selectedProgressTargetId ? (
            <Card className="border-dashed border-border/50">
              <CardContent className="py-12 text-center">
                <Activity className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Gerçekleşme kayıtlarını görüntülemek için bir hedef seçin.</p>
              </CardContent>
            </Card>
          ) : progressLoading ? (
            <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : progressList.length === 0 ? (
            <Card className="border-dashed border-border/50">
              <CardContent className="py-12 text-center">
                <Activity className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Bu hedefe ait gerçekleşme kaydı yok.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {progressList.map((p: any) => (
                <Card key={p.id} className="bg-card/50 border-border/50">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                      <span className="text-muted-foreground">Yıl: <span className="text-foreground font-medium">{p.periodYear}{p.periodMonth ? `/${p.periodMonth}` : ""}</span></span>
                      <span className="text-muted-foreground">Değer: <span className="text-foreground font-medium">{fmt(p.actualValue, 1)}</span></span>
                      {p.actualSavingValue != null && <span className="text-muted-foreground">Tasarruf: <span className="text-foreground font-medium">{fmt(p.actualSavingValue, 1)}</span></span>}
                      {p.comment && <span className="text-muted-foreground col-span-2">{p.comment}</span>}
                      <span className="text-muted-foreground">Kaydeden: <span className="text-foreground">{p.recordedBy ?? "—"}</span></span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive shrink-0" onClick={() => setDeleteProgressId(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ── Target Add/Edit Dialog ── */}
      <Dialog open={targetOpen} onOpenChange={setTargetOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTargetId !== null ? "Hedefi Düzenle" : "Yeni Enerji Hedefi"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Hedef Adı *</Label>
                <Input placeholder="ör. Ana Fabrika 2030 Enerji Hedefi" value={targetForm.name} onChange={(e) => setTargetForm({ ...targetForm, name: e.target.value })} />
              </div>
              {isAdmin && unitId === null && (
                <div className="space-y-1.5">
                  <Label>Birim *</Label>
                  <Select value={targetForm.unitId} onValueChange={(v) => setTargetForm({ ...targetForm, unitId: v })}>
                    <SelectTrigger><SelectValue placeholder="Birim seç" /></SelectTrigger>
                    <SelectContent>{(allUnits ?? []).map((u: any) => <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Hedef Tipi</Label>
                <Select value={targetForm.targetType} onValueChange={(v) => setTargetForm({ ...targetForm, targetType: v })}>
                  <SelectTrigger><SelectValue placeholder="Seç..." /></SelectTrigger>
                  <SelectContent>{TARGET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Durum</Label>
                <Select value={targetForm.status} onValueChange={(v) => setTargetForm({ ...targetForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TARGET_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Baz Yıl *</Label>
                <Select value={targetForm.baselineYear} onValueChange={(v) => setTargetForm({ ...targetForm, baselineYear: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Hedef Yıl *</Label>
                <Select value={targetForm.targetYear} onValueChange={(v) => setTargetForm({ ...targetForm, targetYear: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Hedef Azalma Oranı (%) *</Label>
                <div className="relative">
                  <Input type="number" min="0" max="100" step="0.5" value={targetForm.targetReductionPercent} onChange={(e) => setTargetForm({ ...targetForm, targetReductionPercent: e.target.value })} className="pr-8" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Ölçü Birimi</Label>
                <Input placeholder="ör. kWh, MWh, tep" value={targetForm.unitLabel} onChange={(e) => setTargetForm({ ...targetForm, unitLabel: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Baz Değer</Label>
                <Input type="number" min="0" placeholder="Opsiyonel" value={targetForm.baselineValue} onChange={(e) => setTargetForm({ ...targetForm, baselineValue: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Hedef Değer</Label>
                <Input type="number" min="0" placeholder="Opsiyonel" value={targetForm.targetValue} onChange={(e) => setTargetForm({ ...targetForm, targetValue: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Gerçekleşen Değer</Label>
                <Input type="number" min="0" placeholder="Opsiyonel" value={targetForm.actualValue} onChange={(e) => setTargetForm({ ...targetForm, actualValue: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Amaç Metni</Label>
                <Textarea placeholder="ISO 50001 amaç ifadesi..." value={targetForm.objectiveText} onChange={(e) => setTargetForm({ ...targetForm, objectiveText: e.target.value })} rows={2} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Hedef Açıklaması</Label>
                <Textarea placeholder="Hedefle ilgili detaylı açıklama..." value={targetForm.targetText} onChange={(e) => setTargetForm({ ...targetForm, targetText: e.target.value })} rows={2} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Notlar</Label>
                <Textarea placeholder="Ek bilgi veya strateji notları..." value={targetForm.notes} onChange={(e) => setTargetForm({ ...targetForm, notes: e.target.value })} rows={2} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTargetOpen(false)}>İptal</Button>
            <Button onClick={handleSaveTarget} disabled={isSavingTarget}>{isSavingTarget ? "Kaydediliyor..." : editingTargetId !== null ? "Güncelle" : "Ekle"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Action Plan Dialog ── */}
      <Dialog open={actionOpen} onOpenChange={setActionOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingActionId !== null ? "Eylem Planını Düzenle" : "Yeni Eylem Planı"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Hedef *</Label>
                <Select value={actionForm.targetId} onValueChange={(v) => setActionForm({ ...actionForm, targetId: v })} disabled={!!editingActionId}>
                  <SelectTrigger><SelectValue placeholder="Hedef seçin..." /></SelectTrigger>
                  <SelectContent>{targetList.map((t: any) => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Eylem Adı *</Label>
                <Input placeholder="Eylem planı başlığı" value={actionForm.title} onChange={(e) => onActionFormChange("title", e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Açıklama</Label>
                <Textarea placeholder="Eylem planı detayları..." value={actionForm.description} onChange={(e) => onActionFormChange("description", e.target.value)} rows={2} />
              </div>
              <div className="space-y-1.5">
                <Label>Sorumlu</Label>
                <Input placeholder="Ad Soyad" value={actionForm.responsibleName} onChange={(e) => onActionFormChange("responsibleName", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Öncelik</Label>
                <Select value={actionForm.priority} onValueChange={(v) => onActionFormChange("priority", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Durum</Label>
                <Select value={actionForm.status} onValueChange={(v) => onActionFormChange("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ACTION_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>İlerleme (%)</Label>
                <Input type="number" min="0" max="100" value={actionForm.progressPercent} onChange={(e) => onActionFormChange("progressPercent", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Beklenen Enerji Tasarrufu</Label>
                <Input type="number" min="0" placeholder="Miktar" value={actionForm.expectedSavingValue} onChange={(e) => onActionFormChange("expectedSavingValue", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Tasarruf Birimi</Label>
                <Input placeholder="kWh, MWh, tep..." value={actionForm.expectedSavingUnit} onChange={(e) => onActionFormChange("expectedSavingUnit", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Beklenen yıllık mali tasarruf (₺)</Label>
                <Input type="number" min="0" placeholder="Yıllık tutar" value={actionForm.expectedCostSaving} onChange={(e) => onActionFormChange("expectedCostSaving", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Yatırım maliyeti (₺)</Label>
                <Input type="number" min="0" placeholder="Toplam yatırım" value={actionForm.investmentCost} onChange={(e) => onActionFormChange("investmentCost", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Geri ödeme süresi / yatırım geri dönüşü (ay)</Label>
                <Input type="number" min="0" placeholder="Otomatik hesaplanır" value={actionForm.paybackMonths} onChange={(e) => onActionFormChange("paybackMonths", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Başlangıç Tarihi</Label>
                <Input type="date" value={actionForm.startDate} onChange={(e) => onActionFormChange("startDate", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Bitiş Tarihi</Label>
                <Input type="date" value={actionForm.dueDate} onChange={(e) => onActionFormChange("dueDate", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Tamamlanma Tarihi</Label>
                <Input type="date" value={actionForm.completionDate} onChange={(e) => onActionFormChange("completionDate", e.target.value)} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Notlar</Label>
                <Textarea placeholder="Ek notlar..." value={actionForm.notes} onChange={(e) => onActionFormChange("notes", e.target.value)} rows={2} />
              </div>
              <div className="col-span-2 flex items-center gap-2 rounded-lg border border-border/50 p-3 bg-muted/20">
                <Checkbox id="isVap" checked={actionForm.isVap} onCheckedChange={(v) => onActionFormChange("isVap", Boolean(v))} />
                <label htmlFor="isVap" className="text-sm cursor-pointer">
                  Bu eylem <span className="font-medium text-teal-400">Verimlilik Artırıcı Proje (VAP)</span> olarak işaretlensin
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionOpen(false)}>İptal</Button>
            <Button onClick={handleSaveAction}>{editingActionId !== null ? "Güncelle" : "Ekle"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Progress Dialog ── */}
      <Dialog open={progressOpen} onOpenChange={setProgressOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gerçekleşme Kaydı Ekle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Hedef *</Label>
              <Select value={progressForm.targetId} onValueChange={(v) => setProgressForm({ ...progressForm, targetId: v })}>
                <SelectTrigger><SelectValue placeholder="Hedef seçin..." /></SelectTrigger>
                <SelectContent>{targetList.map((t: any) => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Yıl *</Label>
                <Select value={progressForm.periodYear} onValueChange={(v) => setProgressForm({ ...progressForm, periodYear: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Ay (opsiyonel)</Label>
                <Select value={progressForm.periodMonth || "all"} onValueChange={(v) => setProgressForm({ ...progressForm, periodMonth: v === "all" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Tüm yıl" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm yıl</SelectItem>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <SelectItem key={m} value={m.toString()}>{m}. Ay</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Gerçekleşen Değer *</Label>
              <Input type="number" min="0" placeholder="Ölçülen değer" value={progressForm.actualValue} onChange={(e) => setProgressForm({ ...progressForm, actualValue: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Gerçekleşen Tasarruf (opsiyonel)</Label>
              <Input type="number" min="0" placeholder="Tasarruf miktarı" value={progressForm.actualSavingValue} onChange={(e) => setProgressForm({ ...progressForm, actualSavingValue: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Yorum</Label>
              <Textarea placeholder="Açıklama..." value={progressForm.comment} onChange={(e) => setProgressForm({ ...progressForm, comment: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProgressOpen(false)}>İptal</Button>
            <Button onClick={handleSaveProgress}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirms ── */}
      <Dialog open={deleteTargetId !== null} onOpenChange={(o) => !o && setDeleteTargetId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Hedefi Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Bu hedefi silmek istediğinizden emin misiniz? Bağlı tüm eylem planları ve izleme kayıtları da silinecektir.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTargetId(null)}>İptal</Button>
            <Button variant="destructive" onClick={() => deleteTargetId && handleDeleteTarget(deleteTargetId)} disabled={deleteTarget.isPending}>{deleteTarget.isPending ? "Siliniyor..." : "Sil"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteActionId !== null} onOpenChange={(o) => !o && setDeleteActionId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Eylem Planını Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Bu eylem planını silmek istediğinizden emin misiniz?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteActionId(null)}>İptal</Button>
            <Button variant="destructive" onClick={() => deleteActionId && handleDeleteAction(deleteActionId)}>Sil</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteProgressId !== null} onOpenChange={(o) => !o && setDeleteProgressId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Kaydı Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Bu gerçekleşme kaydını silmek istediğinizden emin misiniz?</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteProgressId(null)}>İptal</Button>
            <Button variant="destructive" onClick={() => deleteProgressId && handleDeleteProgress(deleteProgressId)}>Sil</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
