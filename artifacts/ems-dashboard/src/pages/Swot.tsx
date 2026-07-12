import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUnit } from "@/context/UnitContext";
import { useCompany } from "@/context/CompanyContext";
import { useAuth } from "@/context/AuthContext";
import {
  useListSwotItems, useCreateSwotItem, useUpdateSwotItem, useDeleteSwotItem,
  getListSwotItemsQueryKey, useListUnits, getListUnitsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Star, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = [
  { value: "strengths", label: "Güçlü Yönler", color: "border-green-500/30 bg-green-500/5", headerColor: "text-green-400 bg-green-500/10", dot: "bg-green-400" },
  { value: "weaknesses", label: "Zayıf Yönler", color: "border-red-500/30 bg-red-500/5", headerColor: "text-red-400 bg-red-500/10", dot: "bg-red-400" },
  { value: "opportunities", label: "Fırsatlar", color: "border-blue-500/30 bg-blue-500/5", headerColor: "text-blue-400 bg-blue-500/10", dot: "bg-blue-400" },
  { value: "threats", label: "Tehditler", color: "border-amber-500/30 bg-amber-500/5", headerColor: "text-amber-400 bg-amber-500/10", dot: "bg-amber-400" },
];

const CATEGORY_VALUES = CATEGORIES.map((category) => category.value);

const IMPACTS = [
  { value: "yuksek", label: "Yüksek" },
  { value: "orta", label: "Orta" },
  { value: "dusuk", label: "Düşük" },
];

interface SwotForm { category: string; title: string; description: string; score: string; impact: string; }
const EMPTY_FORM: SwotForm = { category: "strengths", title: "", description: "", score: "3", impact: "orta" };

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDeepLinkCategory(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return CATEGORY_VALUES.includes(normalized) ? normalized : null;
}

function StarRating({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={`h-3 w-3 ${i < score ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
      ))}
    </div>
  );
}

export default function Swot() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { unitId, setUnitId } = useUnit();
  const { companyId } = useCompany();
  const { user } = useAuth();
  const role = user?.role;
  const isCompanyAdmin = role === "admin" || role === "kontrol_admin";
  const isAdmin = isCompanyAdmin || role === "superadmin";
  const unitParam = unitId !== null ? { unitId } : companyId !== null ? { companyId } : undefined;
  const [deepLinkParams] = useState(() => new URLSearchParams(window.location.search));
  const deepLinkUnitId = parsePositiveInt(deepLinkParams.get("unitId"));
  const deepLinkCategory = parseDeepLinkCategory(deepLinkParams.get("category"));
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const deepLinkAppliedRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SwotForm>(EMPTY_FORM);

  const { data: items, isLoading } = useListSwotItems(unitParam, { query: { queryKey: getListSwotItemsQueryKey(unitParam) } });
  const { data: allUnits } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}), enabled: isAdmin && unitId === null } });
  const unitMap: Record<number, string> = Object.fromEntries((allUnits ?? []).map((u: any) => [u.id, u.name]));
  const createSwot = useCreateSwotItem();
  const updateSwot = useUpdateSwotItem();
  const deleteSwot = useDeleteSwotItem();

  useEffect(() => {
    if (deepLinkAppliedRef.current || !user) return;

    if (isCompanyAdmin && deepLinkUnitId !== null) {
      setUnitId(deepLinkUnitId);
    }

    deepLinkAppliedRef.current = true;
  }, [deepLinkUnitId, isCompanyAdmin, setUnitId, user]);

  useEffect(() => {
    if (!deepLinkCategory || isLoading) return;

    const node = categoryRefs.current[deepLinkCategory];
    if (!node) return;

    const scrollTimer = window.setTimeout(() => {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);

    return () => window.clearTimeout(scrollTimer);
  }, [deepLinkCategory, isLoading]);

  function openCreate(category: string) { setEditingId(null); setForm({ ...EMPTY_FORM, category }); setOpen(true); }
  function openEdit(item: any) {
    setEditingId(item.id);
    setForm({ category: item.category, title: item.title, description: item.description ?? "", score: item.score.toString(), impact: item.impact });
    setOpen(true);
  }

  function handleSave() {
    const { category, title, score, impact, description } = form;
    if (!title) { toast({ title: "Başlık gerekli", variant: "destructive" }); return; }
    const data: any = { category, title, score: parseInt(score), impact, description: description || undefined };
    if (unitId !== null) data.unitId = unitId;
    if (editingId !== null) {
      updateSwot.mutate({ id: editingId, data }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListSwotItemsQueryKey(unitParam) }); setOpen(false); toast({ title: "Güncellendi" }); },
      });
    } else {
      createSwot.mutate({ data }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListSwotItemsQueryKey(unitParam) }); setOpen(false); toast({ title: "Eklendi" }); },
      });
    }
  }

  function handleDelete(id: number) {
    deleteSwot.mutate({ id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListSwotItemsQueryKey(unitParam) }); toast({ title: "Silindi" }); } });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">SWOT Analizi</h1>
        <p className="text-sm text-muted-foreground mt-1">ISO 50001 Madde 4 — Kuruluşun bağlamı</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CATEGORIES.map(cat => {
            const catItems = (items ?? []).filter((i: any) => i.category === cat.value);
            const isDeepLinkedCategory = deepLinkCategory === cat.value;
            return (
              <div
                key={cat.value}
                ref={(node) => {
                  categoryRefs.current[cat.value] = node;
                }}
                className={`rounded-lg transition-shadow ${isDeepLinkedCategory ? "ring-2 ring-primary/60 ring-offset-2 ring-offset-background" : ""}`}
              >
              <Card className={`border ${cat.color}`}>
                <CardHeader className="pb-3">
                  <div className={`flex items-center justify-between rounded-md px-3 py-1.5 ${cat.headerColor}`}>
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${cat.dot}`} />
                      <CardTitle className="text-sm font-semibold">{cat.label}</CardTitle>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1" onClick={() => openCreate(cat.value)}>
                      <Plus className="h-3 w-3" /> Ekle
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {catItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Madde yok. Eklemek için yukarıya tıklayın.</p>
                  ) : (
                    catItems.map((item: any) => (
                      <div key={item.id} className="group bg-background/50 border border-border/50 rounded-md p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.title}</p>
                            {item.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.description}</p>}
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <StarRating score={item.score} />
                              <span className={`text-xs px-1.5 py-0.5 rounded ${item.impact === "yuksek" ? "bg-red-500/10 text-red-400" : item.impact === "orta" ? "bg-amber-500/10 text-amber-400" : "bg-green-500/10 text-green-400"}`}>
                                {IMPACTS.find(i => i.value === item.impact)?.label}
                              </span>
                              {isAdmin && unitId === null && item.unitId && unitMap[item.unitId] && (
                                <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                  <Building2 className="h-2.5 w-2.5" />{unitMap[item.unitId]}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => openEdit(item)}><Pencil className="h-3 w-3" /></Button>
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingId !== null ? "SWOT Maddesi Düzenle" : "SWOT Maddesi Ekle"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Kategori</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Başlık *</Label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Madde başlığı" />
            </div>
            <div className="space-y-1.5">
              <Label>Açıklama</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Detay..." rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Puan (1–5)</Label>
                <Select value={form.score} onValueChange={v => setForm(f => ({ ...f, score: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[1, 2, 3, 4, 5].map(n => <SelectItem key={n} value={n.toString()}>{n} — {"★".repeat(n)}{"☆".repeat(5 - n)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Etki Düzeyi</Label>
                <Select value={form.impact} onValueChange={v => setForm(f => ({ ...f, impact: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{IMPACTS.map(i => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createSwot.isPending || updateSwot.isPending}>{editingId !== null ? "Güncelle" : "Ekle"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
