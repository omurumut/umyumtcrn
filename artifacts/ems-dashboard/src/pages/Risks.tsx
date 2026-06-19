import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUnit } from "@/context/UnitContext";
import { useAuth } from "@/context/AuthContext";
import { useListRisks, useCreateRisk, useUpdateRisk, useDeleteRisk, getListRisksQueryKey, useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type MatrixConfig, type MatrixGrade, riskMatrixConfig, opportunityMatrixConfig } from "@/config/matrixConfig";

interface RiskForm {
  type: string; title: string; description: string;
  probability: number; severity: number; mitigationPlan: string; owner: string; status: string;
}
const EMPTY: RiskForm = { type: "risk", title: "", description: "", probability: 3, severity: 3, mitigationPlan: "", owner: "", status: "acik" };

function resolveGrade(score: number, grades: MatrixGrade[]): MatrixGrade {
  return grades.find(g => score >= g.min && score <= g.max) ?? grades[0];
}

function MatrixGrid({ items, config }: { items: any[]; config: MatrixConfig }) {
  const cellMap: Record<string, number> = {};
  for (const item of items) {
    const key = `${item.probability}-${item.severity}`;
    cellMap[key] = (cellMap[key] ?? 0) + 1;
  }

  const levelMap = Object.fromEntries(config.levels.map(l => [l.value, l.label]));
  const levelValues = config.levels.map(l => l.value);

  return (
    <Card className="w-full shrink-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{config.title}</CardTitle>
        <CardDescription className="text-xs">{items.length} kayıt • Olasılık × Etki skoru</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <div className="min-w-[320px]">
            <div className="flex items-end mb-1 ml-[52px]">
              <div className="flex-1 text-center text-[10px] font-semibold text-muted-foreground tracking-widest mb-1">ETKİ</div>
            </div>
            <div className="flex items-end mb-1">
              <div className="w-[52px] shrink-0" />
              {levelValues.map(impact => (
                <div key={impact} className="flex-1 min-w-[44px] text-center px-0.5">
                  <div className="text-[9px] text-muted-foreground leading-tight">{levelMap[impact]}</div>
                  <div className="text-[11px] font-bold text-muted-foreground">{impact}</div>
                </div>
              ))}
            </div>

            <div className="flex gap-0">
              <div className="flex items-center justify-center shrink-0" style={{ width: 14 }}>
                <span
                  className="text-[9px] font-semibold text-muted-foreground tracking-widest whitespace-nowrap"
                  style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
                >
                  OLASILIK
                </span>
              </div>

              <div className="flex-1">
                {[...levelValues].reverse().map(prob => (
                  <div key={prob} className="flex items-stretch mb-1">
                    <div className="w-[38px] shrink-0 flex flex-col items-end justify-center pr-1.5">
                      <div className="text-[9px] text-muted-foreground leading-tight text-right">{levelMap[prob]}</div>
                      <div className="text-[11px] font-bold text-muted-foreground">{prob}</div>
                    </div>
                    {levelValues.map(impact => {
                      const score = prob * impact;
                      const count = cellMap[`${prob}-${impact}`] ?? 0;
                      const grade = resolveGrade(score, config.grades);
                      return (
                        <div
                          key={impact}
                          className={`flex-1 min-w-[44px] mx-0.5 h-11 rounded border flex flex-col items-center justify-center relative ${grade.cellStyle}`}
                        >
                          <span className="absolute top-[3px] left-[4px] text-[8px] opacity-40 leading-none">{score}</span>
                          {count > 0 && (
                            <span className="text-xs font-bold">{count}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1 border-t border-border/40">
          {config.grades.map(({ label, cellStyle }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded-sm border ${cellStyle}`} />
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RiskOpportunityMatrices({ risks }: { risks: any[] }) {
  const [active, setActive] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const riskItems   = risks.filter(r => r.type === "risk");
  const firsatItems = risks.filter(r => r.type === "firsat");

  const matrices = [
    { items: riskItems,   config: riskMatrixConfig },
    { items: firsatItems, config: opportunityMatrixConfig },
  ];

  function goTo(idx: number) {
    setActive(idx);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ left: idx * scrollRef.current.offsetWidth, behavior: "smooth" });
    }
  }

  function handleScroll() {
    if (scrollRef.current) {
      const idx = Math.round(scrollRef.current.scrollLeft / scrollRef.current.offsetWidth);
      setActive(idx);
    }
  }

  return (
    <div className="space-y-3">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-none"
        style={{ scrollbarWidth: "none" }}
      >
        {matrices.map(({ items, config }) => (
          <div key={config.title} className="snap-start shrink-0 w-full">
            <MatrixGrid items={items} config={config} />
          </div>
        ))}
      </div>

      <div className="flex justify-center items-center gap-2">
        {matrices.map(({ config }, i) => (
          <button
            key={config.title}
            onClick={() => goTo(i)}
            aria-label={config.title}
            className={`rounded-full transition-all duration-200 ${
              active === i
                ? "w-6 h-2.5 bg-teal-400"
                : "w-2.5 h-2.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 15 ? "bg-red-500/10 text-red-400 border-red-500/20" : score >= 8 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-green-500/10 text-green-400 border-green-500/20";
  const label = score >= 15 ? "Kritik" : score >= 8 ? "Yüksek" : "Düşük";
  return <Badge variant="outline" className={`text-xs ${color}`}>{label} ({score})</Badge>;
}

export default function Risks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { unitId } = useUnit();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const unitParam = unitId !== null ? { unitId } : undefined;

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RiskForm>(EMPTY);
  const [filterType, setFilterType] = useState("all");

  const { data: risks, isLoading } = useListRisks(unitParam, { query: { queryKey: getListRisksQueryKey(unitParam) } });
  const { data: allUnits } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}), enabled: isAdmin && unitId === null } });
  const unitMap: Record<number, string> = Object.fromEntries((allUnits ?? []).map((u: any) => [u.id, u.name]));
  const createRisk = useCreateRisk();
  const updateRisk = useUpdateRisk();
  const deleteRisk = useDeleteRisk();

  const filtered = (risks ?? []).filter((r: any) => filterType === "all" || r.type === filterType);

  function openCreate() { setEditingId(null); setForm(EMPTY); setOpen(true); }
  function openEdit(r: any) {
    setEditingId(r.id);
    setForm({ type: r.type, title: r.title, description: r.description ?? "", probability: r.probability, severity: r.severity, mitigationPlan: r.mitigationPlan ?? "", owner: r.owner ?? "", status: r.status });
    setOpen(true);
  }

  function handleSave() {
    if (!form.title) { toast({ title: "Başlık gerekli", variant: "destructive" }); return; }
    const data: any = { type: form.type, title: form.title, description: form.description || undefined, probability: form.probability, severity: form.severity, mitigationPlan: form.mitigationPlan || undefined, owner: form.owner || undefined, status: form.status };
    if (unitId !== null) data.unitId = unitId;
    if (editingId !== null) {
      updateRisk.mutate({ id: editingId, data }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListRisksQueryKey(unitParam) }); setOpen(false); toast({ title: "Güncellendi" }); } });
    } else {
      createRisk.mutate({ data }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListRisksQueryKey(unitParam) }); setOpen(false); toast({ title: "Eklendi" }); } });
    }
  }

  function handleDelete(id: number) {
    deleteRisk.mutate({ id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListRisksQueryKey(unitParam) }); toast({ title: "Silindi" }); } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Risk & Fırsat Analizi</h1>
          <p className="text-sm text-muted-foreground mt-1">ISO 50001 — 1–5 puan sistemi ile değerlendirme</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> Ekle</Button>
      </div>

      <RiskOpportunityMatrices risks={risks ?? []} />

      <div className="flex items-center gap-3">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tümü</SelectItem>
            <SelectItem value="risk">Riskler</SelectItem>
            <SelectItem value="firsat">Fırsatlar</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} öğe</span>
      </div>

      {isLoading ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div> : (
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-muted-foreground"><p>Kayıt yok</p></CardContent></Card>
          ) : filtered.map((r: any) => (
            <Card key={r.id} className="group">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={r.type === "firsat" ? "border-blue-500/20 text-blue-400 bg-blue-500/10" : "border-red-500/20 text-red-400 bg-red-500/10"}>
                        {r.type === "firsat" ? "Fırsat" : "Risk"}
                      </Badge>
                      <ScoreBadge score={r.score} />
                      <Badge variant="outline" className={r.status === "kapali" ? "border-green-500/20 text-green-400 bg-green-500/10" : "border-muted"}>
                        {r.status === "acik" ? "Açık" : r.status === "devam" ? "Devam Ediyor" : "Kapalı"}
                      </Badge>
                      {isAdmin && unitId === null && r.unitId && unitMap[r.unitId] && (
                        <Badge variant="outline" className="text-xs border-violet-500/20 text-violet-400 bg-violet-500/10">
                          <Building2 className="h-2.5 w-2.5 mr-1" />{unitMap[r.unitId]}
                        </Badge>
                      )}
                    </div>
                    <p className="font-semibold text-sm mt-2">{r.title}</p>
                    {r.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.description}</p>}
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>Olasılık: <strong>{r.probability}/5</strong></span>
                      <span>Etki: <strong>{r.severity}/5</strong></span>
                      {r.owner && <span>Sorumlu: <strong>{r.owner}</strong></span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId !== null ? "Düzenle" : "Risk / Fırsat Ekle"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tür</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="risk">Risk</SelectItem><SelectItem value="firsat">Fırsat</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Durum</Label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="acik">Açık</SelectItem><SelectItem value="devam">Devam Ediyor</SelectItem><SelectItem value="kapali">Kapalı</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Başlık *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Açıklama</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Olasılık</Label>
                <span className="text-sm font-semibold text-teal-400">{form.probability}/5</span>
              </div>
              <Slider min={1} max={5} step={1} value={[form.probability]} onValueChange={([v]) => setForm(f => ({ ...f, probability: v }))} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Etki</Label>
                <span className="text-sm font-semibold text-teal-400">{form.severity}/5</span>
              </div>
              <Slider min={1} max={5} step={1} value={[form.severity]} onValueChange={([v]) => setForm(f => ({ ...f, severity: v }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sorumlu</Label>
                <Input value={form.owner} onChange={e => setForm(f => ({ ...f, owner: e.target.value }))} placeholder="İsim / Birim" />
              </div>
              <div className="bg-muted/30 rounded-md p-3 flex flex-col items-center justify-center">
                <p className="text-xs text-muted-foreground">Risk Skoru</p>
                <p className={`text-2xl font-bold ${form.probability * form.severity >= 15 ? "text-red-400" : form.probability * form.severity >= 8 ? "text-amber-400" : "text-green-400"}`}>
                  {form.probability * form.severity}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Eylem Planı</Label>
              <Textarea value={form.mitigationPlan} onChange={e => setForm(f => ({ ...f, mitigationPlan: e.target.value }))} placeholder="Risk azaltma / fırsat değerlendirme planı..." rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createRisk.isPending || updateRisk.isPending}>{editingId !== null ? "Güncelle" : "Ekle"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
