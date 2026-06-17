import { useState } from "react";
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

interface RiskForm {
  type: string; title: string; description: string;
  probability: number; severity: number; mitigationPlan: string; owner: string; status: string;
}
const EMPTY: RiskForm = { type: "risk", title: "", description: "", probability: 3, severity: 3, mitigationPlan: "", owner: "", status: "acik" };

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 15 ? "bg-red-500/10 text-red-400 border-red-500/20" : score >= 8 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-green-500/10 text-green-400 border-green-500/20";
  const label = score >= 15 ? "Kritik" : score >= 8 ? "Yüksek" : "Düşük";
  return <Badge variant="outline" className={`text-xs ${color}`}>{label} ({score})</Badge>;
}

function RiskMatrix({ risks }: { risks: any[] }) {
  const cells: Record<string, { count: number; types: string[] }> = {};
  for (const r of risks) {
    const key = `${r.probability}-${r.severity}`;
    if (!cells[key]) cells[key] = { count: 0, types: [] };
    cells[key].count++;
    cells[key].types.push(r.type);
  }
  function cellColor(p: number, s: number) {
    const score = p * s;
    if (score >= 15) return "bg-red-500/20 border-red-500/30";
    if (score >= 8) return "bg-amber-500/20 border-amber-500/30";
    if (score >= 4) return "bg-yellow-500/10 border-yellow-500/20";
    return "bg-green-500/10 border-green-500/20";
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Risk Matrisi (Olasılık × Etki)</CardTitle>
        <CardDescription>Kırmızı = Kritik ≥15 | Sarı = Yüksek ≥8 | Yeşil = Düşük</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div className="min-w-[320px]">
            <div className="flex items-center mb-1">
              <div className="w-20 text-xs text-muted-foreground text-right pr-2">Olasılık</div>
              {[1, 2, 3, 4, 5].map(s => <div key={s} className="flex-1 text-center text-xs text-muted-foreground">{s}</div>)}
            </div>
            {[5, 4, 3, 2, 1].map(p => (
              <div key={p} className="flex items-center mb-1">
                <div className="w-20 text-xs text-muted-foreground text-right pr-2">{p}</div>
                {[1, 2, 3, 4, 5].map(s => {
                  const key = `${p}-${s}`;
                  const cell = cells[key];
                  return (
                    <div key={s} className={`flex-1 mx-0.5 h-10 rounded border flex items-center justify-center text-xs font-bold ${cellColor(p, s)}`}>
                      {cell ? cell.count : ""}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="flex items-center mt-1">
              <div className="w-20" />
              <div className="flex-1 text-center text-xs text-muted-foreground">Etki (1–5)</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Risks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { unitId } = useUnit();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const unitParam = unitId !== null ? { unitId } : undefined;

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RiskForm>(EMPTY);
  const [filterType, setFilterType] = useState("all");

  const { data: risks, isLoading } = useListRisks(unitParam, { query: { queryKey: getListRisksQueryKey(unitParam) } });
  const { data: allUnits } = useListUnits({ query: { queryKey: getListUnitsQueryKey(), enabled: isAdmin && unitId === null } });
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

      <RiskMatrix risks={risks ?? []} />

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
