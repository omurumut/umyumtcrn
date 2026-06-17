import { useState } from "react";
import { useYear } from "@/context/YearContext";
import { useUnit } from "@/context/UnitContext";
import { useGetSummary, getGetSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Zap, Leaf, Flame, Building2,
  LayoutGrid, Table2, ArrowUpDown, ArrowUp, ArrowDown,
  Target, ShieldAlert, AlertTriangle, Gauge,
} from "lucide-react";

const COLORS = ["#0d9488", "#1e3a5f", "#f59e0b", "#ef4444", "#22c55e", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16", "#f97316"];

const TYPE_LABELS: Record<string, string> = {
  fabrika: "Fabrika", ofis: "Ofis", depo: "Depo",
  hastane: "Hastane", okul: "Okul", diger: "Diğer",
};

type SortKey = "totalKwh" | "totalTep" | "totalCo2" | "kwhChange" | "meterCount";
type ViewMode = "cards" | "table";

function KpiCard({ title, value, unit, icon: Icon, color }: { title: string; value: string | number; unit: string; icon: React.ElementType; color: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{title}</p>
            <p className="text-3xl font-bold">{typeof value === "number" ? value.toLocaleString("tr-TR") : value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{unit}</p>
          </div>
          <div className={`p-2.5 rounded-lg ${color}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChangeBadge({ change }: { change: number }) {
  if (change === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const up = change > 0;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${up ? "text-red-400" : "text-green-400"}`}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}{change.toFixed(1)}%
    </span>
  );
}

function UnitCard({ unit, grandTotal, color, idx, onSelect }: { unit: any; grandTotal: number; color: string; idx: number; onSelect: (id: number) => void }) {
  const share = grandTotal > 0 ? (unit.totalKwh / grandTotal) * 100 : 0;
  return (
    <Card
      className="group cursor-pointer hover:border-teal-500/40 hover:shadow-lg transition-all"
      onClick={() => onSelect(unit.id)}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-muted-foreground/60">#{idx + 1}</span>
              <p className="font-semibold text-sm truncate max-w-[160px]">{unit.name}</p>
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge variant="outline" className="text-xs">{TYPE_LABELS[unit.type] ?? unit.type}</Badge>
              {unit.city && <span className="text-xs text-muted-foreground">{unit.city}</span>}
            </div>
          </div>
          <div
            className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-bold"
            style={{ background: color }}
          >
            {unit.name.charAt(0).toUpperCase()}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-end justify-between mb-1">
              <span className="text-xs text-muted-foreground">kWh</span>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold font-mono">{unit.totalKwh.toLocaleString("tr-TR")}</span>
                <ChangeBadge change={unit.kwhChange} />
              </div>
            </div>
            <div className="w-full bg-muted/50 rounded-full h-1.5">
              <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, share)}%`, background: color }} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 text-right">Toplam pay: %{share.toFixed(1)}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted/30 rounded-md p-2">
              <p className="text-xs text-muted-foreground">TEP</p>
              <p className="text-sm font-semibold font-mono">{unit.totalTep.toLocaleString("tr-TR")}</p>
            </div>
            <div className="bg-muted/30 rounded-md p-2">
              <p className="text-xs text-muted-foreground">ton CO₂</p>
              <p className="text-sm font-semibold font-mono">{unit.totalCo2.toLocaleString("tr-TR")}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1 border-t border-border/50 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Gauge className="h-3 w-3" />{unit.meterCount} sayaç</span>
            <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{unit.seuCount} ÖEK</span>
            {unit.swotCount !== undefined && <span className="flex items-center gap-1"><Target className="h-3 w-3" />{unit.swotCount} SWOT</span>}
            {unit.riskCount !== undefined && <span className="flex items-center gap-1"><ShieldAlert className="h-3 w-3" />{unit.riskCount} risk</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Summary() {
  const { year } = useYear();
  const { setUnitId } = useUnit();
  const [view, setView] = useState<ViewMode>("cards");
  const [sortKey, setSortKey] = useState<SortKey>("totalKwh");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data: summary, isLoading } = useGetSummary(
    { year },
    { query: { queryKey: getGetSummaryQueryKey({ year }) } }
  );

  const rawUnits: any[] = summary?.units ?? [];

  const sorted = [...rawUnits].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const topUnits = rawUnits.slice(0, 10);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "desc" ? <ArrowDown className="h-3 w-3 ml-1 text-teal-400" /> : <ArrowUp className="h-3 w-3 ml-1 text-teal-400" />;
  }

  function handleUnitSelect(id: number) {
    setUnitId(id);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{year} Yılı — Çok Birimli Karşılaştırma</h1>
          <p className="text-sm text-muted-foreground mt-1">Tüm birimler genelinde konsolide enerji performansı</p>
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 shrink-0">
          <Button
            size="sm"
            variant={view === "cards" ? "default" : "ghost"}
            className="h-7 px-2.5 gap-1.5"
            onClick={() => setView("cards")}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Kartlar
          </Button>
          <Button
            size="sm"
            variant={view === "table" ? "default" : "ghost"}
            className="h-7 px-2.5 gap-1.5"
            onClick={() => setView("table")}
          >
            <Table2 className="h-3.5 w-3.5" />
            Tablo
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Aktif Birim" value={summary?.unitCount ?? 0} unit="lokasyon" icon={Building2} color="bg-slate-600" />
            <KpiCard title="Toplam Enerji" value={summary?.grandTotalKwh ?? 0} unit="kWh" icon={Zap} color="bg-teal-600" />
            <KpiCard title="Toplam CO₂" value={summary?.grandTotalCo2 ?? 0} unit="ton CO₂" icon={Leaf} color="bg-red-500" />
            <KpiCard title="Toplam TEP" value={summary?.grandTotalTep ?? 0} unit="TEP" icon={Flame} color="bg-amber-500" />
          </div>

          {rawUnits.length === 0 ? (
            <Card>
              <CardContent className="py-16 flex flex-col items-center text-muted-foreground">
                <Building2 className="h-12 w-12 mb-4 opacity-20" />
                <p className="font-medium">Henüz birim tanımlanmamış</p>
                <p className="text-sm mt-1">Birim Yönetimi sayfasından birim ekleyerek başlayın</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {view === "cards" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {sorted.map((u: any, idx: number) => (
                    <UnitCard
                      key={u.id}
                      unit={u}
                      grandTotal={summary?.grandTotalKwh ?? 0}
                      color={COLORS[idx % COLORS.length]}
                      idx={idx}
                      onSelect={handleUnitSelect}
                    />
                  ))}
                </div>
              ) : (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Birim Detay Tablosu</CardTitle>
                    <CardDescription>Başlığa tıklayarak sıralayın. Satıra tıklayarak o birimin verisine geçin.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Sıra</th>
                            <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Birim</th>
                            <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Tür</th>
                            <th className="text-right py-2 px-3 text-xs font-medium cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("totalKwh")}>
                              <span className="inline-flex items-center justify-end">kWh<SortIcon k="totalKwh" /></span>
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-medium cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("totalTep")}>
                              <span className="inline-flex items-center justify-end">TEP<SortIcon k="totalTep" /></span>
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-medium cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("totalCo2")}>
                              <span className="inline-flex items-center justify-end">ton CO₂<SortIcon k="totalCo2" /></span>
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-medium cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("kwhChange")}>
                              <span className="inline-flex items-center justify-end">Değişim<SortIcon k="kwhChange" /></span>
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-medium cursor-pointer hover:text-foreground select-none" onClick={() => toggleSort("meterCount")}>
                              <span className="inline-flex items-center justify-end">Sayaç<SortIcon k="meterCount" /></span>
                            </th>
                            <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">ÖEK</th>
                            <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">SWOT</th>
                            <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Risk</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sorted.map((u: any, idx: number) => (
                            <tr
                              key={u.id}
                              className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                              onClick={() => handleUnitSelect(u.id)}
                            >
                              <td className="py-2.5 px-3">
                                <span className="text-xs font-bold text-muted-foreground">{idx + 1}</span>
                              </td>
                              <td className="py-2.5 px-3">
                                <div>
                                  <p className="font-medium text-sm">{u.name}</p>
                                  <p className="text-xs text-muted-foreground truncate max-w-[180px]">{u.location}</p>
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <Badge variant="outline" className="text-xs">{TYPE_LABELS[u.type] ?? u.type}</Badge>
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-sm">{u.totalKwh.toLocaleString("tr-TR")}</td>
                              <td className="py-2.5 px-3 text-right font-mono text-sm text-muted-foreground">{u.totalTep.toLocaleString("tr-TR")}</td>
                              <td className="py-2.5 px-3 text-right font-mono text-sm text-muted-foreground">{u.totalCo2.toLocaleString("tr-TR")}</td>
                              <td className="py-2.5 px-3 text-right"><ChangeBadge change={u.kwhChange} /></td>
                              <td className="py-2.5 px-3 text-right text-xs text-muted-foreground">{u.meterCount}</td>
                              <td className="py-2.5 px-3 text-right text-xs text-muted-foreground">{u.seuCount}</td>
                              <td className="py-2.5 px-3 text-right text-xs text-muted-foreground">{u.swotCount ?? 0}</td>
                              <td className="py-2.5 px-3 text-right text-xs text-muted-foreground">{u.riskCount ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-border bg-muted/10">
                            <td colSpan={3} className="py-2.5 px-3 text-xs font-bold text-muted-foreground">TOPLAM ({rawUnits.length} birim)</td>
                            <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-teal-400">{(summary?.grandTotalKwh ?? 0).toLocaleString("tr-TR")}</td>
                            <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-muted-foreground">{(summary?.grandTotalTep ?? 0).toLocaleString("tr-TR")}</td>
                            <td className="py-2.5 px-3 text-right font-mono text-sm font-bold text-muted-foreground">{(summary?.grandTotalCo2 ?? 0).toLocaleString("tr-TR")}</td>
                            <td colSpan={5} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Birim Bazında Enerji Tüketimi</CardTitle>
                  <CardDescription>kWh — azalan sıra (ilk {topUnits.length} birim)</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topUnits} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => v.toLocaleString("tr-TR")} />
                      <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                        formatter={(v: number) => [v.toLocaleString("tr-TR") + " kWh", "Tüketim"]}
                      />
                      <Bar dataKey="totalKwh" radius={[0, 4, 4, 0]} name="kWh">
                        {topUnits.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
