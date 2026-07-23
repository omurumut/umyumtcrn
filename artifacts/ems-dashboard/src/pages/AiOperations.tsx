import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, Brain, Database, Eye, Gauge, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCompany } from "@/context/CompanyContext";
import {
  getAiOperationsAnalysisDetail,
  getAiOperationsCompanyUsage,
  getAiOperationsErrors,
  getAiOperationsSummary,
  getAiOperationsTimeseries,
  listAiOperationsAnalyses,
  type AiOperationsAnalysisDetail,
  type AiOperationsAnalyses,
  type AiOperationsSummary,
} from "@/lib/ai-operations-api";
import { analysisTypeLabel, formatDateTime, formatNumber } from "@/components/ai/ai-display";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const RANGE_OPTIONS = [
  { value: "today", label: "Bugun" },
  { value: "7d", label: "Son 7 gun" },
  { value: "30d", label: "Son 30 gun" },
  { value: "month", label: "Bu ay" },
  { value: "custom", label: "Ozel aralik" },
];

const STATUS_LABELS: Record<string, string> = {
  pending: "Bekliyor",
  processing: "Isleniyor",
  completed: "Tamamlandi",
  failed: "Basarisiz",
};

export default function AiOperations() {
  const { token, user } = useAuth();
  const { companyId } = useCompany();
  const isSuperadmin = user?.role === "superadmin";
  const [rangePreset, setRangePreset] = useState("30d");
  const [customFrom, setCustomFrom] = useState(toDateInput(addDays(new Date(), -30)));
  const [customTo, setCustomTo] = useState(toDateInput(new Date()));
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<number | null>(null);
  const range = useMemo(() => resolveRange(rangePreset, customFrom, customTo), [rangePreset, customFrom, customTo]);
  const baseQuery = useMemo(() => ({
    from: range.from,
    to: range.to,
    companyId: isSuperadmin ? companyId : null,
    status: status === "all" ? null : status,
  }), [companyId, isSuperadmin, range.from, range.to, status]);
  const enabled = Boolean(token && user && user.role !== "user");

  const summaryQuery = useQuery({
    queryKey: ["ai-operations-summary", baseQuery],
    queryFn: () => getAiOperationsSummary(token, baseQuery),
    enabled,
  });
  const timeseriesQuery = useQuery({
    queryKey: ["ai-operations-timeseries", baseQuery],
    queryFn: () => getAiOperationsTimeseries(token, baseQuery),
    enabled,
  });
  const errorsQuery = useQuery({
    queryKey: ["ai-operations-errors", baseQuery],
    queryFn: () => getAiOperationsErrors(token, baseQuery),
    enabled,
  });
  const analysesQuery = useQuery({
    queryKey: ["ai-operations-analyses", baseQuery, page],
    queryFn: () => listAiOperationsAnalyses(token, { ...baseQuery, page, pageSize: 20 }),
    enabled,
  });
  const companiesQuery = useQuery({
    queryKey: ["ai-operations-companies", baseQuery],
    queryFn: () => getAiOperationsCompanyUsage(token, baseQuery),
    enabled: enabled && isSuperadmin,
  });
  const detailQuery = useQuery({
    queryKey: ["ai-operations-analysis-detail", selectedAnalysisId, baseQuery],
    queryFn: () => getAiOperationsAnalysisDetail(token, selectedAnalysisId!, baseQuery),
    enabled: enabled && selectedAnalysisId !== null,
  });

  if (user?.role === "user") {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Yetki yok</AlertTitle>
        <AlertDescription>AI operasyonlari yalniz yonetici rolleri tarafindan goruntulenebilir.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6" data-testid="ai-operations-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">AI Operasyonlari</h1>
          <p className="text-sm text-muted-foreground">Pilot AI kullanimi, maliyet tahmini, fallback ve circuit durumlari.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Aralik</Label>
            <Select value={rangePreset} onValueChange={(value) => { setRangePreset(value); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-ops-from">Baslangic</Label>
            <Input id="ai-ops-from" type="date" value={range.from} disabled={rangePreset !== "custom"} onChange={(event) => setCustomFrom(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-ops-to">Bitis</Label>
            <Input id="ai-ops-to" type="date" value={range.to} disabled={rangePreset !== "custom"} onChange={(event) => setCustomTo(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tum statusler</SelectItem>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <SectionState query={summaryQuery} render={(summary) => <SummaryContent summary={summary} />} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gunluk analiz ve cache</CardTitle>
            <CardDescription>{timeseriesQuery.data ? chartSummary(timeseriesQuery.data.points) : "Trend yukleniyor."}</CardDescription>
          </CardHeader>
          <CardContent>
            {timeseriesQuery.isLoading ? <Skeleton className="h-72 w-full" /> : (
              <div className="h-72" aria-label="Gunluk analiz ve cache hit grafigi">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeseriesQuery.data?.points ?? []} margin={{ top: 10, right: 20, bottom: 10, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Line dataKey="total" name="Analiz" stroke="#0f766e" strokeWidth={2} dot={false} />
                    <Line dataKey="cache_hit" name="Cache hit" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basari, fallback ve hata</CardTitle>
            <CardDescription>Renkler tablo metrikleriyle birlikte yorumlanir.</CardDescription>
          </CardHeader>
          <CardContent>
            {timeseriesQuery.isLoading ? <Skeleton className="h-72 w-full" /> : (
              <div className="h-72" aria-label="Basari fallback hata dagilimi grafigi">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeseriesQuery.data?.points ?? []} margin={{ top: 10, right: 20, bottom: 10, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Area dataKey="completed" name="Tamamlandi" fill="#0f766e" stroke="#0f766e" fillOpacity={0.25} />
                    <Area dataKey="fallback" name="Fallback" fill="#d97706" stroke="#d97706" fillOpacity={0.25} />
                    <Area dataKey="failed" name="Basarisiz" fill="#dc2626" stroke="#dc2626" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ErrorsCard items={errorsQuery.data?.items ?? []} isLoading={errorsQuery.isLoading} />
        <AnalysesCard data={analysesQuery.data} isLoading={analysesQuery.isLoading} page={page} setPage={setPage} onOpen={setSelectedAnalysisId} />
      </div>

      {isSuperadmin && (
        <CompanyUsageCard items={companiesQuery.data?.items ?? []} isLoading={companiesQuery.isLoading} />
      )}

      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Guvenlik notu</AlertTitle>
        <AlertDescription>
          Bu ekran prompt, context, sonuc JSON, evidence, ham provider yaniti veya secret gostermez. Maliyet alanlari fatura degil, fiyat kataloguna dayali tahmini API maliyetidir.
        </AlertDescription>
      </Alert>

      <AnalysisDetailDialog detail={detailQuery.data} loading={detailQuery.isLoading} open={selectedAnalysisId !== null} onOpenChange={(open) => !open && setSelectedAnalysisId(null)} />
    </div>
  );
}

function SummaryContent({ summary }: { summary: AiOperationsSummary }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Brain} label="AI global durum" value={summary.global.enabled ? "Acik" : "Kapali"} />
        <Metric icon={ShieldCheck} label="Production data" value={summary.global.productionDataEnabled ? "Gercek firma verisi acik" : "Gercek firma verisi kapali"} />
        <Metric icon={Gauge} label="Provider / model" value={`${summary.global.provider} / ${summary.global.modelConfigured ? "model hazir" : "model eksik"}`} />
        <Metric icon={Activity} label="Pilot health" value={summary.pilotHealth.label} />
        <Metric icon={Database} label="Toplam analiz" value={String(summary.totals.totalRequests)} />
        <Metric icon={RefreshCw} label="Cache hit orani" value={formatPercent(summary.totals.cacheHitRate)} />
        <Metric icon={AlertTriangle} label="Fallback orani" value={formatPercent(summary.totals.fallbackRate)} />
        <Metric icon={Gauge} label="Circuit state" value={summary.circuit.label} />
        <Metric icon={Activity} label="Aktif / stale" value={`${summary.totals.activeProcessing} / ${summary.totals.staleProcessing}`} />
        <Metric icon={Database} label="Provider cagrisi" value={String(summary.totals.providerCalls)} />
        <Metric icon={Brain} label="Token toplam" value={formatNumber(summary.tokens.total)} />
        <Metric icon={Gauge} label={summary.cost.label} value={formatCost(summary.cost.estimatedCost, summary.cost.currency, summary.cost.mixedCurrency)} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <InfoPanel title="Firma AI policy" rows={[
          ["Veri politikasi", summary.policy?.dataPolicy ?? "Kayit yok"],
          ["Gunluk limit", valueOrDash(summary.policy?.dailyAnalysisLimit)],
          ["Aylik limit", valueOrDash(summary.policy?.monthlyAnalysisLimit)],
          ["Fallback", summary.policy?.fallbackEnabled === false ? "Kapali" : "Acik"],
        ]} />
        <InfoPanel title="Token ve maliyet" rows={[
          ["Input token", formatNumber(summary.tokens.input)],
          ["Output token", formatNumber(summary.tokens.output)],
          ["Thinking token", formatNumber(summary.tokens.thinking)],
          ["Bilinmeyen maliyet", String(summary.cost.unknownCount)],
          ["Catalog", summary.cost.pricingCatalogVersion ?? "-"],
        ]} />
        <InfoPanel title="Retention ve son durum" rows={[
          ["Son cleanup", summary.retentionCleanup?.lastRunAt ? formatDateTime(summary.retentionCleanup.lastRunAt) : "-"],
          ["Son basarili analiz", summary.totals.lastCompletedAt ? formatDateTime(summary.totals.lastCompletedAt) : "-"],
          ["Son guvenli hata", summary.totals.lastErrorCode ?? "-"],
          ["Ortalama latency", summary.totals.avgLatencyMs !== null ? `${Math.round(summary.totals.avgLatencyMs)} ms` : "-"],
          ["P95 latency", summary.totals.p95LatencyMs !== null ? `${Math.round(summary.totals.p95LatencyMs)} ms` : "-"],
        ]} />
      </div>
      {summary.circuit.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Circuit breaker durumu</CardTitle>
            <CardDescription>Superadmin icin provider/model detaylari; lease owner ve process bilgisi gosterilmez.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Failure</TableHead>
                  <TableHead>Son hata</TableHead>
                  <TableHead>Son basari</TableHead>
                  <TableHead>Next probe</TableHead>
                  <TableHead>Lease</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.circuit.items.map((item) => (
                  <TableRow key={`${item.provider}:${item.model}`}>
                    <TableCell>{item.provider}</TableCell>
                    <TableCell>{item.model}</TableCell>
                    <TableCell><Badge variant="outline">{item.label}</Badge></TableCell>
                    <TableCell>{item.failureCount}</TableCell>
                    <TableCell>{item.lastFailureCode ?? "-"}</TableCell>
                    <TableCell>{item.lastSuccessAt ? formatDateTime(item.lastSuccessAt) : "-"}</TableCell>
                    <TableCell>{item.nextProbeAt ? formatDateTime(item.nextProbeAt) : "-"}</TableCell>
                    <TableCell>{item.leaseActive ? "Aktif" : "Yok"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ErrorsCard({ items, isLoading }: { items: Array<{ code: string; label: string; group: string; count: number; latestAt: string | null }>; isLoading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hatalar ve engeller</CardTitle>
        <CardDescription>Safe error code dagilimi; ham provider mesajlari gosterilmez.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-56 w-full" /> : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Secili aralikta hata kaydi yok.</p>
        ) : (
          <div className="space-y-4">
            <div className="h-52" aria-label="Hata kodu dagilimi grafigi">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={items}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="code" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" name="Adet" fill="#dc2626" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader><TableRow><TableHead>Kod</TableHead><TableHead>Grup</TableHead><TableHead>Adet</TableHead><TableHead>Son</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.code}><TableCell>{item.code}</TableCell><TableCell>{item.group}</TableCell><TableCell>{item.count}</TableCell><TableCell>{item.latestAt ? formatDateTime(item.latestAt) : "-"}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AnalysesCard({ data, isLoading, page, setPage, onOpen }: { data: AiOperationsAnalyses | undefined; isLoading: boolean; page: number; setPage: (page: number) => void; onOpen: (id: number) => void }) {
  const total = data?.pagination.total ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Aktif ve basarisiz analizler</CardTitle>
        <CardDescription>Liste guvenli operasyon metadata'si ile sinirlidir.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 overflow-auto">
        {isLoading ? <Skeleton className="h-56 w-full" /> : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarih</TableHead><TableHead>Tur</TableHead><TableHead>Status</TableHead><TableHead>Provider</TableHead><TableHead>Cache</TableHead><TableHead>Hata</TableHead><TableHead className="text-right">Detay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.items ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Secili filtrelerde analiz yok.</TableCell></TableRow>
                ) : data!.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap text-xs">{item.createdAt ? formatDateTime(item.createdAt) : "-"}</TableCell>
                    <TableCell>{analysisTypeLabel(item.analysisType as never)}</TableCell>
                    <TableCell><Badge variant="outline">{STATUS_LABELS[item.status] ?? item.status}</Badge></TableCell>
                    <TableCell>{item.provider}</TableCell>
                    <TableCell>{item.cacheHit ? "Hit" : item.fallbackUsed ? "Fallback" : "Miss"}</TableCell>
                    <TableCell>{item.errorCode ?? "-"}</TableCell>
                    <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => onOpen(item.id)}><Eye className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Toplam {total}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Onceki</Button>
                <Button variant="outline" size="sm" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Sonraki</Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CompanyUsageCard({ items, isLoading }: { items: Array<Record<string, unknown>>; isLoading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Firma bazli kullanim</CardTitle>
        <CardDescription>Yalniz superadmin; tenant toplamlarini ayri satirlarda gosterir.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-auto">
        {isLoading ? <Skeleton className="h-56 w-full" /> : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Firma</TableHead><TableHead>Policy</TableHead><TableHead>Provider</TableHead><TableHead>Cache</TableHead><TableHead>Fallback</TableHead><TableHead>Failed</TableHead><TableHead>Token</TableHead><TableHead>Tahmini API maliyeti</TableHead><TableHead>Aktif</TableHead><TableHead>Son analiz</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={String(item.companyId)}>
                  <TableCell>{String(item.companyName)}</TableCell>
                  <TableCell>{String(item.policy)}</TableCell>
                  <TableCell>{String(item.providerCalls)}</TableCell>
                  <TableCell>{String(item.cacheHit)}</TableCell>
                  <TableCell>{String(item.fallback)}</TableCell>
                  <TableCell>{String(item.failed)}</TableCell>
                  <TableCell>{formatNumber(typeof item.totalTokens === "number" ? item.totalTokens : null)}</TableCell>
                  <TableCell>{formatCost(item.estimatedCost as string | number | null, item.currency as string | null, Boolean(item.mixedCurrency))}</TableCell>
                  <TableCell>{String(item.activeProcessing)}</TableCell>
                  <TableCell>{typeof item.lastAnalysisAt === "string" ? formatDateTime(item.lastAnalysisAt) : "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AnalysisDetailDialog({ detail, loading, open, onOpenChange }: { detail: AiOperationsAnalysisDetail | undefined; loading: boolean; open: boolean; onOpenChange: (open: boolean) => void }) {
  const analysis = detail?.analysis ?? {};
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>AI analiz operasyon detayi</DialogTitle>
          <DialogDescription>Prompt, context, sonuc JSON ve provider raw response bu detayda yer almaz.</DialogDescription>
        </DialogHeader>
        {loading ? <Skeleton className="h-80 w-full" /> : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <Metric label="Status" value={String(analysis.status ?? "-")} />
              <Metric label="Provider" value={`${String(analysis.provider ?? "-")} / ${String(analysis.model ?? "-")}`} />
              <Metric label="Cache/Fallback" value={`${analysis.cacheHit ? "Cache" : "Yeni"} / ${analysis.fallbackUsed ? "Fallback" : "Yok"}`} />
              <Metric label="Data sufficiency" value={String(analysis.dataSufficiency ?? "-")} />
              <Metric label="Context truncated" value={analysis.contextTruncated ? "Evet" : "Hayir"} />
              <Metric label="Safe error" value={String(analysis.errorCode ?? "-")} />
            </div>
            <Table>
              <TableHeader>
                <TableRow><TableHead>#</TableHead><TableHead>Provider</TableHead><TableHead>Success</TableHead><TableHead>Error</TableHead><TableHead>Token</TableHead><TableHead>Tahmini API maliyeti</TableHead><TableHead>Latency</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {(detail?.attempts ?? []).map((attempt) => (
                  <TableRow key={String(attempt.attemptNumber)}>
                    <TableCell>{String(attempt.attemptNumber)}</TableCell>
                    <TableCell>{String(attempt.provider)} / {String(attempt.model)}</TableCell>
                    <TableCell>{attempt.success ? "Basarili" : "Basarisiz"}</TableCell>
                    <TableCell>{String(attempt.errorCode ?? "-")}</TableCell>
                    <TableCell>{formatNumber(typeof attempt.totalTokens === "number" ? attempt.totalTokens : null)}</TableCell>
                    <TableCell>{formatCost(attempt.estimatedCost as string | number | null, attempt.currency as string | null, false)}</TableCell>
                    <TableCell>{typeof attempt.latencyMs === "number" ? `${attempt.latencyMs} ms` : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SectionState<T>({ query, render }: { query: { isLoading: boolean; isError: boolean; data?: T }; render: (data: T) => ReactNode }) {
  if (query.isLoading) return <Skeleton className="h-64 w-full" />;
  if (query.isError || !query.data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>AI operasyon ozeti okunamadi</AlertTitle>
        <AlertDescription>Diger bolumler uygunsa yuklenmeye devam eder.</AlertDescription>
      </Alert>
    );
  }
  return render(query.data);
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Activity }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-medium">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function resolveRange(preset: string, customFrom: string, customTo: string) {
  const now = new Date();
  if (preset === "today") return { from: toDateInput(now), to: toDateInput(now) };
  if (preset === "7d") return { from: toDateInput(addDays(now, -6)), to: toDateInput(now) };
  if (preset === "month") return { from: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, to: toDateInput(now) };
  if (preset === "custom") return { from: customFrom, to: customTo };
  return { from: toDateInput(addDays(now, -29)), to: toDateInput(now) };
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatCost(value: string | number | null, currency: string | null, mixedCurrency: boolean) {
  if (mixedCurrency) return "Karma para birimi";
  if (value === null || value === undefined) return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${numeric.toFixed(6)} ${currency ?? ""}`.trim();
}

function valueOrDash(value: number | null | undefined) {
  return value === null || value === undefined ? "-" : String(value);
}

function chartSummary(points: Array<{ total: number; cache_hit: number; fallback: number; failed: number }>) {
  const total = points.reduce((sum, point) => sum + point.total, 0);
  const cache = points.reduce((sum, point) => sum + point.cache_hit, 0);
  const fallback = points.reduce((sum, point) => sum + point.fallback, 0);
  const failed = points.reduce((sum, point) => sum + point.failed, 0);
  return `${total} analiz, ${cache} cache hit, ${fallback} fallback, ${failed} failed.`;
}
