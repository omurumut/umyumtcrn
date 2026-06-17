import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUnit } from "@/context/UnitContext";
import { useAuth } from "@/context/AuthContext";
import {
  useListTargets,
  useCreateTarget,
  useUpdateTarget,
  useDeleteTarget,
  getListTargetsQueryKey,
  useListUnits,
  getListUnitsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Target, TrendingDown, TrendingUp, CheckCircle2, Clock, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from "recharts";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 20 }, (_, i) => CURRENT_YEAR - 10 + i);

interface TargetForm {
  name: string;
  baselineYear: string;
  targetYear: string;
  targetReductionPercent: string;
  notes: string;
  unitId: string;
}

const EMPTY_FORM: TargetForm = {
  name: "",
  baselineYear: (CURRENT_YEAR - 1).toString(),
  targetYear: (CURRENT_YEAR + 4).toString(),
  targetReductionPercent: "10",
  notes: "",
  unitId: "",
};

function fmt(n: number | null | undefined, dec = 1) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function StatusBadge({ target, lastReduction }: { target: any; lastReduction: number | null }) {
  const now = CURRENT_YEAR;
  if (target.targetYear < now) {
    if (lastReduction !== null && lastReduction >= target.targetReductionPercent) {
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1"><CheckCircle2 className="h-3 w-3" />Hedef Aşıldı</Badge>;
    }
    return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1"><TrendingUp className="h-3 w-3" />Hedef Kaçırıldı</Badge>;
  }
  if (lastReduction !== null && lastReduction >= target.targetReductionPercent) {
    return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1"><CheckCircle2 className="h-3 w-3" />Hedefe Ulaşıldı</Badge>;
  }
  if (lastReduction !== null && lastReduction > 0) {
    return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 gap-1"><TrendingDown className="h-3 w-3" />İlerleme Var</Badge>;
  }
  return <Badge className="bg-muted text-muted-foreground gap-1"><Clock className="h-3 w-3" />Başlangıç</Badge>;
}

function ProgressBar({ actual, target }: { actual: number | null; target: number }) {
  if (actual === null) return <div className="text-xs text-muted-foreground">Veri yok</div>;
  const clamped = Math.max(0, Math.min(actual, target * 1.5));
  const pct = Math.min(100, (clamped / target) * 100);
  const color = actual >= target ? "bg-green-500" : actual > 0 ? "bg-blue-500" : "bg-muted-foreground/30";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Gerçekleşen: <span className="text-foreground font-medium">{fmt(actual)}%</span></span>
        <span>Hedef: <span className="text-foreground font-medium">{fmt(target, 1)}%</span></span>
      </div>
      <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EnpiChart({ target }: { target: any }) {
  if (!target.yearlyProgress?.length) return null;
  const baseline = target.baselineKwh;

  const data = target.yearlyProgress.map((p: any) => {
    const years = p.year - target.baselineYear;
    const linearTarget = years === 0 ? 0 : parseFloat(
      ((target.targetReductionPercent / (target.targetYear - target.baselineYear)) * years).toFixed(2)
    );
    return {
      year: p.year,
      gerceklesen: p.reductionPercent,
      hedef: parseFloat(linearTarget.toFixed(2)),
      kwh: p.actualKwh,
    };
  });

  // Add final target point if not yet reached
  if (target.targetYear > CURRENT_YEAR) {
    data.push({ year: target.targetYear, gerceklesen: null, hedef: target.targetReductionPercent, kwh: null });
  }

  return (
    <div className="mt-4 pt-4 border-t border-border/50">
      <p className="text-xs text-muted-foreground mb-2 font-medium">EnPI İlerleme Grafiği (% azalma)</p>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis dataKey="year" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
          <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} unit="%" />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
            formatter={(v: any, name: string) => [v != null ? `${fmt(v)}%` : "—", name === "gerceklesen" ? "Gerçekleşen" : "Hedef Seyri"]}
          />
          <Legend formatter={(v) => v === "gerceklesen" ? "Gerçekleşen" : "Hedef Seyri"} wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 2" />
          <Line type="monotone" dataKey="hedef" stroke="#6366f1" strokeDasharray="5 3" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="gerceklesen" stroke="#22c55e" dot={{ fill: "#22c55e", r: 3 }} strokeWidth={2} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
      {baseline !== null && (
        <p className="text-xs text-muted-foreground mt-1">
          Baz Tüketim ({target.baselineYear}): <span className="text-foreground">{fmt(baseline, 0)} kWh</span>
        </p>
      )}
    </div>
  );
}

