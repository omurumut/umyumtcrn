import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUnit } from "@/context/UnitContext";
import { useCompany } from "@/context/CompanyContext";
import { useAuth } from "@/context/AuthContext";
import {
  useListRisks,
  useCreateRisk,
  useUpdateRisk,
  useDeleteRisk,
  getListRisksQueryKey,
  useListUnits,
  getListUnitsQueryKey,
} from "@workspace/api-client-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Plus, Pencil, Trash2, Building2, Target, ClipboardList, MessageSquarePlus, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { type MatrixConfig, type MatrixGrade, riskMatrixConfig, opportunityMatrixConfig } from "@/config/matrixConfig";

interface RiskNote {
  id: number;
  riskId: number;
  userId: number | null;
  userName: string;
  content: string;
  createdAt: string;
}

interface RiskForm {
  type: string;
  title: string;
  description: string;
  foreseenImpact: string;
  probability: number;
  severity: number;
  responseType: string;
  mitigationPlan: string;
  targetProbability: number;
  targetSeverity: number;
  owner: string;
  status: string;
}

const EMPTY: RiskForm = {
  type: "risk", title: "", description: "",
  foreseenImpact: "",
  probability: 3, severity: 3,
  responseType: "izleme",
  mitigationPlan: "",
  targetProbability: 2, targetSeverity: 2,
  owner: "", status: "acik",
};

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
            {[...levelValues].reverse().map(prob => (
              <div key={prob} className="flex items-center mb-0.5">
                <div className="w-[52px] shrink-0 text-right pr-2">
                  <div className="text-[11px] font-bold text-muted-foreground">{prob}</div>
                  <div className="text-[9px] text-muted-foreground leading-tight">{levelMap[prob]}</div>
                </div>
                {levelValues.map(impact => {
                  const s = prob * impact;
                  const grade = resolveGrade(s, config.grades);
                  const count = cellMap[`${prob}-${impact}`] ?? 0;
                  return (
                    <div key={impact} className={`flex-1 min-w-[44px] min-h-[36px] rounded mx-0.5 flex items-center justify-center text-xs font-bold ${grade.cellStyle} ${count > 0 ? "ring-2 ring-white/40" : ""}`}>
                      {count > 0 ? count : ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-1">
          {config.grades.map(g => (
            <span key={g.label} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${g.badgeStyle}`}>
              {g.label} ({g.min}–{g.max})
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function parseDeepLinkInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function Risks() {
  const { unitId: activeUnitId, setUnitId } = useUnit();
  const { companyId } = useCompany();
  const { token, user } = useAuth();
  const role = user?.role;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [deepLinkParams] = useState(() => new URLSearchParams(window.location.search));
  const deepLinkRiskId = parseDeepLinkInt(deepLinkParams.get("riskId"));
  const deepLinkUnitId = parseDeepLinkInt(deepLinkParams.get("unitId"));
  const deepLinkType = deepLinkParams.get("type");
  const riskRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const deepLinkAppliedRef = useRef(false);
  const isCompanyAdmin = role === "admin" || role === "kontrol_admin";
  const isAdmin = isCompanyAdmin || role === "superadmin";

  const unitParam = activeUnitId !== null ? activeUnitId : undefined;
  const { data: risks = [], isLoading } = useListRisks(
    { unitId: unitParam as any },
    { query: { queryKey: getListRisksQueryKey({ unitId: unitParam as any }) } }
  );
  const { data: units = [] } = useListUnits(
    {},
    { query: { queryKey: getListUnitsQueryKey({}) } }
  );

  const createMut = useCreateRisk();
  const updateMut = useUpdateRisk();
  const deleteMut = useDeleteRisk();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<RiskForm>(EMPTY);
  const [filterType, setFilterType] = useState<"all" | "risk" | "firsat">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "acik" | "devam" | "kapali">("all");

  // Notes state
  const [newNote, setNewNote] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<number | null>(null);

  useEffect(() => {
    if (deepLinkAppliedRef.current || !user) return;

    if (deepLinkType === "risk") {
      setFilterType("risk");
    }

    if (isCompanyAdmin && deepLinkUnitId !== null) {
      setUnitId(deepLinkUnitId);
    }

    deepLinkAppliedRef.current = true;
  }, [deepLinkType, deepLinkUnitId, isCompanyAdmin, setUnitId, user]);

  const editingRisk = editId !== null ? (risks as any[]).find((r: any) => r.id === editId) : null;
  const editingNotes: RiskNote[] = editingRisk?.notes ?? [];

  const patchField = (key: keyof RiskForm, value: any) => setForm(f => ({ ...f, [key]: value }));

  const riskFiltered = (risks as any[]).filter((r: any) => r.type === "risk"
    && (filterType === "all" || filterType === "risk")
    && (filterStatus === "all" || r.status === filterStatus)
  );
  const firsatFiltered = (risks as any[]).filter((r: any) => r.type === "firsat"
    && (filterType === "all" || filterType === "firsat")
    && (filterStatus === "all" || r.status === filterStatus)
  );
  const displayItems = [...riskFiltered, ...firsatFiltered];

  useEffect(() => {
    if (deepLinkRiskId === null || isLoading) return;

    const node = riskRefs.current[deepLinkRiskId];
    if (!node) return;

    const scrollTimer = window.setTimeout(() => {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);

    return () => window.clearTimeout(scrollTimer);
  }, [deepLinkRiskId, displayItems.length, isLoading]);

  function openCreate(defaultType: string = "risk") {
    setEditId(null);
    setForm({ ...EMPTY, type: defaultType });
    setNewNote("");
    setEditingNoteId(null);
    setDialogOpen(true);
  }

  function openEdit(item: any) {
    setEditId(item.id);
    setForm({
      type: item.type,
      title: item.title ?? "",
      description: item.description ?? "",
      foreseenImpact: item.foreseenImpact ?? "",
      probability: item.probability ?? 3,
      severity: item.severity ?? 3,
      responseType: item.responseType ?? "izleme",
      mitigationPlan: item.mitigationPlan ?? "",
      targetProbability: item.targetProbability ?? 2,
      targetSeverity: item.targetSeverity ?? 2,
      owner: item.owner ?? "",
      status: item.status ?? "acik",
    });
    setNewNote("");
    setEditingNoteId(null);
    setDialogOpen(true);
  }

  function invalidateRisks() {
    qc.invalidateQueries({ queryKey: getListRisksQueryKey({ unitId: unitParam as any }) });
  }

  async function handleSave() {
    if (!form.title.trim()) { toast({ title: "Başlık zorunludur", variant: "destructive" }); return; }
    if (form.responseType === "aksiyon" && !form.mitigationPlan.trim()) {
      toast({ title: "Aksiyon seçildiğinde eylem planı zorunludur", variant: "destructive" }); return;
    }

    const payload: any = {
      type: form.type,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      foreseenImpact: form.foreseenImpact.trim() || undefined,
      probability: form.probability,
      severity: form.severity,
      responseType: form.responseType,
      mitigationPlan: form.mitigationPlan.trim() || undefined,
      owner: form.owner.trim() || undefined,
      status: form.status,
    };

    if (form.type === "risk" && form.responseType === "aksiyon") {
      payload.targetProbability = form.targetProbability;
      payload.targetSeverity = form.targetSeverity;
    }

    if (!activeUnitId && units.length > 0) payload.unitId = (units as any[])[0].id;
    if (activeUnitId) payload.unitId = activeUnitId;

    try {
      if (editId !== null) {
        await updateMut.mutateAsync({ id: editId, data: payload });
        toast({ title: "Kayıt güncellendi" });
      } else {
        await createMut.mutateAsync({ data: payload });
        toast({ title: "Kayıt oluşturuldu" });
      }
      setDialogOpen(false);
      invalidateRisks();
    } catch (err: any) {
      toast({ title: "Hata", description: err?.message ?? "İşlem başarısız", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Bu kaydı silmek istiyor musunuz?")) return;
    try {
      await deleteMut.mutateAsync({ id });
      toast({ title: "Kayıt silindi" });
      invalidateRisks();
    } catch {
      toast({ title: "Silinemedi", variant: "destructive" });
    }
  }

  async function handleAddNote() {
    if (!newNote.trim() || editId === null) return;
    setSubmittingNote(true);
    try {
      const res = await fetch(`/api/risks/${editId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: newNote.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNewNote("");
      invalidateRisks();
      toast({ title: "Not eklendi" });
    } catch (err: any) {
      toast({ title: "Not eklenemedi", description: err?.message, variant: "destructive" });
    } finally {
      setSubmittingNote(false);
    }
  }

  async function handleSaveNote(noteId: number) {
    if (!editingNoteContent.trim() || editId === null) return;
    setSavingNoteId(noteId);
    try {
      const res = await fetch(`/api/risks/${editId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: editingNoteContent.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditingNoteId(null);
      invalidateRisks();
      toast({ title: "Not güncellendi" });
    } catch (err: any) {
      toast({ title: "Güncellenemedi", description: err?.message, variant: "destructive" });
    } finally {
      setSavingNoteId(null);
    }
  }

  async function handleDeleteNote(noteId: number) {
    if (!confirm("Bu notu silmek istiyor musunuz?") || editId === null) return;
    try {
      const res = await fetch(`/api/risks/${editId}/notes/${noteId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      invalidateRisks();
      toast({ title: "Not silindi" });
    } catch (err: any) {
      toast({ title: "Silinemedi", description: err?.message, variant: "destructive" });
    }
  }

  function startEditNote(note: RiskNote) {
    setEditingNoteId(note.id);
    setEditingNoteContent(note.content);
  }

  function getRiskConfig(type: string) {
    return type === "firsat" ? opportunityMatrixConfig : riskMatrixConfig;
  }

  function ScoreBadge({ item }: { item: any }) {
    const cfg = getRiskConfig(item.type);
    const grade = resolveGrade(item.score, cfg.grades);
    return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${grade.badgeStyle}`}>{grade.label} ({item.score})</span>;
  }

  const riskItems = (risks as any[]).filter(r => r.type === "risk");
  const firsatItems = (risks as any[]).filter(r => r.type === "firsat");

  return (
    <div className="space-y-6 p-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Risk &amp; Fırsat Kaydı</h1>
          <p className="text-muted-foreground text-sm mt-0.5">ISO 50001 uyumlu risk değerlendirme ve fırsat takibi</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => openCreate("firsat")}>
            <Plus className="w-4 h-4 mr-1" /> Fırsat Ekle
          </Button>
          <Button size="sm" onClick={() => openCreate("risk")}>
            <Plus className="w-4 h-4 mr-1" /> Risk Ekle
          </Button>
        </div>
      </div>

      {/* Matrix Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MatrixGrid items={riskItems} config={riskMatrixConfig} />
        <MatrixGrid items={firsatItems} config={opportunityMatrixConfig} />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <Select value={filterType} onValueChange={v => setFilterType(v as any)}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Tür" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tümü</SelectItem>
            <SelectItem value="risk">Risk</SelectItem>
            <SelectItem value="firsat">Fırsat</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={v => setFilterStatus(v as any)}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Durum" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm Durumlar</SelectItem>
            <SelectItem value="acik">Açık</SelectItem>
            <SelectItem value="devam">Devam</SelectItem>
            <SelectItem value="kapali">Kapalı</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{displayItems.length} kayıt</span>
      </div>

      {/* Items */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
        </div>
      ) : displayItems.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Kayıt bulunamadı</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {displayItems.map((item: any) => {
            const cfg = getRiskConfig(item.type);
            const grade = resolveGrade(item.score, cfg.grades);
            const isRisk = item.type === "risk";
            const noteCount = (item.notes ?? []).length;
            const isDeepLinkedRisk = deepLinkRiskId === item.id;
            return (
              <div
                key={item.id}
                ref={(node) => {
                  riskRefs.current[item.id] = node;
                }}
                className={`rounded-xl transition-colors ${isDeepLinkedRisk ? "ring-2 ring-red-400/70 bg-red-500/5" : ""}`}
              >
              <Card className="overflow-hidden">
                <div className="flex">
                  <div className="w-1.5 shrink-0">
                    <div className={`h-full w-1.5 ${isRisk ? "bg-red-500" : "bg-emerald-500"}`} />
                  </div>
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={isRisk ? "destructive" : "default"} className={isRisk ? "" : "bg-emerald-600 hover:bg-emerald-700"}>
                            {isRisk ? "Risk" : "Fırsat"}
                          </Badge>
                          <span className="font-semibold text-sm truncate">{item.title}</span>
                          <ScoreBadge item={item} />
                          {noteCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <MessageSquarePlus className="w-3 h-3" />{noteCount} not
                            </span>
                          )}
                        </div>
                        {item.description && <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>}
                        {item.foreseenImpact && (
                          <p className="text-xs text-amber-400/90 line-clamp-1">
                            <Target className="w-3 h-3 inline mr-1" />{item.foreseenImpact}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-xs text-muted-foreground">O:{item.probability} × E:{item.severity}</span>
                          {item.targetScore && item.type === "risk" && (
                            <span className="text-xs text-blue-400">Hedef: {item.targetScore}</span>
                          )}
                          <span className="text-xs">
                            {item.responseType === "aksiyon" && <ClipboardList className="w-3 h-3 inline mr-1 text-blue-400" />}
                            {item.responseType === "aksiyon" ? "Aksiyon" : "İzleme"}
                          </span>
                          {item.owner && <span className="text-xs text-muted-foreground"><Building2 className="w-3 h-3 inline mr-1" />{item.owner}</span>}
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                            {item.status === "acik" ? "Açık" : item.status === "devam" ? "Devam" : "Kapalı"}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEdit(item)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId !== null ? "Kaydı Düzenle" : form.type === "firsat" ? "Yeni Fırsat" : "Yeni Risk"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Type selector */}
            <div className="flex gap-2">
              <Button size="sm" variant={form.type === "risk" ? "default" : "outline"} onClick={() => patchField("type", "risk")}>Risk</Button>
              <Button size="sm" variant={form.type === "firsat" ? "default" : "outline"} onClick={() => patchField("type", "firsat")}>Fırsat</Button>
            </div>

            {/* Title */}
            <div className="space-y-1">
              <Label>Başlık *</Label>
              <Input maxLength={255} value={form.title} onChange={e => patchField("title", e.target.value)} placeholder="Risk/Fırsat başlığı" />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <Label>Açıklama</Label>
              <Textarea value={form.description} onChange={e => patchField("description", e.target.value)} placeholder="Kısa açıklama" rows={2} />
            </div>

            {/* Foreseen Impact */}
            <div className="space-y-1">
              <Label>Öngörülen Etki</Label>
              <Textarea value={form.foreseenImpact} onChange={e => patchField("foreseenImpact", e.target.value)} placeholder="Gerçekleşirse beklenen etki/sonuç" rows={2} />
            </div>

            {/* Probability & Severity */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Olasılık: <span className="font-bold text-primary">{form.probability}</span></Label>
                <Slider min={1} max={5} step={1} value={[form.probability]} onValueChange={([v]) => patchField("probability", v)} />
                <div className="flex justify-between text-[10px] text-muted-foreground"><span>Çok Düşük</span><span>Çok Yüksek</span></div>
              </div>
              <div className="space-y-2">
                <Label>Etki: <span className="font-bold text-primary">{form.severity}</span></Label>
                <Slider min={1} max={5} step={1} value={[form.severity]} onValueChange={([v]) => patchField("severity", v)} />
                <div className="flex justify-between text-[10px] text-muted-foreground"><span>Çok Düşük</span><span>Çok Yüksek</span></div>
              </div>
            </div>
            <div className="text-sm text-center">
              Skor: <span className="font-bold text-primary text-lg">{form.probability * form.severity}</span>
              {" — "}
              <ScoreBadgeInline score={form.probability * form.severity} type={form.type} />
            </div>

            {/* Karar (Response Type) */}
            <div className="space-y-2">
              <Label>Karar</Label>
              <RadioGroup value={form.responseType} onValueChange={v => patchField("responseType", v)} className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="izleme" id="r-izleme" />
                  <Label htmlFor="r-izleme" className="font-normal cursor-pointer">İzleme</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="aksiyon" id="r-aksiyon" />
                  <Label htmlFor="r-aksiyon" className="font-normal cursor-pointer">Aksiyon</Label>
                </div>
              </RadioGroup>
            </div>

            {/* Mitigation Plan (shown when aksiyon) */}
            {form.responseType === "aksiyon" && (
              <div className="space-y-1">
                <Label>Eylem Planı *</Label>
                <Textarea value={form.mitigationPlan} onChange={e => patchField("mitigationPlan", e.target.value)} placeholder="Uygulanacak aksiyon adımları" rows={3} />
              </div>
            )}

            {/* Target score (risk + aksiyon only) */}
            {form.type === "risk" && form.responseType === "aksiyon" && (
              <div className="grid grid-cols-2 gap-4 p-3 rounded-lg border border-blue-500/30 bg-blue-500/5">
                <div className="col-span-2 text-xs font-semibold text-blue-400 uppercase tracking-wide">Hedef Değerler</div>
                <div className="space-y-2">
                  <Label className="text-xs">Hedef Olasılık: <span className="font-bold text-blue-400">{form.targetProbability}</span></Label>
                  <Slider min={1} max={5} step={1} value={[form.targetProbability]} onValueChange={([v]) => patchField("targetProbability", v)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Hedef Etki: <span className="font-bold text-blue-400">{form.targetSeverity}</span></Label>
                  <Slider min={1} max={5} step={1} value={[form.targetSeverity]} onValueChange={([v]) => patchField("targetSeverity", v)} />
                </div>
                <div className="col-span-2 text-xs text-center">
                  Hedef Skor: <span className="font-bold text-blue-400 text-base">{form.targetProbability * form.targetSeverity}</span>
                </div>
              </div>
            )}

            {/* Owner & Status */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Sorumlu</Label>
                <Input value={form.owner} onChange={e => patchField("owner", e.target.value)} placeholder="Sorumlu kişi/departman" />
              </div>
              <div className="space-y-1">
                <Label>Durum</Label>
                <Select value={form.status} onValueChange={v => patchField("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="acik">Açık</SelectItem>
                    <SelectItem value="devam">Devam Ediyor</SelectItem>
                    <SelectItem value="kapali">Kapalı</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes Section (only in edit mode) */}
            {editId !== null && (
              <>
                <Separator />
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <MessageSquarePlus className="w-4 h-4 text-muted-foreground" />
                    <Label className="text-sm font-semibold">Notlar</Label>
                    {editingNotes.length > 0 && (
                      <Badge variant="secondary" className="text-xs">{editingNotes.length}</Badge>
                    )}
                  </div>

                  {editingNotes.length > 0 ? (
                    <ScrollArea className="max-h-56 rounded-md border p-3 space-y-3">
                      <div className="space-y-3">
                        {editingNotes.map((note) => (
                          <div key={note.id} className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-foreground">{note.userName}</span>
                                <span className="text-[10px] text-muted-foreground">{formatDate(note.createdAt)}</span>
                              </div>
                              {isAdmin && editingNoteId !== note.id && (
                                <div className="flex gap-1">
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEditNote(note)}>
                                    <Pencil className="w-3 h-3" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => handleDeleteNote(note.id)}>
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              )}
                            </div>
                            {editingNoteId === note.id ? (
                              <div className="space-y-1.5">
                                <Textarea
                                  value={editingNoteContent}
                                  onChange={e => setEditingNoteContent(e.target.value)}
                                  rows={2}
                                  className="text-sm"
                                  autoFocus
                                />
                                <div className="flex gap-1.5">
                                  <Button size="sm" className="h-7 text-xs" disabled={savingNoteId === note.id} onClick={() => handleSaveNote(note.id)}>
                                    {savingNoteId === note.id ? "Kaydediliyor…" : "Kaydet"}
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingNoteId(null)}>İptal</Button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note.content}</p>
                            )}
                            <Separator className="mt-2" />
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Henüz not eklenmemiş.</p>
                  )}

                  {/* Add new note */}
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">Yeni Not Ekle</Label>
                      <Textarea
                        value={newNote}
                        onChange={e => setNewNote(e.target.value)}
                        placeholder="Gerçekleşme durumu, gelişme veya güncelleme..."
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="h-[60px] px-3 shrink-0"
                      disabled={!newNote.trim() || submittingNote}
                      onClick={handleAddNote}
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>İptal</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {createMut.isPending || updateMut.isPending ? "Kaydediliyor…" : editId !== null ? "Güncelle" : "Oluştur"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScoreBadgeInline({ score, type }: { score: number; type: string }) {
  const cfg = type === "firsat" ? opportunityMatrixConfig : riskMatrixConfig;
  const grade = resolveGrade(score, cfg.grades);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${grade.badgeStyle}`}>{grade.label}</span>;
}
