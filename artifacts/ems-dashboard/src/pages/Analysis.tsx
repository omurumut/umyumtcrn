import { useYear } from "@/context/YearContext";
import { useUnit } from "@/context/UnitContext";
import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import {
  useGetRegressionAnalysis, useGetPerformanceIndicators, useListMeters,
  getGetRegressionAnalysisQueryKey, getGetPerformanceIndicatorsQueryKey, getListMetersQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "lucide-react";
import {
  ScatterChart, Scatter, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";

function MetricCard({ label, value, unit, info, good }: { label: string; value: number | string; unit?: string; info?: string; good?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${good === true ? "text-green-400" : good === false ? "text-red-400" : "text-teal-400"}`}>
          {typeof value === "number" ? value.toLocaleString("tr-TR") : value}
          {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
        </p>
        {info && <p className="text-xs text-muted-foreground mt-1">{info}</p>}
      </CardContent>
    </Card>
  );
}

export default function Analysis() {
  const { year } = useYear();
  const { unitId } = useUnit();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [meterId, setMeterId] = useState<string>("all");

  const unitParam = unitId !== null ? { unitId } : undefined;
  const { data: meters } = useListMeters(unitParam, { query: { queryKey: getListMetersQueryKey(unitParam) } });

  const regParams = {
    year,
    ...(meterId !== "all" ? { meterId: parseInt(meterId) } : {}),
    ...(unitId !== null ? { unitId } : {}),
  };
  const { data: regression, isLoading: regLoading } = useGetRegressionAnalysis(regParams, {
    query: { queryKey: getGetRegressionAnalysisQueryKey(regParams) },
  });

  const perfParams = { year, ...(unitId !== null ? { unitId } : {}) };
  const { data: perf, isLoading: perfLoading } = useGetPerformanceIndicators(perfParams, {
    query: { queryKey: getGetPerformanceIndicatorsQueryKey(perfParams) },
  });

  const scatterData = (regression?.dataPoints ?? []).map(d => ({ x: d.hdd, y: d.actual, month: d.month }));
  const lineData = (regression?.dataPoints ?? []).map(d => ({ hdd: d.hdd, actual: d.actual, predicted: d.predicted, month: d.month })).sort((a, b) => a.hdd - b.hdd);

  const r2 = regression?.r2 ?? 0;
  const r2Quality = r2 >= 0.8 ? "İyi" : r2 >= 0.5 ? "Orta" : "Zayıf";
  const r2Color = r2 >= 0.8 ? "text-green-400" : r2 >= 0.5 ? "text-amber-400" : "text-red-400";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Regresyon Analizi</h1>
          <p className="text-sm text-muted-foreground mt-1">Enerji — HDD korelasyonu ve performans göstergeleri</p>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Sayaç:</Label>
          <Select value={meterId} onValueChange={setMeterId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm Sayaçlar</SelectItem>
              {(meters ?? []).map((m: any) => <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isAdmin && unitId === null ? (
        <Card><CardContent className="py-16 flex flex-col items-center text-muted-foreground">
          <Building2 className="h-10 w-10 mb-3 opacity-30" />
          <p className="font-medium">Birim seçilmedi</p>
          <p className="text-sm mt-1">Üst menüden bir birim seçerek analiz verilerini görüntüleyin</p>
        </CardContent></Card>
      ) : (<>
      {/* Performance Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {perfLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />) : (
          <>
            <MetricCard label="Toplam kWh" value={perf?.totalKwh ?? 0} unit="kWh" info={`${year} yılı toplamı`} />
            <MetricCard label="Toplam TEP" value={perf?.totalTep ?? 0} unit="TEP" />
            <MetricCard label="Toplam CO₂" value={perf?.totalCo2 ?? 0} unit="ton" />
            <MetricCard
              label="İyileşme"
              value={(perf?.improvementPercent ?? 0) > 0 ? `+${perf?.improvementPercent.toFixed(1)}%` : `${perf?.improvementPercent?.toFixed(1) ?? "0.0"}%`}
              info="Geçen yıla göre"
              good={(perf?.improvementPercent ?? 0) < 0}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {regLoading ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24" />) : (
          <>
            <MetricCard label="EnPG" value={regression?.enpg ?? 0} unit="kWh/HDD" info="Enerji Performans Göstergesi" />
            <MetricCard label="EnRÇ" value={regression?.enrc ?? 0} info="Enerji Referans Çizgisi oranı" />
            <MetricCard label="EEI" value={regression?.eei ?? 0} info={`R² = ${regression?.r2?.toFixed(3) ?? "—"} (${r2Quality})`} good={r2 >= 0.7} />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Regresyon Modeli</CardTitle>
          <CardDescription>
            Eğim: {regression?.slope?.toFixed(2) ?? "—"} kWh/HDD | Kesim: {regression?.intercept?.toFixed(0) ?? "—"} kWh |
            <span className={` ml-1 font-semibold ${r2Color}`}>R² = {regression?.r2?.toFixed(3) ?? "—"} ({r2Quality})</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {regLoading ? <Skeleton className="h-64 w-full" /> : lineData.length < 2 ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
              Regresyon için en az 2 aylık HDD'li tüketim verisi gereklidir
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" dataKey="x" name="HDD" label={{ value: "HDD", position: "insideBottom", offset: -5, fill: "hsl(var(--muted-foreground))", fontSize: 11 }} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis type="number" dataKey="y" name="kWh" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={60} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                  formatter={(v: number, name: string) => [v.toLocaleString("tr-TR"), name === "y" ? "Gerçek kWh" : name]}
                />
                <Scatter name="Gerçek Tüketim" data={scatterData} fill="#0d9488" />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {(regression?.dataPoints ?? []).length >= 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Gerçek — Tahmin Karşılaştırması</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={lineData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hdd" name="HDD" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} label={{ value: "HDD", position: "insideBottom", offset: -5, fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={60} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }} />
                <Line type="monotone" dataKey="actual" stroke="#0d9488" strokeWidth={2} dot={{ r: 4 }} name="Gerçek" />
                <Line type="monotone" dataKey="predicted" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Tahmin" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      </>)}
    </div>
  );
}
