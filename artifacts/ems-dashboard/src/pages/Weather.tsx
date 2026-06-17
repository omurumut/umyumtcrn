import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListWeather, useFetchWeatherData, getListWeatherQueryKey } from "@workspace/api-client-react";
import { useYear } from "@/context/YearContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { CloudRain, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MONTHS = ["", "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const TR_CITIES = ["Istanbul", "Ankara", "Izmir", "Bursa", "Antalya", "Konya", "Trabzon", "Adana", "Gaziantep", "Kayseri"];

export default function Weather() {
  const { year } = useYear();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location, setLocation] = useState("Istanbul");
  const [fetchYear, setFetchYear] = useState(year.toString());

  const params = { year };
  const { data: weatherData, isLoading } = useListWeather(params, { query: { queryKey: getListWeatherQueryKey(params) } });
  const fetchWeather = useFetchWeatherData();

  function handleFetch() {
    if (!location) { toast({ title: "Lokasyon girin", variant: "destructive" }); return; }
    fetchWeather.mutate({ data: { location, year: parseInt(fetchYear) } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWeatherQueryKey() });
        toast({ title: `${location} için ${fetchYear} yılı HDD/CDD verileri çekildi` });
      },
      onError: () => toast({ title: "Veri çekilemedi", variant: "destructive" }),
    });
  }

  const chartData = (weatherData ?? []).filter(w => w.year === year).map(w => ({
    month: MONTHS[w.month],
    HDD: w.hdd,
    CDD: w.cdd,
    avgTemp: w.avgTemp,
  })).sort((a, b) => MONTHS.indexOf(a.month) - MONTHS.indexOf(b.month));

  const totalHdd = (weatherData ?? []).filter(w => w.year === year).reduce((a, w) => a + w.hdd, 0);
  const totalCdd = (weatherData ?? []).filter(w => w.year === year).reduce((a, w) => a + w.cdd, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Meteoroloji Verileri</h1>
        <p className="text-sm text-muted-foreground mt-1">HDD/CDD verileri — enerji tüketim korelasyonu</p>
      </div>

      {/* Fetch Panel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><CloudRain className="h-4 w-4" /> API'den HDD/CDD Çek</CardTitle>
          <CardDescription>Seçili lokasyon ve yıl için meteorolojik veriler otomatik hesaplanır</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="space-y-1.5">
              <Label>Şehir / Lokasyon</Label>
              <Input
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="ör. Istanbul"
                className="w-48"
                list="city-list"
              />
              <datalist id="city-list">
                {TR_CITIES.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>Yıl</Label>
              <Input
                value={fetchYear}
                onChange={e => setFetchYear(e.target.value)}
                className="w-28"
                type="number"
              />
            </div>
            <Button onClick={handleFetch} disabled={fetchWeather.isPending} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${fetchWeather.isPending ? "animate-spin" : ""}`} />
              {fetchWeather.isPending ? "Çekiliyor..." : "Verileri Çek"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {weatherData && weatherData.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <Card><CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-blue-400">{Math.round(totalHdd)}</p>
            <p className="text-xs text-muted-foreground mt-1">Toplam HDD ({year})</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-amber-400">{Math.round(totalCdd)}</p>
            <p className="text-xs text-muted-foreground mt-1">Toplam CDD ({year})</p>
          </CardContent></Card>
          <Card><CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-teal-400">{(weatherData ?? []).filter(w => w.year === year)[0]?.location ?? "—"}</p>
            <p className="text-xs text-muted-foreground mt-1">Aktif Lokasyon</p>
          </CardContent></Card>
        </div>
      )}

      {/* Chart */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Aylık HDD/CDD Dağılımı — {year}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={45} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="HDD" fill="#1e3a5f" radius={[3, 3, 0, 0]} />
                <Bar dataKey="CDD" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Aylık Meteoroloji Tablosu — {year}</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ay</TableHead>
                  <TableHead>Lokasyon</TableHead>
                  <TableHead className="text-right">HDD</TableHead>
                  <TableHead className="text-right">CDD</TableHead>
                  <TableHead className="text-right">Ort. Sıcaklık (°C)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(weatherData ?? []).filter(w => w.year === year).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Veri yok. Yukarıdan şehir seçerek verileri çekin.</TableCell></TableRow>
                ) : (
                  (weatherData ?? []).filter(w => w.year === year).sort((a, b) => a.month - b.month).map(w => (
                    <TableRow key={w.id}>
                      <TableCell className="font-medium">{MONTHS[w.month]}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{w.location}</TableCell>
                      <TableCell className="text-right font-mono text-blue-400">{w.hdd}</TableCell>
                      <TableCell className="text-right font-mono text-amber-400">{w.cdd}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{w.avgTemp?.toFixed(1) ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
