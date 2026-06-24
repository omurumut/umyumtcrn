import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useUnit } from "@/context/UnitContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, PlayCircle, Save, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type AnalysisLevel = "energyUseGroup" | "meter" | "subUnit" | "energySource" | "unit";
type SysRec = "seu_candidate" | "not_seu";
type UserDecision = "accepted_as_seu" | "not_seu" | "monitor";

interface AnalysisItem {
  groupId: number | null;
  name: string;
  analysisLevel: string;
  energyTep: number;
  consumptionSharePercent: number;
  hasOpportunity: boolean;
  priorityResult: number | null;
  systemRecommendation: SysRec;
  energyUseGroupId: number | null;
  meterId: number | null;
  subUnitId: number | null;
  energySourceId: number | null;
  userDecision: UserDecision | null;
  decisionReason: string;
  responsible: string;
  targetReductionPercent: string;
  notes: string;
}

interface Props {
  isAdminMode?: boolean;
  adminRecordType?: "unit_official" | "admin_review";
}

const LEVEL_OPTIONS: { value: AnalysisLevel; label: string }[] = [
  { value: "energyUseGroup", label: "Enerji Kullanım Grubu" },
  { value: "meter", label: "Sayaç" },
  { value: "subUnit", label: "Alt Birim" },
  { value: "energySource", label: "Enerji Kaynağı" },
  { value: "unit", label: "Birim" },
];

