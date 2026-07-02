import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  AlertCircle, AlertTriangle, CheckCircle2, Clock, TrendingUp, BarChart2,
  Zap, Target, Activity, Info, ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { useUnit } from "@/context/UnitContext";
import { useYear } from "@/context/YearContext";
import { useListUnits, getListUnitsQueryKey } from "@workspace/api-client-react";

const API_BASE = "/api";

async function apiFetch<T>(url: string, token: string | null): Promise<T> {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let msg = "API hatası";
    try {
      const body = await res.json();
      msg = body?.error ?? body?.message ?? msg;
    } catch { /* ignore */ }
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.json();
}

// ── Types ────────────────────────────────────────────────────────────────────

interface OverviewData {
  year: number;
  totalTep: number;
  totalCo2Ton: number;
  seuCount: number;
  activeEnpiCount: number;
  monitoredSeuCount: number;
  unmonitoredSeuCount: number;
  targetsCount: number;
  openActionsCount: number;
  overdueActionsCount: number;
  activeVapCount: number;
}

interface SourceBreakdownItem {
  energySourceId: number;
  energySourceName: string;
  unitOfMeasure: string;
  rawConsumption: number;
  tep: number;
  co2Ton: number;
  tepSharePercent: number;
}

interface SourceComparisonItem {
  energySourceId: number;
  energySourceName: string;
  unitOfMeasure: string;
  selectedYearRawConsumption: number;
  previousYearRawConsumption: number;
  rawConsumptionChangePercent: number | null;
  selectedYearTep: number;
  previousYearTep: number;
  tepChangePercent: number | null;
  selectedYearCo2Ton: number;
  previousYearCo2Ton: number;
  co2ChangePercent: number | null;
}

interface EnpiSummaryItem {
  seuItemId: number;
  seuName: string;
  unitId: number | null;
  unitName: string | null;
  energyUseGroupName: string | null;
  energySourceName: string | null;
  baselineId: number | null;
  baselineStatus: string | null;
  baselinePeriod: string | null;
  regressionFormula: string | null;
  r2Score: number | null;
  adjustedR2Score: number | null;
  resultCount: number;
  lastResultYear: number | null;
  lastResultMonth: number | null;
  lastResultPeriod: string | null;
  latestEei: number | null;
  latestSet: number | null;
  cumulativeCusum: number | null;
  latestExpectedConsumption: number | null;
  latestActualConsumption: number | null;
  latestVariance: number | null;
  latestVariancePercent: number | null;
  existingStatus: string | null;
  monitoringState: "not_monitored" | "baseline_without_results" | "monitored" | "missing_relation";
  dataRelationState: "complete" | "missing_unit" | "missing_energy_source" | "missing_energy_use_group" | "missing_baseline_link" | "missing_result_link";
}

interface UnitComparisonItem {
  unitId: number;
  unitName: string;
  totalTep: number;
  totalCo2Ton: number;
  seuCount: number;
  activeEnpiCount: number;
  monitoredSeuCount: number;
  unmonitoredSeuCount: number;
  openActionsCount: number;
  overdueActionsCount: number;
}

