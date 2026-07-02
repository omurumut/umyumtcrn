import { useYear } from "@/context/YearContext";
import { useUnit } from "@/context/UnitContext";
import { useCompany } from "@/context/CompanyContext";
import { useAuth } from "@/context/AuthContext";
import {
  useGetDashboardKpi,
  useGetMonthlyTrend,
  getGetDashboardKpiQueryKey,
  getGetMonthlyTrendQueryKey,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, Flame, Gauge, Leaf,
  Target, ArrowRight, AlertTriangle, BarChart2, Activity,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";

// ── Yardımcı ─────────────────────────────────────────────────────────────────
const API_BASE = "/api";

async function apiFetch<T>(url: string, token: string | null): Promise<T> {
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function fmt(n: number | null | undefined, dec = 1) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ── KPI Kartı ─────────────────────────────────────────────────────────────────
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

// ── Küçük İstatistik Kutusu ───────────────────────────────────────────────────
function StatBox({
  label, value, sub, color, warn,
}: {
  label: string; value: string | number; sub: string; color: string; warn?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-card px-3 py-3 text-center ${warn ? "border-red-500/30 bg-red-500/5" : ""}`}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 leading-tight">{label}</p>
      <p className={`text-xl font-bold ${color}`}>
        {typeof value === "number" ? value.toLocaleString("tr-TR") : value}
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

// ── Overview veri tipi ────────────────────────────────────────────────────────
interface OverviewData {
  year: number;
  seuCount: number;
  activeEnpiCount: number;
  monitoredSeuCount: number;
  unmonitoredSeuCount: number;
  targetsCount: number;
  openActionsCount: number;
  overdueActionsCount: number;
  activeVapCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { year } = useYear();
  const { unitId } = useUnit();
  const { companyId } = useCompany();
  const { token } = useAuth();
  const [, navigate] = useLocation();

  // KPI ve trend için Orval hook parametreleri
  const params = unitId !== null ? { year, unitId } : companyId !== null ? { year, companyId } : { year };

  const { data: kpi, isLoading: kpiLoading } = useGetDashboardKpi(params, {
    query: { queryKey: getGetDashboardKpiQueryKey(params) },
  });
  const { data: trend, isLoading: trendLoading, isFetching: trendFetching } = useGetMonthlyTrend(params, {
    query: { queryKey: getGetMonthlyTrendQueryKey(params) },
  });

  // Enerji Gözden Geçirme özet verisi — energy-review/overview endpoint
  const ovParams = new URLSearchParams({ year: String(year) });
  if (unitId !== null) ovParams.set("unitId", String(unitId));

  const { data: overview, isLoading: ovLoading } = useQuery<OverviewData>({
    queryKey: ["energy-review-overview-dashboard", year, unitId, companyId],
    queryFn: () => apiFetch(`${API_BASE}/energy-review/overview?${ovParams}`, token),
    enabled: token !== null,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{year} Yılı Enerji Performansı</h1>
        <p className="text-sm text-muted-foreground mt-1">ISO 50001 Enerji Yönetim Sistemi — Genel Bakış</p>
      </div>

      {/* ── Temel Enerji KPI Kartları ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)
        ) : (
          <>
            <KpiCard
              title="Toplam TEP"
              value={kpi?.totalTep ?? 0}
              unit="TEP"
              change={kpi?.tepChange}
              icon={Flame}
              color="bg-amber-500"
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
              title="Sayaç Sayısı"
              value={kpi?.meterCount ?? 0}
              unit="adet"
              icon={Gauge}
              color="bg-blue-700"
            />
            <KpiCard
              title="Onaylı ÖEK"
              value={kpi?.activeSeuCount ?? 0}
              unit="kalem"
              icon={Activity}
              color="bg-teal-600"
            />
          </>
        )}
      </div>

      {/* ── ISO 50001 Yönetim Göstergeleri ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          ISO 50001 Yönetim Göstergeleri
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {ovLoading ? (
            Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : (
            <>
              <StatBox
                label="Aktif Hedef"
                value={overview?.targetsCount ?? 0}
                sub="adet"
                color="text-blue-400"
              />
              <StatBox
                label="Açık Aksiyon"
                value={overview?.openActionsCount ?? 0}
                sub="plan / devam"
                color="text-amber-400"
              />
              <StatBox
                label="Gecikmiş Aksiyon"
                value={overview?.overdueActionsCount ?? 0}
                sub="adet"
                color={(overview?.overdueActionsCount ?? 0) > 0 ? "text-red-400" : "text-muted-foreground"}
                warn={(overview?.overdueActionsCount ?? 0) > 0}
              />
              <StatBox
                label="Aktif VAP"
                value={overview?.activeVapCount ?? 0}
                sub="proje"
                color="text-purple-400"
              />
              <StatBox
                label="Aktif EnPG / EnRÇ"
                value={overview?.activeEnpiCount ?? 0}
                sub="model"
                color="text-teal-400"
              />
              <StatBox
                label="İzlenen ÖEK"
                value={overview?.monitoredSeuCount ?? 0}
                sub="adet"
                color="text-green-400"
              />
              <StatBox
                label="İzlenmeyen ÖEK"
                value={overview?.unmonitoredSeuCount ?? 0}
                sub="adet"
                color={(overview?.unmonitoredSeuCount ?? 0) > 0 ? "text-amber-400" : "text-muted-foreground"}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Aylık TEP Trendi ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Aylık Enerji Tüketim Trendi</CardTitle>
          <CardDescription>Son 12 ay — TEP bazında</CardDescription>
        </CardHeader>
        <CardContent>
          {trendLoading || trendFetching ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trend ?? []} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="tepGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="monthName" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={60} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                  formatter={(v: number) => [fmt(v, 3) + " TEP", "Tüketim"]}
                />
                <Area
                  type="monotone"
                  dataKey="tep"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fill="url(#tepGrad)"
                  name="TEP"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Enerji Gözden Geçirme Yönlendirme Kartı ── */}
      <Card
        className="border-primary/20 bg-card/60 cursor-pointer hover:border-primary/40 transition-colors"
        onClick={() => navigate("/enerji-gozden-gecirme")}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <BarChart2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Enerji Gözden Geçirme</CardTitle>
                <CardDescription className="text-xs">
                  ISO 50001:2018 Madde 6.3 — {year} yılı performans özeti
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0">
              Enerji Gözden Geçirmeye Git <ArrowRight className="h-3 w-3 ml-0.5" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {ovLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : overview == null ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Bu dönem için enerji gözden geçirme verisi bulunamadı.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
              <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-center">
                <p className="text-[11px] text-muted-foreground mb-1">Yıl</p>
                <p className="text-xl font-bold">{overview.year}</p>
              </div>
              <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-center">
                <p className="text-[11px] text-muted-foreground mb-1">ÖEK Sayısı</p>
                <p className="text-xl font-bold text-teal-400">{overview.seuCount}</p>
              </div>
              <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-center">
                <p className="text-[11px] text-muted-foreground mb-1">Aktif EnPG / EnRÇ</p>
                <p className="text-xl font-bold text-primary">{overview.activeEnpiCount}</p>
              </div>
              <div className="rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-2.5 text-center">
                <p className="text-[11px] text-muted-foreground mb-1">İzlenen ÖEK</p>
                <p className="text-xl font-bold text-green-400">{overview.monitoredSeuCount}</p>
              </div>
              <div className={`rounded-lg px-3 py-2.5 text-center ${overview.unmonitoredSeuCount > 0 ? "bg-amber-500/10 border border-amber-500/20" : "bg-muted/40"}`}>
                <p className="text-[11px] text-muted-foreground mb-1">İzlenmeyen ÖEK</p>
                <p className={`text-xl font-bold ${overview.unmonitoredSeuCount > 0 ? "text-amber-400" : ""}`}>{overview.unmonitoredSeuCount}</p>
              </div>
              <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-center">
                <p className="text-[11px] text-muted-foreground mb-1">Açık Aksiyon</p>
                <p className="text-xl font-bold text-amber-400">{overview.openActionsCount}</p>
              </div>
              <div className={`rounded-lg px-3 py-2.5 text-center ${overview.overdueActionsCount > 0 ? "bg-red-500/10 border border-red-500/20" : "bg-muted/40"}`}>
                <p className="text-[11px] text-muted-foreground mb-1 flex items-center justify-center gap-1">
                  {overview.overdueActionsCount > 0 && <AlertTriangle className="h-2.5 w-2.5 text-red-400" />}
                  Gecikmiş
                </p>
                <p className={`text-xl font-bold ${overview.overdueActionsCount > 0 ? "text-red-400" : ""}`}>{overview.overdueActionsCount}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hedeflere Git kısa link */}
      <div className="flex justify-end">
        <button
          onClick={() => navigate("/hedefler")}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Target className="h-3 w-3" />
          Hedefler ve Aksiyon Planları <ArrowRight className="h-3 w-3 ml-0.5" />
        </button>
      </div>
    </div>
  );
}
