import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useUnit } from "@/context/UnitContext";
import { useYear } from "@/context/YearContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, BarChart2, Database,
  TrendingUp, BookOpen, Activity, Info,
} from "lucide-react";

const API_BASE = "/api";

const PRIORITY_LABELS: Record<number, string> = {
  1: "Çok Yüksek", 2: "Yüksek", 3: "Orta", 4: "Düşük",
};

const MONTH_SHORT: Record<number, string> = {
  1: "Oca", 2: "Şub", 3: "Mar", 4: "Nis", 5: "May", 6: "Haz",
  7: "Tem", 8: "Ağu", 9: "Eyl", 10: "Eki", 11: "Kas", 12: "Ara",
};

async function apiFetch(url: string, token: string | null) {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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

export default function EnergyPerformance() {
  const { token, user } = useAuth();
  const { unitId: contextUnitId } = useUnit();
  const { year } = useYear();
  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  const [activeTab, setActiveTab] = useState("seu-selection");
  const [unitFilter, setUnitFilter] = useState<number | null>(null);
  const [selectedSeuItem, setSelectedSeuItem] = useState<SeuItemRow | null>(null);
  const [selectedVariables, setSelectedVariables] = useState<string[]>([]);

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

  function handleSelectSeuItem(item: SeuItemRow) {
    setSelectedSeuItem(item);
    setActiveTab("dataset");
  }

  function toggleVariable(code: string) {
    setSelectedVariables(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
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

        {/* Regresyon Analizi — Placeholder */}
        <TabsContent value="regression">
          <Card>
            <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
              <BarChart2 className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">Regresyon Analizi</p>
              <p className="text-xs text-muted-foreground/70 max-w-sm">
                Seçilen değişkenlerle enerji tüketimi arasındaki ilişki analiz edilecek.
                R², düzeltilmiş R², EnPG ve EEI metrikleri hesaplanacak.
              </p>
              <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400 bg-amber-500/10 mt-1">
                Yakında
              </Badge>
            </CardContent>
          </Card>
        </TabsContent>

        {/* EnRÇ Kayıtları — Placeholder */}
        <TabsContent value="baselines">
          <Card>
            <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
              <TrendingUp className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">Enerji Referans Çizgisi (EnRÇ)</p>
              <p className="text-xs text-muted-foreground/70 max-w-sm">
                Regresyon sonucuna dayalı EnRÇ kaydı oluşturma, model parametreleri
                (kesim noktası, katsayılar) ve geçerlilik yönetimi burada yer alacak.
              </p>
              <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400 bg-amber-500/10 mt-1">
                Yakında
              </Badge>
            </CardContent>
          </Card>
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
