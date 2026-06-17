import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUnit } from "@/context/UnitContext";
import { useAuth } from "@/context/AuthContext";
import { useListSeu, useCreateSeu, useUpdateSeu, useDeleteSeu, getListSeuQueryKey, useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Plus, Pencil, Trash2, AlertTriangle, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  { value: "uretim", label: "Üretim" },
  { value: "aydinlatma", label: "Aydınlatma" },
  { value: "iklimlendirme", label: "İklimlendirme" },
  { value: "kompresör", label: "Kompresör" },
  { value: "diger", label: "Diğer" },
];

const COLORS = ["#0d9488", "#1e3a5f", "#f59e0b", "#ef4444", "#22c55e", "#8b5cf6"];

interface SeuForm {
  name: string; category: string; annualKwh: string; percentage: string;
  priority: string; targetReductionPercent: string; responsible: string; notes: string;
}
const EMPTY: SeuForm = { name: "", category: "uretim", annualKwh: "", percentage: "", priority: "1", targetReductionPercent: "", responsible: "", notes: "" };

export default function Seu() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { unitId } = useUnit();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const unitParam = unitId !== null ? { unitId } : undefined;

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SeuForm>(EMPTY);

  const { data: items, isLoading } = useListSeu(unitParam, { query: { queryKey: getListSeuQueryKey(unitParam) } });
  const { data: allUnits } = useListUnits({ query: { queryKey: getListUnitsQueryKey(), enabled: isAdmin && unitId === null } });
  const unitMap: Record<number, string> = Object.fromEntries((allUnits ?? []).map((u: any) => [u.id, u.name]));
  const createSeu = useCreateSeu();
  const updateSeu = useUpdateSeu();
  const deleteSeu = useDeleteSeu();

  function openCreate() { setEditingId(null); setForm(EMPTY); setOpen(true); }
  function openEdit(item: any) {
    setEditingId(item.id);
    setForm({ name: item.name, category: item.category, annualKwh: item.annualKwh.toString(), percentage: item.percentage.toString(), priority: item.priority.toString(), targetReductionPercent: item.targetReductionPercent?.toString() ?? "", responsible: item.responsible ?? "", notes: item.notes ?? "" });
    setOpen(true);
  }

  function handleSave() {
    if (!form.name || !form.category) { toast({ title: "Zorunlu alanlar eksik", variant: "destructive" }); return; }
    const data: any = { name: form.name, category: form.category, annualKwh: parseFloat(form.annualKwh) || 0, percentage: parseFloat(form.percentage) || 0, priority: parseInt(form.priority) || 1 };
    if (form.targetReductionPercent) data.targetReductionPercent = parseFloat(form.targetReductionPercent);
    if (form.responsible) data.responsible = form.responsible;
    if (form.notes) data.notes = form.notes;
    if (unitId !== null) data.unitId = unitId;
    if (editingId !== null) {
      updateSeu.mutate({ id: editingId, data }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListSeuQueryKey(unitParam) }); setOpen(false); toast({ title: "Güncellendi" }); } });
    } else {
      createSeu.mutate({ data }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListSeuQueryKey(unitParam) }); setOpen(false); toast({ title: "ÖEK eklendi" }); } });
    }
  }

  function handleDelete(id: number) {
    deleteSeu.mutate({ id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListSeuQueryKey(unitParam) }); toast({ title: "Silindi" }); } });
  }

  const sorted = [...(items ?? [])].sort((a: any, b: any) => a.priority - b.priority);
  const chartData = sorted.map((s: any, i: number) => ({ name: s.name, kwh: s.annualKwh, percentage: s.percentage, color: COLORS[i % COLORS.length] }));
  const totalKwh = sorted.reduce((a: number, s: any) => a + s.annualKwh, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Önemli Enerji Kullanımları (ÖEK)</h1>
          <p className="text-sm text-muted-foreground mt-1">ISO 50001 — Significant Energy Uses (SEU)</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> ÖEK Ekle</Button>
      </div>

      {!isLoading && sorted.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-teal-400">{sorted.length}</p>
            <p className="text-xs text-muted-foreground mt-1">Toplam ÖEK</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-teal-400">{Math.round(totalKwh).toLocaleString("tr-TR")}</p>
            <p className="text-xs text-muted-foreground mt-1">Toplam kWh</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-amber-400">{sorted.filter((s: any) => s.targetReductionPercent).length}</p>
            <p className="text-xs text-muted-foreground mt-1">Hedef Belirlenen</p>
          </CardContent></Card>
        </div>
      )}

      {!isLoading && chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">ÖEK Enerji Tüketimi Sıralaması</CardTitle>
            <CardDescription>Yıllık kWh bazında azalan sıra</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 42)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={120} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                  formatter={(v: number) => [v.toLocaleString("tr-TR") + " kWh", "Yıllık Tüketim"]}
                />
                <Bar dataKey="kwh" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry, idx) => <Cell key={idx} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-16 flex flex-col items-center text-muted-foreground">
            <AlertTriangle className="h-10 w-10 mb-3 opacity-30" />
            <p className="font-medium">ÖEK bulunamadı</p>
            <p className="text-sm mt-1">Önemli enerji kullanımlarını tanımlayarak başlayın</p>
            <Button className="mt-4 gap-2" onClick={openCreate}><Plus className="h-4 w-4" /> ÖEK Ekle</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sorted.map((item: any, idx: number) => (
            <Card key={item.id} className="group">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: COLORS[idx % COLORS.length] }}>
                      {item.priority}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{item.name}</p>
                        <Badge variant="outline" className="text-xs">{CATEGORIES.find(c => c.value === item.category)?.label ?? item.category}</Badge>
                        {isAdmin && unitId === null && item.unitId && unitMap[item.unitId] && (
                          <Badge variant="outline" className="text-xs border-violet-500/20 text-violet-400 bg-violet-500/10">
                            <Building2 className="h-2.5 w-2.5 mr-1" />{unitMap[item.unitId]}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                        <span className="font-mono text-foreground font-medium">{Math.round(item.annualKwh).toLocaleString("tr-TR")} kWh/yıl</span>
                        <span className="text-teal-400 font-medium">%{item.percentage}</span>
                        {item.targetReductionPercent && <span className="text-amber-400">Hedef: -%{item.targetReductionPercent} azaltım</span>}
                        {item.responsible && <span>Sorumlu: {item.responsible}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 bg-muted/50 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, item.percentage)}%`, background: COLORS[idx % COLORS.length] }} />
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">%{item.percentage} toplam tüketim</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId !== null ? "ÖEK Düzenle" : "Yeni ÖEK Ekle"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
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
                <Label>Öncelik Sırası</Label>
                <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <SelectItem key={n} value={n.toString()}>{n}. Öncelik</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Yıllık Tüketim (kWh)</Label>
                <Input type="number" value={form.annualKwh} onChange={e => setForm(f => ({ ...f, annualKwh: e.target.value }))} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Toplam Tüketimdeki Pay (%)</Label>
                <Input type="number" value={form.percentage} onChange={e => setForm(f => ({ ...f, percentage: e.target.value }))} placeholder="0" />
              </div>
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
