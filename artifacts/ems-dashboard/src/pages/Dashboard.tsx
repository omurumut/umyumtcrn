import { useYear } from "@/context/YearContext";
import { useUnit } from "@/context/UnitContext";
import { useCompany } from "@/context/CompanyContext";
import {
  useGetDashboardKpi,
  useGetMonthlyTrend,
  useGetSeuBreakdown,
  getGetDashboardKpiQueryKey,
  getGetMonthlyTrendQueryKey,
  getGetSeuBreakdownQueryKey,
  useListTargets,
  getListTargetsQueryKey,
  useGetDashboardTargetStatus,
  getGetDashboardTargetStatusQueryKey,
  useGetDashboardActionStatus,
  getGetDashboardActionStatusQueryKey,
  useGetDashboardVapSummary,
  getGetDashboardVapSummaryQueryKey,
  useGetDashboardSeuSummary,
  getGetDashboardSeuSummaryQueryKey,
} from "@workspace/api-client-react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, Zap, Leaf, Flame, Gauge,
  Target, CheckCircle2, ArrowRight, Clock, ListChecks,
  AlertTriangle, Lightbulb, BarChart2, Factory,
} from "lucide-react";
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

function StatusBadge({ status }: { status: string | null | undefined }) {
  const config: Record<string, { label: string; cls: string }> = {
    active:      { label: "Aktif",          cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    completed:   { label: "Tamamlandı",     cls: "bg-green-500/20 text-green-400 border-green-500/30" },
    planned:     { label: "Planlandı",      cls: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
    in_progress: { label: "Devam Ediyor",   cls: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
    cancelled:   { label: "İptal",          cls: "bg-red-500/20 text-red-400 border-red-500/30" },
    idea:        { label: "Fikir",          cls: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  };
  const s = status ?? "";
  const c = config[s] ?? { label: s || "—", cls: "bg-muted text-muted-foreground border-muted" };
  return (
    <Badge className={`text-[10px] px-1.5 py-0 h-4 shrink-0 border ${c.cls}`}>
      {c.label}
    </Badge>
  );
}

const CURRENT_YEAR = new Date().getFullYear();

function fmt(n: number | null | undefined, dec = 1) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtCurrency(n: number | null | undefined) {
  if (n == null) return "—";
  return "₺" + Math.round(n).toLocaleString("tr-TR");
}

function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="py-10 flex flex-col items-center justify-center text-muted-foreground gap-1">
      <p className="text-sm">{message}</p>
      {sub && <p className="text-xs">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { year } = useYear();
  const { unitId } = useUnit();
  const { companyId } = useCompany();
  const [, navigate] = useLocation();

  const params = unitId !== null ? { year, unitId } : companyId !== null ? { year, companyId } : { year };
  const targetParams = unitId !== null ? { unitId } : companyId !== null ? { companyId } : undefined;
  const mgmtParams = unitId !== null ? { year, unitId } : { year };

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

  const { data: targetStatus, isLoading: targetStatusLoading } = useGetDashboardTargetStatus(mgmtParams, {
    query: { queryKey: getGetDashboardTargetStatusQueryKey(mgmtParams) },
  });
  const { data: actionStatus, isLoading: actionStatusLoading } = useGetDashboardActionStatus(mgmtParams, {
    query: { queryKey: getGetDashboardActionStatusQueryKey(mgmtParams) },
  });
  const { data: vapSummary, isLoading: vapLoading } = useGetDashboardVapSummary(mgmtParams, {
    query: { queryKey: getGetDashboardVapSummaryQueryKey(mgmtParams) },
  });
  const { data: seuSummary, isLoading: seuSummaryLoading } = useGetDashboardSeuSummary(mgmtParams, {
    query: { queryKey: getGetDashboardSeuSummaryQueryKey(mgmtParams) },
  });

  // Derived management KPIs
  const tsItems = targetStatus?.items ?? [];
  const activeTargetCount = tsItems.filter(t => t.status === "active").length;
  const achievable = tsItems.filter(t => t.achievementPct !== null && t.achievementPct !== undefined);
  const avgAchievementPct = achievable.length > 0
    ? achievable.reduce((s, t) => s + Math.min(100, t.achievementPct!), 0) / achievable.length
    : null;

  const actionSummary = actionStatus?.summary;
  const openActionCount = (actionSummary?.planned ?? 0) + (actionSummary?.inProgress ?? 0);
  const overdueCount = actionSummary?.overdue ?? 0;

  const vapItems = vapSummary?.items ?? [];
  const activeVapCount = vapItems.filter(v => v.status === "in_progress" || v.status === "planned").length;
  const totalAnnualSaving = vapSummary?.financial?.totalAnnualCostSaving ?? 0;

  const totalConfirmedSeu = (seuSummary?.byUnit ?? []).reduce((s, u) => s + (u.confirmedSeuCount ?? 0), 0);

  // Legacy target derived stats
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

  const mgmtLoading = targetStatusLoading || actionStatusLoading || vapLoading || seuSummaryLoading;

  // Ort. Gerçekleşme görüntüleme hesabı
  const avgAchDisplay: { value: string; sub: string; color: string } =
    avgAchievementPct === null
      ? { value: "İzleme yok", sub: "gerçekleşme girilmemiş", color: "text-muted-foreground" }
      : avgAchievementPct < 0
      ? { value: "Sapma var", sub: `%${fmt(Math.abs(avgAchievementPct), 0)} geride`, color: "text-red-400" }
      : { value: `%${fmt(Math.min(100, avgAchievementPct), 0)}${avgAchievementPct > 100 ? "+" : ""}`, sub: "hedef bazında", color: "text-primary" };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{year} Yılı Enerji Performansı</h1>
        <p className="text-sm text-muted-foreground mt-1">ISO 50001 Enerji Yönetim Sistemi — Genel Bakış</p>
      </div>

      {/* Enerji KPI Kartları */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : (
          <>
            <KpiCard title="Toplam Enerji" value={kpi?.totalKwh ?? 0} unit="kWh" change={kpi?.kwhChange} icon={Zap} color="bg-teal-600" />
            <KpiCard title="CO₂ Emisyonu" value={kpi?.totalCo2 ?? 0} unit="ton CO₂" change={kpi?.co2Change} icon={Leaf} color="bg-red-500" />
            <KpiCard title="Toplam TEP" value={kpi?.totalTep ?? 0} unit="TEP" change={kpi?.tepChange} icon={Flame} color="bg-amber-500" />
            <KpiCard title="Sayaç / ÖEK" value={`${kpi?.meterCount ?? 0} / ${kpi?.activeSeuCount ?? 0}`} unit="adet" icon={Gauge} color="bg-blue-700" />
          </>
        )}
      </div>

      {/* ISO 50001 Yönetim KPI Satırı */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">ISO 50001 Yönetim Göstergeleri</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          {mgmtLoading ? (
            Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : (
            <>
              <MgmtStatBox label="Aktif Hedef" value={activeTargetCount} sub="adet" color="text-blue-400" />
              <MgmtStatBox label="Ort. Gerçekleşme" value={avgAchDisplay.value} sub={avgAchDisplay.sub} color={avgAchDisplay.color} />
              <MgmtStatBox label="Açık Eylem" value={openActionCount} sub="plan / devam" color="text-amber-400" />
              <MgmtStatBox label="Gecikmiş Eylem" value={overdueCount} sub="adet" color={overdueCount > 0 ? "text-red-400" : "text-muted-foreground"} />
              <MgmtStatBox label="Aktif VAP" value={activeVapCount} sub="proje" color="text-purple-400" />
              <MgmtStatBox label="Yıllık Tasarruf" value={fmtCurrency(totalAnnualSaving)} sub="beklenen" color="text-green-400" />
              <MgmtStatBox label="Onaylı ÖEK" value={totalConfirmedSeu} sub="kalem" color="text-teal-400" />
            </>
          )}
        </div>
      </div>

      {/* Aylık Trend + ÖEK Dağılımı */}
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
                  <Pie data={seu} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="kwh" nameKey="name" paddingAngle={2}>
                    {seu.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
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

      {/* Legacy Hedef Özeti */}
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
                              {last !== null ? `%${fmt(last)} / %${fmt(t.targetReductionPercent)}` : `— / %${fmt(t.targetReductionPercent)}`}
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

      {/* CO₂ & HDD/CDD Grafikleri */}
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
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="hdd" fill="#1e3a5f" radius={[3, 3, 0, 0]} name="HDD" />
                  <Bar dataKey="cdd" fill="#f59e0b" radius={[3, 3, 0, 0]} name="CDD" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── B) Hedef Durumu ─────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-500/10">
                <Target className="h-4 w-4 text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-base">Hedef Durumu</CardTitle>
                <CardDescription className="text-xs">Gerçekleşme yüzdesi ve ilerleme trendi ({year})</CardDescription>
              </div>
            </div>
            <button
              onClick={() => navigate("/hedefler")}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Hedeflere Git <ArrowRight className="h-3 w-3 ml-0.5" />
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {targetStatusLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : tsItems.length === 0 ? (
            <EmptyState message="Bu yıl için hedef verisi yok." sub="Hedefler sayfasından hedef ve gerçekleşme girin." />
          ) : (
            <div className="space-y-3">
              {tsItems.map(t => {
                const rawPct = t.achievementPct ?? 0;
                const displayPct = Math.min(100, Math.max(0, rawPct));
                const isComplete = rawPct >= 100;
                const hasProgress = (t.latestProgress?.actualValue ?? null) !== null;
                return (
                  <div key={t.id} className="rounded-lg border bg-muted/20 px-4 py-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">{t.name}</span>
                        <StatusBadge status={t.status} />
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                        {t.unitName && <span className="hidden sm:inline">{t.unitName}</span>}
                        <span>{t.baselineYear ?? "—"} → {t.targetYear ?? "—"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isComplete ? "bg-green-500" : hasProgress ? "bg-primary" : "bg-muted-foreground/30"}`}
                          style={{ width: `${displayPct}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold w-16 text-right whitespace-nowrap ${isComplete ? "text-green-400" : rawPct < 0 ? "text-red-400" : "text-foreground"}`}>
                        {t.achievementPct == null
                          ? "—"
                          : rawPct > 100
                          ? "%100+"
                          : rawPct < 0
                          ? "Sapma"
                          : `%${fmt(rawPct, 0)}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        Eylem: {t.actionCount} plan
                        {t.latestProgress
                          ? <> · Son: {t.latestProgress.periodYear}/{String(t.latestProgress.periodMonth ?? "").padStart(2, "0")}</>
                          : <> · <span className="text-amber-500/80">Gerçekleşme girilmedi</span></>
                        }
                      </span>
                      <span>
                        {t.actualValue != null ? fmt(t.actualValue, 0) : "—"} / {t.targetValue != null ? fmt(t.targetValue, 0) : "—"} {t.unitLabel ?? ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── C) Eylem Planı Durumu + D) VAP Portföyü ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* C) Eylem Planı Durumu */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-500/10">
                <ListChecks className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <CardTitle className="text-base">Eylem Planı Durumu</CardTitle>
                <CardDescription className="text-xs">Gecikmiş ve devam eden eylemler</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {actionStatusLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <>
                {/* Özet sayaçlar */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-muted/40 p-2.5 text-center">
                    <p className="text-[11px] text-muted-foreground">Toplam</p>
                    <p className="text-xl font-bold">{actionSummary?.total ?? 0}</p>
                  </div>
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-center">
                    <p className="text-[11px] text-muted-foreground">Devam Eden</p>
                    <p className="text-xl font-bold text-amber-400">{actionSummary?.inProgress ?? 0}</p>
                  </div>
                  <div className={`rounded-lg p-2.5 text-center ${overdueCount > 0 ? "bg-red-500/10 border border-red-500/20" : "bg-muted/40"}`}>
                    <p className="text-[11px] text-muted-foreground">Gecikmiş</p>
                    <p className={`text-xl font-bold ${overdueCount > 0 ? "text-red-400" : ""}`}>{overdueCount}</p>
                  </div>
                </div>

                {/* Finansal özet */}
                {(actionStatus?.financial?.totalExpectedCostSaving ?? 0) > 0 && (
                  <div className="rounded-lg bg-muted/20 px-3 py-2 flex justify-between text-xs">
                    <span className="text-muted-foreground">Beklenen Tasarruf</span>
                    <span className="font-semibold text-green-400">{fmtCurrency(actionStatus?.financial?.totalExpectedCostSaving)}</span>
                  </div>
                )}

                {/* Eylem listesi */}
                {(actionStatus?.items ?? []).length === 0 ? (
                  <EmptyState message="Eylem planı bulunamadı." />
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {(actionStatus?.items ?? [])
                      .filter(a => a.status === "in_progress" || a.isOverdue)
                      .slice(0, 8)
                      .map(a => (
                        <div key={a.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${a.isOverdue ? "bg-red-500/5 border border-red-500/20" : "bg-muted/20"}`}>
                          {a.isOverdue && <AlertTriangle className="h-3 w-3 text-red-400 shrink-0" />}
                          <span className="flex-1 truncate font-medium">{a.title}</span>
                          <StatusBadge status={a.status} />
                          {a.progressPct != null && (
                            <span className="text-muted-foreground whitespace-nowrap">%{a.progressPct}</span>
                          )}
                        </div>
                      ))}
                    {(actionStatus?.items ?? []).length > 8 && (
                      <p className="text-[11px] text-muted-foreground text-center pt-1">
                        +{(actionStatus?.items ?? []).length - 8} eylem daha
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* D) VAP Portföyü */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-500/10">
                <Lightbulb className="h-4 w-4 text-purple-400" />
              </div>
              <div>
                <CardTitle className="text-base">VAP Portföyü</CardTitle>
                <CardDescription className="text-xs">Verimlilik Artırıcı Projeler</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {vapLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : vapItems.length === 0 ? (
              <EmptyState message="VAP projesi bulunamadı." sub="Eylem planlarından VAP olarak işaretleyin." />
            ) : (
              <>
                {/* Finansal özet */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/40 p-2.5">
                    <p className="text-[11px] text-muted-foreground">Toplam Yatırım</p>
                    <p className="text-base font-bold">{fmtCurrency(vapSummary?.financial?.totalInvestment)}</p>
                  </div>
                  <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-2.5">
                    <p className="text-[11px] text-muted-foreground">Yıllık Tasarruf</p>
                    <p className="text-base font-bold text-green-400">{fmtCurrency(vapSummary?.financial?.totalAnnualCostSaving)}</p>
                  </div>
                  <div className="rounded-lg bg-muted/40 p-2.5">
                    <p className="text-[11px] text-muted-foreground">Geri Ödeme</p>
                    <p className="text-base font-bold">
                      {vapSummary?.financial?.portfolioPaybackMonths != null
                        ? `${fmt(vapSummary.financial.portfolioPaybackMonths, 0)} ay`
                        : "—"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-teal-500/10 border border-teal-500/20 p-2.5">
                    <p className="text-[11px] text-muted-foreground">CO₂ Azaltım</p>
                    <p className="text-base font-bold text-teal-400">
                      {vapSummary?.financial?.totalCo2ReductionTon != null
                        ? `${fmt(vapSummary.financial.totalCo2ReductionTon, 1)} ton`
                        : "—"}
                    </p>
                  </div>
                </div>

                {/* VAP listesi */}
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {vapItems.slice(0, 6).map(v => (
                    <div key={v.id} className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2 text-xs">
                      <span className="flex-1 truncate font-medium">{v.projectTitle}</span>
                      <StatusBadge status={v.status} />
                      {(v.annualEnergySavingValue != null && v.annualEnergySavingValue > 0) ? (
                        <span className="text-teal-400 whitespace-nowrap shrink-0">
                          {v.annualEnergySavingValue.toLocaleString("tr-TR")} {v.annualEnergySavingUnit ?? "kWh"}
                        </span>
                      ) : (v.annualCostSaving != null && v.annualCostSaving > 0) ? (
                        <span className="text-green-400 whitespace-nowrap shrink-0">{fmtCurrency(v.annualCostSaving)}/yıl</span>
                      ) : (
                        <span className="text-muted-foreground whitespace-nowrap shrink-0">—</span>
                      )}
                    </div>
                  ))}
                  {vapItems.length > 6 && (
                    <p className="text-[11px] text-muted-foreground text-center pt-1">
                      +{vapItems.length - 6} proje daha
                    </p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── E) ÖEK Değerlendirme Özeti ──────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-teal-500/10">
              <BarChart2 className="h-4 w-4 text-teal-400" />
            </div>
            <div>
              <CardTitle className="text-base">ÖEK Değerlendirme Özeti</CardTitle>
              <CardDescription className="text-xs">Onaylı Önemli Enerji Kullanımları — birim bazlı</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {seuSummaryLoading ? (
            <div className="space-y-2">
              {[1, 2].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : (seuSummary?.totalAssessments ?? 0) === 0 ? (
            <EmptyState
              message="Henüz resmi ÖEK değerlendirmesi bulunmuyor."
              sub="ÖEK Değerlendirme sayfasından birim bazlı değerlendirme yapın."
            />
          ) : (
            <div className="space-y-4">
              {/* Birim özet satırları */}
              <div className="space-y-2">
                {(seuSummary?.byUnit ?? []).map(u => (
                  <div key={u.unitId ?? 0} className="rounded-lg border bg-muted/20 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Factory className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{u.unitName ?? "Birim"}</span>
                        <span className="text-xs text-muted-foreground">({u.latestAssessmentYear})</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        {(u.confirmedSeuCount ?? 0) > 0 ? (
                          <span className="text-teal-400 font-semibold">{u.confirmedSeuCount} onaylı ÖEK</span>
                        ) : (
                          <span className="text-amber-500/80 font-medium">Karar bekleniyor</span>
                        )}
                        {(u.confirmedSeuTep ?? 0) > 0 && (
                          <span className="text-muted-foreground">{fmt(u.confirmedSeuTep, 1)} TEP</span>
                        )}
                        {(u.overrideCount ?? 0) > 0 && (
                          <span className="text-amber-400">{u.overrideCount} manuel değişiklik</span>
                        )}
                      </div>
                    </div>
                    {/* Kapsama progress bar */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-teal-500 transition-all"
                          style={{ width: `${Math.min(100, u.coveragePct ?? 0)}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap w-20 text-right">
                        %{fmt(u.coveragePct, 0)} kapsama
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Top SEU items */}
              {(seuSummary?.topSeuItems ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">En Büyük ÖEK Kalemleri (TEP)</p>
                  <div className="space-y-1">
                    {(seuSummary?.topSeuItems ?? []).slice(0, 5).map((item, idx) => (
                      <div key={idx} className="flex items-center gap-3 text-xs py-1.5 border-b border-border/40 last:border-0">
                        <span className="w-5 text-center text-muted-foreground font-mono">{idx + 1}</span>
                        <span className="flex-1 font-medium truncate">{item.name}</span>
                        <span className="text-muted-foreground hidden sm:inline truncate max-w-28">{item.unitName ?? ""}</span>
                        {item.consumptionSharePct != null && (
                          <span className="text-muted-foreground whitespace-nowrap">%{fmt(item.consumptionSharePct, 0)}</span>
                        )}
                        <span className="text-teal-400 font-semibold whitespace-nowrap w-20 text-right">
                          {fmt(item.energyTep, 1)} TEP
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MgmtStatBox({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-3 text-center">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 leading-tight">{label}</p>
      <p className={`text-xl font-bold ${color}`}>
        {typeof value === "number" ? value.toLocaleString("tr-TR") : value}
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}
