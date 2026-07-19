import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListReports, useGenerateReport, getListReportsQueryKey } from "@workspace/api-client-react";
import { useYear } from "@/context/YearContext";
import { useUnit } from "@/context/UnitContext";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Download, RefreshCw, ClipboardList, Archive } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadBlobResponse, downloadPdfResponse } from "@/lib/download";

type ArchiveItem = {
  id: number;
  reportType: string;
  title: string;
  outputName: string;
  status: string;
  sizeBytes: number | null;
  generatedBy: { id: number | null; name: string } | null;
  generatedAt: string;
  completedAt: string | null;
  year: number | null;
  periodLabel: string | null;
  downloadable: boolean;
  failureCategory: string | null;
};

type ArchiveResponse = {
  items: ArchiveItem[];
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  annual_energy_performance: "Yıllık Enerji Performansı",
  energy_targets_management: "Enerji Hedefleri Yönetimi",
  energy_performance_monitoring: "Enerji Performansı İzleme",
};

function formatBytes(value: number | null): string {
  if (!value || value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Reports() {
  const { year } = useYear();
  const { unitId } = useUnit();
  const { token, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [reportYear, setReportYear] = useState(year.toString());
  const [includeSwot, setIncludeSwot] = useState(true);
  const [includeRisks, setIncludeRisks] = useState(true);
  const [includeSeu, setIncludeSeu] = useState(true);
  const [includeRegression, setIncludeRegression] = useState(true);
  const [annualOverrideTouched, setAnnualOverrideTouched] = useState<Record<string, boolean>>({});

  // ── ISO 50001 Hedef/Eylem/VAP raporu state ─────────────────────────────
  const [targetYear, setTargetYear] = useState(year.toString());
  const [targetStatus, setTargetStatus] = useState("all");
  const [targetIncludeVap, setTargetIncludeVap] = useState(true);
  const [targetIncludeProgress, setTargetIncludeProgress] = useState(true);
  const [targetOverrideTouched, setTargetOverrideTouched] = useState<Record<string, boolean>>({});
  const [targetLoading, setTargetLoading] = useState(false);
  const [archiveType, setArchiveType] = useState("all");
  const [archiveYear, setArchiveYear] = useState("all");
  const [archiveStatus, setArchiveStatus] = useState("completed");
  const [archivePage, setArchivePage] = useState(0);
  const [archiveData, setArchiveData] = useState<ArchiveResponse | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const archiveLimit = 10;

  async function fetchArchive(page = archivePage) {
    if (!token) return;
    if (user?.role === "superadmin") {
      setArchiveData({ items: [], total: 0, limit: archiveLimit, offset: 0, hasNext: false });
      setArchiveError("Superadmin için firma context'i gereklidir.");
      return;
    }
    setArchiveLoading(true);
    setArchiveError(null);
    try {
      const params = new URLSearchParams({ limit: String(archiveLimit), offset: String(page * archiveLimit) });
      if (unitId !== null) params.set("unitId", String(unitId));
      if (archiveType !== "all") params.set("reportType", archiveType);
      if (archiveYear !== "all") params.set("year", archiveYear);
      if (archiveStatus !== "all") params.set("status", archiveStatus);
      const response = await fetch(`/api/reports/archive?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      setArchiveData(body as ArchiveResponse);
      setArchivePage(page);
    } catch (error) {
      setArchiveError(error instanceof Error ? error.message : "Rapor arşivi yüklenemedi.");
    } finally {
      setArchiveLoading(false);
    }
  }

  useEffect(() => {
    void fetchArchive(0);
  }, [token, user?.role, unitId, archiveType, archiveYear, archiveStatus]);

  async function downloadArchiveByUrl(url: string, fallback: string) {
    if (!token) return;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${response.status}`);
      }
      await downloadBlobResponse(response, fallback);
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Rapor indirilemedi.", variant: "destructive" });
    }
  }

  async function downloadArchive(item: ArchiveItem) {
    await downloadArchiveByUrl(`/api/reports/archive/${item.id}/download`, item.outputName);
  }

  async function handleTargetReport() {
    setTargetLoading(true);
    try {
      const params = new URLSearchParams({ year: targetYear });
      if (unitId !== null) params.set("unitId", String(unitId));
      if (targetStatus !== "all") params.set("status", targetStatus);
      if (targetOverrideTouched.includeVap) params.set("includeVap", String(targetIncludeVap));
      if (targetOverrideTouched.includeProgress) params.set("includeProgress", String(targetIncludeProgress));

      const res = await fetch(`/api/reports/energy-targets/pdf?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }

      await downloadPdfResponse(res, `enerji-hedefleri-${targetYear}.pdf`);
      void fetchArchive(0);

      toast({ title: `${targetYear} yılı yönetim raporu indirildi` });
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "Yönetim raporu oluşturulamadı.",
        variant: "destructive",
      });
    } finally {
      setTargetLoading(false);
    }
  }

  const listParams = unitId !== null ? { unitId } : undefined;
  const { data: reports, isLoading } = useListReports({ query: { queryKey: getListReportsQueryKey() } });
  const generate = useGenerateReport();

  const filteredReports = unitId !== null
    ? (reports ?? []).filter((r: any) => r.unitId === unitId)
    : (reports ?? []);

  function handleGenerate() {
    const legacyOverrides = {
      ...(annualOverrideTouched.includeSwot ? { includeSwot } : {}),
      ...(annualOverrideTouched.includeRisks ? { includeRisks } : {}),
      ...(annualOverrideTouched.includeSeu ? { includeSeu } : {}),
      ...(annualOverrideTouched.includeRegression ? { includeRegression } : {}),
    };
    generate.mutate({
      data: {
        year: parseInt(reportYear),
        ...legacyOverrides,
        ...(unitId !== null ? { unitId } : {}),
      },
    }, {
      onSuccess: (result: any) => {
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
        toast({ title: `${reportYear} yılı raporu oluşturuldu` });
        if (result?.downloadUrl) {
          void downloadArchiveByUrl(result.downloadUrl, `enerji-raporu-${reportYear}.html`);
        }
        void fetchArchive(0);
      },
      onError: () => toast({ title: "Rapor oluşturulamadı", variant: "destructive" }),
    });
  }

  function handleDownload(report: any) {
    if (!report.downloadUrl) return;
    const a = document.createElement("a");
    a.href = report.downloadUrl;
    a.download = `enerji-raporu-${report.year}.html`;
    a.click();
  }

  const years = Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Raporlar</h1>
        <p className="text-sm text-muted-foreground mt-1">Yıllık enerji performans raporları</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" /> Rapor Oluştur
          </CardTitle>
          <CardDescription>Seçilen yıl için kapsamlı ISO 50001 enerji performans raporu hazırlanır ve HTML olarak indirilir</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Rapor Yılı</Label>
            <Select value={reportYear} onValueChange={setReportYear}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{years.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block">Dahil Edilecek Bölümler</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "swot", label: "SWOT Analizi", checked: includeSwot, setter: setIncludeSwot },
                { id: "risks", label: "Risk & Fırsat", checked: includeRisks, setter: setIncludeRisks },
                { id: "seu", label: "Önemli Enerji Kullanımları", checked: includeSeu, setter: setIncludeSeu },
                { id: "regression", label: "Regresyon Analizi", checked: includeRegression, setter: setIncludeRegression },
              ].map(item => (
                <div key={item.id} className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-muted/20">
                  <Checkbox
                    id={item.id}
                    checked={item.checked}
                    onCheckedChange={(v) => {
                      item.setter(v === true);
                      setAnnualOverrideTouched((current) => ({ ...current, [`include${item.id === "swot" ? "Swot" : item.id === "risks" ? "Risks" : item.id === "seu" ? "Seu" : "Regression"}`]: true }));
                    }}
                  />
                  <label htmlFor={item.id} className="text-sm cursor-pointer">{item.label}</label>
                </div>
              ))}
            </div>
          </div>

          <Button onClick={handleGenerate} disabled={generate.isPending} className="gap-2 w-full sm:w-auto">
            {generate.isPending ? (
              <><RefreshCw className="h-4 w-4 animate-spin" /> Hazırlanıyor...</>
            ) : (
              <><FileText className="h-4 w-4" /> Rapor Oluştur & İndir</>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4" /> ISO 50001 Hedef, Eylem Planı ve VAP Yönetim Raporu
          </CardTitle>
          <CardDescription>
            Enerji hedefleri, eylem planları, gerçekleşme kayıtları ve VAP bağlantılarını yönetim raporu olarak indirir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Rapor Yılı</Label>
              <Select value={targetYear} onValueChange={setTargetYear}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{years.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Hedef Durumu</Label>
              <Select value={targetStatus} onValueChange={setTargetStatus}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="active">Aktif</SelectItem>
                  <SelectItem value="completed">Tamamlandı</SelectItem>
                  <SelectItem value="cancelled">İptal</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="mb-2 block">Dahil Edilecek Bölümler</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-muted/20">
                <Checkbox
                  id="target-include-vap"
                  checked={targetIncludeVap}
                  onCheckedChange={(v) => {
                    setTargetIncludeVap(v === true);
                    setTargetOverrideTouched((current) => ({ ...current, includeVap: true }));
                  }}
                />
                <label htmlFor="target-include-vap" className="text-sm cursor-pointer">VAP Portföyü</label>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-md border border-border/50 bg-muted/20">
                <Checkbox
                  id="target-include-progress"
                  checked={targetIncludeProgress}
                  onCheckedChange={(v) => {
                    setTargetIncludeProgress(v === true);
                    setTargetOverrideTouched((current) => ({ ...current, includeProgress: true }));
                  }}
                />
                <label htmlFor="target-include-progress" className="text-sm cursor-pointer">Gerçekleşme Kronolojisi</label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Button
              onClick={handleTargetReport}
              disabled={targetLoading}
              className="gap-2 w-full sm:w-auto"
            >
              {targetLoading ? (
                <><RefreshCw className="h-4 w-4 animate-spin" /> Rapor hazırlanıyor...</>
              ) : (
                <><Download className="h-4 w-4" /> PDF Raporu İndir</>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              Rapor güvenli PDF dosyası olarak indirilir.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Archive className="h-4 w-4" /> Rapor Arşivi
          </CardTitle>
          <CardDescription>Oluşturulan raporları tenant kapsamı içinde listeler ve güvenli endpoint üzerinden indirir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>Rapor Türü</Label>
              <Select value={archiveType} onValueChange={(value) => { setArchiveType(value); setArchivePage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="annual_energy_performance">Yıllık Enerji Performansı</SelectItem>
                  <SelectItem value="energy_targets_management">Enerji Hedefleri Yönetimi</SelectItem>
                  <SelectItem value="energy_performance_monitoring">Enerji Performansı İzleme</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Yıl</Label>
              <Select value={archiveYear} onValueChange={(value) => { setArchiveYear(value); setArchivePage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  {years.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Durum</Label>
              <Select value={archiveStatus} onValueChange={(value) => { setArchiveStatus(value); setArchivePage(0); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="completed">Hazır</SelectItem>
                  <SelectItem value="generating">Üretiliyor</SelectItem>
                  <SelectItem value="failed">Hatalı</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="gap-2 w-full" onClick={() => fetchArchive(0)} disabled={archiveLoading}>
                <RefreshCw className={`h-4 w-4 ${archiveLoading ? "animate-spin" : ""}`} /> Yenile
              </Button>
            </div>
          </div>

          {archiveError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{archiveError}</div>
          ) : archiveLoading && !archiveData ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rapor</TableHead>
                    <TableHead>Dönem</TableHead>
                    <TableHead>Oluşturan</TableHead>
                    <TableHead>Tarih</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Boyut</TableHead>
                    <TableHead className="text-right">İndir</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(archiveData?.items ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Seçili filtrelere uygun arşiv kaydı yok</TableCell></TableRow>
                  ) : (
                    archiveData!.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.title}</div>
                          <div className="text-xs text-muted-foreground">{REPORT_TYPE_LABELS[item.reportType] ?? item.reportType}</div>
                        </TableCell>
                        <TableCell>{item.year ?? item.periodLabel ?? "-"}</TableCell>
                        <TableCell>{item.generatedBy?.name ?? "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(item.generatedAt).toLocaleDateString("tr-TR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            item.status === "completed" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                            item.status === "failed" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                            "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }>
                            {item.status === "completed" ? "Hazır" : item.status === "failed" ? `Hata${item.failureCategory ? `: ${item.failureCategory}` : ""}` : "Üretiliyor"}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatBytes(item.sizeBytes)}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={!item.downloadable} onClick={() => downloadArchive(item)}>
                            <Download className="h-3.5 w-3.5" /> İndir
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{archiveData ? `${archiveData.total} kayıt` : ""}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={archivePage <= 0 || archiveLoading} onClick={() => fetchArchive(Math.max(0, archivePage - 1))}>Önceki</Button>
              <Button variant="outline" size="sm" disabled={!archiveData?.hasNext || archiveLoading} onClick={() => fetchArchive(archivePage + 1)}>Sonraki</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Geçmiş Raporlar</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Yıl</TableHead>
                  <TableHead>Oluşturma Tarihi</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead className="text-right">İndir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReports.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">Henüz rapor oluşturulmadı</TableCell></TableRow>
                ) : (
                  [...filteredReports].reverse().map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.year} Yılı Raporu</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={
                          r.status === "complete" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                          r.status === "error" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                          "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        }>
                          {r.status === "complete" ? "Hazır" : r.status === "error" ? "Hata" : "İşleniyor"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {r.downloadUrl && (
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => handleDownload(r)}>
                            <Download className="h-3.5 w-3.5" /> HTML
                          </Button>
                        )}
                      </TableCell>
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