// ── Renk paleti ──────────────────────────────────────────────────────────────
const PIE_COLORS = ["#14b8a6", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6", "#10b981", "#f97316", "#06b6d4"];

// ── Küçük yardımcı bileşenler ────────────────────────────────────────────────
function KpiCard({
  title,
  value,
  unit,
  icon: Icon,
  accent = "teal",
  tooltip,
}: {
  title: string;
  value: string | number;
  unit?: string;
  icon?: React.ElementType;
  accent?: "teal" | "amber" | "red" | "indigo" | "muted";
  tooltip?: string;
}) {
  const accentMap: Record<string, string> = {
    teal: "text-teal-400 bg-teal-600/10",
    amber: "text-amber-400 bg-amber-600/10",
    red: "text-red-400 bg-red-600/10",
    indigo: "text-indigo-400 bg-indigo-600/10",
    muted: "text-muted-foreground bg-muted/30",
  };
  const cls = accentMap[accent] ?? accentMap.teal;
  return (
    <Card className="bg-card border-border">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground mb-1 truncate">{title}</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold">{value}</span>
              {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
            </div>
          </div>
          {Icon && (
            <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${cls}`}>
              <Icon className="h-4 w-4" />
            </div>
          )}
        </div>
        {tooltip && (
          <p className="text-[10px] text-muted-foreground/70 mt-2 leading-tight">{tooltip}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MonitoringBadge({ state }: { state: EnpiSummaryItem["monitoringState"] }) {
  if (state === "monitored")
    return <Badge className="bg-teal-600/20 text-teal-400 border-teal-600/30 text-[10px]">İzleniyor</Badge>;
  if (state === "baseline_without_results")
    return <Badge className="bg-amber-600/20 text-amber-400 border-amber-600/30 text-[10px]">EnRÇ Var / Sonuç Yok</Badge>;
  if (state === "missing_relation")
    return <Badge className="bg-red-600/20 text-red-400 border-red-600/30 text-[10px]">Veri İlişkisi Eksik</Badge>;
  return <Badge className="bg-muted/30 text-muted-foreground border-border text-[10px]">İzlenmiyor</Badge>;
}

// Değişim yüzdesini nötr biçimde gösterir: artış/azalış/değişim yok / karşılaştırılamıyor.
// Pozitif/negatif değişim renklendirmesi yapılmaz (üretim/hava/faaliyet farklılıklarından kaynaklayabilir).
function ChangeCell({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="text-muted-foreground text-[10px]">Karşılaştırılamıyor</span>;
  }
  if (pct === 0) {
    return <span className="text-muted-foreground tabular-nums">—</span>;
  }
  const sign = pct > 0 ? "▲" : "▼";
  const abs = Math.abs(pct);
  return (
    <span className="text-foreground tabular-nums">
      {sign} {pct > 0 ? "+" : ""}{abs.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
      <Info className="h-8 w-8 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function LoadingRows({ cols }: { cols: number }) {
  return (
    <>
      {[1, 2, 3].map((i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <div className="h-4 rounded bg-muted/30 animate-pulse w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

// ── Ana bileşen ──────────────────────────────────────────────────────────────

export default function EnergyReview() {
  const { user, token } = useAuth();
  const { unitId: ctxUnitId } = useUnit();
  const { year } = useYear();

  const isAdmin = user?.role === "admin" || user?.role === "superadmin";

  // Admin kullanıcı için lokal birim filtresi (context'ten bağımsız seçim)
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);

  // ÖEK & EnPG sekmesi filtreleri
  const [enpiFilterState, setEnpiFilterState] = useState("all");
  const [enpiFilterUnit, setEnpiFilterUnit] = useState("all");
  const [enpiFilterSource, setEnpiFilterSource] = useState("all");
  const [enpiFilterOnlyMissing, setEnpiFilterOnlyMissing] = useState(false);

  const { data: units } = useListUnits(
    {} as any,
    { query: { queryKey: getListUnitsQueryKey() } },
  );

  // Efektif birim: admin → local state; standart kullanıcı → context
  const effectiveUnitId: number | null = isAdmin ? selectedUnitId : (user?.unitId ?? null);

  function buildParams(extra?: Record<string, string | number | undefined>) {
    const p = new URLSearchParams();
    p.set("year", String(year));
    if (isAdmin && effectiveUnitId !== null) p.set("unitId", String(effectiveUnitId));
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v !== undefined) p.set(k, String(v));
      }
    }
    return p.toString();
  }

  const overviewQ = useQuery<OverviewData>({
    queryKey: ["energy-review-overview", year, effectiveUnitId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/overview?${buildParams()}`, token),
  });

  const sourceQ = useQuery<SourceBreakdownItem[]>({
    queryKey: ["energy-review-source", year, effectiveUnitId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/source-breakdown?${buildParams()}`, token),
  });

  const enpiQ = useQuery<EnpiSummaryItem[]>({
    queryKey: ["energy-review-enpi", year, effectiveUnitId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/enpi-summary?${buildParams()}`, token),
  });

  const sourceCompQ = useQuery<SourceComparisonItem[]>({
    queryKey: ["energy-review-source-comparison", year, effectiveUnitId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/source-comparison?${buildParams()}`, token),
  });

  const unitCompQ = useQuery<UnitComparisonItem[]>({
    queryKey: ["energy-review-units", year],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/unit-comparison?year=${year}`, token),
    enabled: isAdmin,
  });

  const ov = overviewQ.data;
  const sources = sourceQ.data ?? [];
  const enpiList = enpiQ.data ?? [];
  const unitList = unitCompQ.data ?? [];

  // ÖEK filtreli liste
  const filteredEnpiList = enpiList.filter((item) => {
    if (enpiFilterState !== "all" && item.monitoringState !== enpiFilterState) return false;
    if (isAdmin && enpiFilterUnit !== "all" && String(item.unitId) !== enpiFilterUnit) return false;
    if (enpiFilterSource !== "all" && item.energySourceName !== enpiFilterSource) return false;
    if (enpiFilterOnlyMissing && item.monitoringState !== "missing_relation") return false;
    return true;
  });

  const unitName: string = isAdmin
    ? (effectiveUnitId !== null ? (units as any[])?.find((u: any) => u.id === effectiveUnitId)?.name ?? "" : "Tüm Birimler")
    : ((units as any[])?.find((u: any) => u.id === (user?.unitId ?? null))?.name ?? "");

  return (
    <div className="p-6 space-y-6">
      {/* ── Başlık ── */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-teal-400" />
            Enerji Gözden Geçirme
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            ISO 50001:2018 Madde 6.3 — Enerji kullanımları, ÖEK'ler, EnPG'ler, EnRÇ sonuçları, hedefler ve aksiyonların bütüncül değerlendirmesi
          </p>
        </div>

        {/* Birim filtresi (sadece admin) */}
        {isAdmin && (
          <div className="flex items-center gap-2 shrink-0">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Birim</Label>
            <Select
              value={selectedUnitId !== null ? String(selectedUnitId) : "all"}
              onValueChange={(v) => setSelectedUnitId(v === "all" ? null : parseInt(v))}
            >
              <SelectTrigger className="w-52 h-8 text-xs">
                <SelectValue placeholder="Tüm Birimler" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tüm Birimler</SelectItem>
                {(units as any[] | undefined)?.map((u: any) => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Standart kullanıcı: sabit birim kapsam etiketi */}
        {!isAdmin && unitName && (
          <Badge variant="outline" className="text-xs border-teal-600/30 text-teal-400 bg-teal-600/10 shrink-0">
            Birim: {unitName}
          </Badge>
        )}
      </div>

      {/* ── Sekmeler ── */}
      <Tabs defaultValue="overview">
        <TabsList className="bg-muted/30">
          <TabsTrigger value="overview">Genel Performans</TabsTrigger>
          <TabsTrigger value="sources">Enerji Kaynakları</TabsTrigger>
          <TabsTrigger value="enpi">ÖEK & EnPG Performansı</TabsTrigger>
          {isAdmin && <TabsTrigger value="units">Birim Karşılaştırma</TabsTrigger>}
          <TabsTrigger value="actions">Hedefler & Aksiyonlar</TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 1: Genel Performans                                        */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {overviewQ.isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Veriler yüklenemedi: {(overviewQ.error as Error)?.message}
            </div>
          )}

          {/* KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              title="Toplam TEP"
              value={overviewQ.isLoading ? "—" : ov ? ov.totalTep.toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "0"}
              unit="TEP"
              icon={Activity}
              accent="teal"
              tooltip="Ton Eşdeğer Petrol (TEP) — tüm enerji kaynaklarının ortak birimi"
            />
            <KpiCard
              title="Toplam CO₂"
              value={overviewQ.isLoading ? "—" : ov ? ov.totalCo2Ton.toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "0"}
              unit="ton CO₂"
              icon={TrendingUp}
              accent="indigo"
            />
            <KpiCard
              title="ÖEK Sayısı"
              value={overviewQ.isLoading ? "—" : ov?.seuCount ?? 0}
              icon={AlertTriangle}
              accent="amber"
              tooltip="Kabul edilmiş Önemli Enerji Kullanımı sayısı"
            />
            <KpiCard
              title="Aktif EnPG / EnRÇ Modeli"
              value={overviewQ.isLoading ? "—" : ov?.activeEnpiCount ?? 0}
              icon={TrendingUp}
              accent="teal"
              tooltip="Aktif Enerji Performans Göstergesi / Enerji Referans Çizgisi Modeli sayısı"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              title="İzlenen ÖEK"
              value={overviewQ.isLoading ? "—" : ov?.monitoredSeuCount ?? 0}
              icon={CheckCircle2}
              accent="teal"
              tooltip={`${year} yılı için EnPG sonucu bulunan ÖEK`}
            />
            <KpiCard
              title="İzlenmeyen ÖEK"
              value={overviewQ.isLoading ? "—" : ov?.unmonitoredSeuCount ?? 0}
              icon={AlertCircle}
              accent={(ov?.unmonitoredSeuCount ?? 0) > 0 ? "amber" : "muted"}
              tooltip="Henüz EnPG sonucu bulunmayan ÖEK"
            />
            <KpiCard
              title="Açık Aksiyon"
              value={overviewQ.isLoading ? "—" : ov?.openActionsCount ?? 0}
              icon={Clock}
              accent="muted"
            />
            <KpiCard
              title="Gecikmiş Aksiyon"
              value={overviewQ.isLoading ? "—" : ov?.overdueActionsCount ?? 0}
              icon={AlertCircle}
              accent={(ov?.overdueActionsCount ?? 0) > 0 ? "red" : "muted"}
            />
          </div>

          {/* Ek bilgi kartları */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="bg-card border-border">
              <CardContent className="pt-5 pb-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-teal-600/10 shrink-0">
                  <Target className="h-5 w-5 text-teal-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Aktif Hedef</p>
                  <p className="text-xl font-bold">{overviewQ.isLoading ? "—" : ov?.targetsCount ?? 0}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="pt-5 pb-4 flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-indigo-600/10 shrink-0">
                  <Zap className="h-5 w-5 text-indigo-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Aktif VAP Projesi</p>
                  <p className="text-xl font-bold">{overviewQ.isLoading ? "—" : ov?.activeVapCount ?? 0}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border col-span-1">
              <CardContent className="pt-5 pb-4">
                <p className="text-xs text-muted-foreground mb-2">ÖEK İzleme Durumu</p>
                {ov && ov.seuCount > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-3 rounded-full bg-muted/30 overflow-hidden">
                      <div
                        className="h-full bg-teal-500 rounded-full transition-all"
                        style={{ width: `${Math.round((ov.monitoredSeuCount / ov.seuCount) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium tabular-nums">
                      %{Math.round((ov.monitoredSeuCount / ov.seuCount) * 100)}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Veri yok</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 2: Enerji Kaynakları                                       */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="sources" className="mt-4">
          {sourceQ.isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Veriler yüklenemedi: {(sourceQ.error as Error)?.message}
            </div>
          )}

          {!sourceQ.isLoading && sources.length === 0 && !sourceQ.isError && (
            <EmptyState message={`${year} yılı için kaynak tüketimi bulunamadı.`} />
          )}

          {sources.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              {/* Tablo */}
              <div className="lg:col-span-3">
                <Card className="bg-card border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Kaynak Bazlı Tüketim</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-xs">Enerji Kaynağı</TableHead>
                          <TableHead className="text-xs text-right">Tüketim</TableHead>
                          <TableHead className="text-xs text-right">Birim</TableHead>
                          <TableHead className="text-xs text-right">TEP</TableHead>
                          <TableHead className="text-xs text-right">TEP Payı</TableHead>
                          <TableHead className="text-xs text-right">ton CO₂</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sourceQ.isLoading ? (
                          <LoadingRows cols={6} />
                        ) : (
                          sources.map((s) => (
                            <TableRow key={s.energySourceId} className="border-border">
                              <TableCell className="text-xs font-medium">{s.energySourceName}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {s.rawConsumption.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                              </TableCell>
                              <TableCell className="text-xs text-right text-muted-foreground">{s.unitOfMeasure}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {s.tep.toLocaleString("tr-TR", { maximumFractionDigits: 3 })}
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <Badge variant="outline" className="text-[10px] border-teal-600/30 text-teal-400">
                                  %{s.tepSharePercent.toFixed(1)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {s.co2Ton.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                        {/* Toplam satırı — sadece TEP ve CO₂ toplanır */}
                        {sources.length > 1 && !sourceQ.isLoading && (
                          <TableRow className="border-border border-t-2 font-semibold">
                            <TableCell className="text-xs">Toplam</TableCell>
                            <TableCell className="text-xs text-right text-muted-foreground text-[10px]">
                              —
                            </TableCell>
                            <TableCell />
                            <TableCell className="text-xs text-right tabular-nums">
                              {sources.reduce((a, s) => a + s.tep, 0).toLocaleString("tr-TR", { maximumFractionDigits: 3 })}
                            </TableCell>
                            <TableCell className="text-xs text-right">%100</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">
                              {sources.reduce((a, s) => a + s.co2Ton, 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
                <p className="text-[10px] text-muted-foreground/60 mt-2 px-1">
                  * Farklı enerji kaynakları farklı doğal birimlerle ölçülür (kWh, m³, litre, ton). Ham tüketim değerleri birbiriyle toplanmaz. Ortak ölçüm yalnızca TEP ve ton CO₂ sütunlarındadır.
                </p>
              </div>

              {/* Pie chart */}
              <div className="lg:col-span-2">
                <Card className="bg-card border-border">
                  <CardHeader className="pb-1 pt-4 px-4">
                    <CardTitle className="text-sm">TEP Payı Dağılımı</CardTitle>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      Grafik yalnızca TEP payını gösterir — farklı doğal birimler karşılaştırılmaz.
                    </p>
                  </CardHeader>
                  <CardContent className="px-2 pb-3 pt-1">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={sources}
                          dataKey="tep"
                          nameKey="energySourceName"
                          cx="50%"
                          cy="50%"
                          outerRadius={72}
                          labelLine={false}
                          label={({ tepSharePercent }) => tepSharePercent > 5 ? `%${tepSharePercent.toFixed(0)}` : ""}
                        >
                          {sources.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(value: number, name: string) => [
                            `${value.toLocaleString("tr-TR", { maximumFractionDigits: 3 })} TEP`,
                            name,
                          ]}
                        />
                        <Legend iconSize={9} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          {/* ── Yıllık Karşılaştırma Tablosu ── */}
          <div className="mt-6 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Yıllık Enerji Kaynağı Karşılaştırması</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Seçili yıl ile bir önceki yıl aynı enerji kaynağı bazında karşılaştırılır. Farklı doğal birimler birbiriyle toplanmaz.
              </p>
            </div>

            {sourceCompQ.isError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Karşılaştırma verileri yüklenemedi: {(sourceCompQ.error as Error)?.message}
              </div>
            )}

            {!sourceCompQ.isLoading && !sourceCompQ.isError && (sourceCompQ.data ?? []).length === 0 && (
              <EmptyState message={`${year} ve ${year - 1} yılları için karşılaştırılacak kaynak tüketimi bulunamadı.`} />
            )}

            {(sourceCompQ.isLoading || (sourceCompQ.data ?? []).length > 0) && !sourceCompQ.isError && (
              <Card className="bg-card border-border">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-xs min-w-[140px]">Enerji Kaynağı</TableHead>
                          <TableHead className="text-xs">Birim</TableHead>
                          <TableHead className="text-xs text-right min-w-[90px]">{year} Tüketim</TableHead>
                          <TableHead className="text-xs text-right min-w-[90px]">{year - 1} Tüketim</TableHead>
                          <TableHead className="text-xs text-right min-w-[110px]">Tüketim Değişimi</TableHead>
                          <TableHead className="text-xs text-right min-w-[80px]">{year} TEP</TableHead>
                          <TableHead className="text-xs text-right min-w-[80px]">{year - 1} TEP</TableHead>
                          <TableHead className="text-xs text-right min-w-[100px]">TEP Değişimi</TableHead>
                          <TableHead className="text-xs text-right min-w-[90px]">{year} ton CO₂</TableHead>
                          <TableHead className="text-xs text-right min-w-[90px]">{year - 1} ton CO₂</TableHead>
                          <TableHead className="text-xs text-right min-w-[100px]">CO₂ Değişimi</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sourceCompQ.isLoading ? (
                          <LoadingRows cols={11} />
                        ) : (
                          (sourceCompQ.data ?? []).map((row) => (
                            <TableRow key={row.energySourceId} className="border-border">
                              <TableCell className="text-xs font-medium">{row.energySourceName}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{row.unitOfMeasure}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {row.selectedYearRawConsumption.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                                {row.previousYearRawConsumption.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <ChangeCell pct={row.rawConsumptionChangePercent} />
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {row.selectedYearTep.toLocaleString("tr-TR", { maximumFractionDigits: 3 })}
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                                {row.previousYearTep.toLocaleString("tr-TR", { maximumFractionDigits: 3 })}
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <ChangeCell pct={row.tepChangePercent} />
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {row.selectedYearCo2Ton.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                                {row.previousYearCo2Ton.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <ChangeCell pct={row.co2ChangePercent} />
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 3: ÖEK & EnPG Performansı                                 */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="enpi" className="mt-4 space-y-4">
          {enpiQ.isError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Veriler yüklenemedi: {(enpiQ.error as Error)?.message}
            </div>
          )}

          {/* ── Özet KPI kartları ── */}
          {(enpiList.length > 0 || enpiQ.isFetching) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard
                title="Toplam ÖEK"
                value={enpiQ.isFetching ? "—" : enpiList.length}
                icon={Activity}
                accent="muted"
              />
              <KpiCard
                title="Aktif EnRÇ Modeli"
                value={enpiQ.isFetching ? "—" : enpiList.filter((i) => i.baselineId !== null).length}
                icon={TrendingUp}
                accent="teal"
              />
              <KpiCard
                title="İzlenen ÖEK"
                value={enpiQ.isFetching ? "—" : enpiList.filter((i) => i.monitoringState === "monitored").length}
                icon={CheckCircle2}
                accent="teal"
              />
              <KpiCard
                title="EnRÇ Var / Sonuç Yok"
                value={enpiQ.isFetching ? "—" : enpiList.filter((i) => i.monitoringState === "baseline_without_results").length}
                icon={Clock}
                accent="amber"
              />
              <KpiCard
                title="İzlenmeyen ÖEK"
                value={enpiQ.isFetching ? "—" : enpiList.filter((i) => i.monitoringState === "not_monitored").length}
                icon={AlertCircle}
                accent="muted"
              />
              <KpiCard
                title="Veri İlişkisi Eksik"
                value={enpiQ.isFetching ? "—" : enpiList.filter((i) => i.monitoringState === "missing_relation").length}
                icon={AlertTriangle}
                accent={enpiList.filter((i) => i.monitoringState === "missing_relation").length > 0 ? "red" : "muted"}
              />
            </div>
          )}

          {/* ── Filtreler ── */}
          {(enpiList.length > 0 || enpiQ.isFetching) && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">İzleme</Label>
                <Select value={enpiFilterState} onValueChange={setEnpiFilterState}>
                  <SelectTrigger className="h-8 text-xs w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    <SelectItem value="monitored">İzleniyor</SelectItem>
                    <SelectItem value="baseline_without_results">EnRÇ Var / Sonuç Yok</SelectItem>
                    <SelectItem value="not_monitored">İzlenmiyor</SelectItem>
                    <SelectItem value="missing_relation">Veri İlişkisi Eksik</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Birim</Label>
                  <Select value={enpiFilterUnit} onValueChange={setEnpiFilterUnit}>
                    <SelectTrigger className="h-8 text-xs w-40">
                      <SelectValue placeholder="Tümü" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tümü</SelectItem>
                      {Array.from(new Set(enpiList.map((i) => i.unitId).filter(Boolean))).map((uid) => {
                        const found = enpiList.find((i) => i.unitId === uid);
                        return found ? (
                          <SelectItem key={uid!} value={String(uid)}>{found.unitName ?? String(uid)}</SelectItem>
                        ) : null;
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Enerji Kaynağı</Label>
                <Select value={enpiFilterSource} onValueChange={setEnpiFilterSource}>
                  <SelectTrigger className="h-8 text-xs w-36">
                    <SelectValue placeholder="Tümü" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    {Array.from(new Set(enpiList.map((i) => i.energySourceName).filter((s): s is string => s !== null))).map((src) => (
                      <SelectItem key={src} value={src}>{src}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enpiOnlyMissing"
                  checked={enpiFilterOnlyMissing}
                  onChange={(e) => setEnpiFilterOnlyMissing(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border accent-teal-500"
                />
                <Label htmlFor="enpiOnlyMissing" className="text-xs text-muted-foreground cursor-pointer whitespace-nowrap">
                  Sadece eksik ilişkiler
                </Label>
              </div>
            </div>
          )}

          {/* ── Boş durum ── */}
          {!enpiQ.isFetching && enpiList.length === 0 && !enpiQ.isError && (
            <EmptyState message="Bu dönem için kabul edilmiş ÖEK bulunamadı." />
          )}

          {!enpiQ.isFetching && enpiList.length > 0 && filteredEnpiList.length === 0 && (
            <EmptyState message="Seçili filtrelere uyan ÖEK bulunamadı." />
          )}

          {/* ── Tablo ── */}
          {(filteredEnpiList.length > 0 || enpiQ.isFetching) && (
            <Card className="bg-card border-border">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead className="text-xs min-w-[140px]">ÖEK</TableHead>
                        {isAdmin && <TableHead className="text-xs min-w-[100px]">Birim</TableHead>}
                        <TableHead className="text-xs min-w-[120px]">Enerji Kul. Grubu</TableHead>
                        <TableHead className="text-xs min-w-[100px]">Enerji Kaynağı</TableHead>
                        <TableHead className="text-xs min-w-[80px]">EnRÇ</TableHead>
                        <TableHead className="text-xs text-right min-w-[110px]">R² / Düz. R²</TableHead>
                        <TableHead className="text-xs min-w-[80px]">Son Dönem</TableHead>
                        <TableHead className="text-xs text-right min-w-[100px]">Beklenen Tük.</TableHead>
                        <TableHead className="text-xs text-right min-w-[100px]">Gerç. Tük.</TableHead>
                        <TableHead className="text-xs text-right min-w-[100px]">Sapma</TableHead>
                        <TableHead className="text-xs text-right min-w-[70px]">EEI</TableHead>
                        <TableHead className="text-xs text-right min-w-[70px]">SET</TableHead>
                        <TableHead className="text-xs text-right min-w-[100px]">Küm. CUSUM</TableHead>
                        <TableHead className="text-xs min-w-[130px]">İzleme Durumu</TableHead>
                        <TableHead className="text-xs text-right">Detay</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {enpiQ.isFetching ? (
                        <LoadingRows cols={isAdmin ? 15 : 14} />
                      ) : (
                        filteredEnpiList.map((item) => (
                          <TableRow key={item.seuItemId} className="border-border">
                            <TableCell className="text-xs font-medium">{item.seuName}</TableCell>
                            {isAdmin && (
                              <TableCell className="text-xs text-muted-foreground">{item.unitName ?? "—"}</TableCell>
                            )}
                            <TableCell className="text-xs text-muted-foreground">{item.energyUseGroupName ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{item.energySourceName ?? "—"}</TableCell>
                            <TableCell className="text-xs">
                              {item.baselineId ? (
                                <Badge className="bg-teal-600/20 text-teal-400 border-teal-600/30 text-[10px]">Var</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] text-muted-foreground">Yok</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.r2Score != null || item.adjustedR2Score != null
                                ? `${item.r2Score != null ? Number(item.r2Score).toFixed(3) : "—"} / ${item.adjustedR2Score != null ? Number(item.adjustedR2Score).toFixed(3) : "—"}`
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{item.lastResultPeriod ?? "—"}</TableCell>
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.latestExpectedConsumption != null
                                ? Number(item.latestExpectedConsumption).toLocaleString("tr-TR", { maximumFractionDigits: 2 })
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.latestActualConsumption != null
                                ? Number(item.latestActualConsumption).toLocaleString("tr-TR", { maximumFractionDigits: 2 })
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.latestVariance != null ? (
                                <span>
                                  {Number(item.latestVariance) > 0 ? "▲ " : Number(item.latestVariance) < 0 ? "▼ " : ""}
                                  {Number(item.latestVariance).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                                  {item.latestVariancePercent != null
                                    ? ` (${Number(item.latestVariancePercent) > 0 ? "+" : ""}${Number(item.latestVariancePercent).toFixed(1)}%)`
                                    : ""}
                                </span>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.latestEei != null
                                ? Number(item.latestEei).toLocaleString("tr-TR", { maximumFractionDigits: 3 })
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.latestSet != null
                                ? Number(item.latestSet).toLocaleString("tr-TR", { maximumFractionDigits: 3 })
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right tabular-nums">
                              {item.cumulativeCusum != null
                                ? Number(item.cumulativeCusum).toLocaleString("tr-TR", { maximumFractionDigits: 2 })
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <MonitoringBadge state={item.monitoringState} />
                            </TableCell>
                            <TableCell className="text-right">
                              <Link href="/performans-gostergeleri">
                                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-teal-400 hover:text-teal-300">
                                  <ExternalLink className="h-3 w-3" />
                                  Detay
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 4: Birim Karşılaştırma (sadece admin)                     */}
        {/* ══════════════════════════════════════════════════════════════ */}
        {isAdmin && (
          <TabsContent value="units" className="mt-4">
            {unitCompQ.isError && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Veriler yüklenemedi: {(unitCompQ.error as Error)?.message}
              </div>
            )}

            {!unitCompQ.isLoading && unitList.length === 0 && !unitCompQ.isError && (
              <EmptyState message="Karşılaştırılacak birim bulunamadı." />
            )}

            {(unitList.length > 0 || unitCompQ.isLoading) && (
              <Card className="bg-card border-border">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-xs min-w-[140px]">Birim</TableHead>
                          <TableHead className="text-xs text-right">TEP</TableHead>
                          <TableHead className="text-xs text-right">ton CO₂</TableHead>
                          <TableHead className="text-xs text-right">ÖEK</TableHead>
                          <TableHead className="text-xs text-right">Aktif EnPG / EnRÇ Modeli</TableHead>
                          <TableHead className="text-xs text-right">İzlenen ÖEK</TableHead>
                          <TableHead className="text-xs text-right">İzlenmeyen ÖEK</TableHead>
                          <TableHead className="text-xs text-right">Açık Aksiyon</TableHead>
                          <TableHead className="text-xs text-right">Gecikmiş</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unitCompQ.isLoading ? (
                          <LoadingRows cols={9} />
                        ) : (
                          unitList.map((u) => (
                            <TableRow key={u.unitId} className="border-border">
                              <TableCell className="text-xs font-medium">{u.unitName}</TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {u.totalTep.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                              </TableCell>
                              <TableCell className="text-xs text-right tabular-nums">
                                {u.totalCo2Ton.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}
                              </TableCell>
                              <TableCell className="text-xs text-right">{u.seuCount}</TableCell>
                              <TableCell className="text-xs text-right">{u.activeEnpiCount}</TableCell>
                              <TableCell className="text-xs text-right">
                                <span className="text-teal-400">{u.monitoredSeuCount}</span>
                              </TableCell>
                              <TableCell className="text-xs text-right">
                                <span className={u.unmonitoredSeuCount > 0 ? "text-amber-400" : ""}>
                                  {u.unmonitoredSeuCount}
                                </span>
                              </TableCell>
                              <TableCell className="text-xs text-right">{u.openActionsCount}</TableCell>
                              <TableCell className="text-xs text-right">
                                <span className={u.overdueActionsCount > 0 ? "text-red-400" : ""}>
                                  {u.overdueActionsCount}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
            <p className="text-[10px] text-muted-foreground/60 mt-2 px-1">
              * Birimler TEP (Ton Eşdeğer Petrol) üzerinden karşılaştırılır. Farklı enerji kaynaklarının doğal tüketim değerleri (kWh, m³, litre) birbiriyle kıyaslanmaz.
            </p>
          </TabsContent>
        )}

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Tab 5: Hedefler & Aksiyonlar                                  */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <TabsContent value="actions" className="mt-4 space-y-4">
          {overviewQ.isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Card key={i} className="bg-card border-border">
                  <CardContent className="pt-5 pb-4">
                    <div className="h-8 rounded bg-muted/30 animate-pulse" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : !ov ? (
            <EmptyState message="Veri yüklenemedi." />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <KpiCard
                  title="Aktif Hedef"
                  value={ov.targetsCount}
                  icon={Target}
                  accent="teal"
                  tooltip={`${year} yılını kapsayan aktif hedefler`}
                />
                <KpiCard
                  title="Açık Aksiyon"
                  value={ov.openActionsCount}
                  icon={Clock}
                  accent="muted"
                />
                <KpiCard
                  title="Gecikmiş Aksiyon"
                  value={ov.overdueActionsCount}
                  icon={AlertCircle}
                  accent={ov.overdueActionsCount > 0 ? "red" : "muted"}
                />
                <KpiCard
                  title="Aktif VAP Projesi"
                  value={ov.activeVapCount}
                  icon={Zap}
                  accent="indigo"
                />
              </div>

              {ov.targetsCount === 0 && ov.openActionsCount === 0 && ov.activeVapCount === 0 && (
                <EmptyState message={`${year} yılı için aktif hedef veya aksiyon bulunamadı.`} />
              )}

              <div className="flex flex-wrap gap-3 pt-2">
                <Link href="/hedefler">
                  <Button variant="outline" size="sm" className="gap-2 text-xs">
                    <Target className="h-3.5 w-3.5" />
                    Enerji Hedefleri Modülüne Git
                  </Button>
                </Link>
                <Link href="/vap-projeler">
                  <Button variant="outline" size="sm" className="gap-2 text-xs">
                    <Zap className="h-3.5 w-3.5" />
                    VAP Projeleri Modülüne Git
                  </Button>
                </Link>
              </div>

              <Card className="bg-muted/20 border-border">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    Bu sekme salt okunurdur. Hedef ekleme, düzenleme ve aksiyon yönetimi için ilgili modüllere gidin.
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