const PRIORITY_COLORS: Record<number, string> = {
  1: "bg-red-500/20 text-red-400 border-red-500/30",
  2: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  3: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  4: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

const MONTHS = ["", "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function computePriority(share: number, hasOpp: boolean): number | null {
  if (share >= 20) return hasOpp ? 1 : 2;
  if (share >= 10) return hasOpp ? 2 : 3;
  if (share >= 5) return hasOpp ? 3 : 4;
  if (hasOpp) return 4;
  return null;
}
function computeRec(p: number | null): SysRec { return p !== null ? "seu_candidate" : "not_seu"; }

function impliedDecision(rec: SysRec): UserDecision {
  return rec === "seu_candidate" ? "accepted_as_seu" : "not_seu";
}

export default function SeuAnalysisTab({ isAdminMode = false, adminRecordType = "admin_review" }: Props) {
  const { token, user } = useAuth();
  const { unitId: contextUnitId } = useUnit();
  const { toast } = useToast();
  const qc = useQueryClient();
  const currentYear = new Date().getFullYear();

  const [year, setYear] = useState(currentYear);
  const [monthStart, setMonthStart] = useState(1);
  const [monthEnd, setMonthEnd] = useState(12);
  const [level, setLevel] = useState<AnalysisLevel>("energyUseGroup");
  const [adminUnitId, setAdminUnitId] = useState<number | null>(null);
  const [items, setItems] = useState<AnalysisItem[]>([]);
  const [unitTotalTep, setUnitTotalTep] = useState(0);
  const [missingTepWarning, setMissingTepWarning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [analysisRan, setAnalysisRan] = useState(false);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const resolvedUnitId = isAdminMode ? adminUnitId : (user?.unitId ?? contextUnitId);

  const { data: allUnits } = useListUnits({}, { query: { queryKey: getListUnitsQueryKey({}), enabled: isAdminMode } });

  async function runAnalysis() {
    if (!resolvedUnitId) { toast({ title: "Birim seçilmedi", variant: "destructive" }); return; }
    setIsAnalyzing(true);
    setAnalysisRan(false);
    try {
      const p = new URLSearchParams({
        year: String(year), monthStart: String(monthStart), monthEnd: String(monthEnd),
        analysisLevel: level, unitId: String(resolvedUnitId),
      });
      const res = await fetch(`/api/seu/analyze?${p}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Analiz başarısız"); }
      const data = await res.json();
      setUnitTotalTep(data.unitTotalTep);
      setMissingTepWarning(data.missingTepWarning);
      setItems(data.items.map((item: any) => ({
        ...item,
        userDecision: null as UserDecision | null,
        decisionReason: "",
        responsible: "",
        targetReductionPercent: "",
        notes: "",
      })));
      setAnalysisRan(true);
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setIsAnalyzing(false);
    }
  }

  function toggleOpportunity(idx: number) {
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const newHasOpp = !item.hasOpportunity;
      const priority = computePriority(item.consumptionSharePercent, newHasOpp);
      return { ...item, hasOpportunity: newHasOpp, priorityResult: priority, systemRecommendation: computeRec(priority) };
    }));
  }

  function updateItem(idx: number, patch: Partial<AnalysisItem>) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, ...patch } : item));
  }

  async function saveAssessment() {
    if (!resolvedUnitId) { toast({ title: "Birim seçilmedi", variant: "destructive" }); return; }
    const undecided = items.find(item => !item.userDecision);
    if (undecided) {
      toast({
        title: "Karar eksik",
        description: "Analizi kaydetmeden önce her satır için karar seçmelisiniz. Düzenle işleminden ÖEK / ÖEK dışı / İzlemeye al kararını seçiniz.",
        variant: "destructive",
      });
      return;
    }
    for (const item of items) {
      if (item.userDecision && item.userDecision !== impliedDecision(item.systemRecommendation) && !item.decisionReason) {
        toast({ title: `"${item.name}" için karar gerekçesi zorunlu`, variant: "destructive" }); return;
      }
    }
    setIsSaving(true);
    const recordType = isAdminMode ? adminRecordType : "unit_official";
    try {
      const res = await fetch("/api/seu/assessments", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId: resolvedUnitId, year, periodStart: monthStart, periodEnd: monthEnd,
          analysisLevel: level, methodType: "consumption_share_opportunity_matrix",
          recordType, isOfficial: recordType === "unit_official", unitTotalTep, items,
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Kaydetme başarısız"); }
      qc.invalidateQueries({ queryKey: ["seu-assessments"] });
      toast({ title: recordType === "unit_official" ? "Resmi ÖEK analizi kaydedildi" : "Admin analizi kaydedildi" });
    } catch (e: any) {
      toast({ title: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  const editItem = editIdx !== null ? items[editIdx] : null;

  return (
    <div className="space-y-4">
      {isAdminMode && (
        <div className="flex items-center gap-2 p-3 rounded-md border border-violet-500/20 bg-violet-500/5 text-sm text-violet-300">
          <Info className="h-4 w-4 shrink-0" />
          <span>Bu sekmedeki analiz <strong>resmi kayıt olmayacak</strong> (admin_review olarak saklanır) ve kullanıcının resmi ÖEK kaydını etkilemez.</span>
        </div>
      )}
      {!isAdminMode && !isAdmin && (
        <div className="flex items-center gap-2 p-3 rounded-md border border-teal-500/20 bg-teal-500/5 text-sm text-teal-300">
          <Info className="h-4 w-4 shrink-0" />
          <span>Analiz kapsamı: Kullanıcının atanmış olduğu birim</span>
        </div>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {isAdminMode && (
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label className="text-xs">Birim</Label>
                <Select value={adminUnitId ? String(adminUnitId) : ""} onValueChange={v => setAdminUnitId(v ? parseInt(v) : null)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Birim seçin" /></SelectTrigger>
                  <SelectContent>
                    {(allUnits ?? []).map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Yıl</Label>
              <Select value={String(year)} onValueChange={v => setYear(parseInt(v))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Dönem</Label>
              <div className="flex items-center gap-1">
                <Select value={String(monthStart)} onValueChange={v => setMonthStart(parseInt(v))}>
                  <SelectTrigger className="h-8 text-xs w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.slice(1).map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
                <span className="text-muted-foreground text-xs">–</span>
                <Select value={String(monthEnd)} onValueChange={v => setMonthEnd(parseInt(v))}>
                  <SelectTrigger className="h-8 text-xs w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.slice(1).map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Analiz Seviyesi</Label>
              <Select value={level} onValueChange={v => setLevel(v as AnalysisLevel)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{LEVEL_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button onClick={runAnalysis} disabled={isAnalyzing || (isAdminMode && !adminUnitId)} className="gap-2">
              <PlayCircle className="h-4 w-4" />
              {isAnalyzing ? "Hesaplanıyor…" : "Analizi Çalıştır"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {missingTepWarning && (
        <div className="flex items-center gap-2 p-3 rounded-md border border-amber-500/20 bg-amber-500/5 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Bazı tüketim kayıtlarında TEP değeri sıfır. Sonuçlar eksik olabilir. Tüketim girişlerini kontrol edin.</span>
        </div>
      )}

      {analysisRan && items.length === 0 && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-muted-foreground">
            <AlertTriangle className="h-8 w-8 mb-2 opacity-30" />
            <p>Bu dönemde tüketim verisi bulunamadı</p>
          </CardContent>
        </Card>
      )}

      {analysisRan && items.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Birim Toplam: <span className="text-foreground font-medium">{unitTotalTep.toFixed(4)} TEP</span>
              <span className="mx-2">·</span>
              <span>{items.length} kalem</span>
              <span className="mx-2">·</span>
              <span className="text-amber-400">{items.filter(i => i.systemRecommendation === "seu_candidate").length} ÖEK adayı</span>
            </div>
            <Button onClick={saveAssessment} disabled={isSaving} className="gap-2" size="sm">
              <Save className="h-3.5 w-3.5" />
              {isSaving ? "Kaydediliyor…" : "Analizi Kaydet"}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-2.5 pl-3 font-medium text-xs text-muted-foreground whitespace-nowrap">Ad</th>
                  <th className="text-right p-2.5 font-medium text-xs text-muted-foreground whitespace-nowrap">TEP</th>
                  <th className="text-right p-2.5 font-medium text-xs text-muted-foreground whitespace-nowrap">Pay %</th>
                  <th className="text-center p-2.5 font-medium text-xs text-muted-foreground whitespace-nowrap">Fırsat</th>
                  <th className="text-center p-2.5 font-medium text-xs text-muted-foreground whitespace-nowrap">Öncelik</th>
                  <th className="text-center p-2.5 font-medium text-xs text-muted-foreground whitespace-nowrap">Öneri</th>
                  <th className="text-center p-2.5 font-medium text-xs text-muted-foreground whitespace-nowrap">Karar</th>
                  <th className="p-2.5 font-medium text-xs text-muted-foreground whitespace-nowrap">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="p-2.5 pl-3 font-medium max-w-[200px] truncate" title={item.name}>{item.name}</td>
                    <td className="p-2.5 text-right font-mono text-xs">{item.energyTep.toFixed(4)}</td>
                    <td className="p-2.5 text-right font-mono text-xs font-medium">{item.consumptionSharePercent.toFixed(1)}%</td>
                    <td className="p-2.5 text-center">
                      <button
                        onClick={() => toggleOpportunity(idx)}
                        className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors cursor-pointer ${item.hasOpportunity ? "border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20" : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"}`}
                      >
                        {item.hasOpportunity ? "Evet" : "Hayır"}
                      </button>
                    </td>
                    <td className="p-2.5 text-center">
                      {item.priorityResult !== null ? (
                        <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[item.priorityResult] ?? ""}`}>
                          {item.priorityResult}
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2.5 text-center">
                      <Badge variant="outline" className={`text-xs ${item.systemRecommendation === "seu_candidate" ? "border-teal-500/30 text-teal-400 bg-teal-500/10" : "border-muted text-muted-foreground"}`}>
                        {item.systemRecommendation === "seu_candidate" ? "ÖEK Adayı" : "ÖEK Dışı"}
                      </Badge>
                    </td>
                    <td className="p-2.5 text-center">
                      {item.userDecision ? (
                        <Badge variant="outline" className="text-xs border-violet-500/30 text-violet-400 bg-violet-500/10">
                          {item.userDecision === "accepted_as_seu" ? "Kabul" : item.userDecision === "not_seu" ? "Dışarı" : "İzle"}
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2.5">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditIdx(idx)}>
                        Düzenle
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editItem !== null && editIdx !== null && (
        <ItemEditDialog
          item={editItem}
          onSave={patch => { updateItem(editIdx, patch); setEditIdx(null); }}
          onClose={() => setEditIdx(null)}
        />
      )}
    </div>
  );
}

interface EditDialogProps {
  item: AnalysisItem;
  onSave: (patch: Partial<AnalysisItem>) => void;
  onClose: () => void;
}

function ItemEditDialog({ item, onSave, onClose }: EditDialogProps) {
  const { toast } = useToast();
  const [hasOpp, setHasOpp] = useState(item.hasOpportunity);
  const [userDecision, setUserDecision] = useState<UserDecision | null>(item.userDecision);
  const [decisionReason, setDecisionReason] = useState(item.decisionReason);
  const [responsible, setResponsible] = useState(item.responsible);
  const [targetPct, setTargetPct] = useState(item.targetReductionPercent);
  const [notes, setNotes] = useState(item.notes);

  const priority = computePriority(item.consumptionSharePercent, hasOpp);
  const sysRec = computeRec(priority);
  const expectedDecision = impliedDecision(sysRec);
  const decisionDiffers = userDecision !== null && userDecision !== expectedDecision;

  function handleSave() {
    if (decisionDiffers && !decisionReason.trim()) {
      toast({ title: "Karar gerekçesi zorunlu", description: "Sistem önerisinden farklı karar için gerekçe girilmelidir.", variant: "destructive" });
      return;
    }
    onSave({
      hasOpportunity: hasOpp,
      priorityResult: priority,
      systemRecommendation: sysRec,
      userDecision,
      decisionReason,
      responsible,
      targetReductionPercent: targetPct,
      notes,
    });
  }

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">ÖEK Kararı: {item.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3 p-3 rounded-md bg-muted/20 border border-border text-xs">
            <div><span className="text-muted-foreground">Pay: </span><span className="font-medium">{item.consumptionSharePercent.toFixed(1)}%</span></div>
            <div><span className="text-muted-foreground">TEP: </span><span className="font-medium">{item.energyTep.toFixed(4)}</span></div>
            <div><span className="text-muted-foreground">Öncelik: </span>
              {priority !== null ? <Badge variant="outline" className={`text-xs ${PRIORITY_COLORS[priority] ?? ""}`}>{priority}</Badge> : <span className="text-muted-foreground">—</span>}
            </div>
            <div><span className="text-muted-foreground">Öneri: </span>
              <span className={sysRec === "seu_candidate" ? "text-teal-400" : "text-muted-foreground"}>
                {sysRec === "seu_candidate" ? "ÖEK Adayı" : "ÖEK Dışı"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setHasOpp(v => !v)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${hasOpp ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-border bg-muted/30 text-muted-foreground"}`}
            >
              İyileştirme Fırsatı: {hasOpp ? "Var" : "Yok"}
            </button>
            <span className="text-xs text-muted-foreground">(Tıklayarak değiştirin)</span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Kullanıcı Kararı *</Label>
            <Select value={userDecision ?? ""} onValueChange={v => { setUserDecision(v as UserDecision || null); }}>
              <SelectTrigger><SelectValue placeholder="Karar seçin (zorunlu)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="accepted_as_seu">ÖEK Olarak Kabul Et</SelectItem>
                <SelectItem value="not_seu">ÖEK Dışı</SelectItem>
                <SelectItem value="monitor">İzle</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {decisionDiffers && (
            <div className="space-y-1.5">
              <Label className="text-xs text-amber-400">Karar Gerekçesi *</Label>
              <Textarea
                value={decisionReason}
                onChange={e => setDecisionReason(e.target.value)}
                placeholder="Sistem önerisinden farklı karar için gerekçe giriniz…"
                rows={2}
                className="text-sm"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Sorumlu</Label>
              <Input value={responsible} onChange={e => setResponsible(e.target.value)} placeholder="Kişi / Birim" className="h-8 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hedef Azaltım (%)</Label>
              <Input type="number" value={targetPct} onChange={e => setTargetPct(e.target.value)} placeholder="0" className="h-8 text-sm" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notlar</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="text-sm" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>İptal</Button>
          <Button size="sm" onClick={handleSave}>Uygula</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