export default function Targets() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { unitId } = useUnit();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const unitParam = unitId !== null ? { unitId } : undefined;

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TargetForm>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: targets, isLoading } = useListTargets(unitParam, {
    query: { queryKey: getListTargetsQueryKey(unitParam) },
  });
  const { data: allUnits } = useListUnits({
    query: { queryKey: getListUnitsQueryKey(), enabled: isAdmin && unitId === null },
  });
  const unitMap: Record<number, string> = Object.fromEntries(
    (allUnits ?? []).map((u: any) => [u.id, u.name])
  );

  const createTarget = useCreateTarget();
  const updateTarget = useUpdateTarget();
  const deleteTarget = useDeleteTarget();

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, unitId: unitId !== null ? unitId.toString() : "" });
    setOpen(true);
  }
  function openEdit(t: any) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      baselineYear: t.baselineYear.toString(),
      targetYear: t.targetYear.toString(),
      targetReductionPercent: t.targetReductionPercent.toString(),
      notes: t.notes ?? "",
      unitId: t.unitId?.toString() ?? "",
    });
    setOpen(true);
  }

  function handleSave() {
    const { name, baselineYear, targetYear, targetReductionPercent, notes, unitId: formUnitId } = form;
    if (!name) { toast({ title: "Hedef adı gerekli", variant: "destructive" }); return; }
    if (parseInt(targetYear) <= parseInt(baselineYear)) {
      toast({ title: "Hedef yılı baz yıldan büyük olmalı", variant: "destructive" }); return;
    }
    const payload: any = {
      name,
      baselineYear: parseInt(baselineYear),
      targetYear: parseInt(targetYear),
      targetReductionPercent: parseFloat(targetReductionPercent),
      notes: notes || undefined,
    };
    if (formUnitId) payload.unitId = parseInt(formUnitId);

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: getListTargetsQueryKey(unitParam) });
      setOpen(false);
    };

    if (editingId !== null) {
      updateTarget.mutate({ id: editingId, data: payload }, {
        onSuccess: () => { invalidate(); toast({ title: "Hedef güncellendi" }); },
        onError: () => toast({ title: "Güncelleme başarısız", variant: "destructive" }),
      });
    } else {
      createTarget.mutate({ data: payload }, {
        onSuccess: () => { invalidate(); toast({ title: "Hedef eklendi" }); },
        onError: () => toast({ title: "Ekleme başarısız", variant: "destructive" }),
      });
    }
  }

  function handleDelete(id: number) {
    deleteTarget.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTargetsQueryKey(unitParam) });
        setDeleteId(null);
        toast({ title: "Hedef silindi" });
      },
      onError: () => toast({ title: "Silme başarısız", variant: "destructive" }),
    });
  }

  const isSaving = createTarget.isPending || updateTarget.isPending;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Enerji Hedefleri
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            ISO 50001 — Yıllık enerji azaltma hedefleri ve EnPI ilerleme takibi
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          Yeni Hedef
        </Button>
      </div>

      {/* Summary Cards */}
      {!isLoading && targets && targets.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(() => {
            const total = targets.length;
            const achieved = targets.filter((t: any) => {
              const last = t.yearlyProgress?.at(-1)?.reductionPercent;
              return last !== null && last >= t.targetReductionPercent;
            }).length;
            const inProgress = targets.filter((t: any) => {
              const last = t.yearlyProgress?.at(-1)?.reductionPercent;
              return last !== null && last > 0 && last < t.targetReductionPercent;
            }).length;
            const avgTarget = targets.reduce((s: number, t: any) => s + t.targetReductionPercent, 0) / total;
            return (
              <>
                <Card className="bg-card/50 border-border/50">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Toplam Hedef</p>
                    <p className="text-2xl font-bold mt-1">{total}</p>
                  </CardContent>
                </Card>
                <Card className="bg-card/50 border-border/50">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Hedefe Ulaşılan</p>
                    <p className="text-2xl font-bold mt-1 text-green-400">{achieved}</p>
                  </CardContent>
                </Card>
                <Card className="bg-card/50 border-border/50">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">İlerleme Olan</p>
                    <p className="text-2xl font-bold mt-1 text-blue-400">{inProgress}</p>
                  </CardContent>
                </Card>
                <Card className="bg-card/50 border-border/50">
                  <CardContent className="p-4">
                    <p className="text-xs text-muted-foreground">Ort. Hedef Azalma</p>
                    <p className="text-2xl font-bold mt-1">%{fmt(avgTarget)}</p>
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </div>
      )}

      {/* Targets List */}
      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
      ) : !targets?.length ? (
        <Card className="border-dashed border-border/50">
          <CardContent className="py-16 text-center">
            <Target className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Henüz enerji hedefi tanımlanmamış.</p>
            <Button onClick={openCreate} variant="outline" className="mt-4 gap-2">
              <Plus className="h-4 w-4" />İlk Hedefi Ekle
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {targets.map((t: any) => {
            const lastPoint = t.yearlyProgress?.at(-1);
            const lastReduction = lastPoint?.reductionPercent ?? null;
            const currentYearPoint = t.yearlyProgress?.find((p: any) => p.year === CURRENT_YEAR);
            const latestActualKwh = currentYearPoint?.actualKwh ?? lastPoint?.actualKwh ?? null;
            return (
              <Card key={t.id} className="bg-card/50 border-border/50">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base truncate">{t.name}</CardTitle>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground">
                          {t.baselineYear} → {t.targetYear}
                        </span>
                        {isAdmin && t.unitId && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Building2 className="h-3 w-3" />{unitMap[t.unitId] ?? `Birim #${t.unitId}`}
                          </span>
                        )}
                        <StatusBadge target={t} lastReduction={lastReduction} />
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Key metrics */}
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
                      <p className="text-xs text-muted-foreground">Güncel kWh</p>
                      <p className="text-sm font-semibold">
                        {latestActualKwh !== null ? `${(latestActualKwh / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}k` : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <ProgressBar actual={lastReduction} target={t.targetReductionPercent} />

                  {/* EnPI chart */}
                  <EnpiChart target={t} />

                  {t.notes && (
                    <p className="text-xs text-muted-foreground border-t border-border/50 pt-2 mt-2">{t.notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "Hedefi Düzenle" : "Yeni Enerji Hedefi"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Hedef Adı *</Label>
              <Input
                placeholder="ör. Ana Fabrika 2030 Hedefi"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            {isAdmin && unitId === null && (
              <div className="space-y-1.5">
                <Label>Birim</Label>
                <Select value={form.unitId} onValueChange={(v) => setForm({ ...form, unitId: v })}>
                  <SelectTrigger><SelectValue placeholder="Birim seç" /></SelectTrigger>
                  <SelectContent>
                    {(allUnits ?? []).map((u: any) => (
                      <SelectItem key={u.id} value={u.id.toString()}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Baz Yıl *</Label>
                <Select value={form.baselineYear} onValueChange={(v) => setForm({ ...form, baselineYear: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Hedef Yıl *</Label>
                <Select value={form.targetYear} onValueChange={(v) => setForm({ ...form, targetYear: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{YEARS.map((y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Hedef Azalma Oranı (%) *</Label>
              <div className="relative">
                <Input
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.5"
                  value={form.targetReductionPercent}
                  onChange={(e) => setForm({ ...form, targetReductionPercent: e.target.value })}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Baz yıla göre {form.targetYear} sonunda hedeflenen azalma yüzdesi
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Notlar</Label>
              <Textarea
                placeholder="Hedefle ilgili ek bilgi veya strateji notları..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Kaydediliyor..." : editingId !== null ? "Güncelle" : "Ekle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Hedefi Sil</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Bu enerji hedefini silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>İptal</Button>
            <Button variant="destructive" onClick={() => deleteId && handleDelete(deleteId)} disabled={deleteTarget.isPending}>
              {deleteTarget.isPending ? "Siliniyor..." : "Sil"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
