import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useUnit } from "@/context/UnitContext";
import { useYear } from "@/context/YearContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, BarChart2, Database,
  TrendingUp, Activity, Info, Save, Clock, Archive, FileCheck,
} from "lucide-react";

const API_BASE = "/api";

const PRIORITY_LABELS: Record<number, string> = {
  1: "Çok Yüksek", 2: "Yüksek", 3: "Orta", 4: "Düşük",
};

const MONTH_SHORT: Record<number, string> = {
  1: "Oca", 2: "Şub", 3: "Mar", 4: "Nis", 5: "May", 6: "Haz",
  7: "Tem", 8: "Ağu", 9: "Eyl", 10: "Eki", 11: "Kas", 12: "Ara",
};

async function apiFetch(url: string, token: string | null, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) throw Object.assign(new Error("API hatası"), { status: res.status });
  return res.json();
}

interface SeuItemRow {
  id: number;
  name: string;
  energyTep: number;
  consumptionSharePercent: number;
  priorityResult: number | null;
  userDecision: string | null;
  decisionReason: string | null;
  assessmentYear: number;
  assessmentRecordType: string;
  assessmentIsOfficial: boolean | null;
  unitId: number | null;
  unitName: string | null;
  energySourceName: string | null;
  energyUseGroupName: string | null;
}

interface ConsumptionRow {
  year: number;
  month: number;
  monthLabel: string;
  totalKwh: number;
  totalTep: number;
  totalCo2: number;
  hdd: number | null;
  cdd: number | null;
  energySourceName: string | null;
  meters: string;
}

type DatasetMatchType = "meter" | "energyUseGroup" | "subUnit" | "unit" | "manual_unlinked";

interface RegressionVariable {
  variableName: string;
  code: string;
  coefficient: number;
  standardError: number;
  tStat: number;
  pValue: number;
  isSignificant: boolean;
}

interface MissingVarMonth {
  month: string;
  missingVariables: string[];
}

interface RegressionResult {
  modelType: "single_regression" | "multiple_regression";
  seuItemName: string;
  year: number;
  sampleSize: number;
  intercept: number;
  rSquared: number;
  adjustedRSquared: number;
  variables: RegressionVariable[];
  isValid: boolean;
  validationMessages: string[];
  suggestedVariablesToRemove: string[];
  formulaText: string;
  usedMonths: string[];
  missingVariableMonths: MissingVarMonth[];
  error?: string;
}

interface DatasetResponse {
  seuItem: {
    id: number; name: string; unitId: number | null;
    energySourceId: number | null; energyUseGroupId: number | null;
    meterId: number | null; assessmentYear: number; assessmentRecordType: string | null;
  };
  year: number;
  matchType: DatasetMatchType;
  matchedMeterCount: number;
  matchedConsumptionCount: number;
  missingMonths: string[];
  warningMessage: string | null;
  consumptionDataset: ConsumptionRow[];
}

interface VariableItem {
  id: number | null;
  name: string;
  code: string | null;
  category: string;
  unitLabel: string | null;
  sourceType: string;
}

interface VariablesResponse {
  systemVariables: VariableItem[];
  userVariables: VariableItem[];
}

interface BaselineVariable {
  id: number;
  baselineId: number;
  variableName: string;
  variableCode: string | null;
  coefficient: number | null;
  standardError: number | null;
  tStat: number | null;
  pValue: number | null;
  isSignificant: boolean;
}

interface BaselineRecord {
  id: number;
  baselineYear: number;
  periodStart: string;
  periodEnd: string;
  modelType: string;
  intercept: number | null;
  rSquared: number | null;
  adjustedRSquared: number | null;
  sampleSize: number | null;
  formulaText: string | null;
  isValid: boolean;
  status: string;
  updateReason: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  variables: BaselineVariable[];
}

const UPDATE_REASONS = [
  "Yıllık Güncelleme",
  "Statik Faktör Değişikliği",
  "Enerji Kaynağı Değişikliği",
  "Proses Değişikliği",
  "Model Geçerliliğini Kaybetti",
  "Manuel Güncelleme",
];

const MODEL_TYPE_LABELS: Record<string, string> = {
  single_regression: "Tekli Regresyon",
  multiple_regression: "Çoklu Regresyon",
  linear: "Lineer",
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: "Aktif", color: "border-teal-500/40 text-teal-400 bg-teal-500/10" },
  draft: { label: "Taslak", color: "border-amber-500/40 text-amber-400 bg-amber-500/10" },
  archived: { label: "Arşivlendi", color: "border-border text-muted-foreground bg-muted/30" },
};

