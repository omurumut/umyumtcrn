import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, Info, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";

const MONTH_NAMES = ["", "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

const LEVEL_LABELS: Record<string, string> = {
  energyUseGroup: "Enerji Kullanım Grubu",
  meter: "Sayaç",
  subUnit: "Alt Birim",
  energySource: "Enerji Kaynağı",
  unit: "Birim",
  manual: "Manuel Kayıt",
};

const DECISION_LABEL: Record<string, string> = {
  accepted_as_seu: "ÖEK",
  not_seu: "ÖEK Dışı",
  monitor: "İzleme",
};

const DECISION_STYLE: Record<string, string> = {
  accepted_as_seu: "border-teal-500/40 text-teal-400 bg-teal-500/10",
  not_seu: "border-red-500/40 text-red-400 bg-red-500/10",
  monitor: "border-amber-500/40 text-amber-400 bg-amber-500/10",
};

const SYS_REC_LABEL: Record<string, string> = {
  seu_candidate: "ÖEK Adayı",
  not_seu: "ÖEK Dışı",
};

const SYS_REC_STYLE: Record<string, string> = {
  seu_candidate: "border-teal-500/30 text-teal-400 bg-teal-500/10",
  not_seu: "border-border text-muted-foreground bg-muted/20",
};

const PRIORITY_COLORS: Record<number, string> = {
  1: "bg-red-500/20 text-red-400 border-red-500/30",
  2: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  3: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  4: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  5: "bg-muted/30 text-muted-foreground border-border",
};

type DecisionFilter = "all" | "accepted_as_seu" | "monitor" | "not_seu";

const currentYear = new Date().getFullYear();
const YEARS = ["all", currentYear, currentYear - 1, currentYear - 2, currentYear - 3] as const;

interface DecisionItem {
  itemId: number | null;
  assessmentId: number | null;
  manualId: number | null;
  source: "analysis" | "manual";
  name: string;
  energyTep: number;
  consumptionSharePercent: number;
  hasOpportunity: boolean;
  priorityResult: number | null;
  systemRecommendation: string;
  userDecision: string | null;
  decisionReason: string | null;
  responsible: string | null;
  targetReductionPercent: number | null;
  notes: string | null;
  itemUpdatedAt: string;
  assessmentYear: number | null;
  periodStart: number | null;
  periodEnd: number | null;
  analysisLevel: string;
  recordType: string;
  unitTotalTep: number | null;
  unitId: number | null;
  unitName: string | null;
  category: string | null;
}

// ── Edit dialog for analysis items ───────────────────────
interface AnalysisEditForm {
  hasOpportunity: boolean;
  userDecision: string;
  decisionReason: string;
  responsible: string;
  targetReductionPercent: string;
  notes: string;
}

function AnalysisEditDialog({
  item,
  token,
  onClose,
  onSuccess,
}: {
  item: DecisionItem;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<AnalysisEditForm>({
    hasOpportunity: item.hasOpportunity,
    userDecision: item.userDecision ?? "",
    decisionReason: item.decisionReason ?? "",
    responsible: item.responsible ?? "",
    targetReductionPercent: item.targetReductionPercent != null ? String(item.targetReductionPercent) : "",
    notes: item.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.userDecision) {
      toast({ title: "Karar seçilmedi", variant: "destructive" }); return;
    }
    if (form.userDecision !== item.systemRecommendation?.replace("seu_candidate", "accepted_as_seu") && !form.decisionReason) {
      toast({ title: "Sistem önerisinden farklı karar için gerekçe zorunludur", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/seu/decision-items/analysis/${item.itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          hasOpportunity: form.hasOpportunity,
          userDecision: form.userDecision,
          decisionReason: form.decisionReason || null,
          responsible: form.responsible || null,
          targetReductionPercent: form.targetReductionPercent ? parseFloat(form.targetReductionPercent) : null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Güncellenemedi");
      }
      toast({ title: "Kalem güncellendi" });
      onSuccess();
      onClose();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Karar Düzenle</DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">{item.name}</p>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, hasOpportunity: !f.hasOpportunity }))}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${form.hasOpportunity ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-border bg-muted/30 text-muted-foreground"}`}
            >
              İyileştirme Fırsatı: {form.hasOpportunity ? "Var" : "Yok"}
            </button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Karar *</Label>
            <Select value={form.userDecision} onValueChange={v => setForm(f => ({ ...f, userDecision: v }))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Seçin…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="accepted_as_seu">ÖEK (Önemli Enerji Kullanımı)</SelectItem>
                <SelectItem value="monitor">İzleme</SelectItem>
                <SelectItem value="not_seu">ÖEK Dışı</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Karar Gerekçesi</Label>
            <Textarea value={form.decisionReason} onChange={e => setForm(f => ({ ...f, decisionReason: e.target.value }))} rows={2} className="text-xs" placeholder="Gerekçe…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Hedef Azaltım (%)</Label>
              <Input type="number" value={form.targetReductionPercent} onChange={e => setForm(f => ({ ...f, targetReductionPercent: e.target.value }))} className="h-8 text-xs" placeholder="İsteğe bağlı" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sorumlu</Label>
              <Input value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible: e.target.value }))} className="h-8 text-xs" placeholder="Birim / Kişi" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Not</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>İptal</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit dialog for manual items ─────────────────────────
interface ManualEditForm {
  name: string;
  annualKwh: string;
  targetReductionPercent: string;
  responsible: string;
  notes: string;
}

function ManualEditDialog({
  item,
  token,
  onClose,
  onSuccess,
}: {
  item: DecisionItem;
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<ManualEditForm>({
    name: item.name,
    annualKwh: String(item.energyTep),
    targetReductionPercent: item.targetReductionPercent != null ? String(item.targetReductionPercent) : "",
    responsible: item.responsible ?? "",
    notes: item.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.name) { toast({ title: "Ad zorunludur", variant: "destructive" }); return; }
    if (!form.annualKwh || isNaN(parseFloat(form.annualKwh))) { toast({ title: "Geçerli bir TEP değeri girin", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/seu/${item.manualId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: form.name,
          annualKwh: parseFloat(form.annualKwh),
          targetReductionPercent: form.targetReductionPercent ? parseFloat(form.targetReductionPercent) : null,
          responsible: form.responsible || null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Güncellenemedi");
      }
      toast({ title: "Manuel kayıt güncellendi" });
      onSuccess();
      onClose();
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Manuel Kayıt Düzenle</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Ad *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="text-xs" placeholder="ör. Ana Kompresör Sistemi" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Yıllık TEP *</Label>
              <Input type="number" value={form.annualKwh} onChange={e => setForm(f => ({ ...f, annualKwh: e.target.value }))} className="h-8 text-xs" step="0.0001" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hedef Azaltım (%)</Label>
              <Input type="number" value={form.targetReductionPercent} onChange={e => setForm(f => ({ ...f, targetReductionPercent: e.target.value }))} className="h-8 text-xs" placeholder="İsteğe bağlı" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sorumlu</Label>
            <Input value={form.responsible} onChange={e => setForm(f => ({ ...f, responsible: e.target.value }))} className="h-8 text-xs" placeholder="Birim / Kişi" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Not</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="text-xs" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>İptal</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? "Kaydediliyor…" : "Kaydet"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SeuDecisionItemsListProps {
  unitIdFilter?: number | null;
  recordTypeFilter?: string | null;
  adminMode?: boolean;
}

export default function SeuDecisionItemsList({
  unitIdFilter,
  recordTypeFilter,
  adminMode = false,
}: SeuDecisionItemsListProps = {}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [year, setYear] = useState<number | "all">("all");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("all");
  const [editItem, setEditItem] = useState<DecisionItem | null>(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ["seu-decision-items", year, unitIdFilter, recordTypeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (year !== "all") params.set("year", String(year));
      if (unitIdFilter) params.set("unitId", String(unitIdFilter));
      if (recordTypeFilter) params.set("recordType", recordTypeFilter);
      const url = `/api/seu/decision-items${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Yüklenemedi");
      return res.json() as Promise<DecisionItem[]>;
    },
    enabled: !!token,
  });

  const allItems = items ?? [];

  const filtered = decisionFilter === "all"
    ? allItems
    : allItems.filter((i) => {
        if (i.source === "manual") return false;
        return i.userDecision === decisionFilter;
      });

  const analysisItems = allItems.filter(i => i.source === "analysis");
  const manualItems = allItems.filter(i => i.source === "manual");
  const seuCount = analysisItems.filter(i => i.userDecision === "accepted_as_seu").length;
  const monitorCount = analysisItems.filter(i => i.userDecision === "monitor").length;
  const notSeuCount = analysisItems.filter(i => i.userDecision === "not_seu").length;

  const FILTER_TABS: { value: DecisionFilter; label: string; count: number }[] = [
    { value: "all", label: "Tüm Kayıtlar", count: allItems.length },
    { value: "accepted_as_seu", label: "ÖEK", count: seuCount },
    { value: "monitor", label: "İzleme", count: monitorCount },
    { value: "not_seu", label: "ÖEK Dışı", count: notSeuCount },
  ];

  function handleEditSuccess() {
    qc.invalidateQueries({ queryKey: ["seu-decision-items"] });
    qc.invalidateQueries({ queryKey: ["seu-assessments"] });
  }

  return (
    <div className="space-y-4">
      {!adminMode && (
        <div className="flex items-center gap-2 p-3 rounded-md border border-border/60 bg-muted/10 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" />
          Kapsam: Biriminize ait resmi ÖEK değerlendirme kararları ve manuel kayıtlar
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <div className="space-y-1">
          <Label className="text-xs">Yıl</Label>
          <Select value={String(year)} onValueChange={v => setYear(v === "all" ? "all" : parseInt(v))}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm Yıllar</SelectItem>
              {YEARS.filter(y => y !== "all").map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!isLoading && allItems.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-4">
            <span className="font-medium text-foreground">{analysisItems.length} analiz kararı</span>
            {manualItems.length > 0 && <span className="text-violet-400 font-medium">{manualItems.length} manuel kayıt</span>}
            {seuCount > 0 && <span className="text-teal-400 font-medium">{seuCount} ÖEK</span>}
            {monitorCount > 0 && <span className="text-amber-400 font-medium">{monitorCount} İzleme</span>}
            {notSeuCount > 0 && <span className="text-red-400 font-medium">{notSeuCount} ÖEK Dışı</span>}
          </div>
        )}
      </div>

      {!isLoading && allItems.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {FILTER_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setDecisionFilter(tab.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                decisionFilter === tab.value
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/40"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : allItems.length === 0 ? (
        <Card>
          <CardContent className="py-14 flex flex-col items-center text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mb-3 opacity-30" />
            <p className="font-medium">{year === "all" ? "Henüz" : `${year} yılı için`} kayıtlı ÖEK kararı bulunamadı</p>
            <p className="text-sm mt-1">Önce ÖEK Analizi sekmesinden analiz yapıp kararları kaydedin</p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Bu filtrede karar yok
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-2 pl-3 font-medium text-muted-foreground whitespace-nowrap">Analiz Öğesi</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Kaynak</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">TEP</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">Pay %</th>
                <th className="text-center p-2 font-medium text-muted-foreground whitespace-nowrap">Fırsat</th>
                <th className="text-center p-2 font-medium text-muted-foreground whitespace-nowrap">Öncelik</th>
                <th className="text-center p-2 font-medium text-muted-foreground whitespace-nowrap">Sistem Önerisi</th>
                <th className="text-center p-2 font-medium text-muted-foreground whitespace-nowrap">Karar</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Gerekçe</th>
                <th className="text-right p-2 font-medium text-muted-foreground whitespace-nowrap">Hedef %</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Sorumlu</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Not</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Dönem</th>
                <th className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">Güncelleme</th>
                <th className="text-center p-2 pr-3 font-medium text-muted-foreground whitespace-nowrap">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, idx) => {
                const canEdit = !adminMode && (
                  item.source === "analysis"
                    ? item.itemId != null
                    : item.manualId != null
                );
                return (
                  <tr key={`${item.source}-${item.itemId ?? item.manualId}-${idx}`} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="p-2 pl-3">
                      <div className="flex items-center gap-1.5">
                        {item.userDecision && (
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            item.userDecision === "accepted_as_seu" ? "bg-teal-400" :
                            item.userDecision === "monitor" ? "bg-amber-400" : "bg-red-400"
                          }`} />
                        )}
                        {item.source === "manual" && (
                          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-violet-400" />
                        )}
                        <span className="font-medium max-w-[180px] truncate" title={item.name}>{item.name}</span>
                      </div>
                      <div className="text-muted-foreground mt-0.5 pl-3">
                        {adminMode && item.unitName && (
                          <span className="text-foreground font-medium mr-1">{item.unitName} ·</span>
                        )}
                        {LEVEL_LABELS[item.analysisLevel] ?? item.analysisLevel}
                        {item.assessmentYear && <span className="ml-1">· {item.assessmentYear}</span>}
                      </div>
                    </td>
                    <td className="p-2">
                      {item.source === "manual" ? (
                        <Badge variant="outline" className="text-xs border-violet-500/30 text-violet-400 bg-violet-500/10 whitespace-nowrap">
                          Manuel Kayıt
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs border-teal-500/30 text-teal-400 bg-teal-500/10 whitespace-nowrap">
                          Analizden Oluşturuldu
                        </Badge>
                      )}
                    </td>
                    <td className="p-2 text-right font-mono">{Number(item.energyTep).toFixed(4)}</td>
                    <td className="p-2 text-right font-mono font-medium">{Number(item.consumptionSharePercent).toFixed(1)}%</td>
                    <td className="p-2 text-center">
                      {item.source === "manual" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={`px-1.5 py-0.5 rounded text-xs border ${
                          item.hasOpportunity
                            ? "border-green-500/30 text-green-400 bg-green-500/10"
                            : "border-border text-muted-foreground bg-muted/20"
                        }`}>
                          {item.hasOpportunity ? "Var" : "Yok"}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {item.priorityResult != null ? (
                        <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[item.priorityResult] ?? ""}`}>
                          {item.priorityResult}
                        </Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 text-center">
                      {item.source === "manual" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge variant="outline" className={`text-xs ${SYS_REC_STYLE[item.systemRecommendation] ?? ""}`}>
                          {SYS_REC_LABEL[item.systemRecommendation] ?? item.systemRecommendation}
                        </Badge>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      {item.userDecision ? (
                        <Badge variant="outline" className={`text-xs ${DECISION_STYLE[item.userDecision] ?? ""}`}>
                          {DECISION_LABEL[item.userDecision] ?? item.userDecision}
                        </Badge>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 max-w-[160px]">
                      <span className="text-muted-foreground line-clamp-2" title={item.decisionReason ?? ""}>
                        {item.decisionReason || "—"}
                      </span>
                    </td>
                    <td className="p-2 text-right text-muted-foreground">
                      {item.targetReductionPercent != null ? `%${item.targetReductionPercent}` : "—"}
                    </td>
                    <td className="p-2 max-w-[100px] truncate text-muted-foreground" title={item.responsible ?? ""}>
                      {item.responsible || "—"}
                    </td>
                    <td className="p-2 max-w-[120px] truncate text-muted-foreground" title={item.notes ?? ""}>
                      {item.notes || "—"}
                    </td>
                    <td className="p-2 text-muted-foreground whitespace-nowrap">
                      {item.periodStart && item.periodEnd
                        ? `${MONTH_NAMES[item.periodStart]}–${MONTH_NAMES[item.periodEnd]}`
                        : "—"}
                    </td>
                    <td className="p-2 text-muted-foreground whitespace-nowrap">
                      {new Date(item.itemUpdatedAt).toLocaleDateString("tr-TR")}
                    </td>
                    <td className="p-2 pr-3 text-center">
                      {canEdit && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => setEditItem(item)}
                          title="Düzenle"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editItem && editItem.source === "analysis" && (
        <AnalysisEditDialog
          item={editItem}
          token={token ?? ""}
          onClose={() => setEditItem(null)}
          onSuccess={handleEditSuccess}
        />
      )}
      {editItem && editItem.source === "manual" && (
        <ManualEditDialog
          item={editItem}
          token={token ?? ""}
          onClose={() => setEditItem(null)}
          onSuccess={handleEditSuccess}
        />
      )}
    </div>
  );
}
