import { useYear } from "@/context/YearContext";
import { useUnit } from "@/context/UnitContext";
import {
  useGetDashboardKpi,
  useGetMonthlyTrend,
  useGetSeuBreakdown,
  getGetDashboardKpiQueryKey,
  getGetMonthlyTrendQueryKey,
  getGetSeuBreakdownQueryKey,
  useListTargets,
  getListTargetsQueryKey,
} from "@workspace/api-client-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadialBarChart, RadialBar,
} from "recharts";
import { TrendingUp, TrendingDown, Zap, Leaf, Flame, Gauge, Target, CheckCircle2, ArrowRight, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";

const COLORS = ["#0d9488", "#1e3a5f", "#f59e0b", "#ef4444", "#22c55e", "#8b5cf6"];

function KpiCard({
  title, value, unit, change, icon: Icon, color,
}: {
  title: string; value: string | number; unit: string; change?: number;
  icon: React.ElementType; color: string;
}) {
  const isPositive = (change ?? 0) > 0;
  const isZero = (change ?? 0) === 0;
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{title}</p>
            <p className="text-3xl font-bold text-foreground">
              {typeof value === "number" ? value.toLocaleString("tr-TR") : value}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{unit}</p>
          </div>
          <div className={`p-2.5 rounded-lg ${color}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
        {change !== undefined && (
          <div className="flex items-center gap-1 mt-3">
            {isZero ? (
              <span className="text-xs text-muted-foreground">Geçen yıla göre değişim yok</span>
            ) : (
              <>
                {isPositive ? (
                  <TrendingUp className="h-3 w-3 text-red-500" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-green-500" />
                )}
                <span className={`text-xs font-medium ${isPositive ? "text-red-500" : "text-green-500"}`}>
                  {isPositive ? "+" : ""}{change?.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground">geçen yıla göre</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CURRENT_YEAR = new Date().getFullYear();

function fmt(n: number | null | undefined, dec = 1) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function Dashboard() {
  const { year } = useYear();
  const { unitId } = useUnit();
  const [, navigate] = useLocation();

  const params = unitId !== null ? { year, unitId } : { year };
  const targetParams = unitId !== null ? { unitId } : undefined;

  const { data: kpi, isLoading: kpiLoading } = useGetDashboardKpi(params, {
    query: { queryKey: getGetDashboardKpiQueryKey(params) },
  });
  const { data: trend, isLoading: trendLoading } = useGetMonthlyTrend(params, {
    query: { queryKey: getGetMonthlyTrendQueryKey(params) },
  });
  const { data: seu, isLoading: seuLoading } = useGetSeuBreakdown(params, {
    query: { queryKey: getGetSeuBreakdownQueryKey(params) },
  });
  const { data: targets, isLoading: targetsLoading } = useListTargets(targetParams, {
    query: { queryKey: getListTargetsQueryKey(targetParams) },
  });

  // Derive target stats
  const activeTargets = (targets ?? []).filter((t: any) => t.targetYear >= CURRENT_YEAR);
  const totalTargets = (targets ?? []).length;
  const achieved = (targets ?? []).filter((t: any) => {
    const last = t.yearlyProgress?.at(-1)?.reductionPercent;
    return last !== null && last >= t.targetReductionPercent;
  });
  const inProgress = (targets ?? []).filter((t: any) => {
    const last = t.yearlyProgress?.at(-1)?.reductionPercent;
    return last !== null && last > 0 && last < t.targetReductionPercent;
  });
  const avgCompletion = totalTargets > 0
    ? (targets ?? []).reduce((sum: number, t: any) => {
        const last = t.yearlyProgress?.at(-1)?.reductionPercent;
        if (last === null || last === undefined) return sum;
        return sum + Math.min(100, (last / t.targetReductionPercent) * 100);
      }, 0) / totalTargets
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{year} Yılı Enerji Performansı</h1>
        <p className="text-sm text-muted-foreground mt-1">ISO 50001 Enerji Yönetim Sistemi — Genel Bakış</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : (
          <>
            <KpiCard
              title="Toplam Enerji"
              value={kpi?.totalKwh ?? 0}
              unit="kWh"
              change={kpi?.kwhChange}
              icon={Zap}
              color="bg-teal-600"
            />
            <KpiCard
              title="CO₂ Emisyonu"
              value={kpi?.totalCo2 ?? 0}
              unit="ton CO₂"
              change={kpi?.co2Change}
              icon={Leaf}
              color="bg-red-500"
            />
            <KpiCard
              title="Toplam TEP"
              value={kpi?.totalTep ?? 0}
              unit="TEP"
              change={kpi?.tepChange}
              icon={Flame}
              color="bg-amber-500"
            />
            <KpiCard
              title="Sayaç / ÖEK"
              value={`${kpi?.meterCount ?? 0} / ${kpi?.activeSeuCount ?? 0}`}
              unit="adet"
              icon={Gauge}
              color="bg-blue-700"
            />
          </>
        )}
      </div>

      {/* Monthly Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Aylık Enerji Tüketim Trendi</CardTitle>
            <CardDescription>Son 12 ay — kWh bazında</CardDescription>
          </CardHeader>
          <CardContent>
            {trendLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={trend ?? []} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="kwhGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0d9488" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="monthName" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={60} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                    labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                    formatter={(v: number) => [v.toLocaleString("tr-TR") + " kWh", "Tüketim"]}
                  />
                  <Area type="monotone" dataKey="kwh" stroke="#0d9488" strokeWidth={2} fill="url(#kwhGrad)" name="kWh" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* SEU Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">ÖEK Dağılımı</CardTitle>
            <CardDescription>Kaynak bazında enerji payı</CardDescription>
          </CardHeader>
          <CardContent>
            {seuLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : seu && seu.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={seu}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    dataKey="kwh"
                    nameKey="name"
                    paddingAngle={2}
                  >
                    {seu.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                    formatter={(v: number, name) => [v.toLocaleString("tr-TR") + " kWh", name]}
                  />
                  <Legend iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <p className="text-sm">ÖEK verisi yok</p>
                <p className="text-xs mt-1">ÖEK sayfasından veri ekleyin</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ISO 50001 Target Summary */}
      {(targetsLoading || totalTargets > 0) && (
        <Card
          className="border-primary/20 bg-card/60 cursor-pointer hover:border-primary/40 transition-colors"
          onClick={() => navigate("/hedefler")}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <Target className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Kuruluş Bazlı Hedef Özeti</CardTitle>
                  <CardDescription className="text-xs">ISO 50001 — Enerji azaltma hedefleri genel durumu</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                Tümünü Gör <ArrowRight className="h-3 w-3 ml-0.5" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {targetsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Stats row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-lg bg-muted/40 px-3 py-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Toplam Hedef</p>
                    <p className="text-2xl font-bold">{totalTargets}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{activeTargets.length} aktif</p>
                  </div>
                  <div className="rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Hedefe Ulaşan</p>
                    <p className="text-2xl font-bold text-green-400">{achieved.length}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {totalTargets > 0 ? `%${fmt((achieved.length / totalTargets) * 100, 0)}` : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">İlerleme Var</p>
                    <p className="text-2xl font-bold text-blue-400">{inProgress.length}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">hedef yolunda</p>
                  </div>
                  <div className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Ort. Tamamlanma</p>
                    <p className="text-2xl font-bold text-primary">%{fmt(avgCompletion, 0)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">tüm hedeflerde</p>
                  </div>
                </div>

                {/* Target mini list */}
                <div className="space-y-2">
                  {(targets ?? []).slice(0, 4).map((t: any) => {
                    const last = t.yearlyProgress?.at(-1)?.reductionPercent ?? null;
                    const pct = last !== null ? Math.min(100, (last / t.targetReductionPercent) * 100) : 0;
                    const isAchieved = last !== null && last >= t.targetReductionPercent;
                    const hasProgress = last !== null && last > 0;
                    return (
                      <div key={t.id} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium truncate">{t.name}</span>
                            {isAchieved ? (
                              <Badge className="text-[10px] px-1.5 py-0 h-4 bg-green-500/20 text-green-400 border-green-500/30 shrink-0">
                                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Ulaşıldı
                              </Badge>
                            ) : !hasProgress ? (
                              <Badge className="text-[10px] px-1.5 py-0 h-4 bg-muted text-muted-foreground shrink-0">
                                <Clock className="h-2.5 w-2.5 mr-0.5" />Başlamadı
                              </Badge>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${isAchieved ? "bg-green-500" : hasProgress ? "bg-primary" : "bg-muted-foreground/30"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-muted-foreground whitespace-nowrap w-24 text-right">
                              {last !== null ? `%${fmt(last)} / %${fmt(t.targetReductionPercent)}` : `—  / %${fmt(t.targetReductionPercent)}`}
                            </span>
                          </div>
                        </div>
                        <div className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">{t.baselineYear}→{t.targetYear}</div>
                      </div>
                    );
                  })}
                  {totalTargets > 4 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">
                      +{totalTargets - 4} hedef daha — tümünü görmek için tıklayın
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* CO2 & HDD/CDD Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">CO₂ Emisyon Trendi</CardTitle>
            <CardDescription>Aylık ton CO₂</CardDescription>
          </CardHeader>
          <CardContent>
            {trendLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trend ?? []} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="monthName" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={45} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                    formatter={(v: number) => [v.toLocaleString("tr-TR") + " ton", "CO₂"]}
                  />
                  <Bar dataKey="co2" fill="#ef4444" radius={[3, 3, 0, 0]} name="CO₂" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">HDD / CDD Karşılaştırması</CardTitle>
            <CardDescription>Isıtma ve soğutma derece günleri</CardDescription>
          </CardHeader>
          <CardContent>
            {trendLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trend ?? []} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="monthName" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={45} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                  />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="hdd" fill="#1e3a5f" radius={[3, 3, 0, 0]} name="HDD" />
                  <Bar dataKey="cdd" fill="#f59e0b" radius={[3, 3, 0, 0]} name="CDD" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