export default function EnergyPerformance() {
  const { token, user } = useAuth();
  const { unitId: contextUnitId } = useUnit();
  const { year } = useYear();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("seu-selection");
  const [unitFilter, setUnitFilter] = useState<number | null>(null);
  const [selectedSeuItem, setSelectedSeuItem] = useState<SeuItemRow | null>(null);
  const [selectedVariables, setSelectedVariables] = useState<string[]>([]);
  const [regressionResult, setRegressionResult] = useState<RegressionResult | null>(null);
  const [regressionLoading, setRegressionLoading] = useState(false);
  const [regressionError, setRegressionError] = useState<string | null>(null);

  // EnRÇ kaydetme formu state
  const [saveStatus, setSaveStatus] = useState<"active" | "draft">("active");
  const [saveUpdateReason, setSaveUpdateReason] = useState<string>("");
  const [saveNotes, setSaveNotes] = useState<string>("");
  const [savePeriodStart, setSavePeriodStart] = useState<string>("");
  const [savePeriodEnd, setSavePeriodEnd] = useState<string>("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [expandedBaseline, setExpandedBaseline] = useState<number | null>(null);

  const { data: units } = useListUnits(
    {} as any,
    { query: { queryKey: [...getListUnitsQueryKey()], enabled: isAdmin } }
  );

  const unitParam = isAdmin
    ? (unitFilter !== null ? unitFilter : contextUnitId !== null ? contextUnitId : undefined)
    : undefined;

  const seuItemsUrl = `${API_BASE}/energy-performance/seu-items${unitParam !== undefined ? `?unitId=${unitParam}` : ""}`;
  const { data: seuItems, isLoading: seuLoading } = useQuery<SeuItemRow[]>({
    queryKey: ["energy-performance-seu-items", unitParam],
    queryFn: () => apiFetch(seuItemsUrl, token),
  });

  const datasetUrl = selectedSeuItem
    ? `${API_BASE}/energy-performance/dataset?seuItemId=${selectedSeuItem.id}&year=${year}`
    : null;
  const { data: dataset, isLoading: datasetLoading } = useQuery<DatasetResponse>({
    queryKey: ["energy-performance-dataset", selectedSeuItem?.id, year],
    queryFn: () => apiFetch(datasetUrl!, token),
    enabled: !!selectedSeuItem,
  });

  const variablesUrl = selectedSeuItem
    ? `${API_BASE}/energy-performance/variables?seuItemId=${selectedSeuItem.id}`
    : `${API_BASE}/energy-performance/variables`;
  const { data: variablesData } = useQuery<VariablesResponse>({
    queryKey: ["energy-performance-variables"],
    queryFn: () => apiFetch(variablesUrl, token),
  });

  const baselinesUrl = selectedSeuItem
    ? `${API_BASE}/energy-performance/baselines?seuItemId=${selectedSeuItem.id}`
    : null;
  const { data: baselines, isLoading: baselinesLoading, refetch: refetchBaselines } = useQuery<BaselineRecord[]>({
    queryKey: ["energy-performance-baselines", selectedSeuItem?.id],
    queryFn: () => apiFetch(baselinesUrl!, token),
    enabled: !!selectedSeuItem,
  });

  function handleSelectSeuItem(item: SeuItemRow) {
    setSelectedSeuItem(item);
    setRegressionResult(null);
    setRegressionError(null);
    setSaveError(null);
    setSaveSuccess(null);
    setActiveTab("dataset");
  }

  function initSavePeriods() {
    if (!savePeriodStart) setSavePeriodStart(`${year}-01`);
    if (!savePeriodEnd) setSavePeriodEnd(`${year}-12`);
  }

  async function saveBaseline(status: "active" | "draft") {
    if (!selectedSeuItem || !regressionResult) return;
    setSaveLoading(true);
    setSaveError(null);
    setSaveSuccess(null);
    const periodStart = savePeriodStart || `${year}-01`;
    const periodEnd = savePeriodEnd || `${year}-12`;
    try {
      await apiFetch(`${API_BASE}/energy-performance/baselines`, token, {
        method: "POST",
        body: JSON.stringify({
          seuItemId: selectedSeuItem.id,
          year,
          baselinePeriodStart: periodStart,
          baselinePeriodEnd: periodEnd,
          regressionResult: {
            modelType: regressionResult.modelType,
            intercept: regressionResult.intercept,
            rSquared: regressionResult.rSquared,
            adjustedRSquared: regressionResult.adjustedRSquared,
            sampleSize: regressionResult.sampleSize,
            formulaText: regressionResult.formulaText,
            isValid: regressionResult.isValid,
            variables: regressionResult.variables.map(v => ({
              variableName: v.variableName,
              code: v.code,
              coefficient: v.coefficient,
              standardError: v.standardError,
              tStat: v.tStat,
              pValue: v.pValue,
              isSignificant: v.isSignificant,
            })),
          },
          status,
          updateReason: saveUpdateReason || null,
          notes: saveNotes || null,
        }),
      });
      setSaveSuccess(status === "active"
        ? "EnRÇ aktif olarak kaydedildi. Önceki aktif kayıt arşivlendi."
        : "EnRÇ taslak olarak kaydedildi."
      );
      setSaveUpdateReason("");
      setSaveNotes("");
      refetchBaselines();
    } catch (e: any) {
      const msg = e?.status === 422
        ? "Prosedür kriterlerini sağlamayan model aktif EnRÇ olarak kaydedilemez."
        : "Kaydetme sırasında hata oluştu.";
      setSaveError(msg);
    } finally {
      setSaveLoading(false);
    }
  }

  function toggleVariable(code: string) {
    setSelectedVariables(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  }

  async function runRegression() {
    if (!selectedSeuItem || selectedVariables.length === 0) return;
    setRegressionLoading(true);
    setRegressionError(null);
    setRegressionResult(null);
    try {
      const result: RegressionResult = await apiFetch(
        `${API_BASE}/energy-performance/regression/run`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ seuItemId: selectedSeuItem.id, year, selectedVariables }),
        }
      );
      if (result.error) {
        setRegressionError(result.error);
      } else {
        setRegressionResult(result);
      }
    } catch {
      setRegressionError("Regresyon analizi sırasında sunucu hatası oluştu.");
    } finally {
      setRegressionLoading(false);
    }
  }

  return (
    <div className="space-y-4 max-w-7xl">
      <div>
        <h1 className="text-xl font-semibold">Performans Göstergeleri</h1>
        <p className="text-sm text-muted-foreground">EnPG / EnRÇ / Regresyon Analizi</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="seu-selection" className="gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            ÖEK Seçimi
          </TabsTrigger>
          <TabsTrigger value="dataset" disabled={!selectedSeuItem} className="gap-1.5">
            <Database className="h-3.5 w-3.5" />
            Veri Seti Hazırlığı
          </TabsTrigger>
          <TabsTrigger value="regression" disabled={!selectedSeuItem} className="gap-1.5">
            <BarChart2 className="h-3.5 w-3.5" />
            Regresyon Analizi
          </TabsTrigger>
          <TabsTrigger value="baselines" disabled={!selectedSeuItem} className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            EnRÇ Kayıtları
          </TabsTrigger>
          <TabsTrigger value="monitoring" disabled={!selectedSeuItem} className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            EnPG İzleme
          </TabsTrigger>
        </TabsList>

        {/* ÖEK Seçimi */}
        <TabsContent value="seu-selection">
          <div className="space-y-4">
            {isAdmin && (
              <div className="flex items-center gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Birim</Label>
                  <Select
                    value={unitFilter !== null ? String(unitFilter) : "all"}
                    onValueChange={v => {
                      setUnitFilter(v === "all" ? null : parseInt(v));
                      setSelectedSeuItem(null);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs w-52">
                      <SelectValue placeholder="Tüm Birimler" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tüm Birimler</SelectItem>
                      {(units ?? []).map((u: any) => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {seuLoading ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Yükleniyor…</div>
            ) : !seuItems || seuItems.length === 0 ? (
              <Card>
                <CardContent className="py-10 flex flex-col items-center gap-2 text-center">
                  <AlertCircle className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    Kabul edilmiş ÖEK kalemi bulunamadı.
                  </p>
                  <p className="text-xs text-muted-foreground/70">
                    ÖEK/SEU modülünde kalem kararlarını <strong>ÖEK Olarak Kabul Et</strong> olarak işaretleyin.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{seuItems.length} kabul edilmiş ÖEK kalemi</p>
                {seuItems.map(item => (
                  <Card
                    key={item.id}
                    className={`cursor-pointer transition-colors hover:bg-muted/30 ${
                      selectedSeuItem?.id === item.id ? "ring-2 ring-teal-500/50 bg-teal-500/5" : ""
                    }`}
                    onClick={() => handleSelectSeuItem(item)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{item.name}</span>
                            <Badge variant="outline" className="text-xs border-teal-500/30 text-teal-400 bg-teal-500/10">
                              {item.assessmentYear}
                            </Badge>
                            {item.priorityResult && (
                              <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400 bg-amber-500/10">
                                {PRIORITY_LABELS[item.priorityResult] ?? `Öncelik ${item.priorityResult}`}
                              </Badge>
                            )}
                            {item.assessmentRecordType === "unit_official" ? (
                              <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400 bg-blue-500/10">
                                Birim Resmi
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs border-purple-500/30 text-purple-400 bg-purple-500/10">
                                Admin İnceleme
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground flex-wrap">
                            {item.unitName && <span>📍 {item.unitName}</span>}
                            {item.energySourceName && <span>⚡ {item.energySourceName}</span>}
                            {item.energyUseGroupName && <span>🏭 {item.energyUseGroupName}</span>}
                            <span>TEP: <strong className="text-foreground">{item.energyTep.toFixed(3)}</strong></span>
                            <span>Pay: <strong className="text-foreground">%{item.consumptionSharePercent.toFixed(1)}</strong></span>
                          </div>
                          {item.decisionReason && (
                            <p className="text-xs text-muted-foreground/70 mt-1 truncate max-w-xl">
                              Gerekçe: {item.decisionReason}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Veri Seti Hazırlığı */}
        <TabsContent value="dataset">
          {!selectedSeuItem ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Önce ÖEK Seçimi sekmesinden bir kalem seçin.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Bilgi kutusu */}
              <Card className="bg-blue-500/5 border-blue-500/20">
                <CardContent className="p-4 flex gap-3">
                  <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-muted-foreground">
                    Enerji değişkenlerinin enerji tüketimi üzerindeki etkisini belirleme yöntemi regresyon analizidir.
                    Geçmiş 12 aylık enerji tüketim verileri ve sayısal değişkenler kullanılır.
                  </p>
                </CardContent>
              </Card>

              {/* Seçili ÖEK özeti */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-teal-400" />
                    Seçili ÖEK: {selectedSeuItem.name}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-7 text-xs"
                      onClick={() => { setSelectedSeuItem(null); setActiveTab("seu-selection"); }}
                    >
                      Değiştir
                    </Button>
                  </CardTitle>
                </CardHeader>
              </Card>

              {/* Veri eşleştirme bilgisi */}
              {dataset && (
                <Card className="border-border/40">
                  <CardContent className="p-4">
                    <div className="flex flex-wrap gap-4 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Veri eşleştirme:</span>
                        <span className={`font-medium px-2 py-0.5 rounded-full text-[11px] ${
                          dataset.matchType === "manual_unlinked"
                            ? "bg-destructive/20 text-destructive"
                            : "bg-teal-500/15 text-teal-400"
                        }`}>
                          {dataset.matchType === "meter" && "Sayaç"}
                          {dataset.matchType === "energyUseGroup" && "Enerji Kullanım Grubu"}
                          {dataset.matchType === "subUnit" && "Alt Birim"}
                          {dataset.matchType === "unit" && "Birim"}
                          {dataset.matchType === "manual_unlinked" && "İlişkilendirilmemiş"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Eşleşen sayaç:</span>
                        <span className="font-medium">{dataset.matchedMeterCount}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Tüketim kaydı:</span>
                        <span className="font-medium">{dataset.matchedConsumptionCount}</span>
                      </div>
                      {dataset.seuItem.assessmentYear !== dataset.year && (
                        <div className="flex items-center gap-1.5 text-amber-400">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Değerlendirme yılı: {dataset.seuItem.assessmentYear}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Uyarı mesajı */}
              {dataset?.warningMessage && (
                <Card className="border-amber-500/30 bg-amber-500/5">
                  <CardContent className="p-4 flex gap-2 items-start">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-300">{dataset.warningMessage}</p>
                  </CardContent>
                </Card>
              )}

              {/* Eksik aylar */}
              {dataset && dataset.missingMonths.length > 0 && dataset.consumptionDataset.length > 0 && (
                <Card className="border-amber-500/20 bg-amber-500/5">
                  <CardContent className="p-4 flex gap-2 items-start">
                    <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-300">
                      <span className="font-medium">Eksik aylar ({dataset.missingMonths.length}):</span>{" "}
                      {dataset.missingMonths.join(", ")}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Tüketim verisi tablosu */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Aylık Enerji Tüketim Verisi — {dataset?.year ?? year} (Tüketimler TEP cinsinden gösterilmektedir)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {datasetLoading ? (
                    <div className="text-sm text-muted-foreground py-4 text-center">Yükleniyor…</div>
                  ) : !dataset || dataset.consumptionDataset.length === 0 ? (
                    <div className="py-6 text-center space-y-2">
                      {dataset?.matchType === "manual_unlinked" ? (
                        <p className="text-sm text-muted-foreground">
                          Bu manuel ÖEK herhangi bir sayaç veya enerji kullanım grubu ile ilişkilendirilmemiş.
                        </p>
                      ) : dataset?.matchedMeterCount === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Bu ÖEK'e ait enerji kullanım grubunda kayıtlı sayaç bulunamadı.
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Bu ÖEK ile eşleşen {dataset?.matchedMeterCount ?? 0} sayaç bulundu ancak{" "}
                          {dataset?.year ?? year} yılı için tüketim kaydı bulunamadı.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border/50 text-muted-foreground">
                            <th className="text-left p-2 pl-0 font-medium">Yıl</th>
                            <th className="text-left p-2 font-medium">Ay</th>
                            <th className="text-right p-2 font-medium">Tüketim (kWh)</th>
                            <th className="text-right p-2 font-medium">TEP</th>
                            <th className="text-right p-2 font-medium">CO₂ (kg)</th>
                            <th className="text-right p-2 font-medium">HDD</th>
                            <th className="text-right p-2 font-medium">CDD</th>
                            <th className="text-left p-2 font-medium">Enerji Kaynağı</th>
                            <th className="text-left p-2 font-medium">Sayaç</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dataset.consumptionDataset.map((row, idx) => (
                            <tr key={idx} className="border-b border-border/30 hover:bg-muted/20">
                              <td className="p-2 pl-0 text-muted-foreground">{row.year}</td>
                              <td className="p-2 font-medium">{row.monthLabel}</td>
                              <td className="p-2 text-right tabular-nums">{row.totalKwh.toLocaleString("tr-TR")}</td>
                              <td className="p-2 text-right tabular-nums text-teal-400">{row.totalTep.toFixed(4)}</td>
                              <td className="p-2 text-right tabular-nums">{row.totalCo2.toLocaleString("tr-TR")}</td>
                              <td className="p-2 text-right tabular-nums text-blue-400">
                                {row.hdd != null ? row.hdd.toFixed(1) : <span className="text-muted-foreground/50">—</span>}
                              </td>
                              <td className="p-2 text-right tabular-nums text-orange-400">
                                {row.cdd != null ? row.cdd.toFixed(1) : <span className="text-muted-foreground/50">—</span>}
                              </td>
                              <td className="p-2 text-muted-foreground">{row.energySourceName ?? "—"}</td>
                              <td className="p-2 text-muted-foreground text-xs max-w-[120px] truncate" title={row.meters}>
                                {row.meters || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-border font-medium">
                            <td colSpan={2} className="p-2 pl-0 text-muted-foreground">Toplam</td>
                            <td className="p-2 text-right tabular-nums">
                              {dataset.consumptionDataset.reduce((s, r) => s + r.totalKwh, 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                            </td>
                            <td className="p-2 text-right tabular-nums text-teal-400">
                              {dataset.consumptionDataset.reduce((s, r) => s + r.totalTep, 0).toFixed(4)}
                            </td>
                            <td colSpan={5} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Değişken seçimi */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Değişken Seçimi</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Regresyon analizine dahil edilecek değişkenleri seçin.
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {variablesData && (
                      <>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">İklim Değişkenleri</p>
                          <div className="flex flex-wrap gap-2">
                            {variablesData.systemVariables.filter(v => v.category === "climate").map(v => (
                              <button
                                key={v.code}
                                onClick={() => toggleVariable(v.code ?? v.name)}
                                className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                                  selectedVariables.includes(v.code ?? v.name)
                                    ? "bg-teal-500/20 border-teal-500/50 text-teal-300"
                                    : "bg-card border-border hover:bg-muted/30 text-muted-foreground"
                                }`}
                              >
                                {v.name}
                                {v.unitLabel && <span className="ml-1 opacity-60">({v.unitLabel})</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">Operasyonel Değişkenler</p>
                          <div className="flex flex-wrap gap-2">
                            {variablesData.systemVariables.filter(v => v.category !== "climate").map(v => (
                              <button
                                key={v.code}
                                onClick={() => toggleVariable(v.code ?? v.name)}
                                className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                                  selectedVariables.includes(v.code ?? v.name)
                                    ? "bg-teal-500/20 border-teal-500/50 text-teal-300"
                                    : "bg-card border-border hover:bg-muted/30 text-muted-foreground"
                                }`}
                              >
                                {v.name}
                                {v.unitLabel && <span className="ml-1 opacity-60">({v.unitLabel})</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                        {variablesData.userVariables.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-2">Tanımlı Değişkenler</p>
                            <div className="flex flex-wrap gap-2">
                              {variablesData.userVariables.map(v => (
                                <button
                                  key={`user-${v.id}`}
                                  onClick={() => toggleVariable(`user-${v.id}`)}
                                  className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                                    selectedVariables.includes(`user-${v.id}`)
                                      ? "bg-teal-500/20 border-teal-500/50 text-teal-300"
                                      : "bg-card border-border hover:bg-muted/30 text-muted-foreground"
                                  }`}
                                >
                                  {v.name}
                                  {v.unitLabel && <span className="ml-1 opacity-60">({v.unitLabel})</span>}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {selectedVariables.length > 0 && (
                      <div className="flex items-center gap-2 pt-2 border-t border-border/50">
                        <span className="text-xs text-muted-foreground">Seçilen:</span>
                        {selectedVariables.map(code => (
                          <Badge key={code} variant="outline" className="text-xs border-teal-500/30 text-teal-400 bg-teal-500/10">
                            {code}
                          </Badge>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto h-7 text-xs"
                          onClick={() => setActiveTab("regression")}
                        >
                          Regresyon Analizine Geç
                          <ChevronRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Regresyon Analizi */}
        <TabsContent value="regression">
          {!selectedSeuItem ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Önce ÖEK Seçimi sekmesinden bir kalem seçin.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {/* Seçili ÖEK + Kontrol Paneli */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-teal-400" />
                    ÖEK: {selectedSeuItem.name}
                    <span className="text-muted-foreground font-normal">— {year} yılı</span>
                    <Button
                      variant="ghost" size="sm" className="ml-auto h-7 text-xs"
                      onClick={() => { setSelectedSeuItem(null); setActiveTab("seu-selection"); }}
                    >Değiştir</Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {/* Seçili değişkenler */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground shrink-0">Seçili değişkenler:</span>
                    {selectedVariables.length === 0 ? (
                      <span className="text-xs text-amber-400">Henüz değişken seçilmedi — Veri Seti Hazırlığı sekmesinden seçin.</span>
                    ) : (
                      selectedVariables.map(code => (
                        <Badge key={code} variant="outline" className="text-xs border-teal-500/30 text-teal-400 bg-teal-500/10">
                          {code}
                        </Badge>
                      ))
                    )}
                    {selectedVariables.length > 0 && (
                      <Button
                        variant="ghost" size="sm" className="h-6 text-xs ml-1 text-muted-foreground"
                        onClick={() => setActiveTab("dataset")}
                      >
                        Değiştir
                      </Button>
                    )}
                  </div>
                  {/* Çalıştır butonu */}
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={runRegression}
                      disabled={regressionLoading || selectedVariables.length === 0}
                      className="h-8 text-xs bg-teal-600 hover:bg-teal-700 text-white"
                    >
                      {regressionLoading ? "Hesaplanıyor…" : "Regresyon Analizi Çalıştır"}
                      {!regressionLoading && <BarChart2 className="h-3.5 w-3.5 ml-1.5" />}
                    </Button>
                    {selectedVariables.length === 0 && (
                      <span className="text-xs text-muted-foreground">Analiz çalıştırmak için en az 1 değişken seçin.</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Hata mesajı */}
              {regressionError && (
                <Card className="border-destructive/30 bg-destructive/5">
                  <CardContent className="p-4 flex gap-2 items-start">
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">{regressionError}</p>
                  </CardContent>
                </Card>
              )}

              {/* Sonuçlar */}
              {regressionResult && (
                <div className="space-y-4">
                  {/* Geçerlilik kartı */}
                  <Card className={regressionResult.isValid
                    ? "border-teal-500/30 bg-teal-500/5"
                    : "border-destructive/30 bg-destructive/5"
                  }>
                    <CardContent className="p-4 flex items-start gap-3">
                      {regressionResult.isValid
                        ? <CheckCircle2 className="h-5 w-5 text-teal-400 shrink-0 mt-0.5" />
                        : <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                      }
                      <div>
                        <p className={`text-sm font-medium ${regressionResult.isValid ? "text-teal-300" : "text-destructive"}`}>
                          {regressionResult.isValid
                            ? "Bu model prosedür kriterlerini sağlamaktadır."
                            : "Bu model prosedür kriterlerini sağlamamaktadır; aktif EnRÇ olarak kaydedilemez."
                          }
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {regressionResult.validationMessages.map((msg, i) => (
                            <li key={i} className="text-xs text-muted-foreground">{msg}</li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Metrik kartları */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      {
                        label: "Model Tipi",
                        value: regressionResult.modelType === "single_regression" ? "Tekli Regresyon" : "Çoklu Regresyon",
                        sub: `${regressionResult.sampleSize} aylık veri`,
                        color: "text-foreground",
                      },
                      {
                        label: "R²",
                        value: regressionResult.rSquared.toFixed(4),
                        sub: regressionResult.rSquared >= 0.75 ? "≥ 0.75 ✓" : "< 0.75 ✗",
                        color: regressionResult.rSquared >= 0.75 ? "text-teal-400" : "text-destructive",
                      },
                      {
                        label: "Ayarlı R²",
                        value: regressionResult.adjustedRSquared.toFixed(4),
                        sub: regressionResult.adjustedRSquared >= 0.75 ? "≥ 0.75 ✓" : "< 0.75 ✗",
                        color: regressionResult.adjustedRSquared >= 0.75 ? "text-teal-400" : "text-destructive",
                      },
                      {
                        label: "Kesişim (Intercept)",
                        value: regressionResult.intercept.toFixed(4),
                        sub: "TEP",
                        color: "text-foreground",
                      },
                    ].map(card => (
                      <Card key={card.label} className="border-border/50">
                        <CardContent className="p-3">
                          <p className="text-xs text-muted-foreground mb-1">{card.label}</p>
                          <p className={`text-lg font-semibold tabular-nums ${card.color}`}>{card.value}</p>
                          <p className="text-xs text-muted-foreground">{card.sub}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Değişken tablosu */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Değişken Sonuçları</CardTitle>
                      <p className="text-xs text-muted-foreground">P değeri &lt; 0.1 olan değişkenler anlamlı kabul edilir.</p>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border/50 text-muted-foreground">
                              <th className="text-left p-2 pl-0 font-medium">Değişken</th>
                              <th className="text-right p-2 font-medium">Katsayı</th>
                              <th className="text-right p-2 font-medium">Std. Hata</th>
                              <th className="text-right p-2 font-medium">t İstatistiği</th>
                              <th className="text-right p-2 font-medium">P Değeri</th>
                              <th className="text-center p-2 font-medium">Anlamlı?</th>
                            </tr>
                          </thead>
                          <tbody>
                            {regressionResult.variables.map((v, i) => (
                              <tr key={i} className={`border-b border-border/30 ${!v.isSignificant ? "bg-destructive/5" : ""}`}>
                                <td className="p-2 pl-0 font-medium">{v.variableName}</td>
                                <td className="p-2 text-right tabular-nums">{v.coefficient.toFixed(6)}</td>
                                <td className="p-2 text-right tabular-nums text-muted-foreground">{v.standardError.toFixed(6)}</td>
                                <td className="p-2 text-right tabular-nums text-muted-foreground">{v.tStat.toFixed(4)}</td>
                                <td className={`p-2 text-right tabular-nums font-medium ${v.isSignificant ? "text-teal-400" : "text-destructive"}`}>
                                  {v.pValue.toFixed(4)}
                                </td>
                                <td className="p-2 text-center">
                                  {v.isSignificant
                                    ? <span className="text-teal-400">✓ Evet</span>
                                    : <span className="text-destructive">✗ Hayır</span>
                                  }
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Anlamlı olmayan değişken önerisi */}
                      {regressionResult.suggestedVariablesToRemove.length > 0 && (
                        <div className="mt-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 flex gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-300">
                            <span className="font-medium">Sistem önerisi:</span> P değeri 0.1'den büyük olan değişkenleri (
                            {regressionResult.suggestedVariablesToRemove.join(", ")}) çıkararak yeniden analiz yapmanız önerilir.
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Formül */}
                  <Card className="border-border/50 bg-muted/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Regresyon Formülü</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs font-mono text-teal-300 break-all">{regressionResult.formulaText}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        Bağımlı değişken: Aylık toplam enerji tüketimi (TEP)
                      </p>
                    </CardContent>
                  </Card>

                  {/* Kullanılan aylar */}
                  <Card className="border-border/40">
                    <CardContent className="p-4">
                      <div className="flex flex-wrap gap-2 items-center">
                        <span className="text-xs text-muted-foreground shrink-0">Analizde kullanılan aylar ({regressionResult.sampleSize}):</span>
                        {regressionResult.usedMonths.map(m => (
                          <Badge key={m} variant="outline" className="text-xs border-border text-muted-foreground">{m}</Badge>
                        ))}
                      </div>
                      {regressionResult.missingVariableMonths.length > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          <span className="text-amber-400">Eksik değişken verisi nedeniyle hariç tutulan aylar: </span>
                          {regressionResult.missingVariableMonths.map(m => m.month).join(", ")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* EnRÇ Kayıtları */}
        <TabsContent value="baselines">
          {!selectedSeuItem ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Önce ÖEK Seçimi sekmesinden bir kalem seçin.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">

              {/* Başlık + ÖEK bilgisi */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-teal-400" />
                    EnRÇ — {selectedSeuItem.name}
                    <span className="text-muted-foreground font-normal">— {year} yılı</span>
                    <Button
                      variant="ghost" size="sm" className="ml-auto h-7 text-xs"
                      onClick={() => { setSelectedSeuItem(null); setActiveTab("seu-selection"); }}
                    >Değiştir</Button>
                  </CardTitle>
                </CardHeader>
              </Card>

              {/* EnRÇ Kaydet Paneli — regresyon sonucu varsa */}
              {regressionResult ? (
                <Card className={regressionResult.isValid
                  ? "border-teal-500/30 bg-teal-500/5"
                  : "border-amber-500/20 bg-amber-500/5"
                }>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Save className="h-4 w-4" />
                      Mevcut Regresyon Sonucunu Kaydet
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Model özeti */}
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span className="text-muted-foreground">
                        Model: <strong className="text-foreground">{MODEL_TYPE_LABELS[regressionResult.modelType] ?? regressionResult.modelType}</strong>
                      </span>
                      <span className="text-muted-foreground">
                        R²: <strong className={regressionResult.rSquared >= 0.75 ? "text-teal-400" : "text-destructive"}>
                          {regressionResult.rSquared.toFixed(4)}
                        </strong>
                      </span>
                      <span className="text-muted-foreground">
                        Ayarlı R²: <strong className={regressionResult.adjustedRSquared >= 0.75 ? "text-teal-400" : "text-destructive"}>
                          {regressionResult.adjustedRSquared.toFixed(4)}
                        </strong>
                      </span>
                      <Badge variant="outline" className={`text-xs ${regressionResult.isValid
                        ? "border-teal-500/40 text-teal-400 bg-teal-500/10"
                        : "border-destructive/40 text-destructive bg-destructive/10"
                      }`}>
                        {regressionResult.isValid ? "Prosedür Kriterleri ✓" : "Kriterler Sağlanmıyor"}
                      </Badge>
                    </div>

                    {!regressionResult.isValid && (
                      <div className="flex gap-2 items-start p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-300">
                          Bu model prosedür kriterlerini sağlamıyor. Yalnızca taslak olarak kaydedilebilir.
                        </p>
                      </div>
                    )}

                    {/* Referans dönemi */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Referans Dönemi Başlangıcı</Label>
                        <input
                          type="month"
                          className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={savePeriodStart || `${year}-01`}
                          onChange={e => setSavePeriodStart(e.target.value)}
                          onFocus={initSavePeriods}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Referans Dönemi Sonu</Label>
                        <input
                          type="month"
                          className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          value={savePeriodEnd || `${year}-12`}
                          onChange={e => setSavePeriodEnd(e.target.value)}
                          onFocus={initSavePeriods}
                        />
                      </div>
                    </div>

                    {/* Güncelleme nedeni */}
                    <div className="space-y-1">
                      <Label className="text-xs">Güncelleme Nedeni <span className="text-muted-foreground">(opsiyonel)</span></Label>
                      <Select
                        value={saveUpdateReason || "__none__"}
                        onValueChange={v => setSaveUpdateReason(v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Seçin…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Seçiniz —</SelectItem>
                          {UPDATE_REASONS.map(r => (
                            <SelectItem key={r} value={r}>{r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Notlar */}
                    <div className="space-y-1">
                      <Label className="text-xs">Notlar <span className="text-muted-foreground">(opsiyonel)</span></Label>
                      <Textarea
                        placeholder="Ek açıklama…"
                        className="text-xs min-h-[56px] resize-none"
                        value={saveNotes}
                        onChange={e => setSaveNotes(e.target.value)}
                      />
                    </div>

                    {/* Hata / Başarı */}
                    {saveError && (
                      <div className="flex gap-2 items-start p-3 rounded-md bg-destructive/10 border border-destructive/30">
                        <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                        <p className="text-xs text-destructive">{saveError}</p>
                      </div>
                    )}
                    {saveSuccess && (
                      <div className="flex gap-2 items-start p-3 rounded-md bg-teal-500/10 border border-teal-500/30">
                        <CheckCircle2 className="h-4 w-4 text-teal-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-teal-300">{saveSuccess}</p>
                      </div>
                    )}

                    {/* Kaydet butonları */}
                    <div className="flex gap-2 pt-1">
                      {regressionResult.isValid && (
                        <Button
                          className="h-8 text-xs bg-teal-600 hover:bg-teal-700 text-white"
                          disabled={saveLoading}
                          onClick={() => { setSaveStatus("active"); saveBaseline("active"); }}
                        >
                          <FileCheck className="h-3.5 w-3.5 mr-1.5" />
                          {saveLoading && saveStatus === "active" ? "Kaydediliyor…" : "Aktif EnRÇ Olarak Kaydet"}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="h-8 text-xs"
                        disabled={saveLoading}
                        onClick={() => { setSaveStatus("draft"); saveBaseline("draft"); }}
                      >
                        <Clock className="h-3.5 w-3.5 mr-1.5" />
                        {saveLoading && saveStatus === "draft" ? "Kaydediliyor…" : "Taslak Olarak Kaydet"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-border/40 bg-muted/10">
                  <CardContent className="p-4 flex gap-3 items-center">
                    <Info className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                    <p className="text-sm text-muted-foreground">
                      EnRÇ kaydetmek için önce <strong>Regresyon Analizi</strong> sekmesinde analiz çalıştırın.
                    </p>
                    <Button
                      variant="outline" size="sm" className="ml-auto h-7 text-xs shrink-0"
                      onClick={() => setActiveTab("regression")}
                    >
                      Regresyon Analizine Git
                      <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Mevcut EnRÇ Kayıtları */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Archive className="h-4 w-4 text-muted-foreground" />
                    EnRÇ Kayıt Geçmişi
                    {baselines && (
                      <Badge variant="outline" className="text-xs ml-1">{baselines.length} kayıt</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {baselinesLoading ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Yükleniyor…</p>
                  ) : !baselines || baselines.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      Bu ÖEK için henüz EnRÇ kaydı bulunmuyor.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {baselines.map(b => {
                        const statusCfg = STATUS_CONFIG[b.status] ?? STATUS_CONFIG.draft;
                        const isExpanded = expandedBaseline === b.id;
                        return (
                          <div
                            key={b.id}
                            className="border border-border/40 rounded-lg overflow-hidden"
                          >
                            {/* Özet satır */}
                            <button
                              className="w-full p-3 flex items-center gap-3 hover:bg-muted/20 transition-colors text-left"
                              onClick={() => setExpandedBaseline(isExpanded ? null : b.id)}
                            >
                              <Badge variant="outline" className={`text-xs shrink-0 ${statusCfg.color}`}>
                                {statusCfg.label}
                              </Badge>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap text-xs">
                                  <span className="font-medium">{b.baselineYear} yılı</span>
                                  <span className="text-muted-foreground">·</span>
                                  <span className="text-muted-foreground">{MODEL_TYPE_LABELS[b.modelType] ?? b.modelType}</span>
                                  <span className="text-muted-foreground">·</span>
                                  <span className="text-muted-foreground">R²: <strong className="text-foreground">{b.rSquared?.toFixed(4) ?? "—"}</strong></span>
                                  <span className="text-muted-foreground">·</span>
                                  <span className="text-muted-foreground">{b.variables.length} değişken</span>
                                </div>
                                <p className="text-xs text-muted-foreground/70 mt-0.5">
                                  {b.periodStart} → {b.periodEnd}
                                  {b.createdByName && ` · ${b.createdByName}`}
                                  {" · "}
                                  {new Date(b.createdAt).toLocaleDateString("tr-TR")}
                                </p>
                              </div>
                              <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                            </button>

                            {/* Detay */}
                            {isExpanded && (
                              <div className="px-4 pb-4 space-y-4 border-t border-border/30 pt-3">
                                {/* Meta bilgiler */}
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                                  <div><span className="text-muted-foreground">ÖEK: </span><span>{selectedSeuItem.name}</span></div>
                                  <div><span className="text-muted-foreground">Birim: </span><span>{selectedSeuItem.unitName ?? "—"}</span></div>
                                  <div><span className="text-muted-foreground">Referans Yılı: </span><span>{b.baselineYear}</span></div>
                                  <div><span className="text-muted-foreground">Referans Dönemi: </span><span>{b.periodStart} → {b.periodEnd}</span></div>
                                  <div><span className="text-muted-foreground">Model Tipi: </span><span>{MODEL_TYPE_LABELS[b.modelType] ?? b.modelType}</span></div>
                                  <div><span className="text-muted-foreground">Örnek Sayısı: </span><span>{b.sampleSize ?? "—"} ay</span></div>
                                  <div><span className="text-muted-foreground">R²: </span><strong className={b.rSquared != null && b.rSquared >= 0.75 ? "text-teal-400" : "text-destructive"}>{b.rSquared?.toFixed(4) ?? "—"}</strong></div>
                                  <div><span className="text-muted-foreground">Ayarlı R²: </span><strong className={b.adjustedRSquared != null && b.adjustedRSquared >= 0.75 ? "text-teal-400" : "text-destructive"}>{b.adjustedRSquared?.toFixed(4) ?? "—"}</strong></div>
                                  <div><span className="text-muted-foreground">Durum: </span><Badge variant="outline" className={`text-xs ${statusCfg.color}`}>{statusCfg.label}</Badge></div>
                                  <div><span className="text-muted-foreground">Oluşturan: </span><span>{b.createdByName ?? "—"}</span></div>
                                  <div><span className="text-muted-foreground">Tarih: </span><span>{new Date(b.createdAt).toLocaleString("tr-TR")}</span></div>
                                  {b.updateReason && (
                                    <div><span className="text-muted-foreground">Güncelleme Nedeni: </span><span>{b.updateReason}</span></div>
                                  )}
                                </div>

                                {/* Formül */}
                                {b.formulaText && (
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-1">Regresyon Formülü</p>
                                    <p className="text-xs font-mono text-teal-300 bg-muted/30 rounded-md p-2 break-all">{b.formulaText}</p>
                                  </div>
                                )}

                                {/* Değişken tablosu */}
                                {b.variables.length > 0 && (
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-2">Değişken Katsayıları</p>
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b border-border/50 text-muted-foreground">
                                            <th className="text-left p-2 pl-0 font-medium">Değişken</th>
                                            <th className="text-right p-2 font-medium">Katsayı</th>
                                            <th className="text-right p-2 font-medium">Std. Hata</th>
                                            <th className="text-right p-2 font-medium">t İstatistiği</th>
                                            <th className="text-right p-2 font-medium">P Değeri</th>
                                            <th className="text-center p-2 font-medium">Anlamlı?</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {b.variables.map((v, i) => (
                                            <tr key={i} className={`border-b border-border/30 ${!v.isSignificant ? "bg-destructive/5" : ""}`}>
                                              <td className="p-2 pl-0 font-medium">{v.variableName}</td>
                                              <td className="p-2 text-right tabular-nums">{v.coefficient?.toFixed(6) ?? "—"}</td>
                                              <td className="p-2 text-right tabular-nums text-muted-foreground">{v.standardError?.toFixed(6) ?? "—"}</td>
                                              <td className="p-2 text-right tabular-nums text-muted-foreground">{v.tStat?.toFixed(4) ?? "—"}</td>
                                              <td className={`p-2 text-right tabular-nums font-medium ${v.isSignificant ? "text-teal-400" : "text-destructive"}`}>
                                                {v.pValue?.toFixed(4) ?? "—"}
                                              </td>
                                              <td className="p-2 text-center">
                                                {v.isSignificant
                                                  ? <span className="text-teal-400">✓ Evet</span>
                                                  : <span className="text-destructive">✗ Hayır</span>
                                                }
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                )}

                                {/* Notlar */}
                                {b.notes && (
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-1">Notlar</p>
                                    <p className="text-xs text-foreground bg-muted/20 rounded-md p-2">{b.notes}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* EnPG İzleme — Placeholder */}
        <TabsContent value="monitoring">
          <Card>
            <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
              <Activity className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">EnPG İzleme</p>
              <p className="text-xs text-muted-foreground/70 max-w-sm">
                Gerçekleşen tüketim ile beklenen tüketim karşılaştırması, FARK, CUSUM,
                EEI ve SET grafikleri burada izlenecek.
              </p>
              <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400 bg-amber-500/10 mt-1">
                Yakında
              </Badge>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
